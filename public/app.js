import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.min.mjs";
import {
  clampPage,
  clampZoom,
  pageStorageKey,
  legacyPageStorageKey,
} from "./app-utils.mjs";
import {
  PREVIEW_INTERVAL_MS,
  buildPreviewChunk,
  mergePreviewStroke,
} from "./realtime-preview.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.mjs";

const role = document.body.dataset.role;
const isObserver = role === "observer";
const lessonId = new URLSearchParams(location.search).get("lesson") || "default";
const lessonParam = encodeURIComponent(lessonId);
const color = role === "teacher" ? "#e53935" : "#1565c0";
const realtimeClientId =
  sessionStorage.getItem("school:realtimeClientId") || crypto.randomUUID();
sessionStorage.setItem("school:realtimeClientId", realtimeClientId);
const socket = io({ auth: { role, lessonId, clientId: realtimeClientId } });

const statusEl = document.getElementById("status");
const lessonTitleEl = document.getElementById("lessonTitle");
const perfStatsEl = document.getElementById("perfStats");
const pdfCanvas = document.getElementById("pdfCanvas");
const drawCanvas = document.getElementById("drawCanvas");
const pdfCtx = pdfCanvas.getContext("2d");
const drawCtx = drawCanvas.getContext("2d");
const stage = document.getElementById("stage");
const emptyState = document.getElementById("emptyState");
const loadingState = document.getElementById("loadingState");
const loadingText = document.getElementById("loadingText");
const pageInfo = document.getElementById("pageInfo");
const pageInput = document.getElementById("pageInput");
const pageTotal = document.getElementById("pageTotal");
const firstBtn = document.getElementById("firstBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const lastBtn = document.getElementById("lastBtn");
const penBtn = document.getElementById("penBtn");
const eraserBtn = document.getElementById("eraserBtn");
const handBtn = document.getElementById("handBtn");
const lineBtn = document.getElementById("lineBtn");
const arrowBtn = document.getElementById("arrowBtn");
const circleBtn = document.getElementById("circleBtn");
const ovalBtn = document.getElementById("ovalBtn");
const textBtn = document.getElementById("textBtn");
const textSizeSelect = document.getElementById("textSizeSelect");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomResetBtn = document.getElementById("zoomResetBtn");
const zoomInBtn = document.getElementById("zoomInBtn");
const undoBtn = document.getElementById("undoBtn");
const followBtn = document.getElementById("followBtn");
const followStatus = document.getElementById("followStatus");
const uploadInput = document.getElementById("pdfUpload");
const downloadPdfBtn = document.getElementById("downloadPdfBtn");
const observerTeacherPage = document.getElementById("observerTeacherPage");
let teacherLivePage = null;

const snackbar = document.createElement("div");
snackbar.className = "snackbar";
snackbar.setAttribute("role", "status");
snackbar.setAttribute("aria-live", "polite");
snackbar.innerHTML = `
  <div class="snackbar-icon" aria-hidden="true">!</div>
  <div class="snackbar-copy">
    <strong class="snackbar-title"></strong>
    <span class="snackbar-message"></span>
  </div>
  <button class="snackbar-close" type="button" aria-label="Закрыть">×</button>
`;
document.body.appendChild(snackbar);

const snackbarTitle = snackbar.querySelector(".snackbar-title");
const snackbarMessage = snackbar.querySelector(".snackbar-message");
const snackbarClose = snackbar.querySelector(".snackbar-close");
let snackbarTimer;

snackbarClose.addEventListener("click", hideSnackbar);

function showSnackbar({ title, message, type = "error", timeout = 7000 }) {
  clearTimeout(snackbarTimer);
  snackbarTitle.textContent = title;
  snackbarMessage.textContent = message;
  snackbar.classList.remove("success", "error", "visible");
  snackbar.classList.add(type);
  requestAnimationFrame(() => snackbar.classList.add("visible"));
  if (timeout) snackbarTimer = setTimeout(hideSnackbar, timeout);
}

function hideSnackbar() {
  clearTimeout(snackbarTimer);
  snackbar.classList.remove("visible");
}

function humanFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function uploadErrorMessage(status, code) {
  if (status === 413 || code === "PDF_TOO_LARGE") {
    return "Файл слишком большой. Максимальный размер PDF — 100 МБ.";
  }
  if (code === "PDF_REQUIRED") {
    return "Не удалось распознать PDF. Проверьте формат файла и попробуйте ещё раз.";
  }
  if (code === "TEACHER_ONLY") {
    return "Загрузить новый документ можно только со страницы учителя.";
  }
  if (status >= 500) {
    return "Сервер не смог обработать файл. Попробуйте ещё раз через минуту.";
  }
  return "Не удалось загрузить PDF. Проверьте соединение и попробуйте ещё раз.";
}

let pdfDoc = null;
let currentDocumentId = null;
let pageNumber = 1;
let zoom = 1;
let pinchStartDistance = null;
let pinchStartZoom = 1;
let pinchGesture = null;
let handPanLastTouch = null;
let zoomRenderTimer = null;
let tool = "hand";
let strokes = [];
let activeStroke = null;
let activeErasePath = null;
let activeShape = null;
let activeTextMove = null;
let textEditor = null;
let textFontSize = Number(textSizeSelect?.value) || 18;
let previewStrokes = new Map();
let teacherFollowEnabled = false;
let teacherFollowControlling = false;
let teacherFollowPage = 1;
let previewFlushTimer = null;
let previewSentPointCount = 0;
let pingTimer = null;
let perfLogTimer = null;
let reconnects = 0;
let disconnects = 0;
let hasConnectedOnce = false;
let lastPreviewMetricAt = 0;
const previewMetricStarts = new Map();
const perfSessionId =
  sessionStorage.getItem("school:perfSessionId") || crypto.randomUUID();
sessionStorage.setItem("school:perfSessionId", perfSessionId);
const perfMetrics = {
  rtt: null,
  page: null,
  stroke: null,
};

function updatePerfStats() {
  if (!perfStatsEl) return;
  const format = (value) => Number.isFinite(value) ? `${Math.round(value)}мс` : "—";
  perfStatsEl.textContent =
    `RTT ${format(perfMetrics.rtt)} · стр. ${format(perfMetrics.page)} · штрих ${format(perfMetrics.stroke)}`;
}

function measureSocketRtt() {
  if (!socket.connected) return;
  const started = performance.now();
  socket.timeout(4000).emit("perf:ping", {}, (error) => {
    if (error) return;
    perfMetrics.rtt = performance.now() - started;
    updatePerfStats();
  });
}

function sendPerformanceLog() {
  if (isObserver) return;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const payload = {
    role,
    lessonId,
    sessionId: perfSessionId,
    documentId: currentDocumentId,
    page: pageNumber,
    rtt: perfMetrics.rtt,
    pageMs: perfMetrics.page,
    strokeMs: perfMetrics.stroke,
    network: connection?.effectiveType || connection?.type || null,
    downlink: Number.isFinite(connection?.downlink) ? connection.downlink : null,
    browserRtt: Number.isFinite(connection?.rtt) ? connection.rtt : null,
    connected: socket.connected,
    reconnects,
    disconnects,
  };

  fetch("/api/performance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {
    // Diagnostics must never disturb the lesson.
  });
}

socket.on("connect", () => {
  statusEl.textContent = "онлайн";
  if (hasConnectedOnce) reconnects += 1;
  hasConnectedOnce = true;
  clearInterval(pingTimer);
  measureSocketRtt();
  pingTimer = setInterval(measureSocketRtt, 5000);

  clearInterval(perfLogTimer);
  perfLogTimer = setInterval(sendPerformanceLog, 20000);
});
socket.on("disconnect", () => {
  statusEl.textContent = "нет связи";
  disconnects += 1;
  clearInterval(pingTimer);
  pingTimer = null;
  clearInterval(perfLogTimer);
  perfLogTimer = null;
  sendPerformanceLog();
});

socket.on("document:changed", async () => {
  pageNumber = 1;
  updateZoomControls();
  updatePerfStats();
  await async function loadLessonTitle() {
  if (!lessonTitleEl || !lessonId || lessonId === "default") return;
  try {
    const response = await fetch("/api/lessons", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    const lesson = (payload.lessons || []).find((item) => item.id === lessonId);
    if (lesson?.title) lessonTitleEl.textContent = lesson.title;
  } catch {
    // The lesson title is optional UI metadata; lesson loading must not depend on it.
  }
}

loadLessonTitle();
loadDocument();
});

socket.on("stroke:preview", (stroke) => {
  if (stroke.page !== pageNumber) return;
  const current = previewStrokes.get(stroke.id);
  previewStrokes.set(stroke.id, mergePreviewStroke(current, stroke));
  redrawInk();

  if (stroke.metricId && stroke.perfOriginId) {
    socket.emit("perf:preview:seen", {
      metricId: stroke.metricId,
      originId: stroke.perfOriginId,
    });
  }
});

socket.on("stroke:committed", (stroke) => {
  previewStrokes.delete(stroke._id || stroke.id);
  const normalized = { ...stroke, id: stroke._id || stroke.id };
  if (normalized.page === pageNumber && !strokes.some((x) => x.id === normalized.id)) {
    strokes.push(normalized);
    redrawInk();
  }
});

socket.on("text:committed", (item) => {
  const normalized = { ...item, id: item.id || item._id, type: "text" };
  if (normalized.page !== pageNumber) return;
  const index = strokes.findIndex((x) => x.id === normalized.id);
  if (index >= 0) strokes[index] = normalized;
  else strokes.push(normalized);
  redrawInk();
});

socket.on("stroke:deleted", ({ id, page }) => {
  previewStrokes.delete(id);
  if (page !== pageNumber) return;
  strokes = strokes.filter((x) => x.id !== id);
  redrawInk();
});

socket.on("annotations:refresh", ({ page }) => {
  if (page === pageNumber) loadAnnotations();
});

socket.on("perf:preview:seen", ({ metricId } = {}) => {
  const started = previewMetricStarts.get(metricId);
  if (!Number.isFinite(started)) return;
  previewMetricStarts.delete(metricId);
  perfMetrics.stroke = performance.now() - started;
  updatePerfStats();
});

socket.on("teacher:follow:state", async ({ enabled, page, controlling } = {}) => {
  teacherFollowEnabled = Boolean(enabled);
  teacherFollowControlling = Boolean(controlling);
  if (Number.isInteger(Number(page)) && Number(page) > 0) {
    teacherFollowPage = Number(page);
  }

  updateFollowControls();

  if ((role === "student" || isObserver) && teacherFollowEnabled && pdfDoc) {
    await goToPage(teacherFollowPage, { forcedByTeacher: true });
  }
});

socket.on("teacher:page", async ({ page } = {}) => {
  if ((role !== "student" && !isObserver) || !teacherFollowEnabled) return;
  teacherFollowPage = Number(page) || teacherFollowPage;
  await goToPage(teacherFollowPage, { forcedByTeacher: true });
});

socket.on("teacher:monitor:page", ({ page } = {}) => {
  const nextPage = Number(page);
  if (!Number.isInteger(nextPage) || nextPage < 1) return;
  teacherLivePage = nextPage;
  if (observerTeacherPage) {
    observerTeacherPage.hidden = false;
    observerTeacherPage.textContent = `Урок сейчас: стр. ${nextPage}`;
    observerTeacherPage.title = `Перейти на страницу ${nextPage}`;
  }
});

async function goToPage(nextPage, { forcedByTeacher = false } = {}) {
  closeTextEditor({ save: true });
  if (!pdfDoc) return;
  if ((role === "student" || isObserver) && teacherFollowEnabled && !forcedByTeacher) {
    syncPageControls();
    return;
  }
  const clamped = clampPage(nextPage, pdfDoc.numPages);
  if (clamped === pageNumber) {
    syncPageControls();
    return;
  }
  pageNumber = clamped;
  await renderPage();

  if (role === "teacher" && teacherFollowEnabled && teacherFollowControlling) {
    socket.emit("teacher:page", { page: pageNumber });
  }
}

firstBtn.addEventListener("click", () => goToPage(1));
prevBtn.addEventListener("click", () => goToPage(pageNumber - 1));
nextBtn.addEventListener("click", () => goToPage(pageNumber + 1));
lastBtn.addEventListener("click", () => goToPage(pdfDoc?.numPages || 1));

pageInput.addEventListener("change", () => goToPage(pageInput.value));
pageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    pageInput.blur();
    goToPage(pageInput.value);
  }
});

setTool(tool);

penBtn.addEventListener("click", () => setTool("pen"));
eraserBtn.addEventListener("click", () => setTool("eraser"));
handBtn.addEventListener("click", () => setTool("hand"));
lineBtn?.addEventListener("click", () => setTool("line"));
arrowBtn?.addEventListener("click", () => setTool("arrow"));
circleBtn?.addEventListener("click", () => setTool("circle"));
ovalBtn?.addEventListener("click", () => setTool("oval"));
textBtn?.addEventListener("click", () => setTool("text"));
textSizeSelect?.addEventListener("change", () => {
  const next = Number(textSizeSelect.value);
  textFontSize = Number.isFinite(next) ? Math.min(48, Math.max(10, next)) : 18;
  if (textEditor) {
    textEditor.style.fontSize = `${textFontSize}px`;
    textEditor._annotation.fontSize = textFontSize;
    syncTextEditorGeometry();
  }
});
zoomOutBtn.addEventListener("click", () => setZoom(zoom - 0.25));
zoomResetBtn.addEventListener("click", () => setZoom(1));
zoomInBtn.addEventListener("click", () => setZoom(zoom + 0.25));
observerTeacherPage?.addEventListener("click", () => {
  if (teacherLivePage) goToPage(teacherLivePage, { forcedByTeacher: true });
});
undoBtn.addEventListener("click", () => {
  socket.emit("stroke:undo", { page: pageNumber, documentId: currentDocumentId });
});

if (followBtn) {
  followBtn.addEventListener("click", () => {
    followBtn.classList.add("pending");

    if (teacherFollowEnabled && teacherFollowControlling) {
      socket.emit("teacher:follow:stop", {}, (result) => {
        followBtn.classList.remove("pending");
        if (!result?.ok) {
          showSnackbar({
            title: "Не удалось отключить связь страниц",
            message: "Проверьте соединение и попробуйте ещё раз.",
          });
        }
      });
      return;
    }

    if (!currentDocumentId) {
      followBtn.classList.remove("pending");
      showSnackbar({
        title: "Сначала откройте PDF",
        message: "Режим ведения ученика доступен после загрузки учебника.",
      });
      return;
    }

    socket.emit("teacher:follow:start", { page: pageNumber }, (result) => {
      followBtn.classList.remove("pending");
      if (!result?.ok) {
        showSnackbar({
          title: "Не удалось связать страницы",
          message: "Проверьте соединение и попробуйте ещё раз.",
        });
      }
    });
  });
}

if (uploadInput) {
  uploadInput.addEventListener("change", async () => {
    const file = uploadInput.files?.[0];
    if (!file) return;

    if (file.size > 100 * 1024 * 1024) {
      showSnackbar({
        title: "PDF не загружен",
        message: `Файл весит ${humanFileSize(file.size)}. Максимум — 100 МБ.`,
      });
      uploadInput.value = "";
      return;
    }

    statusEl.textContent = "загрузка…";
    const body = new FormData();
    body.append("pdf", file);

    try {
      const res = await fetch(`/api/document?lesson=${lessonParam}`, {
        method: "POST",
        headers: { "x-role": "teacher" },
        body,
      });

      let payload = {};
      try {
        payload = await res.json();
      } catch {
        // Some proxy/server failures return HTML or an empty body.
      }

      if (!res.ok) {
        throw Object.assign(new Error("UPLOAD_FAILED"), {
          status: res.status,
          code: payload.error,
        });
      }

      statusEl.textContent = "онлайн";
      const sizeNote = payload.compressed
        ? `Сжато: ${humanFileSize(payload.originalSize)} → ${humanFileSize(payload.storedSize)}.`
        : `Размер: ${humanFileSize(payload.storedSize || file.size)}.`;

      showSnackbar({
        title: "PDF загружен",
        message: sizeNote,
        type: "success",
        timeout: 4500,
      });
    } catch (error) {
      statusEl.textContent = socket.connected ? "онлайн" : "нет связи";
      showSnackbar({
        title: "PDF не загружен",
        message: uploadErrorMessage(error.status || 0, error.code),
        type: "error",
        timeout: 9000,
      });
    } finally {
      uploadInput.value = "";
    }
  });
}

if (!isObserver) {
  drawCanvas.addEventListener("pointerdown", onPointerDown);
  drawCanvas.addEventListener("pointermove", onPointerMove);
  drawCanvas.addEventListener("pointerup", onPointerUp);
  drawCanvas.addEventListener("pointercancel", onPointerUp);
} else {
  drawCanvas.style.pointerEvents = "none";
  drawCanvas.style.cursor = "default";
  stage.classList.add("hand-mode");
}

function updateFollowControls() {
  if (followBtn) {
    followBtn.classList.toggle("active", teacherFollowEnabled && teacherFollowControlling);
    followBtn.classList.toggle("takeover", teacherFollowEnabled && !teacherFollowControlling);
    followBtn.textContent =
      teacherFollowEnabled && teacherFollowControlling
        ? "🔗 Страницы связаны"
        : teacherFollowEnabled
          ? "↔ Перехватить ведение"
          : "🔗 Вести ученика";
    followBtn.disabled = false;
    followBtn.setAttribute("aria-pressed", String(teacherFollowEnabled && teacherFollowControlling));
  }

  if (followStatus) {
    followStatus.hidden = !teacherFollowEnabled;
    followStatus.textContent = teacherFollowEnabled
      ? `🔗 Учитель ведёт страницу · ${teacherFollowPage}`
      : "";
  }
}

function updateZoomControls() {
  const percent = Math.round(zoom * 100);
  zoomResetBtn.textContent = `${percent}%`;
  zoomOutBtn.disabled = zoom <= 0.75;
  zoomInBtn.disabled = zoom >= 3;
}

function setZoom(nextZoom) {
  const clamped = clampZoom(nextZoom);
  if (Math.abs(clamped - zoom) < 0.001) {
    updateZoomControls();
    return;
  }

  zoom = clamped;
  updateZoomControls();

  clearTimeout(zoomRenderTimer);
  zoomRenderTimer = setTimeout(() => {
    if (pdfDoc) renderPage();
  }, 70);
}

function setTool(nextTool) {
  tool = nextTool;
  penBtn.classList.toggle("active", tool === "pen");
  eraserBtn.classList.toggle("active", tool === "eraser");
  handBtn.classList.toggle("active", tool === "hand");
  lineBtn?.classList.toggle("active", tool === "line");
  arrowBtn?.classList.toggle("active", tool === "arrow");
  circleBtn?.classList.toggle("active", tool === "circle");
  ovalBtn?.classList.toggle("active", tool === "oval");
  textBtn?.classList.toggle("active", tool === "text");

  if (tool === "hand") {
    drawCanvas.style.pointerEvents = "none";
    drawCanvas.style.cursor = "grab";
    stage.classList.add("hand-mode");
  } else {
    drawCanvas.style.pointerEvents = "auto";
    drawCanvas.style.cursor =
      tool === "eraser" ? "cell" : tool === "text" ? "text" : "crosshair";
    stage.classList.remove("hand-mode");
  }
}

function pointFromEvent(event) {
  const rect = drawCanvas.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  };
}

function textAtPoint(point) {
  for (let i = strokes.length - 1; i >= 0; i -= 1) {
    const item = strokes[i];
    if (item.type !== "text" || !item.box) continue;
    const { x, y, w, h } = item.box;
    if (point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h) {
      return item;
    }
  }
  return null;
}

function syncTextEditorGeometry() {
  if (!textEditor) return;
  const shell = document.getElementById("pageShell");
  const editor = textEditor;
  const item = editor._annotation;
  if (!shell || !item) return;

  editor.style.height = "auto";
  const heightPx = Math.max(textFontSize * 1.45, editor.scrollHeight + 2);
  editor.style.height = `${heightPx}px`;

  const widthPx = editor.offsetWidth;
  let leftPx = Number.parseFloat(editor.style.left) || 0;
  let topPx = Number.parseFloat(editor.style.top) || 0;

  leftPx = Math.max(0, Math.min(leftPx, Math.max(0, shell.clientWidth - widthPx)));
  topPx = Math.max(0, Math.min(topPx, Math.max(0, shell.clientHeight - heightPx)));

  editor.style.left = `${leftPx}px`;
  editor.style.top = `${topPx}px`;

  item.box = {
    x: leftPx / shell.clientWidth,
    y: topPx / shell.clientHeight,
    w: Math.min(1, widthPx / shell.clientWidth),
    h: Math.min(1, heightPx / shell.clientHeight),
  };
  item.fontSize = textFontSize;
  item.fontScale = textFontSize / shell.clientWidth;
}

function closeTextEditor({ save = true } = {}) {
  if (!textEditor) return;
  syncTextEditorGeometry();

  const editor = textEditor;
  textEditor = null;
  const text = editor.value.trim();
  const item = editor._annotation;
  editor.remove();

  if (!save || !text || !item) {
    redrawInk();
    return;
  }

  const saved = { ...item, text };
  const index = strokes.findIndex((x) => x.id === saved.id);
  if (index >= 0) strokes[index] = saved;
  else strokes.push(saved);
  socket.emit("text:commit", { ...saved, documentId: currentDocumentId });
  redrawInk();
}

function openTextEditor(point) {
  closeTextEditor({ save: true });
  const shell = document.getElementById("pageShell");
  if (!shell) return;

  const editor = document.createElement("textarea");
  editor.className = "text-annotation-editor";
  editor.placeholder = "Введите текст…";

  const clickX = Math.max(0, Math.min(point.x * shell.clientWidth, shell.clientWidth - 1));
  const clickY = Math.max(0, Math.min(point.y * shell.clientHeight, shell.clientHeight - 1));
  const preferredWidthPx = Math.max(180, shell.clientWidth * 0.38);
  const remainingWidthPx = Math.max(1, shell.clientWidth - clickX);
  const widthPx = Math.min(preferredWidthPx, remainingWidthPx);
  const leftPx = clickX;
  const topPx = Math.max(0, Math.min(clickY, shell.clientHeight - textFontSize * 1.6));

  editor.style.left = `${leftPx}px`;
  editor.style.top = `${topPx}px`;
  editor.style.width = `${widthPx}px`;
  editor.style.fontSize = `${textFontSize}px`;
  editor._annotation = {
    id: crypto.randomUUID(),
    type: "text",
    page: pageNumber,
    role: "teacher",
    color: "#e53935",
    fontSize: textFontSize,
    fontScale: textFontSize / shell.clientWidth,
    box: {
      x: leftPx / shell.clientWidth,
      y: topPx / shell.clientHeight,
      w: widthPx / shell.clientWidth,
      h: Math.min(1, (textFontSize * 1.6) / shell.clientHeight),
    },
    text: "",
  };

  editor.addEventListener("input", syncTextEditorGeometry);
  editor.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeTextEditor({ save: false });
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      closeTextEditor({ save: true });
    }
  });
  editor.addEventListener("blur", () => closeTextEditor({ save: true }), { once: true });

  shell.appendChild(editor);
  textEditor = editor;
  syncTextEditorGeometry();
  // Focus during the original pointer gesture. Mobile browsers may refuse or
  // immediately dismiss the soft keyboard when focus is deferred to the next frame.
  try {
    editor.focus({ preventScroll: true });
  } catch {
    editor.focus();
  }
}

function erasePathHitsTextBox(erase, box) {
  if (!box) return false;
  const pad = erase.radius;
  return erase.points.some(
    (p) =>
      p.x >= box.x - pad &&
      p.x <= box.x + box.w + pad &&
      p.y >= box.y - pad &&
      p.y <= box.y + box.h + pad
  );
}

function drawTextAnnotation(item) {
  if (!item.box || !item.text) return;
  const { x, y, w } = item.box;
  const px = x * drawCanvas.width;
  const py = y * drawCanvas.height;
  const maxWidth = Math.max(1, w * drawCanvas.width);
  const outputScale = drawCanvas.width / Math.max(1, drawCanvas.getBoundingClientRect().width);
  const legacyCssPx = item.fontSize || 18;
  const cssFontSize = Number.isFinite(item.fontScale)
    ? item.fontScale * drawCanvas.getBoundingClientRect().width
    : legacyCssPx;
  const fontSize = cssFontSize * outputScale;

  drawCtx.save();
  drawCtx.fillStyle = item.color || "#e53935";
  drawCtx.font = `${fontSize}px system-ui, sans-serif`;
  drawCtx.textBaseline = "top";

  const lineHeight = fontSize * 1.2;
  let cursorY = py;
  for (const paragraph of String(item.text).split("\n")) {
    if (!paragraph) {
      cursorY += lineHeight;
      continue;
    }
    const words = paragraph.split(/\s+/);
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (drawCtx.measureText(test).width > maxWidth && line) {
        drawCtx.fillText(line, px, cursorY);
        cursorY += lineHeight;
        line = word;
      } else {
        line = test;
      }
    }
    if (line) {
      drawCtx.fillText(line, px, cursorY);
      cursorY += lineHeight;
    }
  }
  drawCtx.restore();
}

function flushStrokePreview() {
  if (!activeStroke) return;

  const chunk = buildPreviewChunk(activeStroke, previewSentPointCount);
  if (!chunk) return;

  const now = performance.now();
  if (now - lastPreviewMetricAt >= 2000) {
    const metricId = crypto.randomUUID();
    chunk.metricId = metricId;
    previewMetricStarts.set(metricId, now);
    lastPreviewMetricAt = now;

    setTimeout(() => previewMetricStarts.delete(metricId), 10000);
  }

  socket.emit("stroke:preview", { ...chunk, documentId: currentDocumentId });
  previewSentPointCount = activeStroke.points.length;
}

function scheduleStrokePreview() {
  if (previewFlushTimer) return;

  previewFlushTimer = setTimeout(() => {
    previewFlushTimer = null;
    flushStrokePreview();
  }, PREVIEW_INTERVAL_MS);
}

function resetStrokePreviewQueue() {
  clearTimeout(previewFlushTimer);
  previewFlushTimer = null;
  previewSentPointCount = 0;
}

function shapeToolActive() {
  return ["line", "arrow", "circle", "oval"].includes(tool);
}

function clampPoint(point) {
  return {
    x: Math.max(0, Math.min(1, point.x)),
    y: Math.max(0, Math.min(1, point.y)),
  };
}

function buildShapeStroke(shape) {
  if (!shape) return null;
  const start = shape.start;
  const end = shape.current;
  const rect = drawCanvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  let points = [];

  if (shape.kind === "line") {
    points = [start, end];
  } else if (shape.kind === "arrow") {
    const sx = start.x * width;
    const sy = start.y * height;
    const ex = end.x * width;
    const ey = end.y * height;
    const dx = ex - sx;
    const dy = ey - sy;
    const length = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / length;
    const uy = dy / length;
    const head = Math.max(10, Math.min(28, length * 0.22));
    const wing = head * 0.58;
    const baseX = ex - ux * head;
    const baseY = ey - uy * head;
    const perpX = -uy;
    const perpY = ux;
    const left = clampPoint({
      x: (baseX + perpX * wing) / width,
      y: (baseY + perpY * wing) / height,
    });
    const right = clampPoint({
      x: (baseX - perpX * wing) / width,
      y: (baseY - perpY * wing) / height,
    });
    points = [start, end, left, end, right];
  } else {
    let x1 = start.x;
    let y1 = start.y;
    let x2 = end.x;
    let y2 = end.y;

    if (shape.kind === "circle") {
      const dxPx = (end.x - start.x) * width;
      const dyPx = (end.y - start.y) * height;
      const sizePx = Math.max(Math.abs(dxPx), Math.abs(dyPx));
      x2 = start.x + Math.sign(dxPx || 1) * (sizePx / width);
      y2 = start.y + Math.sign(dyPx || 1) * (sizePx / height);
      x2 = Math.max(0, Math.min(1, x2));
      y2 = Math.max(0, Math.min(1, y2));
    }

    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const rx = Math.abs(x2 - x1) / 2;
    const ry = Math.abs(y2 - y1) / 2;
    const steps = 48;
    for (let i = 0; i <= steps; i += 1) {
      const angle = (i / steps) * Math.PI * 2;
      points.push({
        x: cx + Math.cos(angle) * rx,
        y: cy + Math.sin(angle) * ry,
      });
    }
  }

  return {
    id: shape.id,
    page: pageNumber,
    role,
    color,
    width: 2.5,
    points,
  };
}

function onPointerDown(event) {
  if (!pdfDoc || tool === "hand") return;

  const point = pointFromEvent(event);

  if (tool === "text") {
    if (role !== "teacher") return;
    // Keep a mobile tap from turning into a follow-up canvas click that
    // immediately blurs the textarea and dismisses the virtual keyboard.
    event.preventDefault();

    const existing = textAtPoint(point);
    if (existing) {
      closeTextEditor({ save: true });
      activeTextMove = {
        id: existing.id,
        offsetX: point.x - existing.box.x,
        offsetY: point.y - existing.box.y,
      };
      redrawInk();
      return;
    }

    openTextEditor(point);
    return;
  }

  drawCanvas.setPointerCapture(event.pointerId);

  if (shapeToolActive()) {
    activeShape = {
      id: crypto.randomUUID(),
      kind: tool,
      start: point,
      current: point,
    };
    redrawInk();
    return;
  }

  if (tool === "eraser") {
    activeErasePath = {
      page: pageNumber,
      radius: 0.022,
      points: [point],
    };
    redrawInk();
    return;
  }

  activeStroke = {
    id: crypto.randomUUID(),
    page: pageNumber,
    role,
    color,
    width: event.pointerType === "pen" ? 2.25 : 2.5,
    points: [point, point],
  };

  resetStrokePreviewQueue();
  flushStrokePreview();
  redrawInk();
}

function onPointerMove(event) {
  if (tool === "hand") return;
  const point = pointFromEvent(event);

  if (activeTextMove) {
    const item = strokes.find((x) => x.id === activeTextMove.id && x.type === "text");
    if (!item?.box) return;
    item.box = {
      ...item.box,
      x: Math.max(0, Math.min(1 - item.box.w, point.x - activeTextMove.offsetX)),
      y: Math.max(0, Math.min(1 - item.box.h, point.y - activeTextMove.offsetY)),
    };
    redrawInk();
    return;
  }

  if (activeShape) {
    activeShape.current = point;
    redrawInk();
    return;
  }

  if (activeErasePath) {
    activeErasePath.points.push(point);
    redrawInk();
    return;
  }

  if (!activeStroke) return;
  activeStroke.points.push(point);
  scheduleStrokePreview();
  redrawInk();
}

function onPointerUp(event) {
  if (tool === "hand") return;

  if (activeTextMove) {
    const item = strokes.find((x) => x.id === activeTextMove.id && x.type === "text");
    activeTextMove = null;
    if (item) socket.emit("text:commit", { ...item, documentId: currentDocumentId });
    redrawInk();
    return;
  }

  if (activeShape) {
    activeShape.current = pointFromEvent(event);
    const finished = buildShapeStroke(activeShape);
    activeShape = null;
    if (finished?.points?.length >= 2) {
      strokes.push(finished);
      socket.emit("stroke:commit", { ...finished, documentId: currentDocumentId });
    }
    redrawInk();
    return;
  }

  if (activeErasePath) {
    const erase = activeErasePath;
    activeErasePath = null;
    if (erase.points.length === 1) erase.points.push(erase.points[0]);

    strokes = strokes.flatMap((stroke) => {
      if (role !== "teacher" && stroke.role !== role) return [stroke];
      if (stroke.type === "text") {
        return erasePathHitsTextBox(erase, stroke.box) ? [] : [stroke];
      }
      return splitStrokeForErase(stroke, erase);
    });

    socket.emit("erase:path", { ...erase, documentId: currentDocumentId });
    redrawInk();
    return;
  }

  if (!activeStroke) return;
  flushStrokePreview();
  const finished = activeStroke;
  activeStroke = null;
  resetStrokePreviewQueue();
  strokes.push(finished);
  previewStrokes.delete(finished.id);
  socket.emit("stroke:commit", { ...finished, documentId: currentDocumentId });
  redrawInk();
}

function distanceToErasePath(point, erasePath) {
  let best = Infinity;
  for (const e of erasePath.points) {
    best = Math.min(best, Math.hypot(point.x - e.x, point.y - e.y));
  }
  return best;
}

function splitStrokeForErase(stroke, erasePath) {
  const parts = [];
  let current = [];

  for (const point of stroke.points) {
    const erased = distanceToErasePath(point, erasePath) <= erasePath.radius;
    if (erased) {
      if (current.length >= 2) {
        parts.push({
          ...stroke,
          id: `${stroke.id || stroke._id}-local-${parts.length}`,
          points: current,
        });
      }
      current = [];
    } else {
      current.push(point);
    }
  }

  if (current.length >= 2) {
    parts.push({
      ...stroke,
      id: `${stroke.id || stroke._id}-local-${parts.length}`,
      points: current,
    });
  }

  return parts;
}

function erasePreviewSegments(stroke) {
  if (!activeErasePath) return [stroke];
  if (role !== "teacher" && stroke.role !== role) return [stroke];
  return splitStrokeForErase(stroke, activeErasePath);
}

async function loadDocument() {
  pdfDoc = null;
  if (downloadPdfBtn) {
    downloadPdfBtn.hidden = true;
    downloadPdfBtn.removeAttribute("href");
  }
  stage.hidden = true;
  emptyState.hidden = true;
  loadingState.hidden = false;
  loadingText.textContent = "Проверяем документ…";
  syncPageControls();

  try {
    const res = await fetch(`/api/document?lesson=${lessonParam}`, { cache: "no-store" });

    if (res.status === 404) {
      loadingState.hidden = true;
      emptyState.hidden = false;
      return;
    }

    if (!res.ok) {
      throw new Error(`DOCUMENT_METADATA_${res.status}`);
    }

    const documentMeta = await res.json();
    currentDocumentId = documentMeta.id;
    if (downloadPdfBtn) {
      downloadPdfBtn.href = `/api/document/file?id=${encodeURIComponent(documentMeta.id)}&lesson=${lessonParam}&download=1`;
      downloadPdfBtn.hidden = false;
    }
    loadingText.textContent = "Скачиваем PDF…";

    const loadingTask = pdfjsLib.getDocument(
      `/api/document/file?id=${encodeURIComponent(documentMeta.id)}&lesson=${lessonParam}`
    );
    loadingTask.onProgress = ({ loaded, total }) => {
      if (total > 0) {
        const percent = Math.min(100, Math.round((loaded / total) * 100));
        loadingText.textContent = `Скачиваем PDF… ${percent}%`;
      } else if (loaded > 0) {
        loadingText.textContent = `Скачиваем PDF… ${humanFileSize(loaded)}`;
      }
    };

    pdfDoc = await loadingTask.promise;
    const pageKey = pageStorageKey(documentMeta.id, role);
    const legacyPageKey = legacyPageStorageKey(documentMeta.id, role);
    const savedPage = Number(
      localStorage.getItem(pageKey) ?? localStorage.getItem(legacyPageKey)
    );
    if (role === "student" && teacherFollowEnabled) {
      pageNumber = clampPage(teacherFollowPage, pdfDoc.numPages);
    } else if (Number.isInteger(savedPage) && savedPage >= 1) {
      pageNumber = Math.min(savedPage, pdfDoc.numPages);
    } else {
      pageNumber = Math.min(pageNumber, pdfDoc.numPages);
    }

    loadingText.textContent =
      pageNumber === 1 ? "Готовим первую страницу…" : `Открываем страницу ${pageNumber}…`;
    await renderPage();

    loadingState.hidden = true;
    emptyState.hidden = true;
    stage.hidden = false;
  } catch (error) {
    console.error("Failed to load PDF:", error);
    pdfDoc = null;
    stage.hidden = true;
    loadingState.hidden = true;
    emptyState.hidden = false;
    emptyState.textContent =
      role === "teacher"
        ? "Не удалось открыть PDF. Попробуйте обновить страницу или загрузить файл заново."
        : "Не удалось скачать PDF. Проверьте соединение и обновите страницу.";
    currentDocumentId = null;
    syncPageControls();
  }
}

function syncPageControls() {
  if (!pdfDoc) {
    pageInput.value = "";
    pageTotal.textContent = "/ —";
    firstBtn.disabled = true;
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    lastBtn.disabled = true;
    pageInput.disabled = true;
    updateFollowControls();
    return;
  }

  pageInput.value = String(pageNumber);
  pageInput.max = String(pdfDoc.numPages);
  pageTotal.textContent = `/ ${pdfDoc.numPages}`;
  const lockedToTeacher = role === "student" && teacherFollowEnabled;
  pageInput.disabled = lockedToTeacher;
  firstBtn.disabled = lockedToTeacher || pageNumber <= 1;
  prevBtn.disabled = lockedToTeacher || pageNumber <= 1;
  nextBtn.disabled = lockedToTeacher || pageNumber >= pdfDoc.numPages;
  lastBtn.disabled = lockedToTeacher || pageNumber >= pdfDoc.numPages;
  updateFollowControls();
}

async function renderPage() {
  const renderStarted = performance.now();
  const page = await pdfDoc.getPage(pageNumber);

  const baseViewport = page.getViewport({ scale: 1 });
  const stageWidth = Math.max(320, (stage?.clientWidth || window.innerWidth) - 8);
  const isTabletLandscape =
    window.matchMedia("(orientation: landscape)").matches &&
    window.innerWidth <= 1400 &&
    window.innerHeight <= 1100;
  const chromeHeight = 126;
  const stageHeight = Math.max(320, window.innerHeight - chromeHeight);
  const widthScale = stageWidth / baseViewport.width;
  const heightScale = stageHeight / baseViewport.height;
  const fitScale = isTabletLandscape ? Math.min(widthScale, heightScale) : widthScale;
  const scale = fitScale * zoom;
  const viewport = page.getViewport({ scale });

  const outputScale = Math.min(window.devicePixelRatio || 1, 2);

  pdfCanvas.width = Math.floor(viewport.width * outputScale);
  pdfCanvas.height = Math.floor(viewport.height * outputScale);
  pdfCanvas.style.width = `${Math.floor(viewport.width)}px`;
  pdfCanvas.style.height = `${Math.floor(viewport.height)}px`;

  drawCanvas.width = pdfCanvas.width;
  drawCanvas.height = pdfCanvas.height;
  drawCanvas.style.width = pdfCanvas.style.width;
  drawCanvas.style.height = pdfCanvas.style.height;

  document.getElementById("pageShell").style.width = pdfCanvas.style.width;
  document.getElementById("pageShell").style.height = pdfCanvas.style.height;

  await page.render({
    canvasContext: pdfCtx,
    viewport,
    transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
  }).promise;

  syncPageControls();
  if (currentDocumentId) {
    localStorage.setItem(
      pageStorageKey(currentDocumentId, role),
      String(pageNumber)
    );
  }

  await loadAnnotations();
  perfMetrics.page = performance.now() - renderStarted;
  updatePerfStats();
  if (role === "teacher") {
    socket.emit("teacher:monitor:page", { page: pageNumber });
  }
}

async function loadAnnotations() {
  previewStrokes.clear();
  const res = await fetch(`/api/annotations/${pageNumber}?lesson=${lessonParam}`);
  strokes = res.ok ? await res.json() : [];
  redrawInk();
}

function redrawInk() {
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

  for (const stroke of strokes) {
    if (stroke.type === "text") {
      if (!activeErasePath || !erasePathHitsTextBox(activeErasePath, stroke.box)) {
        drawTextAnnotation(stroke);
      }
      continue;
    }
    for (const visiblePart of erasePreviewSegments(stroke)) drawStroke(visiblePart);
  }
  for (const stroke of previewStrokes.values()) drawStroke(stroke);
  if (activeStroke) drawStroke(activeStroke);
  if (activeTextMove) {
    const item = strokes.find((x) => x.id === activeTextMove.id && x.type === "text");
    if (item?.box) {
      drawCtx.save();
      drawCtx.strokeStyle = "rgba(229,57,53,.72)";
      drawCtx.setLineDash([6, 5]);
      drawCtx.lineWidth = 1.5 * (window.devicePixelRatio || 1);
      drawCtx.strokeRect(
        item.box.x * drawCanvas.width,
        item.box.y * drawCanvas.height,
        item.box.w * drawCanvas.width,
        item.box.h * drawCanvas.height
      );
      drawCtx.restore();
    }
  }
  if (activeShape) {
    const shapePreview = buildShapeStroke(activeShape);
    if (shapePreview) drawStroke(shapePreview);
  }
  if (activeErasePath?.points?.length) drawEraserCursor(activeErasePath.points.at(-1));
}

function drawEraserCursor(point) {
  const radius = activeErasePath.radius * Math.min(drawCanvas.width, drawCanvas.height);
  drawCtx.save();
  drawCtx.beginPath();
  drawCtx.arc(point.x * drawCanvas.width, point.y * drawCanvas.height, radius, 0, Math.PI * 2);
  drawCtx.fillStyle = "rgba(255,255,255,.72)";
  drawCtx.strokeStyle = "rgba(23,32,42,.45)";
  drawCtx.lineWidth = 1.5;
  drawCtx.fill();
  drawCtx.stroke();
  drawCtx.restore();
}

function drawStroke(stroke) {
  if (stroke.type === "text") return drawTextAnnotation(stroke);
  if (!stroke.points?.length) return;

  drawCtx.save();
  drawCtx.lineCap = "round";
  drawCtx.lineJoin = "round";
  drawCtx.strokeStyle = stroke.color;
  drawCtx.lineWidth = stroke.width * (window.devicePixelRatio || 1);

  drawCtx.beginPath();
  const first = stroke.points[0];
  drawCtx.moveTo(first.x * drawCanvas.width, first.y * drawCanvas.height);

  for (let i = 1; i < stroke.points.length; i += 1) {
    const p = stroke.points[i];
    drawCtx.lineTo(p.x * drawCanvas.width, p.y * drawCanvas.height);
  }

  drawCtx.stroke();
  drawCtx.restore();
}

function touchDistance(touches) {
  const [a, b] = touches;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function touchCenter(touches) {
  const [a, b] = touches;
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
  };
}

async function finishPinchGesture() {
  if (!pinchGesture) return;

  const gesture = pinchGesture;
  pinchGesture = null;
  pinchStartDistance = null;

  const shell = document.getElementById("pageShell");
  if (!shell) return;

  const targetCenter = gesture.lastCenter;
  const anchorX = gesture.anchorX;
  const anchorY = gesture.anchorY;

  shell.style.transform = "";
  shell.style.transformOrigin = "";
  shell.style.willChange = "";

  if (pdfDoc) {
    await renderPage();
  }

  const rect = shell.getBoundingClientRect();
  const anchorScreenX = rect.left + rect.width * anchorX;
  const anchorScreenY = rect.top + rect.height * anchorY;

  stage.scrollLeft += anchorScreenX - targetCenter.x;
  window.scrollBy(0, anchorScreenY - targetCenter.y);
}

stage.addEventListener("touchstart", (event) => {
  if (tool !== "hand") return;

  if (event.touches.length === 1) {
    const touch = event.touches[0];
    handPanLastTouch = { x: touch.clientX, y: touch.clientY };
    pinchStartDistance = null;
    return;
  }

  if (event.touches.length === 2) {
    handPanLastTouch = null;
    pinchStartDistance = touchDistance(event.touches);
    pinchStartZoom = zoom;

    const shell = document.getElementById("pageShell");
    const center = touchCenter(event.touches);
    const rect = shell?.getBoundingClientRect();
    if (shell && rect?.width && rect?.height) {
      const originX = Math.max(0, Math.min(rect.width, center.x - rect.left));
      const originY = Math.max(0, Math.min(rect.height, center.y - rect.top));
      pinchGesture = {
        startCenter: center,
        lastCenter: center,
        anchorX: originX / rect.width,
        anchorY: originY / rect.height,
      };
      shell.style.transformOrigin = `${originX}px ${originY}px`;
      shell.style.willChange = "transform";
    }
  }
}, { passive: true });

stage.addEventListener("touchmove", (event) => {
  if (tool !== "hand") return;

  if (event.touches.length === 1 && handPanLastTouch) {
    event.preventDefault();
    const touch = event.touches[0];
    const deltaX = handPanLastTouch.x - touch.clientX;
    const deltaY = handPanLastTouch.y - touch.clientY;

    if (Math.abs(deltaY) > 0.5) window.scrollBy(0, deltaY);
    if (Math.abs(deltaX) > 0.5) stage.scrollLeft += deltaX;

    handPanLastTouch = { x: touch.clientX, y: touch.clientY };
    return;
  }

  if (event.touches.length !== 2 || !pinchStartDistance || !pinchGesture) return;

  event.preventDefault();
  const nextDistance = touchDistance(event.touches);
  const center = touchCenter(event.touches);
  const factor = nextDistance / pinchStartDistance;
  const nextZoom = clampZoom(pinchStartZoom * factor);
  const scale = nextZoom / pinchStartZoom;
  const translateX = center.x - pinchGesture.startCenter.x;
  const translateY = center.y - pinchGesture.startCenter.y;
  const shell = document.getElementById("pageShell");

  pinchGesture.lastCenter = center;
  zoom = nextZoom;
  updateZoomControls();

  if (shell) {
    shell.style.transform =
      `translate(${translateX}px, ${translateY}px) scale(${scale})`;
  }
}, { passive: false });

stage.addEventListener("touchend", (event) => {
  if (event.touches.length < 2 && pinchGesture) {
    finishPinchGesture().catch(() => {});
  }

  if (event.touches.length === 1) {
    const touch = event.touches[0];
    handPanLastTouch = { x: touch.clientX, y: touch.clientY };
  } else if (event.touches.length === 0) {
    handPanLastTouch = null;
  }

  if (event.touches.length < 2) {
    pinchStartDistance = null;
  }
}, { passive: true });

stage.addEventListener("touchcancel", () => {
  handPanLastTouch = null;
  if (pinchGesture) finishPinchGesture().catch(() => {});
  pinchStartDistance = null;
}, { passive: true });

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (pdfDoc) renderPage();
  }, 150);
});

loadDocument();


import("./lesson-comms.mjs?v=20261003-recovery5")
  .then(({ initLessonComms }) => {
    initLessonComms({ socket, role, lessonId, showSnackbar });
  })
  .catch((error) => {
    console.error("Lesson communications failed to load", error);
  });

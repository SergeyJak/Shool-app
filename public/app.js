import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.mjs";

const role = document.body.dataset.role;
const color = role === "teacher" ? "#e53935" : "#1565c0";
const socket = io({ auth: { role } });

const statusEl = document.getElementById("status");
const pdfCanvas = document.getElementById("pdfCanvas");
const drawCanvas = document.getElementById("drawCanvas");
const pdfCtx = pdfCanvas.getContext("2d");
const drawCtx = drawCanvas.getContext("2d");
const stage = document.getElementById("stage");
const emptyState = document.getElementById("emptyState");
const loadingState = document.getElementById("loadingState");
const loadingText = document.getElementById("loadingText");
const pageInfo = document.getElementById("pageInfo");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const penBtn = document.getElementById("penBtn");
const eraserBtn = document.getElementById("eraserBtn");
const handBtn = document.getElementById("handBtn");
const undoBtn = document.getElementById("undoBtn");
const uploadInput = document.getElementById("pdfUpload");

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
let pageNumber = 1;
let tool = "pen";
let strokes = [];
let activeStroke = null;
let activeErasePath = null;
let previewStrokes = new Map();

socket.on("connect", () => {
  statusEl.textContent = "онлайн";
});
socket.on("disconnect", () => {
  statusEl.textContent = "нет связи";
});

socket.on("document:changed", async () => {
  pageNumber = 1;
  await loadDocument();
});

socket.on("stroke:preview", (stroke) => {
  if (stroke.page !== pageNumber) return;
  previewStrokes.set(stroke.id, stroke);
  redrawInk();
});

socket.on("stroke:committed", (stroke) => {
  previewStrokes.delete(stroke._id || stroke.id);
  const normalized = { ...stroke, id: stroke._id || stroke.id };
  if (normalized.page === pageNumber && !strokes.some((x) => x.id === normalized.id)) {
    strokes.push(normalized);
    redrawInk();
  }
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

prevBtn.addEventListener("click", async () => {
  if (!pdfDoc || pageNumber <= 1) return;
  pageNumber -= 1;
  await renderPage();
});

nextBtn.addEventListener("click", async () => {
  if (!pdfDoc || pageNumber >= pdfDoc.numPages) return;
  pageNumber += 1;
  await renderPage();
});

penBtn.addEventListener("click", () => setTool("pen"));
eraserBtn.addEventListener("click", () => setTool("eraser"));
handBtn.addEventListener("click", () => setTool("hand"));
undoBtn.addEventListener("click", () => {
  socket.emit("stroke:undo", { page: pageNumber });
});

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
      const res = await fetch("/api/document", {
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

drawCanvas.addEventListener("pointerdown", onPointerDown);
drawCanvas.addEventListener("pointermove", onPointerMove);
drawCanvas.addEventListener("pointerup", onPointerUp);
drawCanvas.addEventListener("pointercancel", onPointerUp);

function setTool(nextTool) {
  tool = nextTool;
  penBtn.classList.toggle("active", tool === "pen");
  eraserBtn.classList.toggle("active", tool === "eraser");
  handBtn.classList.toggle("active", tool === "hand");

  if (tool === "hand") {
    drawCanvas.style.pointerEvents = "none";
    drawCanvas.style.cursor = "grab";
  } else {
    drawCanvas.style.pointerEvents = "auto";
    drawCanvas.style.cursor = tool === "eraser" ? "cell" : "crosshair";
  }
}

function pointFromEvent(event) {
  const rect = drawCanvas.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  };
}

function onPointerDown(event) {
  if (!pdfDoc || tool === "hand") return;

  // In pen/eraser mode both finger and stylus work.
  // Scroll is available through the explicit Hand tool.
  drawCanvas.setPointerCapture(event.pointerId);
  const point = pointFromEvent(event);

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

  socket.emit("stroke:preview", activeStroke);
  redrawInk();
}

function onPointerMove(event) {
  if (tool === "hand") return;
  const point = pointFromEvent(event);

  if (activeErasePath) {
    activeErasePath.points.push(point);
    redrawInk();
    return;
  }

  if (!activeStroke) return;
  activeStroke.points.push(point);
  socket.emit("stroke:preview", activeStroke);
  redrawInk();
}

function onPointerUp(event) {
  if (tool === "hand") return;

  if (activeErasePath) {
    const erase = activeErasePath;
    activeErasePath = null;
    if (erase.points.length === 1) erase.points.push(erase.points[0]);
    socket.emit("erase:path", erase);
    redrawInk();
    return;
  }

  if (!activeStroke) return;
  const finished = activeStroke;
  activeStroke = null;
  strokes.push(finished);
  previewStrokes.delete(finished.id);
  socket.emit("stroke:commit", finished);
  redrawInk();
}

function distanceToErasePath(point, erasePath) {
  let best = Infinity;
  for (const e of erasePath.points) {
    best = Math.min(best, Math.hypot(point.x - e.x, point.y - e.y));
  }
  return best;
}

function erasePreviewSegments(stroke) {
  if (!activeErasePath) return [stroke];
  if (role !== "teacher" && stroke.role !== role) return [stroke];

  const parts = [];
  let current = [];

  for (const point of stroke.points) {
    const erased = distanceToErasePath(point, activeErasePath) <= activeErasePath.radius;
    if (erased) {
      if (current.length >= 2) parts.push({ ...stroke, points: current });
      current = [];
    } else {
      current.push(point);
    }
  }

  if (current.length >= 2) parts.push({ ...stroke, points: current });
  return parts;
}

async function loadDocument() {
  pdfDoc = null;
  stage.hidden = true;
  emptyState.hidden = true;
  loadingState.hidden = false;
  loadingText.textContent = "Проверяем документ…";
  pageInfo.textContent = "—";

  try {
    const res = await fetch("/api/document");

    if (res.status === 404) {
      loadingState.hidden = true;
      emptyState.hidden = false;
      return;
    }

    if (!res.ok) {
      throw new Error(`DOCUMENT_METADATA_${res.status}`);
    }

    loadingText.textContent = "Скачиваем PDF…";

    const loadingTask = pdfjsLib.getDocument("/api/document/file");
    loadingTask.onProgress = ({ loaded, total }) => {
      if (total > 0) {
        const percent = Math.min(100, Math.round((loaded / total) * 100));
        loadingText.textContent = `Скачиваем PDF… ${percent}%`;
      } else if (loaded > 0) {
        loadingText.textContent = `Скачиваем PDF… ${humanFileSize(loaded)}`;
      }
    };

    pdfDoc = await loadingTask.promise;
    loadingText.textContent = "Готовим первую страницу…";
    pageNumber = Math.min(pageNumber, pdfDoc.numPages);
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
    pageInfo.textContent = "—";
  }
}

async function renderPage() {
  const page = await pdfDoc.getPage(pageNumber);

  const availableWidth = Math.min(window.innerWidth - 20, 1100);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = availableWidth / baseViewport.width;
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

  pageInfo.textContent = `${pageNumber} / ${pdfDoc.numPages}`;
  prevBtn.disabled = pageNumber <= 1;
  nextBtn.disabled = pageNumber >= pdfDoc.numPages;

  await loadAnnotations();
}

async function loadAnnotations() {
  previewStrokes.clear();
  const res = await fetch(`/api/annotations/${pageNumber}`);
  strokes = res.ok ? await res.json() : [];
  redrawInk();
}

function redrawInk() {
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

  for (const stroke of strokes) {
    for (const visiblePart of erasePreviewSegments(stroke)) drawStroke(visiblePart);
  }
  for (const stroke of previewStrokes.values()) drawStroke(stroke);
  if (activeStroke) drawStroke(activeStroke);
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

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (pdfDoc) renderPage();
  }, 150);
});

loadDocument();

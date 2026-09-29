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
const pageInfo = document.getElementById("pageInfo");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const penBtn = document.getElementById("penBtn");
const eraserBtn = document.getElementById("eraserBtn");
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
  drawCanvas.style.cursor = tool === "eraser" ? "cell" : "crosshair";
}

function pointFromEvent(event) {
  const rect = drawCanvas.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  };
}

function onPointerDown(event) {
  if (!pdfDoc) return;
  drawCanvas.setPointerCapture(event.pointerId);

  const point = pointFromEvent(event);

  if (tool === "eraser") {
    const id = findStrokeAt(point);
    if (id) socket.emit("stroke:delete", { id });
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
  if (!activeStroke) return;
  const point = pointFromEvent(event);
  activeStroke.points.push(point);
  socket.emit("stroke:preview", activeStroke);
  redrawInk();
}

function onPointerUp() {
  if (!activeStroke) return;
  const finished = activeStroke;
  activeStroke = null;
  strokes.push(finished);
  previewStrokes.delete(finished.id);
  socket.emit("stroke:commit", finished);
  redrawInk();
}

function findStrokeAt(point) {
  const tolerance = 14 / Math.max(drawCanvas.width, drawCanvas.height);

  for (let i = strokes.length - 1; i >= 0; i -= 1) {
    const stroke = strokes[i];
    // Student cannot erase teacher corrections.
    if (role !== "teacher" && stroke.role !== role) continue;

    for (const p of stroke.points) {
      const dx = p.x - point.x;
      const dy = p.y - point.y;
      if (Math.hypot(dx, dy) <= tolerance) return stroke.id;
    }
  }
  return null;
}

async function loadDocument() {
  try {
    const res = await fetch("/api/document");
    if (!res.ok) throw new Error("NO_DOCUMENT");

    const loadingTask = pdfjsLib.getDocument("/api/document/file");
    pdfDoc = await loadingTask.promise;
    pageNumber = Math.min(pageNumber, pdfDoc.numPages);
    emptyState.hidden = true;
    stage.hidden = false;
    await renderPage();
  } catch {
    pdfDoc = null;
    stage.hidden = true;
    emptyState.hidden = false;
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

  for (const stroke of strokes) drawStroke(stroke);
  for (const stroke of previewStrokes.values()) drawStroke(stroke);
  if (activeStroke) drawStroke(activeStroke);
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

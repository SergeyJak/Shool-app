const lessonId = new URLSearchParams(location.search).get("lesson") || "default";
const lessonParam = encodeURIComponent(lessonId);

const pdfViewBtn = document.getElementById("viewPdfBtn");
const notebookViewBtn = document.getElementById("viewNotebookBtn");
const pdfMain = document.getElementById("lessonPdfMain");
const notebookView = document.getElementById("lessonNotebookView");
const stage = document.getElementById("notebookStage");
const shell = document.getElementById("notebookPageShell");
const paperCanvas = document.getElementById("notebookPaperCanvas");
const inkCanvas = document.getElementById("notebookInkCanvas");
const paperCtx = paperCanvas?.getContext("2d");
const inkCtx = inkCanvas?.getContext("2d");
const penBtn = document.getElementById("notebookPenBtn");
const eraserBtn = document.getElementById("notebookEraserBtn");
const handBtn = document.getElementById("notebookHandBtn");
const undoBtn = document.getElementById("notebookUndoBtn");
const addPageBtn = document.getElementById("notebookAddPageBtn");
const firstBtn = document.getElementById("notebookFirstBtn");
const prevBtn = document.getElementById("notebookPrevBtn");
const nextBtn = document.getElementById("notebookNextBtn");
const lastBtn = document.getElementById("notebookLastBtn");
const pageInput = document.getElementById("notebookPageInput");
const pageTotal = document.getElementById("notebookPageTotal");
const saveState = document.getElementById("notebookSaveState");

if (!notebookView || !paperCanvas || !inkCanvas) {
  throw new Error("Notebook UI is not available");
}

let page = Math.max(1, Number(localStorage.getItem(`school:notebook:${lessonId}:page`) || 1));
let pageCount = 1;
let tool = "pen";
let strokes = [];
let activeStroke = null;
let erasePath = null;
let saveTimer = null;

function setSaveState(text, kind = "") {
  if (!saveState) return;
  saveState.textContent = text;
  saveState.classList.toggle("error", kind === "error");
}

function api(path, options = {}) {
  const separator = path.includes("?") ? "&" : "?";
  return fetch(`${path}${separator}lesson=${lessonParam}`, {
    cache: "no-store",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
}

function setView(mode) {
  const notebook = mode === "notebook";
  pdfMain.hidden = notebook;
  notebookView.hidden = !notebook;
  pdfViewBtn?.classList.toggle("active", !notebook);
  notebookViewBtn?.classList.toggle("active", notebook);
  pdfViewBtn?.setAttribute("aria-pressed", String(!notebook));
  notebookViewBtn?.setAttribute("aria-pressed", String(notebook));
  document.body.classList.toggle("notebook-open", notebook);
  localStorage.setItem(`school:lesson:${lessonId}:view`, notebook ? "notebook" : "pdf");
  if (notebook) {
    resizeNotebook();
    loadNotebook().catch(showLoadError);
  }
}

function showLoadError() {
  setSaveState("Не удалось загрузить тетрадь", "error");
}

function setTool(next) {
  tool = next;
  for (const [button, name] of [[penBtn, "pen"], [eraserBtn, "eraser"], [handBtn, "hand"]]) {
    button?.classList.toggle("active", name === tool);
  }
  inkCanvas.style.cursor = tool === "hand" ? "grab" : tool === "eraser" ? "cell" : "crosshair";
  inkCanvas.style.pointerEvents = tool === "hand" ? "none" : "auto";
  stage.classList.toggle("hand-mode", tool === "hand");
}

function notebookCssSize() {
  const available = Math.max(320, Math.min(920, stage.clientWidth - 12));
  return { width: available, height: Math.round(available * 1.414) };
}

function resizeNotebook() {
  if (notebookView.hidden) return;
  const { width, height } = notebookCssSize();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const canvas of [paperCanvas, inkCanvas]) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  shell.style.width = `${width}px`;
  shell.style.height = `${height}px`;
  drawPaper();
  redrawInk();
}

function drawPaper() {
  const width = paperCanvas.width;
  const height = paperCanvas.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  paperCtx.clearRect(0, 0, width, height);
  paperCtx.fillStyle = "#fffef9";
  paperCtx.fillRect(0, 0, width, height);

  const lineGap = 32 * dpr;
  paperCtx.strokeStyle = "#cfe0f3";
  paperCtx.lineWidth = 1 * dpr;
  for (let y = 52 * dpr; y < height - 24 * dpr; y += lineGap) {
    paperCtx.beginPath();
    paperCtx.moveTo(18 * dpr, y);
    paperCtx.lineTo(width - 18 * dpr, y);
    paperCtx.stroke();
  }

  paperCtx.strokeStyle = "#f0a6ad";
  paperCtx.lineWidth = 1.2 * dpr;
  paperCtx.beginPath();
  paperCtx.moveTo(68 * dpr, 18 * dpr);
  paperCtx.lineTo(68 * dpr, height - 18 * dpr);
  paperCtx.stroke();
}

function drawStroke(stroke) {
  if (!stroke?.points?.length) return;
  inkCtx.save();
  inkCtx.lineCap = "round";
  inkCtx.lineJoin = "round";
  inkCtx.strokeStyle = stroke.color || "#244b8a";
  inkCtx.lineWidth = (stroke.width || 2.4) * (window.devicePixelRatio || 1);
  inkCtx.beginPath();
  inkCtx.moveTo(stroke.points[0].x * inkCanvas.width, stroke.points[0].y * inkCanvas.height);
  for (let i = 1; i < stroke.points.length; i += 1) {
    const p = stroke.points[i];
    inkCtx.lineTo(p.x * inkCanvas.width, p.y * inkCanvas.height);
  }
  inkCtx.stroke();
  inkCtx.restore();
}

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function erasePreviewParts(stroke, erase) {
  if (!erase?.points?.length) return [stroke];
  const parts = [];
  let current = [];
  for (const point of stroke.points || []) {
    const hit = erase.points.some((candidate) => pointDistance(point, candidate) <= erase.radius);
    if (hit) {
      if (current.length >= 2) parts.push({ ...stroke, points: current });
      current = [];
    } else {
      current.push(point);
    }
  }
  if (current.length >= 2) parts.push({ ...stroke, points: current });
  return parts;
}

function redrawInk() {
  inkCtx.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
  for (const stroke of strokes) {
    for (const part of erasePreviewParts(stroke, erasePath)) drawStroke(part);
  }
  if (activeStroke) drawStroke(activeStroke);
  if (erasePath?.points?.length) {
    const p = erasePath.points.at(-1);
    const radius = erasePath.radius * Math.min(inkCanvas.width, inkCanvas.height);
    inkCtx.save();
    inkCtx.beginPath();
    inkCtx.arc(p.x * inkCanvas.width, p.y * inkCanvas.height, radius, 0, Math.PI * 2);
    inkCtx.fillStyle = "rgba(255,255,255,.72)";
    inkCtx.strokeStyle = "rgba(59,72,112,.45)";
    inkCtx.lineWidth = 1.5;
    inkCtx.fill();
    inkCtx.stroke();
    inkCtx.restore();
  }
}

function pointFromEvent(event) {
  const rect = inkCanvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
  };
}

function syncControls() {
  pageInput.value = String(page);
  pageInput.max = String(pageCount);
  pageTotal.textContent = `/ ${pageCount}`;
  firstBtn.disabled = page <= 1;
  prevBtn.disabled = page <= 1;
  nextBtn.disabled = page >= pageCount;
  lastBtn.disabled = page >= pageCount;
}

async function loadNotebook() {
  setSaveState("загрузка…");
  const stateRes = await api("/api/notebook");
  if (!stateRes.ok) throw new Error("NOTEBOOK_STATE");
  const state = await stateRes.json();
  pageCount = Math.max(1, Number(state.pageCount || 1));
  page = Math.max(1, Math.min(page, pageCount));
  await loadPage(page);
}

async function loadPage(nextPage) {
  page = Math.max(1, Math.min(Number(nextPage) || 1, pageCount));
  localStorage.setItem(`school:notebook:${lessonId}:page`, String(page));
  setSaveState("загрузка…");
  const response = await api(`/api/notebook/${page}`);
  if (!response.ok) throw new Error("NOTEBOOK_PAGE");
  strokes = await response.json();
  syncControls();
  redrawInk();
  setSaveState("сохранено");
  stage.scrollTop = 0;
}

async function addPage() {
  addPageBtn.disabled = true;
  setSaveState("добавляем страницу…");
  try {
    const response = await api("/api/notebook/pages", { method: "POST", body: "{}" });
    if (!response.ok) throw new Error("ADD_PAGE");
    const payload = await response.json();
    pageCount = Math.max(pageCount + 1, Number(payload.pageCount || 1));
    await loadPage(pageCount);
  } catch {
    setSaveState("Не удалось добавить страницу", "error");
  } finally {
    addPageBtn.disabled = false;
  }
}

async function saveStroke(stroke) {
  clearTimeout(saveTimer);
  setSaveState("сохраняем…");
  try {
    const response = await api("/api/notebook/strokes", {
      method: "POST",
      body: JSON.stringify(stroke),
    });
    if (!response.ok) throw new Error("SAVE_STROKE");
    setSaveState("сохранено");
  } catch {
    setSaveState("Не удалось сохранить", "error");
  }
}

async function saveErase(erase) {
  setSaveState("сохраняем…");
  try {
    const response = await api("/api/notebook/erase", {
      method: "POST",
      body: JSON.stringify(erase),
    });
    if (!response.ok) throw new Error("SAVE_ERASE");
    await loadPage(page);
  } catch {
    setSaveState("Не удалось сохранить", "error");
  }
}

inkCanvas.addEventListener("pointerdown", (event) => {
  if (tool === "hand") return;
  event.preventDefault();
  inkCanvas.setPointerCapture(event.pointerId);
  const point = pointFromEvent(event);
  if (tool === "eraser") {
    erasePath = { page, radius: 0.022, points: [point, point] };
  } else {
    activeStroke = {
      id: crypto.randomUUID(),
      page,
      color: "#244b8a",
      width: event.pointerType === "pen" ? 2.1 : 2.5,
      points: [point, point],
    };
  }
  redrawInk();
});

inkCanvas.addEventListener("pointermove", (event) => {
  const point = pointFromEvent(event);
  if (activeStroke) activeStroke.points.push(point);
  if (erasePath) erasePath.points.push(point);
  if (activeStroke || erasePath) redrawInk();
});

async function finishPointer(event) {
  if (tool === "hand") return;
  if (inkCanvas.hasPointerCapture?.(event.pointerId)) {
    try { inkCanvas.releasePointerCapture(event.pointerId); } catch {}
  }
  if (activeStroke) {
    const finished = activeStroke;
    activeStroke = null;
    strokes.push(finished);
    redrawInk();
    await saveStroke(finished);
  }
  if (erasePath) {
    const finishedErase = erasePath;
    erasePath = null;
    strokes = strokes.flatMap((stroke) => erasePreviewParts(stroke, finishedErase));
    redrawInk();
    await saveErase(finishedErase);
  }
}
inkCanvas.addEventListener("pointerup", finishPointer);
inkCanvas.addEventListener("pointercancel", finishPointer);

pdfViewBtn?.addEventListener("click", () => setView("pdf"));
notebookViewBtn?.addEventListener("click", () => setView("notebook"));
penBtn?.addEventListener("click", () => setTool("pen"));
eraserBtn?.addEventListener("click", () => setTool("eraser"));
handBtn?.addEventListener("click", () => setTool("hand"));
firstBtn?.addEventListener("click", () => loadPage(1));
prevBtn?.addEventListener("click", () => loadPage(page - 1));
nextBtn?.addEventListener("click", () => loadPage(page + 1));
lastBtn?.addEventListener("click", () => loadPage(pageCount));
addPageBtn?.addEventListener("click", addPage);
pageInput?.addEventListener("change", () => loadPage(pageInput.value));
pageInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    pageInput.blur();
    loadPage(pageInput.value);
  }
});
undoBtn?.addEventListener("click", async () => {
  setSaveState("отменяем…");
  try {
    const response = await api("/api/notebook/undo", {
      method: "POST",
      body: JSON.stringify({ page }),
    });
    if (!response.ok) throw new Error("UNDO");
    await loadPage(page);
  } catch {
    setSaveState("Не удалось отменить", "error");
  }
});

window.addEventListener("resize", () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(resizeNotebook, 120);
});

setTool("pen");
resizeNotebook();
const initialView = localStorage.getItem(`school:lesson:${lessonId}:view`) === "notebook"
  ? "notebook"
  : "pdf";
setView(initialView);

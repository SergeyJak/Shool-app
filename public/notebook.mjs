const role = document.body.dataset.role;
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
const textBtn = document.getElementById("notebookTextBtn");
const textSizeSelect = document.getElementById("notebookTextSizeSelect");
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
let textEditor = null;
let textFontSize = Number(textSizeSelect?.value) || 18;
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
  for (const [button, name] of [[penBtn, "pen"], [eraserBtn, "eraser"], [handBtn, "hand"], [textBtn, "text"]]) {
    button?.classList.toggle("active", name === tool);
  }
  inkCanvas.style.cursor = tool === "hand" ? "grab" : tool === "eraser" ? "cell" : tool === "text" ? "text" : "crosshair";
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

function drawTextAnnotation(item) {
  if (!item?.box || !item?.text) return;
  const { x, y, w } = item.box;
  const px = x * inkCanvas.width;
  const py = y * inkCanvas.height;
  const maxWidth = Math.max(1, w * inkCanvas.width);
  const outputScale = inkCanvas.width / Math.max(1, inkCanvas.getBoundingClientRect().width);
  const cssFontSize = Number.isFinite(item.fontScale)
    ? item.fontScale * inkCanvas.getBoundingClientRect().width
    : (item.fontSize || 18);
  const fontSize = cssFontSize * outputScale;

  inkCtx.save();
  inkCtx.fillStyle = item.color || "#e53935";
  inkCtx.font = `${fontSize}px system-ui, sans-serif`;
  inkCtx.textBaseline = "top";

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
      const candidate = line ? `${line} ${word}` : word;
      if (inkCtx.measureText(candidate).width > maxWidth && line) {
        inkCtx.fillText(line, px, cursorY);
        cursorY += lineHeight;
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) {
      inkCtx.fillText(line, px, cursorY);
      cursorY += lineHeight;
    }
  }
  inkCtx.restore();
}

function drawStroke(stroke) {
  if (stroke?.type === "text") return drawTextAnnotation(stroke);
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

function erasePreviewParts(stroke, erase) {
  if (!erase?.points?.length) return [stroke];
  if (stroke?.type === "text") return erasePathHitsTextBox(erase, stroke.box) ? [] : [stroke];
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

function textAtPoint(point) {
  for (let i = strokes.length - 1; i >= 0; i -= 1) {
    const item = strokes[i];
    if (item.type !== "text" || !item.box) continue;
    const { x, y, w, h } = item.box;
    if (point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h) return item;
  }
  return null;
}

function syncTextEditorGeometry() {
  if (!textEditor) return;
  const item = textEditor._annotation;
  if (!item) return;

  textEditor.style.height = "auto";
  const heightPx = Math.max(textFontSize * 1.45, textEditor.scrollHeight + 2);
  textEditor.style.height = `${heightPx}px`;

  const widthPx = textEditor.offsetWidth;
  let leftPx = Number.parseFloat(textEditor.style.left) || 0;
  let topPx = Number.parseFloat(textEditor.style.top) || 0;
  leftPx = Math.max(0, Math.min(leftPx, Math.max(0, shell.clientWidth - widthPx)));
  topPx = Math.max(0, Math.min(topPx, Math.max(0, shell.clientHeight - heightPx)));

  textEditor.style.left = `${leftPx}px`;
  textEditor.style.top = `${topPx}px`;
  item.box = {
    x: leftPx / shell.clientWidth,
    y: topPx / shell.clientHeight,
    w: Math.min(1, widthPx / shell.clientWidth),
    h: Math.min(1, heightPx / shell.clientHeight),
  };
  item.fontSize = textFontSize;
  item.fontScale = textFontSize / shell.clientWidth;
}

async function saveText(item) {
  setSaveState("сохраняем…");
  try {
    const response = await api("/api/notebook/text", {
      method: "POST",
      body: JSON.stringify(item),
    });
    if (!response.ok) throw new Error("SAVE_TEXT");
    setSaveState("сохранено");
  } catch {
    setSaveState("Не удалось сохранить текст", "error");
  }
}

function closeTextEditor({ save = true } = {}) {
  if (!textEditor) return;
  syncTextEditorGeometry();
  const editor = textEditor;
  textEditor = null;
  const item = editor._annotation;
  const text = editor.value.trim();
  editor.remove();

  if (!save || !text || !item) {
    redrawInk();
    return;
  }

  const saved = { ...item, text };
  const index = strokes.findIndex((entry) => entry.id === saved.id);
  if (index >= 0) strokes[index] = saved;
  else strokes.push(saved);
  redrawInk();
  void saveText(saved);
}

function openTextEditor(point, existing = null) {
  if (role !== "teacher") return;
  closeTextEditor({ save: true });

  const editor = document.createElement("textarea");
  editor.className = "notebook-text-editor";
  editor.placeholder = "Введите текст…";

  const clickX = existing
    ? existing.box.x * shell.clientWidth
    : Math.max(0, Math.min(point.x * shell.clientWidth, shell.clientWidth - 1));
  const clickY = existing
    ? existing.box.y * shell.clientHeight
    : Math.max(0, Math.min(point.y * shell.clientHeight, shell.clientHeight - 1));
  const preferredWidthPx = existing
    ? existing.box.w * shell.clientWidth
    : Math.max(180, shell.clientWidth * 0.38);
  const remainingWidthPx = Math.max(1, shell.clientWidth - clickX);
  const widthPx = Math.min(preferredWidthPx, remainingWidthPx);
  const initialFontSize = existing?.fontScale
    ? existing.fontScale * shell.clientWidth
    : (existing?.fontSize || textFontSize);
  textFontSize = Math.min(48, Math.max(10, Number(initialFontSize) || 18));
  if (textSizeSelect) textSizeSelect.value = String(Math.round(textFontSize));

  editor.style.left = `${clickX}px`;
  editor.style.top = `${Math.max(0, Math.min(clickY, shell.clientHeight - textFontSize * 1.6))}px`;
  editor.style.width = `${widthPx}px`;
  editor.style.fontSize = `${textFontSize}px`;
  editor.value = existing?.text || "";
  editor._annotation = {
    id: existing?.id || crypto.randomUUID(),
    type: "text",
    page,
    color: "#e53935",
    fontSize: textFontSize,
    fontScale: textFontSize / shell.clientWidth,
    box: existing?.box || {
      x: clickX / shell.clientWidth,
      y: clickY / shell.clientHeight,
      w: widthPx / shell.clientWidth,
      h: Math.min(1, (textFontSize * 1.6) / shell.clientHeight),
    },
    text: existing?.text || "",
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
  try { editor.focus({ preventScroll: true }); } catch { editor.focus(); }
  editor.setSelectionRange(editor.value.length, editor.value.length);
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
  closeTextEditor({ save: true });
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
  const point = pointFromEvent(event);
  if (tool === "text") {
    if (role !== "teacher") return;
    openTextEditor(point, textAtPoint(point));
    return;
  }
  inkCanvas.setPointerCapture(event.pointerId);
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
  saveTimer = setTimeout(() => {
    resizeNotebook();
    syncTextEditorGeometry();
  }, 120);
});

setTool("pen");
resizeNotebook();
const initialView = localStorage.getItem(`school:lesson:${lessonId}:view`) === "notebook"
  ? "notebook"
  : "pdf";
setView(initialView);

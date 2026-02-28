const fileInput = document.getElementById('fileInput');
const svgStage = document.getElementById('svgStage');
const canvasWrap = document.getElementById('canvasWrap');
const brushPreview = document.getElementById('brushPreview');
const cropPreviewEl = document.getElementById('cropPreview');
const dropOverlay = document.getElementById('dropOverlay');
const statusEl = document.getElementById('status');
const speckleAreaEl = document.getElementById('speckleArea');
const speckleAreaValueEl = document.getElementById('speckleAreaValue');
const canvasBgColorEl = document.getElementById('canvasBgColor');
const targetPaletteEl = document.getElementById('targetPalette');
const replaceColorEl = document.getElementById('replaceColor');
const deleteAllMatchingEl = document.getElementById('deleteAllMatching');
const fillAndMergeEl = document.getElementById('fillAndMerge');
const brushSizeEl = document.getElementById('brushSize');
const modeBrushBtn = document.getElementById('modeBrushBtn');
const modeOpenPathBtn = document.getElementById('modeOpenPathBtn');
const openPathCleanAllBtn = document.getElementById('openPathCleanAllBtn');
const modePanBtn = document.getElementById('modePanBtn');
const viewToggleBtn = document.getElementById('viewToggleBtn');
const mergeBtn = document.getElementById('mergeBtn');
const mergeColorAEl = document.getElementById('mergeColorA');
const mergePaletteAEl = document.getElementById('mergePaletteA');
const mergeColorBEl = document.getElementById('mergeColorB');
const mergePaletteBEl = document.getElementById('mergePaletteB');
const mergeTwoColorsBtn = document.getElementById('mergeTwoColorsBtn');
const deleteBaseColorBtn = document.getElementById('deleteBaseColorBtn');
const undoBtn = document.getElementById('undoBtn');
const downloadBtn = document.getElementById('downloadBtn');
const cropRatioEl = document.getElementById('cropRatio');
const cropPaddingEl = document.getElementById('cropPadding');
const cropAlignEl = document.getElementById('cropAlign');
const applyCropBtn = document.getElementById('applyCropBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomResetBtn = document.getElementById('zoomResetBtn');

const shapeSelector = 'path,rect,circle,ellipse,polygon,polyline,line';
const MAX_HISTORY = 25;
const BACKGROUND_LAYER_ATTR = 'data-despeckle-background';
const UI_SETTINGS_KEY = 'svgDespeckler.ui.v1';

let loadedSvg = null;
let loadedFilename = 'updated.svg';
let zoom = 1;
let isDrawing = false;
let pageDragDepth = 0;
let mode = 'brush';
let isSpaceHeld = false;
let isPanning = false;
let selectedTargetColor = '#111111';
let mergeColorA = '#111111';
let mergeColorB = '#222222';
let viewMode = 'fills';
let panStart = { x: 0, y: 0, scrollLeft: 0, scrollTop: 0 };
let history = [];
let isMerging = false;
let queuedFillMergeColor = null;
let queuedFillMergeCount = 0;
let fillMergeGestureDone = false;
let heldPreviewColor = null;

function loadUiSettings() {
  try {
    const raw = localStorage.getItem(UI_SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveUiSettings() {
  try {
    const payload = {
      speckleArea: Number(speckleAreaEl?.value),
      brushSize: Number(brushSizeEl?.value),
      canvasBgColor: canvasBgColorEl?.value || '#0a0b0f',
      workingColor: replaceColorEl?.value || '#111111',
      mergeColorA: mergeColorAEl?.value || '#111111',
      mergeColorB: mergeColorBEl?.value || '#222222',
      deleteAllMatching: Boolean(deleteAllMatchingEl?.checked),
      fillAndMerge: Boolean(fillAndMergeEl?.checked),
      cropRatio: cropRatioEl?.value || 'current',
      cropPadding: Number(cropPaddingEl?.value) || 0,
      cropAlign: cropAlignEl?.value || 'center',
      mode,
      viewMode
    };
    localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage failures.
  }
}

function setStatus(message) {
  statusEl.textContent = message;
}

function applyCanvasBackground(color) {
  const normalized = toHexColor(color);
  if (!normalized) return;
  canvasWrap.style.setProperty('--canvas-bg', normalized);
}

function setCanvasTransparencyMode(enabled) {
  canvasWrap.classList.toggle('transparent-checker', Boolean(enabled));
}

function waitForUiFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function applyLoadedUiSettings() {
  const settings = loadUiSettings();

  if (Number.isFinite(settings.speckleArea) && settings.speckleArea > 0) {
    speckleAreaEl.value = String(Math.round(settings.speckleArea));
  }
  if (Number.isFinite(settings.brushSize) && settings.brushSize >= 2 && settings.brushSize <= 80) {
    brushSizeEl.value = String(Math.round(settings.brushSize));
  }
  if (typeof settings.canvasBgColor === 'string') {
    const c = toHexColor(settings.canvasBgColor);
    if (c) canvasBgColorEl.value = c;
  }
  if (typeof settings.workingColor === 'string') {
    const c = toHexColor(settings.workingColor);
    if (c) replaceColorEl.value = c;
  }
  if (typeof settings.mergeColorA === 'string') {
    const c = toHexColor(settings.mergeColorA);
    if (c && mergeColorAEl) mergeColorAEl.value = c;
  }
  if (typeof settings.mergeColorB === 'string') {
    const c = toHexColor(settings.mergeColorB);
    if (c && mergeColorBEl) mergeColorBEl.value = c;
  }
  if (typeof settings.deleteAllMatching === 'boolean' && deleteAllMatchingEl) {
    deleteAllMatchingEl.checked = settings.deleteAllMatching;
  }
  if (typeof settings.fillAndMerge === 'boolean' && fillAndMergeEl) {
    fillAndMergeEl.checked = settings.fillAndMerge;
  }
  if (typeof settings.cropRatio === 'string' && cropRatioEl) {
    const allowed = new Set(['current', '1:1', '2:3', '3:2', '4:5', '5:4']);
    if (allowed.has(settings.cropRatio)) cropRatioEl.value = settings.cropRatio;
  }
  if (Number.isFinite(settings.cropPadding) && settings.cropPadding >= 0 && cropPaddingEl) {
    cropPaddingEl.value = String(Math.round(settings.cropPadding));
  }
  if (typeof settings.cropAlign === 'string' && cropAlignEl) {
    const allowed = new Set(['center', 'left', 'right']);
    if (allowed.has(settings.cropAlign)) cropAlignEl.value = settings.cropAlign;
  }
  if (settings.mode === 'pan' || settings.mode === 'brush' || settings.mode === 'openPathDel') {
    mode = settings.mode;
  }
  if (settings.viewMode === 'strokes' || settings.viewMode === 'fills') {
    viewMode = settings.viewMode;
  }
}

function queueFillMerge(color, count = 0) {
  if (!color) return;
  queuedFillMergeColor = color;
  queuedFillMergeCount += Number.isFinite(count) ? count : 0;
}

async function flushQueuedFillMerge() {
  if (!loadedSvg || !queuedFillMergeColor || isMerging) return;

  const workingColor = queuedFillMergeColor;
  const filledCount = queuedFillMergeCount;
  queuedFillMergeColor = null;
  queuedFillMergeCount = 0;

  isMerging = true;
  mergeBtn.disabled = true;
  const previousViewMode = viewMode;
  let merged = 0;
  let mergeFailed = false;
  try {
    if (viewMode !== 'fills') {
      viewMode = 'fills';
      applyViewMode();
      await waitForUiFrame();
    }
    setStatus('Fill merge started (0%).');
    await waitForUiFrame();
    merged = await mergeSameColorShapes([workingColor]);
  } catch {
    mergeFailed = true;
  } finally {
    const cleanup = cleanupAllOpenPathsAndStrokes();
    buildPalette();
    if (mergeFailed) {
      setStatus(
        `Fill merge finished with errors (working color ${workingColor}). Filled ${filledCount} path(s), united ${merged} overlap(s), removed ${cleanup.removed} open/stroke element(s).`
      );
    } else {
      setStatus(
        `Fill and merge complete (working color ${workingColor}). Filled ${filledCount} path(s), united ${merged} overlap(s), removed ${cleanup.removed} open/stroke element(s).`
      );
    }

    if (viewMode !== previousViewMode) {
      viewMode = previousViewMode;
      applyViewMode();
    }
    isMerging = false;
    mergeBtn.disabled = false;
  }
}

function normalizeColor(raw) {
  if (!raw) return null;
  const c = raw.trim().toLowerCase();
  if (!c || c === 'none' || c === 'transparent') return null;
  return c;
}

function rgbToHex(rgb) {
  const m = rgb.match(/rgba?\(([^)]+)\)/i);
  if (!m) return rgb;
  const channels = m[1]
    .split(',')
    .map((part) => Number.parseFloat(part.trim()))
    .slice(0, 3);
  if (channels.length < 3 || channels.some((n) => !Number.isFinite(n))) return rgb;
  const [r, g, b] = channels.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'));
  return `#${r}${g}${b}`;
}

let colorProbeCtx = null;

function getColorProbeCtx() {
  if (colorProbeCtx) return colorProbeCtx;
  const canvas = document.createElement('canvas');
  colorProbeCtx = canvas.getContext('2d');
  return colorProbeCtx;
}

function toHexColor(rawColor) {
  const c = normalizeColor(rawColor);
  if (!c) return null;
  if (c.startsWith('#')) {
    if (c.length === 4) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
    if (c.length === 5) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
    if (c.length === 9) return c.slice(0, 7);
    return c;
  }
  if (c.startsWith('rgb')) return rgbToHex(c);
  const ctx = getColorProbeCtx();
  if (!ctx) return null;

  const sentinel = 'rgb(1, 2, 3)';
  ctx.fillStyle = sentinel;
  ctx.fillStyle = c;
  const parsed = ctx.fillStyle;
  if (parsed === sentinel && c !== sentinel && c !== 'rgb(1,2,3)' && c !== '#010203') return null;
  if (typeof parsed === 'string') {
    if (parsed.startsWith('#')) {
      if (parsed.length === 4) return `#${parsed[1]}${parsed[1]}${parsed[2]}${parsed[2]}${parsed[3]}${parsed[3]}`;
      return parsed.slice(0, 7);
    }
    if (parsed.startsWith('rgb')) return rgbToHex(parsed);
  }
  return null;
}

function getFill(el) {
  let node = el;
  while (node && node instanceof Element) {
    const direct = normalizeColor(node.getAttribute('fill'));
    if (direct) return direct;
    const inline = normalizeColor(node.style.fill);
    if (inline) return inline;
    node = node.parentElement;
  }
  if (loadedSvg?.classList?.contains('preview-strokes')) return null;
  const computed = normalizeColor(window.getComputedStyle(el).fill);
  if (computed) return computed;
  return null;
}

function getStroke(el) {
  let node = el;
  while (node && node instanceof Element) {
    const direct = normalizeColor(node.getAttribute('stroke'));
    if (direct) return direct;
    const inline = normalizeColor(node.style.stroke);
    if (inline) return inline;
    node = node.parentElement;
  }
  if (loadedSvg?.classList?.contains('preview-strokes')) return null;
  const computed = normalizeColor(window.getComputedStyle(el).stroke);
  if (computed) return computed;
  return null;
}

function stripStrokeRecursively(node) {
  if (!(node instanceof Element)) return;
  node.removeAttribute('stroke');
  node.removeAttribute('stroke-width');
  node.removeAttribute('stroke-opacity');
  node.style.stroke = '';
  node.style.strokeWidth = '';
  node.style.strokeOpacity = '';
  [...node.children].forEach((child) => stripStrokeRecursively(child));
}

function pathHasOpenSubpath(pathData) {
  if (!pathData) return false;
  const commands = pathData.match(/[AaCcHhLlMmQqSsTtVvZz]/g);
  if (!commands) return false;

  let subpathOpen = false;
  for (const command of commands) {
    if (command === 'M' || command === 'm') {
      if (subpathOpen) return true;
      subpathOpen = true;
    }
    if (command === 'Z' || command === 'z') {
      subpathOpen = false;
    }
  }
  return subpathOpen;
}

function extractClosedSubpaths(pathData) {
  if (!pathData) return '';
  const chunks = pathData.match(/[AaCcHhLlMmQqSsTtVvZz][^AaCcHhLlMmQqSsTtVvZz]*/g);
  if (!chunks) return '';

  const closedChunks = [];
  let currentSubpath = [];
  let currentClosed = false;

  chunks.forEach((chunk) => {
    const command = chunk[0];
    if (command === 'M' || command === 'm') {
      if (currentSubpath.length > 0 && currentClosed) {
        closedChunks.push(...currentSubpath);
      }
      currentSubpath = [chunk];
      currentClosed = false;
      return;
    }

    if (currentSubpath.length === 0) return;
    currentSubpath.push(chunk);
    if (command === 'Z' || command === 'z') {
      currentClosed = true;
    }
  });

  if (currentSubpath.length > 0 && currentClosed) {
    closedChunks.push(...currentSubpath);
  }

  return closedChunks.join(' ').trim();
}

function sanitizePathData(pathData) {
  const d = (pathData || '').trim();
  if (!d) return null;
  if (!pathHasOpenSubpath(d)) return d;
  const closedOnly = extractClosedSubpaths(d);
  if (!closedOnly) return null;
  if (pathHasOpenSubpath(closedOnly)) return null;
  return closedOnly;
}

function setElementFill(el, color) {
  el.setAttribute('fill', color);
  el.style.fill = color;
  el.style.fillOpacity = '1';
  el.removeAttribute('fill-opacity');
  if (viewMode === 'strokes') {
    const previewStroke = toHexColor(color) || color;
    el.style.setProperty('--preview-stroke', previewStroke);
  }
}

function snapshot() {
  if (!loadedSvg) return null;
  return new XMLSerializer().serializeToString(loadedSvg);
}

function parseSvgLength(value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.endsWith('%')) return null;
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function ensureSvgViewportSize(svg) {
  const explicitWidth = parseSvgLength(svg.getAttribute('width'));
  const explicitHeight = parseSvgLength(svg.getAttribute('height'));
  if (explicitWidth && explicitHeight) return;

  const viewBox = svg.viewBox?.baseVal;
  if (!viewBox || !Number.isFinite(viewBox.width) || !Number.isFinite(viewBox.height)) return;
  if (viewBox.width <= 0 || viewBox.height <= 0) return;

  if (!explicitWidth) svg.setAttribute('width', String(viewBox.width));
  if (!explicitHeight) svg.setAttribute('height', String(viewBox.height));
}

function getSvgViewportBounds(svg = loadedSvg) {
  if (!svg) return null;
  const viewBox = svg.viewBox?.baseVal;
  if (
    viewBox
    && Number.isFinite(viewBox.x)
    && Number.isFinite(viewBox.y)
    && Number.isFinite(viewBox.width)
    && Number.isFinite(viewBox.height)
    && viewBox.width > 0
    && viewBox.height > 0
  ) {
    return {
      x: viewBox.x,
      y: viewBox.y,
      width: viewBox.width,
      height: viewBox.height,
      left: viewBox.x,
      right: viewBox.x + viewBox.width,
      top: viewBox.y,
      bottom: viewBox.y + viewBox.height
    };
  }

  const width = parseSvgLength(svg.getAttribute('width'));
  const height = parseSvgLength(svg.getAttribute('height'));
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return {
      x: 0,
      y: 0,
      width,
      height,
      left: 0,
      right: width,
      top: 0,
      bottom: height
    };
  }

  try {
    const box = svg.getBBox();
    if (box && box.width > 0 && box.height > 0) {
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        left: box.x,
        right: box.x + box.width,
        top: box.y,
        bottom: box.y + box.height
      };
    }
  } catch {
    // Ignore bbox failures and fall back to null.
  }

  return null;
}

function boxTouchesViewportEdge(box, viewport, epsilon = 0.5) {
  if (!box || !viewport) return false;
  const pad = Number.isFinite(epsilon) ? Math.max(0, epsilon) : 0.5;
  const leftTouch = box.x <= viewport.left + pad;
  const rightTouch = box.x + box.width >= viewport.right - pad;
  const topTouch = box.y <= viewport.top + pad;
  const bottomTouch = box.y + box.height >= viewport.bottom - pad;
  return leftTouch || rightTouch || topTouch || bottomTouch;
}

function pushHistory(markup) {
  if (!markup) return;
  history.push(markup);
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
  undoBtn.disabled = history.length === 0;
}

function getElementTransformedBox(el) {
  if (!(el instanceof SVGGraphicsElement)) return null;
  let box;
  let ctm;
  try {
    box = el.getBBox();
    ctm = el.getCTM();
  } catch {
    return null;
  }
  if (!ctm) return null;

  const transformedCorners = [
    new DOMPoint(box.x, box.y),
    new DOMPoint(box.x + box.width, box.y),
    new DOMPoint(box.x, box.y + box.height),
    new DOMPoint(box.x + box.width, box.y + box.height)
  ].map((pt) => pt.matrixTransform(ctm));

  const xs = transformedCorners.map((p) => p.x);
  const ys = transformedCorners.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys)
  };
}

function getShapeItems({ includeBackground = false, includeZeroArea = false } = {}) {
  if (!loadedSvg) return [];
  return [...loadedSvg.querySelectorAll(shapeSelector)]
    .map((el) => {
      if (!includeBackground && el.getAttribute(BACKGROUND_LAYER_ATTR) === '1') return null;
      const bbox = getElementTransformedBox(el);
      if (!bbox) return null;
      const fill = getFill(el);
      return {
        el,
        fill,
        fillHex: toHexColor(fill),
        area: bbox.width * bbox.height,
        box: bbox
      };
    })
    .filter((item) => {
      if (!item || !Number.isFinite(item.area)) return false;
      if (includeZeroArea) return item.area >= 0;
      return item.area > 0;
    });
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function renderSpeckleAreaValue() {
  if (!speckleAreaValueEl || !speckleAreaEl) return;
  const current = Math.round(Number(speckleAreaEl.value) || 0);
  const min = Math.round(Number(speckleAreaEl.min) || 10);
  const max = Math.round(Number(speckleAreaEl.max) || 10);
  speckleAreaValueEl.textContent = `${current} / ${max}`;
  speckleAreaEl.title = `Range: ${min} to ${max}`;
}

function deriveSpeckleAreaMax() {
  if (!loadedSvg) return 500;
  const allItems = getShapeItems();
  if (allItems.length === 0) return 10;
  const pathItems = allItems.filter((item) => item.el.tagName.toLowerCase() === 'path');
  const sourceItems = pathItems.length > 0 ? pathItems : allItems;
  const largestArea = sourceItems.reduce((largest, item) => Math.max(largest, item.area), 0);
  const halfLargest = Math.floor(largestArea / 2);
  return Math.max(10, halfLargest);
}

function updateSpeckleAreaControl(preferredValue = null) {
  if (!speckleAreaEl) return;
  const min = 10;
  const max = deriveSpeckleAreaMax();
  const desired = Number.isFinite(preferredValue) ? preferredValue : Number(speckleAreaEl.value);
  const nextValue = Math.round(clampNumber(desired, min, max));
  speckleAreaEl.min = String(min);
  speckleAreaEl.max = String(max);
  speckleAreaEl.value = String(nextValue);
  renderSpeckleAreaValue();
}

function detectEdgeTouchingBackgroundColor() {
  if (!loadedSvg) return null;
  const viewport = getSvgViewportBounds(loadedSvg);
  if (!viewport) return null;

  const totalsByColor = new Map();
  const items = getShapeItems({ includeBackground: true });
  items.forEach((item) => {
    if (!item.fillHex) return;
    if (!boxTouchesViewportEdge(item.box, viewport)) return;
    totalsByColor.set(item.fillHex, (totalsByColor.get(item.fillHex) || 0) + Math.max(1, item.area));
  });

  if (totalsByColor.size === 0) return null;
  return [...totalsByColor.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function findBackgroundInsertAnchor(svg) {
  if (!svg) return null;
  const skip = new Set(['defs', 'title', 'desc', 'metadata']);
  return [...svg.children].find((node) => !skip.has(node.tagName.toLowerCase())) || null;
}

function normalizeBackgroundToViewportRect() {
  if (!loadedSvg) return { color: null, removed: 0, inserted: false };

  [...loadedSvg.querySelectorAll(`[${BACKGROUND_LAYER_ATTR}="1"]`)].forEach((node) => node.remove());

  const backgroundColor = detectEdgeTouchingBackgroundColor();
  if (!backgroundColor) return { color: null, removed: 0, inserted: false };

  let removed = 0;
  getShapeItems({ includeBackground: true }).forEach((item) => {
    if (item.fillHex !== backgroundColor) return;
    item.el.remove();
    removed += 1;
  });

  const viewport = getSvgViewportBounds(loadedSvg);
  if (!viewport) return { color: backgroundColor, removed, inserted: false };

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', String(viewport.x));
  rect.setAttribute('y', String(viewport.y));
  rect.setAttribute('width', String(viewport.width));
  rect.setAttribute('height', String(viewport.height));
  rect.setAttribute(BACKGROUND_LAYER_ATTR, '1');
  rect.setAttribute('pointer-events', 'none');
  setElementFill(rect, backgroundColor);

  const anchor = findBackgroundInsertAnchor(loadedSvg);
  if (anchor) loadedSvg.insertBefore(rect, anchor);
  else loadedSvg.appendChild(rect);

  return { color: backgroundColor, removed, inserted: true };
}

function getBackgroundFillHex() {
  if (!loadedSvg) return null;
  const bgNode = loadedSvg.querySelector(`[${BACKGROUND_LAYER_ATTR}="1"]`);
  if (!(bgNode instanceof Element)) return null;
  return toHexColor(getFill(bgNode));
}

function buildPalette() {
  if (!loadedSvg) return;
  const unique = [...new Set(getShapeItems().map((i) => i.fillHex).filter(Boolean))].sort();
  const backgroundFillHex = getBackgroundFillHex();
  if (backgroundFillHex && !unique.includes(backgroundFillHex)) unique.push(backgroundFillHex);
  unique.sort();
  setCanvasTransparencyMode(!backgroundFillHex);

  if (!selectedTargetColor || (unique.length > 0 && !unique.includes(selectedTargetColor))) {
    selectedTargetColor = unique[0] || '#111111';
  }
  if (!mergeColorA || (unique.length > 0 && !unique.includes(mergeColorA))) {
    mergeColorA = unique[0] || '#111111';
  }
  if (!mergeColorB || (unique.length > 0 && !unique.includes(mergeColorB))) {
    mergeColorB = unique.find((color) => color !== mergeColorA) || mergeColorA || '#222222';
  }

  if (replaceColorEl) replaceColorEl.value = selectedTargetColor;
  if (mergeColorAEl) mergeColorAEl.value = mergeColorA;
  if (mergeColorBEl) mergeColorBEl.value = mergeColorB;

  renderPalette(targetPaletteEl, unique, (color) => {
    selectedTargetColor = color;
    if (replaceColorEl) replaceColorEl.value = color;
    renderSwatchSelection(targetPaletteEl, color);
    saveUiSettings();
  });
  renderPalette(mergePaletteAEl, unique, (color) => {
    mergeColorA = color;
    if (mergeColorAEl) mergeColorAEl.value = color;
    renderSwatchSelection(mergePaletteAEl, color);
    saveUiSettings();
  });
  renderPalette(mergePaletteBEl, unique, (color) => {
    mergeColorB = color;
    if (mergeColorBEl) mergeColorBEl.value = color;
    renderSwatchSelection(mergePaletteBEl, color);
    saveUiSettings();
  });

  renderSwatchSelection(targetPaletteEl, selectedTargetColor);
  renderSwatchSelection(mergePaletteAEl, mergeColorA);
  renderSwatchSelection(mergePaletteBEl, mergeColorB);
  updateSpeckleAreaControl();
  updatePreviewStrokeColors();
  renderCropPreview();
}

function applyViewMode() {
  if (viewToggleBtn) {
    const showingStrokes = viewMode === 'strokes';
    viewToggleBtn.classList.toggle('active', showingStrokes);
    viewToggleBtn.textContent = showingStrokes ? 'Fill View' : 'Stroke View';
  }
  if (!loadedSvg) return;
  loadedSvg.classList.toggle('preview-strokes', viewMode === 'strokes');
  updatePreviewStrokeColors();
}

function clearHeldColorPreviewStyles() {
  if (!loadedSvg) return;
  [...loadedSvg.querySelectorAll(shapeSelector)].forEach((el) => {
    el.classList.remove('hold-dim', 'hold-highlight');
  });
}

function applyHeldColorPreview() {
  if (!loadedSvg || !heldPreviewColor) return;
  const focusColor = toHexColor(heldPreviewColor);
  if (!focusColor) return;

  [...loadedSvg.querySelectorAll(shapeSelector)].forEach((el) => {
    const fillHex = toHexColor(getFill(el));
    const matches = fillHex === focusColor;
    el.classList.toggle('hold-highlight', matches);
    el.classList.toggle('hold-dim', !matches);

    if (viewMode === 'strokes') {
      el.style.setProperty('--preview-stroke', matches ? (fillHex || '#4f8cff') : '#7b8393');
    }
  });
}

function beginHeldColorPreview(color) {
  const focusColor = toHexColor(color);
  if (!focusColor || !loadedSvg) return;
  heldPreviewColor = focusColor;
  applyHeldColorPreview();
}

function endHeldColorPreview() {
  if (!heldPreviewColor) return;
  heldPreviewColor = null;
  clearHeldColorPreviewStyles();
  updatePreviewStrokeColors();
}

function updatePreviewStrokeColors() {
  if (!loadedSvg) return;
  const previewing = viewMode === 'strokes';
  [...loadedSvg.querySelectorAll(shapeSelector)].forEach((el) => {
    if (previewing) {
      const fillHex = toHexColor(getFill(el));
      const strokeHex = toHexColor(getStroke(el));
      el.style.setProperty('--preview-stroke', fillHex || strokeHex || '#4f8cff');
    } else {
      el.style.removeProperty('--preview-stroke');
    }
  });
  if (heldPreviewColor) applyHeldColorPreview();
  else clearHeldColorPreviewStyles();
}

function renderPalette(container, colors, onClick) {
  if (!container) return;
  container.innerHTML = '';
  colors.forEach((color) => {
    const swatch = document.createElement('button');
    swatch.className = 'swatch';
    swatch.type = 'button';
    swatch.style.background = color;
    swatch.dataset.color = color;
    swatch.title = color;
    swatch.addEventListener('click', () => onClick(color));
    swatch.addEventListener('pointerdown', () => beginHeldColorPreview(color));
    swatch.addEventListener('pointerup', endHeldColorPreview);
    swatch.addEventListener('pointercancel', endHeldColorPreview);
    swatch.addEventListener('pointerleave', endHeldColorPreview);
    container.appendChild(swatch);
  });
}

function renderSwatchSelection(container, color) {
  if (!container) return;
  [...container.querySelectorAll('.swatch')].forEach((swatch) => {
    swatch.classList.toggle('active', swatch.dataset.color === color);
  });
}

function bindColorInputHoldPreview(inputEl, getColor) {
  if (!inputEl || typeof getColor !== 'function') return;
  inputEl.addEventListener('pointerdown', () => beginHeldColorPreview(getColor()));
  inputEl.addEventListener('pointerup', endHeldColorPreview);
  inputEl.addEventListener('pointercancel', endHeldColorPreview);
  inputEl.addEventListener('pointerleave', endHeldColorPreview);
}

function setMode(nextMode) {
  mode = nextMode;
  modeBrushBtn.classList.toggle('active', mode === 'brush');
  modeOpenPathBtn.classList.toggle('active', mode === 'openPathDel');
  modePanBtn.classList.toggle('active', mode === 'pan');
  canvasWrap.classList.toggle('pan-enabled', mode === 'pan');
}

function applyZoom() {
  svgStage.style.transform = `scale(${zoom})`;
  zoomResetBtn.textContent = `${Math.round(zoom * 100)}%`;
  const radius = Number(brushSizeEl.value) * zoom;
  brushPreview.style.width = `${radius * 2}px`;
  brushPreview.style.height = `${radius * 2}px`;
  renderCropPreview();
}

function screenToSvg(clientX, clientY) {
  if (!loadedSvg) return { x: 0, y: 0 };
  const p = loadedSvg.createSVGPoint();
  p.x = clientX;
  p.y = clientY;
  const ctm = loadedSvg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const mapped = p.matrixTransform(ctm.inverse());
  return { x: mapped.x, y: mapped.y };
}

function circleIntersectsBox(center, radius, box) {
  const nearX = Math.max(box.x, Math.min(center.x, box.x + box.width));
  const nearY = Math.max(box.y, Math.min(center.y, box.y + box.height));
  const dx = center.x - nearX;
  const dy = center.y - nearY;
  return dx * dx + dy * dy <= radius * radius;
}

function boxesOverlap(a, b, tolerance = 0) {
  const pad = Number.isFinite(tolerance) ? Math.max(0, tolerance) : 0;
  return (
    a.x - pad < b.x + b.width &&
    a.x + a.width + pad > b.x &&
    a.y - pad < b.y + b.height &&
    a.y + a.height + pad > b.y
  );
}

function boxArea(box) {
  if (!box) return 0;
  const area = box.width * box.height;
  return Number.isFinite(area) && area > 0 ? area : 0;
}

function parseAspectRatio(rawRatio) {
  if (typeof rawRatio !== 'string') return null;
  const [wRaw, hRaw] = rawRatio.split(':');
  const width = Number.parseFloat(wRaw);
  const height = Number.parseFloat(hRaw);
  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) return null;
  return width / height;
}

function parsePreserveAspectRatioValue(rawValue) {
  const defaults = {
    align: 'xMidYMid',
    meetOrSlice: 'meet',
    none: false
  };
  if (typeof rawValue !== 'string' || rawValue.trim() === '') return defaults;

  const tokens = rawValue.trim().split(/\s+/i).filter(Boolean);
  const cleaned = tokens[0] === 'defer' ? tokens.slice(1) : tokens;
  if (cleaned.length === 0) return defaults;

  const align = cleaned[0];
  if (align === 'none') {
    return {
      align: 'none',
      meetOrSlice: 'meet',
      none: true
    };
  }

  const meetOrSlice = cleaned[1] === 'slice' ? 'slice' : 'meet';
  const validAlign = /^(xMin|xMid|xMax)(YMin|YMid|YMax)$/i.test(align) ? align : defaults.align;
  return {
    align: validAlign,
    meetOrSlice,
    none: false
  };
}

function mapSvgPointToScreen(point, viewport, svgRect, preserveAspectRatio) {
  if (!(viewport?.width > 0 && viewport?.height > 0 && svgRect?.width > 0 && svgRect?.height > 0)) return null;
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;

  let scaleX = svgRect.width / viewport.width;
  let scaleY = svgRect.height / viewport.height;
  let offsetX = 0;
  let offsetY = 0;

  if (!preserveAspectRatio.none) {
    const uniformScale = preserveAspectRatio.meetOrSlice === 'slice'
      ? Math.max(scaleX, scaleY)
      : Math.min(scaleX, scaleY);
    scaleX = uniformScale;
    scaleY = uniformScale;

    const drawnWidth = viewport.width * uniformScale;
    const drawnHeight = viewport.height * uniformScale;
    const remainingX = svgRect.width - drawnWidth;
    const remainingY = svgRect.height - drawnHeight;

    const alignLower = preserveAspectRatio.align.toLowerCase();
    const xAlign = alignLower.startsWith('xmin')
      ? 0
      : alignLower.startsWith('xmax')
        ? 1
        : 0.5;
    const yAlign = alignLower.endsWith('ymin')
      ? 0
      : alignLower.endsWith('ymax')
        ? 1
        : 0.5;

    offsetX = remainingX * xAlign;
    offsetY = remainingY * yAlign;
  }

  return {
    x: svgRect.left + offsetX + (point.x - viewport.x) * scaleX,
    y: svgRect.top + offsetY + (point.y - viewport.y) * scaleY
  };
}

function formatSvgNumber(value) {
  if (!Number.isFinite(value)) return '0';
  return String(Number(value.toFixed(3)));
}

function getContentBounds() {
  const viewport = getSvgViewportBounds(loadedSvg);
  const items = getShapeItems();
  if (items.length === 0) return viewport;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  items.forEach((item) => {
    const itemLeft = item.box.x;
    const itemTop = item.box.y;
    const itemRight = item.box.x + item.box.width;
    const itemBottom = item.box.y + item.box.height;

    const left = viewport ? Math.max(itemLeft, viewport.x) : itemLeft;
    const top = viewport ? Math.max(itemTop, viewport.y) : itemTop;
    const right = viewport ? Math.min(itemRight, viewport.x + viewport.width) : itemRight;
    const bottom = viewport ? Math.min(itemBottom, viewport.y + viewport.height) : itemBottom;
    if (!(right > left && bottom > top)) return;

    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, right);
    maxY = Math.max(maxY, bottom);
  });

  if (!(Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY))) {
    return viewport;
  }
  const width = Math.max(0, maxX - minX);
  const height = Math.max(0, maxY - minY);
  if (!(width > 0 && height > 0)) return viewport;
  return { x: minX, y: minY, width, height };
}

function computeCropRectFromUi() {
  if (!loadedSvg) return null;
  const rawPadding = Number(cropPaddingEl?.value);
  const padding = Number.isFinite(rawPadding) && rawPadding >= 0 ? rawPadding : 0;
  const align = cropAlignEl?.value === 'left' || cropAlignEl?.value === 'right' ? cropAlignEl.value : 'center';
  const ratioSetting = cropRatioEl?.value || 'current';

  const bounds = getContentBounds();
  if (!bounds) return null;

  let cropX = bounds.x - padding;
  let cropY = bounds.y - padding;
  let cropWidth = Math.max(1, bounds.width + padding * 2);
  let cropHeight = Math.max(1, bounds.height + padding * 2);
  const ratio = ratioSetting === 'current' ? cropWidth / cropHeight : parseAspectRatio(ratioSetting);
  if (!(ratio > 0)) return null;

  const currentRatio = cropWidth / cropHeight;
  if (currentRatio < ratio) {
    const nextWidth = cropHeight * ratio;
    const delta = nextWidth - cropWidth;
    if (align === 'right') cropX -= delta;
    if (align === 'center') cropX -= delta / 2;
    cropWidth = nextWidth;
  } else if (currentRatio > ratio) {
    const nextHeight = cropWidth / ratio;
    const delta = nextHeight - cropHeight;
    cropY -= delta / 2;
    cropHeight = nextHeight;
  }

  return {
    x: cropX,
    y: cropY,
    width: cropWidth,
    height: cropHeight,
    ratioLabel: ratioSetting === 'current' ? 'Current Aspect Ratio' : ratioSetting,
    padding,
    align
  };
}

function renderCropPreview() {
  if (!cropPreviewEl) return;
  if (!loadedSvg) {
    cropPreviewEl.classList.remove('active');
    return;
  }

  const cropRect = computeCropRectFromUi();
  if (!cropRect) {
    cropPreviewEl.classList.remove('active');
    return;
  }

  const viewport = getSvgViewportBounds(loadedSvg);
  if (!viewport || !(viewport.width > 0 && viewport.height > 0)) {
    cropPreviewEl.classList.remove('active');
    return;
  }
  const svgRect = loadedSvg.getBoundingClientRect();
  if (!(svgRect.width > 0 && svgRect.height > 0)) {
    cropPreviewEl.classList.remove('active');
    return;
  }

  const par = parsePreserveAspectRatioValue(loadedSvg.getAttribute('preserveAspectRatio') || '');
  const p1 = mapSvgPointToScreen({ x: cropRect.x, y: cropRect.y }, viewport, svgRect, par);
  const p2 = mapSvgPointToScreen(
    { x: cropRect.x + cropRect.width, y: cropRect.y + cropRect.height },
    viewport,
    svgRect,
    par
  );
  if (!p1 || !p2) {
    cropPreviewEl.classList.remove('active');
    return;
  }

  const screenLeft = Math.min(p1.x, p2.x);
  const screenTop = Math.min(p1.y, p2.y);
  const screenWidth = Math.max(1, Math.abs(p2.x - p1.x));
  const screenHeight = Math.max(1, Math.abs(p2.y - p1.y));
  const wrapRect = canvasWrap.getBoundingClientRect();
  const left = screenLeft - wrapRect.left + canvasWrap.scrollLeft;
  const top = screenTop - wrapRect.top + canvasWrap.scrollTop;

  cropPreviewEl.style.left = `${left}px`;
  cropPreviewEl.style.top = `${top}px`;
  cropPreviewEl.style.width = `${screenWidth}px`;
  cropPreviewEl.style.height = `${screenHeight}px`;
  cropPreviewEl.classList.add('active');
}

function applyCrop() {
  if (!loadedSvg) {
    setStatus('Crop skipped: load an SVG first.');
    return;
  }
  const cropRect = computeCropRectFromUi();
  if (!cropRect) {
    setStatus('Crop skipped: invalid crop settings.');
    return;
  }

  loadedSvg.setAttribute(
    'viewBox',
    `${formatSvgNumber(cropRect.x)} ${formatSvgNumber(cropRect.y)} ${formatSvgNumber(cropRect.width)} ${formatSvgNumber(cropRect.height)}`
  );
  loadedSvg.setAttribute('width', formatSvgNumber(cropRect.width));
  loadedSvg.setAttribute('height', formatSvgNumber(cropRect.height));

  [...loadedSvg.querySelectorAll(`[${BACKGROUND_LAYER_ATTR}="1"]`)].forEach((bg) => {
    bg.setAttribute('x', formatSvgNumber(cropRect.x));
    bg.setAttribute('y', formatSvgNumber(cropRect.y));
    bg.setAttribute('width', formatSvgNumber(cropRect.width));
    bg.setAttribute('height', formatSvgNumber(cropRect.height));
  });

  applyViewMode();
  cropPreviewEl?.classList.remove('active');
  setStatus(
    `Crop applied (${cropRect.ratioLabel}, padding ${Math.round(cropRect.padding)}, align ${cropRect.align}).`
  );
  saveUiSettings();
}

function getElementCenterInSvg(el) {
  if (!(el instanceof Element)) return null;
  try {
    const box = el.getBBox();
    const ctm = el.getCTM();
    if (!ctm) return null;
    const center = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(ctm);
    return { x: center.x, y: center.y };
  } catch {
    return null;
  }
}

function getElementProbePointsInSvg(el) {
  if (!(el instanceof Element)) return [];
  try {
    const box = el.getBBox();
    const ctm = el.getCTM();
    if (!ctm) return [];

    const x1 = box.x;
    const y1 = box.y;
    const x2 = box.x + box.width;
    const y2 = box.y + box.height;
    const xm = box.x + box.width / 2;
    const ym = box.y + box.height / 2;

    const points = [
      new DOMPoint(xm, ym),
      new DOMPoint(x1, y1),
      new DOMPoint(x2, y1),
      new DOMPoint(x1, y2),
      new DOMPoint(x2, y2),
      new DOMPoint(xm, y1),
      new DOMPoint(xm, y2),
      new DOMPoint(x1, ym),
      new DOMPoint(x2, ym)
    ];

    return points.map((p) => p.matrixTransform(ctm));
  } catch {
    return [];
  }
}

function elementContainsSvgPoint(el, point) {
  if (!(el instanceof SVGGeometryElement) || !point) return false;
  const ctm = el.getCTM();
  if (!ctm) return false;
  let inverse;
  try {
    inverse = ctm.inverse();
  } catch {
    return false;
  }
  const local = new DOMPoint(point.x, point.y).matrixTransform(inverse);
  try {
    return el.isPointInFill(local);
  } catch {
    return false;
  }
}

function elementContainsElement(hostEl, childEl) {
  const probes = getElementProbePointsInSvg(childEl);
  if (probes.length === 0) return false;
  return probes.some((p) => elementContainsSvgPoint(hostEl, p));
}

function itemInsideHost(hostItem, childItem) {
  if (!hostItem || !childItem) return false;
  if (hostItem.el === childItem.el) return false;
  const hostArea = boxArea(hostItem.box);
  const childArea = boxArea(childItem.box);
  if (!(hostArea > 0 && childArea > 0)) return false;
  if (childArea >= hostArea * 0.98) return false;
  if (!boxesOverlap(hostItem.box, childItem.box, 1)) return false;

  if (elementContainsElement(hostItem.el, childItem.el)) return true;
  const center = getElementCenterInSvg(childItem.el);
  return elementContainsSvgPoint(hostItem.el, center);
}

function buildBrushSamplePoints(center, radius) {
  if (radius <= 0) return [center];
  const points = [center];
  const ringCount = Math.max(2, Math.min(6, Math.ceil(radius / 6) + 1));

  for (let ringIndex = 1; ringIndex <= ringCount; ringIndex += 1) {
    const ring = ringIndex / ringCount;
    const ringRadius = radius * ring;
    const steps = Math.max(16, Math.ceil(2 * Math.PI * ringRadius));
    for (let i = 0; i < steps; i += 1) {
      const angle = (Math.PI * 2 * i) / steps;
      points.push({
        x: center.x + Math.cos(angle) * ringRadius,
        y: center.y + Math.sin(angle) * ringRadius
      });
    }
  }

  return points;
}

function buildElementProbePoints(item) {
  const { box } = item;
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  return [
    { x: box.x + halfW, y: box.y + halfH },
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x, y: box.y + box.height },
    { x: box.x + box.width, y: box.y + box.height }
  ];
}

function elementIntersectsBrush(item, center, radius) {
  if (!circleIntersectsBox(center, radius, item.box)) return false;

  const geometry = item.el;
  if (!(geometry instanceof SVGGeometryElement)) return true;

  const ctm = geometry.getCTM();
  if (!ctm) return true;

  let inverse;
  try {
    inverse = ctm.inverse();
  } catch {
    return true;
  }

  const samplePoints = [...buildBrushSamplePoints(center, radius), ...buildElementProbePoints(item)];
  return samplePoints.some((sample) => {
    if ((sample.x - center.x) ** 2 + (sample.y - center.y) ** 2 > radius * radius) return false;
    const localPoint = new DOMPoint(sample.x, sample.y).matrixTransform(inverse);
    return geometry.isPointInFill(localPoint) || geometry.isPointInStroke(localPoint);
  });
}

function stripTinyInteriorSubpathsFromTouchedHosts(hostItems, maxArea) {
  if (!(maxArea > 0) || !Array.isArray(hostItems) || hostItems.length === 0) {
    return { hostsUpdated: 0, subpathsRemoved: 0 };
  }

  let hostsUpdated = 0;
  let subpathsRemoved = 0;
  const processedHosts = new Set();

  hostItems.forEach((hostItem) => {
    const hostEl = hostItem?.el || hostItem;
    if (!(hostEl instanceof SVGPathElement) || !hostEl.isConnected) return;
    if (processedHosts.has(hostEl)) return;
    processedHosts.add(hostEl);

    const originalD = (hostEl.getAttribute('d') || '').trim();
    if (!originalD) return;

    const scope = new paper.PaperScope();
    const canvas = document.createElement('canvas');
    scope.setup(canvas);

    let imported;
    try {
      const clone = hostEl.cloneNode(true);
      clone.removeAttribute('id');
      imported = scope.project.importSVG(clone);
    } catch {
      scope.remove();
      return;
    }

    const pathLike = (() => {
      if (imported instanceof scope.Path || imported instanceof scope.CompoundPath) return imported;
      if (imported?.children?.length) {
        return imported.children.find((child) => child instanceof scope.Path || child instanceof scope.CompoundPath) || null;
      }
      return null;
    })();

    if (!pathLike) {
      scope.remove();
      return;
    }

    const allPaths = [];
    const walk = (node) => {
      if (!node) return;
      if (node instanceof scope.Path) {
        allPaths.push(node);
        return;
      }
      if (node.children?.length) {
        [...node.children].forEach((child) => walk(child));
      }
    };
    walk(pathLike);

    const closedPaths = allPaths.filter((pathItem) => pathItem.closed && Number.isFinite(Math.abs(pathItem.area || 0)));
    if (closedPaths.length < 2) {
      scope.remove();
      return;
    }

    const removable = closedPaths.filter((candidate) => {
      const area = Math.abs(candidate.area || 0);
      if (!(area > 0 && area <= maxArea)) return false;
      const center = candidate.bounds?.center;
      if (!center) return false;

      return closedPaths.some((other) => {
        if (other === candidate) return false;
        const otherArea = Math.abs(other.area || 0);
        if (!(otherArea > area * 1.05)) return false;
        try {
          return other.contains(center);
        } catch {
          return false;
        }
      });
    });

    if (removable.length === 0) {
      scope.remove();
      return;
    }

    removable.forEach((candidate) => candidate.remove());
    const exported = pathLike.exportSVG({ asString: false });
    const exportedPath = exported?.tagName?.toLowerCase() === 'path' ? exported : exported?.querySelector?.('path');
    const nextD = (exportedPath?.getAttribute('d') || '').trim();
    const sanitized = sanitizePathData(nextD);
    if (!sanitized) {
      scope.remove();
      return;
    }

    if (sanitized !== originalD) {
      hostEl.setAttribute('d', sanitized);
      hostsUpdated += 1;
      subpathsRemoved += removable.length;
    }

    scope.remove();
  });

  return { hostsUpdated, subpathsRemoved };
}

function getShapeAtClientPoint(clientX, clientY) {
  const hit = document.elementFromPoint(clientX, clientY);
  if (!(hit instanceof Element)) return null;
  const shape = hit.closest(shapeSelector);
  if (!(shape instanceof Element)) return null;
  if (!loadedSvg?.contains(shape)) return null;
  if (shape.getAttribute(BACKGROUND_LAYER_ATTR) === '1') return null;
  return shape;
}

function applyFloodFillMerge(clientX, clientY) {
  if (!loadedSvg || fillMergeGestureDone) return;
  const activeColor = toHexColor(selectedTargetColor || replaceColorEl.value);
  if (!activeColor) {
    setStatus('Fill and merge skipped: choose a working color first.');
    fillMergeGestureDone = true;
    return;
  }

  const hitShape = getShapeAtClientPoint(clientX, clientY);
  if (!hitShape) {
    setStatus('Fill and merge: click a filled shape to flood by color.');
    fillMergeGestureDone = true;
    return;
  }

  const sourceColor = toHexColor(getFill(hitShape));
  if (!sourceColor) {
    setStatus('Fill and merge: selected shape has no fill color.');
    fillMergeGestureDone = true;
    return;
  }

  let filled = 0;
  if (sourceColor !== activeColor) {
    getShapeItems().forEach((item) => {
      if (item.fillHex !== sourceColor) return;
      setElementFill(item.el, activeColor);
      filled += 1;
    });
    buildPalette();
  }

  queueFillMerge(activeColor, filled);
  if (sourceColor === activeColor) {
    setStatus(`Flood merge queued for ${activeColor}.`);
  } else {
    setStatus(`Flood-filled ${filled} path(s) from ${sourceColor} to ${activeColor}. Merge queued for mouseup.`);
  }
  fillMergeGestureDone = true;
}

function applyBrush(clientX, clientY) {
  if (!loadedSvg) return;

  if (mode === 'openPathDel') {
    applyOpenPathDeleteBrush(clientX, clientY);
    return;
  }

  if (fillAndMergeEl?.checked) {
    applyFloodFillMerge(clientX, clientY);
    return;
  }

  const brushRadius = Number(brushSizeEl.value);
  const maxArea = Number(speckleAreaEl.value);
  if (!Number.isFinite(maxArea) || maxArea <= 0) return;
  const activeColor = toHexColor(selectedTargetColor || replaceColorEl.value);
  if (!activeColor) return;

  const pointer = screenToSvg(clientX, clientY);
  const items = getShapeItems();
  const touchedHosts = items.filter(
    (item) => item.fillHex === activeColor && elementIntersectsBrush(item, pointer, brushRadius)
  );
  if (touchedHosts.length === 0) return;

  if (deleteAllMatchingEl?.checked) {
    const toDelete = new Set(touchedHosts.map((item) => item.el));
    toDelete.forEach((el) => el.remove());
    if (toDelete.size > 0) {
      buildPalette();
      setStatus(`Brush erased ${toDelete.size} working-color path(s) touched by brush.`);
    }
    return;
  }

  const touchedInside = [];
  items.forEach((item) => {
    if (item.area > maxArea) return;
    if (!elementIntersectsBrush(item, pointer, brushRadius)) return;
    const inside = touchedHosts.some((host) => itemInsideHost(host, item));
    if (!inside) return;
    touchedInside.push(item);
  });

  const touchedSet = new Set(touchedInside.map((item) => item.el));
  const hostsWithTouched = touchedHosts.filter((host) => touchedInside.some((item) => itemInsideHost(host, item)));

  // Also remove tiny interior artifacts of any color in touched host shapes.
  const interiorAnyColor = items.filter((item) => {
    if (touchedSet.has(item.el)) return false;
    if (item.area > maxArea) return false;
    return hostsWithTouched.some((host) => itemInsideHost(host, item));
  });

  const toDelete = new Set([...touchedInside.map((item) => item.el), ...interiorAnyColor.map((item) => item.el)]);
  toDelete.forEach((el) => {
    el.remove();
  });

  const subpathCleanup = stripTinyInteriorSubpathsFromTouchedHosts(touchedHosts, maxArea);
  if (toDelete.size > 0 || subpathCleanup.subpathsRemoved > 0) {
    buildPalette();
    setStatus(
      `Brush erased ${touchedInside.length} touched speckle(s), ${interiorAnyColor.length} interior artifact(s), and stripped ${subpathCleanup.subpathsRemoved} tiny interior subpath(s) across ${subpathCleanup.hostsUpdated} touched host path(s).`
    );
  }
}

function applyOpenPathDeleteBrush(clientX, clientY) {
  if (!loadedSvg) return;
  const brushRadius = Number(brushSizeEl.value);
  const pointer = screenToSvg(clientX, clientY);
  const items = getShapeItems({ includeZeroArea: true });

  let removed = 0;
  let strippedSubpaths = 0;
  let strippedStroke = 0;
  items.forEach((item) => {
    if (!circleIntersectsBox(pointer, brushRadius, item.box)) return;
    const el = item.el;
    const tag = el.tagName.toLowerCase();
    const fillHex = toHexColor(getFill(el));
    const strokeHex = toHexColor(getStroke(el));
    const hasFill = Boolean(fillHex);
    const hasStroke = Boolean(strokeHex);

    if (tag === 'line' || tag === 'polyline') {
      el.remove();
      removed += 1;
      return;
    }

    if (tag !== 'path') {
      if (hasStroke && !hasFill) {
        el.remove();
        removed += 1;
      } else if (hasStroke && hasFill) {
        removeElementStroke(el);
        strippedStroke += 1;
      }
      return;
    }

    const original = (el.getAttribute('d') || '').trim();
    if (!original) {
      el.remove();
      removed += 1;
      return;
    }
    if (pathHasOpenSubpath(original)) {
      const sanitized = sanitizePathData(original);
      if (!sanitized) {
        el.remove();
        removed += 1;
        return;
      }
      if (sanitized !== original) {
        el.setAttribute('d', sanitized);
        strippedSubpaths += 1;
      }
    }

    const nowHasFill = Boolean(toHexColor(getFill(el)));
    const nowHasStroke = Boolean(toHexColor(getStroke(el)));
    if (nowHasStroke && !nowHasFill) {
      el.remove();
      removed += 1;
      return;
    }
    if (nowHasStroke && nowHasFill) {
      removeElementStroke(el);
      strippedStroke += 1;
    }
  });

  if (removed > 0 || strippedSubpaths > 0 || strippedStroke > 0) {
    buildPalette();
    setStatus(
      `Delete Open Paths removed ${removed} open/stroke element(s), stripped open subpaths from ${strippedSubpaths} mixed path(s), and removed stroke from ${strippedStroke} filled path(s).`
    );
  }
}

async function mergeSameColorShapes(colors = null, onProgress = null) {
  if (!loadedSvg) return 0;
  const palette = colors || [...new Set(getShapeItems().map((i) => i.fillHex).filter(Boolean))];
  const mergeSelector = 'path,rect,circle,ellipse,polygon';
  const totalColors = palette.length || 1;
  let mergedCount = 0;

  for (let colorIndex = 0; colorIndex < palette.length; colorIndex += 1) {
    const fill = palette[colorIndex];
    if (onProgress) {
      onProgress({
        stage: 'color',
        current: colorIndex + 1,
        total: totalColors,
        merged: mergedCount
      });
    }
    if (colorIndex % 2 === 0) await waitForUiFrame();

    const nodes = [...loadedSvg.querySelectorAll(mergeSelector)]
      .filter((el) => toHexColor(getFill(el)) === fill)
      .map((el) => {
        try {
          return { el, box: el.getBBox() };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    if (nodes.length < 2) continue;

    const visited = new Set();
    const activeGroups = [];
    for (let i = 0; i < nodes.length; i += 1) {
      if (visited.has(i)) continue;
      const group = [nodes[i]];
      visited.add(i);
      let changed = true;
      while (changed) {
        changed = false;
        for (let j = 0; j < nodes.length; j += 1) {
          if (visited.has(j)) continue;
          if (group.some((entry) => boxesOverlap(entry.box, nodes[j].box, 0))) {
            group.push(nodes[j]);
            visited.add(j);
            changed = true;
          }
        }
      }
      if (group.length > 1) activeGroups.push(group.map((entry) => entry.el));
    }

    if (activeGroups.length === 0) continue;

    for (let groupIndex = 0; groupIndex < activeGroups.length; groupIndex += 1) {
      const groupNodes = activeGroups[groupIndex];
      if (onProgress) {
        onProgress({
          stage: 'group',
          current: colorIndex + 1,
          total: totalColors,
          groupCurrent: groupIndex + 1,
          groupTotal: activeGroups.length,
          merged: mergedCount
        });
      }
      if (groupIndex % 2 === 0) await waitForUiFrame();

      const scope = new paper.PaperScope();
      const canvas = document.createElement('canvas');
      scope.setup(canvas);

      const imported = groupNodes
        .map((node) => {
          const clone = node.cloneNode(true);
          clone.removeAttribute('id');
          return scope.project.importSVG(clone);
        })
        .filter(Boolean)
        .map((item) => {
          if (item instanceof scope.CompoundPath || item instanceof scope.Path) return item;
          if (item.children?.length) {
            const child = item.children.find((c) => c instanceof scope.Path || c instanceof scope.CompoundPath);
            return child || null;
          }
          return null;
        })
        .filter(Boolean);

      if (imported.length < 2) {
        scope.remove();
        continue;
      }

      let united = imported[0];
      let fullyMerged = true;
      for (let i = 1; i < imported.length; i += 1) {
        try {
          const nextUnited = united.unite(imported[i]);
          if (!nextUnited) {
            fullyMerged = false;
            break;
          }
          united.remove();
          imported[i].remove();
          united = nextUnited;
        } catch {
          fullyMerged = false;
          break;
        }
      }

      if (!fullyMerged || !united || !united.exportSVG) {
        scope.remove();
        continue;
      }

      const exported = united.exportSVG({ asString: false });
      if (!exported) {
        scope.remove();
        continue;
      }

      const sanitizeExportedPath = (pathEl) => {
        const original = (pathEl.getAttribute('d') || '').trim();
        const sanitized = sanitizePathData(original);
        if (!sanitized) return false;
        if (sanitized !== original) pathEl.setAttribute('d', sanitized);
        return true;
      };

      if (exported.tagName?.toLowerCase() === 'path' && !sanitizeExportedPath(exported)) {
        scope.remove();
        continue;
      }
      const invalidDescendants = [];
      [...exported.querySelectorAll('path')].forEach((pathEl) => {
        if (!sanitizeExportedPath(pathEl)) invalidDescendants.push(pathEl);
      });
      invalidDescendants.forEach((pathEl) => pathEl.remove());

      groupNodes.forEach((node) => node.remove());
      stripStrokeRecursively(exported);
      setElementFill(exported, fill);
      loadedSvg.appendChild(exported);
      mergedCount += Math.max(0, groupNodes.length - 1);
      scope.remove();
    }
  }

  return mergedCount;
}

function removeElementStroke(el) {
  el.removeAttribute('stroke');
  el.removeAttribute('stroke-width');
  el.removeAttribute('stroke-opacity');
  el.style.stroke = '';
  el.style.strokeWidth = '';
  el.style.strokeOpacity = '';
}

function cleanupAllOpenPathsAndStrokes() {
  if (!loadedSvg) return { removed: 0, strippedStroke: 0, rewrittenOpenSubpaths: 0 };
  let removed = 0;
  let strippedStroke = 0;
  let rewrittenOpenSubpaths = 0;

  [...loadedSvg.querySelectorAll(shapeSelector)].forEach((el) => {
    const tag = el.tagName.toLowerCase();
    const fillHex = toHexColor(getFill(el));
    const stroke = getStroke(el);
    const hasFill = Boolean(fillHex);
    const hasStroke = Boolean(stroke);

    // Open geometry is never allowed.
    if (tag === 'path') {
      const original = (el.getAttribute('d') || '').trim();
      const sanitized = sanitizePathData(original);
      if (!sanitized) {
        el.remove();
        removed += 1;
        return;
      }
      if (sanitized !== original) {
        el.setAttribute('d', sanitized);
        rewrittenOpenSubpaths += 1;
      }
    }

    // Line primitives are stroke artifacts in this workflow.
    if (tag === 'line' || tag === 'polyline') {
      el.remove();
      removed += 1;
      return;
    }

    // No strokes should remain after merge.
    if (hasStroke) {
      if (!hasFill) {
        el.remove();
        removed += 1;
        return;
      }

      removeElementStroke(el);
      strippedStroke += 1;
    }

    // Remove elements that are neither filled nor stroked.
    const nowHasFill = Boolean(toHexColor(getFill(el)));
    const nowHasStroke = Boolean(getStroke(el));
    if (!nowHasFill && !nowHasStroke) {
      el.remove();
      removed += 1;
    }
  });

  return { removed, strippedStroke, rewrittenOpenSubpaths };
}

function runOpenPathCleanupAll() {
  if (!loadedSvg) {
    setStatus('Open Path Clean All skipped: load an SVG first.');
    return;
  }
  pushHistory(snapshot());
  const cleanup = cleanupAllOpenPathsAndStrokes();
  buildPalette();
  setStatus(
    `Open Path Clean All complete. Removed ${cleanup.removed} open/stroke element(s), rewrote ${cleanup.rewrittenOpenSubpaths} mixed path(s), stripped stroke from ${cleanup.strippedStroke} filled element(s).`
  );
}

function cleanupOpenStrokeArtifacts(maxArea = Number(speckleAreaEl.value) * 4) {
  if (!loadedSvg) return 0;

  const areaLimit = Number.isFinite(maxArea) && maxArea > 0 ? maxArea : 2000;
  let removed = 0;

  [...loadedSvg.querySelectorAll(shapeSelector)].forEach((el) => {
    const tag = el.tagName.toLowerCase();
    const fillHex = toHexColor(getFill(el));
    const stroke = getStroke(el);
    const hasFill = Boolean(fillHex);
    const hasStroke = Boolean(stroke);

    // Remove line-based artifacts.
    if (tag === 'line' || tag === 'polyline') {
      el.remove();
      removed++;
      return;
    }

    let area = Number.POSITIVE_INFINITY;
    try {
      const box = el.getBBox();
      area = box.width * box.height;
    } catch {
      // Ignore bbox failures.
    }

    // Remove tiny stroke-only fragments, but keep tiny filled artwork.
    if (!hasFill && Number.isFinite(area) && area <= areaLimit) {
      el.remove();
      removed++;
      return;
    }

    // Remove invalid/open stroke paths. Filled open paths can be valid glyph geometry.
    if (tag === 'path') {
      const d = (el.getAttribute('d') || '').trim();
      if (!d) {
        el.remove();
        removed++;
        return;
      }

      if (!hasFill && pathHasOpenSubpath(d)) {
        el.remove();
        removed++;
        return;
      }
    }

    // Remove stroke-only leftovers.
    if (!hasFill && hasStroke) {
      el.remove();
      removed++;
      return;
    }
  });

  return removed;
}

function recolorFilledShapes(fromColor, toColor) {
  if (!loadedSvg || !fromColor || !toColor) return 0;
  let recolored = 0;
  getShapeItems().forEach((item) => {
    if (item.fillHex !== fromColor) return;
    setElementFill(item.el, toColor);
    recolored += 1;
  });
  return recolored;
}

async function mergeSelectedColors() {
  if (!loadedSvg) return;
  if (isMerging) return;

  const colorA = toHexColor(mergeColorAEl?.value || mergeColorA);
  const colorB = toHexColor(mergeColorBEl?.value || mergeColorB);
  if (!colorA || !colorB) {
    setStatus('Merge skipped: choose two valid colors.');
    return;
  }
  if (colorA === colorB) {
    setStatus('Merge skipped: pick two different colors.');
    return;
  }

  mergeColorA = colorA;
  mergeColorB = colorB;
  isMerging = true;
  mergeBtn.disabled = true;
  if (mergeTwoColorsBtn) mergeTwoColorsBtn.disabled = true;
  const undoWasDisabled = undoBtn.disabled;
  const previousViewMode = viewMode;
  let mergeFailed = false;
  let recolored = 0;
  let merged = 0;

  try {
    if (viewMode !== 'fills') {
      viewMode = 'fills';
      applyViewMode();
      await waitForUiFrame();
    }

    pushHistory(snapshot());
    recolored = recolorFilledShapes(colorB, colorA);
    setStatus(`Merging selected colors (${colorA} + ${colorB})...`);
    await waitForUiFrame();
    merged = await mergeSameColorShapes([colorA]);
  } catch {
    mergeFailed = true;
  } finally {
    const cleanup = cleanupAllOpenPathsAndStrokes();
    selectedTargetColor = colorA;
    if (replaceColorEl) replaceColorEl.value = colorA;
    buildPalette();

    if (mergeFailed) {
      setStatus(
        `Two-color merge finished with errors. Recolored ${recolored} path(s), united ${merged} overlap(s), removed ${cleanup.removed} open/stroke element(s).`
      );
    } else {
      setStatus(
        `Two-color merge complete. Recolored ${recolored} path(s), united ${merged} overlap(s), removed ${cleanup.removed} open/stroke element(s).`
      );
    }

    if (viewMode !== previousViewMode) {
      viewMode = previousViewMode;
      applyViewMode();
    }
    isMerging = false;
    mergeBtn.disabled = false;
    if (mergeTwoColorsBtn) mergeTwoColorsBtn.disabled = false;
    if (!undoWasDisabled) undoBtn.disabled = false;
    saveUiSettings();
  }
}

function deleteSelectedBaseColor() {
  if (!loadedSvg) {
    setStatus('Delete skipped: load an SVG first.');
    return;
  }
  if (isMerging) return;

  const baseColor = toHexColor(mergeColorAEl?.value || mergeColorA);
  if (!baseColor) {
    setStatus('Delete skipped: pick a valid base color.');
    return;
  }

  const targets = [...loadedSvg.querySelectorAll(shapeSelector)].filter((el) => toHexColor(getFill(el)) === baseColor);
  if (targets.length === 0) {
    setStatus(`Delete skipped: no shapes found with base color ${baseColor}.`);
    return;
  }

  pushHistory(snapshot());
  targets.forEach((el) => el.remove());
  const cleanup = cleanupAllOpenPathsAndStrokes();
  buildPalette();
  setStatus(
    `Deleted ${targets.length} shape(s) with base color ${baseColor}. Removed ${cleanup.removed} open/stroke element(s).`
  );
  saveUiSettings();
}

function onPathContextMenu(event) {
  if (!loadedSvg) return;
  if (!(event.target instanceof Element)) return;
  const pathEl = event.target.closest('path');
  if (!(pathEl instanceof SVGPathElement)) return;
  if (!loadedSvg.contains(pathEl)) return;
  event.preventDefault();

  const box = getElementTransformedBox(pathEl);
  const area = boxArea(box);
  if (!(area > 0)) {
    setStatus('Could not calculate selected path size.');
    return;
  }

  const width = Math.max(0, box?.width || 0);
  const height = Math.max(0, box?.height || 0);
  const size = Math.max(1, Math.round(area));
  const currentMax = Number(speckleAreaEl?.value);
  setStatus(
    `Path size: ${size} (bbox ${width.toFixed(1)} x ${height.toFixed(1)}). Current max: ${Number.isFinite(currentMax) ? Math.round(currentMax) : 'n/a'}.`
  );
}

function undo() {
  const markup = history.pop();
  if (!markup) {
    undoBtn.disabled = true;
    return;
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(markup, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg) return;
  loadedSvg = document.importNode(svg, true);
  loadedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  ensureSvgViewportSize(loadedSvg);
  endHeldColorPreview();
  svgStage.innerHTML = '';
  svgStage.appendChild(loadedSvg);
  undoBtn.disabled = history.length === 0;
  buildPalette();
  applyViewMode();
  renderCropPreview();
  setStatus(`Undo complete. Remaining steps: ${history.length}.`);
}

function downloadSvg() {
  if (!loadedSvg) return;
  const exportSvg = loadedSvg.cloneNode(true);
  exportSvg.classList.remove('preview-strokes');
  [...exportSvg.querySelectorAll(shapeSelector)].forEach((el) => {
    el.style.removeProperty('--preview-stroke');
  });
  const markup = new XMLSerializer().serializeToString(exportSvg);
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = loadedFilename.toLowerCase().endsWith('.svg') ? loadedFilename : `${loadedFilename}.svg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setStatus('Download complete.');
}

function loadSvgText(text, filename = 'uploaded.svg') {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg || doc.querySelector('parsererror')) {
    setStatus('Unable to parse SVG file.');
    return;
  }
  loadedSvg = document.importNode(svg, true);
  loadedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  ensureSvgViewportSize(loadedSvg);
  endHeldColorPreview();
  svgStage.innerHTML = '';
  svgStage.appendChild(loadedSvg);
  loadedFilename = filename.toLowerCase().endsWith('.svg') ? filename : `${filename}.svg`;
  history = [];
  undoBtn.disabled = true;
  downloadBtn.disabled = false;
  const background = normalizeBackgroundToViewportRect();
  setCanvasTransparencyMode(!background.color);
  buildPalette();
  applyViewMode();
  applyZoom();
  renderCropPreview();
  if (background.color) {
    setStatus(
      `Loaded ${loadedFilename}. Normalized background ${background.color} (${background.removed} shape(s) replaced with viewport rect).`
    );
  } else {
    setStatus(`Loaded ${loadedFilename}. Select a working color and erase touched interior speckles.`);
  }
}

function handleFile(file) {
  if (!file) return;
  file.text()
    .then((text) => loadSvgText(text, file.name || 'uploaded.svg'))
    .catch(() => setStatus('Could not read file.'));
}

function updateBrushCursor(event) {
  const rect = canvasWrap.getBoundingClientRect();
  brushPreview.style.left = `${event.clientX - rect.left + canvasWrap.scrollLeft}px`;
  brushPreview.style.top = `${event.clientY - rect.top + canvasWrap.scrollTop}px`;
}

function startPan(event) {
  isPanning = true;
  canvasWrap.classList.add('panning');
  panStart = {
    x: event.clientX,
    y: event.clientY,
    scrollLeft: canvasWrap.scrollLeft,
    scrollTop: canvasWrap.scrollTop
  };
}

function onMouseDown(event) {
  if (!loadedSvg) return;
  if (event.button !== 0) return;
  if (mode === 'pan' || isSpaceHeld) {
    startPan(event);
    return;
  }
  isDrawing = true;
  fillMergeGestureDone = false;
  pushHistory(snapshot());
  applyBrush(event.clientX, event.clientY);
}

canvasWrap.addEventListener('mousemove', (event) => {
  if (!loadedSvg) return;
  updateBrushCursor(event);
  brushPreview.style.display = (mode === 'brush' || mode === 'openPathDel') && !isSpaceHeld ? 'block' : 'none';

  if (isPanning) {
    const dx = event.clientX - panStart.x;
    const dy = event.clientY - panStart.y;
    canvasWrap.scrollLeft = panStart.scrollLeft - dx;
    canvasWrap.scrollTop = panStart.scrollTop - dy;
    return;
  }

  if (isDrawing) applyBrush(event.clientX, event.clientY);
});

canvasWrap.addEventListener('mousedown', onMouseDown);
canvasWrap.addEventListener('mouseleave', () => {
  brushPreview.style.display = 'none';
});
canvasWrap.addEventListener('scroll', renderCropPreview);
window.addEventListener('resize', renderCropPreview);

document.addEventListener('mouseup', async () => {
  isDrawing = false;
  isPanning = false;
  fillMergeGestureDone = false;
  endHeldColorPreview();
  canvasWrap.classList.remove('panning');
  if (queuedFillMergeColor) await flushQueuedFillMerge();
});

document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space') return;
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable) return;
  event.preventDefault();
  isSpaceHeld = true;
  canvasWrap.classList.add('pan-enabled');
});

document.addEventListener('keyup', (event) => {
  if (event.code !== 'Space') return;
  isSpaceHeld = false;
  isPanning = false;
  canvasWrap.classList.remove('pan-enabled', 'panning');
});

canvasWrap.addEventListener(
  'wheel',
  (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    zoom = Math.max(0.1, Math.min(6, zoom * (event.deltaY < 0 ? 1.1 : 0.9)));
    applyZoom();
  },
  { passive: false }
);

replaceColorEl.addEventListener('input', () => {
  selectedTargetColor = replaceColorEl.value;
  renderSwatchSelection(targetPaletteEl, selectedTargetColor);
  saveUiSettings();
});
mergeColorAEl?.addEventListener('input', () => {
  mergeColorA = mergeColorAEl.value;
  renderSwatchSelection(mergePaletteAEl, mergeColorA);
  saveUiSettings();
});
mergeColorBEl?.addEventListener('input', () => {
  mergeColorB = mergeColorBEl.value;
  renderSwatchSelection(mergePaletteBEl, mergeColorB);
  saveUiSettings();
});
bindColorInputHoldPreview(replaceColorEl, () => replaceColorEl.value);
bindColorInputHoldPreview(mergeColorAEl, () => mergeColorAEl?.value || mergeColorA);
bindColorInputHoldPreview(mergeColorBEl, () => mergeColorBEl?.value || mergeColorB);

canvasBgColorEl?.addEventListener('input', () => {
  applyCanvasBackground(canvasBgColorEl.value);
  saveUiSettings();
});

deleteAllMatchingEl?.addEventListener('change', () => {
  if (deleteAllMatchingEl.checked && fillAndMergeEl) fillAndMergeEl.checked = false;
  saveUiSettings();
});
fillAndMergeEl?.addEventListener('change', () => {
  if (fillAndMergeEl.checked && deleteAllMatchingEl) deleteAllMatchingEl.checked = false;
  saveUiSettings();
});
speckleAreaEl?.addEventListener('input', () => {
  renderSpeckleAreaValue();
  saveUiSettings();
});
cropRatioEl?.addEventListener('change', () => {
  saveUiSettings();
  renderCropPreview();
});
cropPaddingEl?.addEventListener('input', () => {
  saveUiSettings();
  renderCropPreview();
});
cropAlignEl?.addEventListener('change', () => {
  saveUiSettings();
  renderCropPreview();
});
brushSizeEl.addEventListener('input', () => {
  applyZoom();
  saveUiSettings();
});
fileInput.addEventListener('change', () => handleFile(fileInput.files?.[0]));
modeBrushBtn.addEventListener('click', () => {
  setMode('brush');
  saveUiSettings();
});
modeOpenPathBtn.addEventListener('click', () => {
  setMode('openPathDel');
  saveUiSettings();
});
openPathCleanAllBtn?.addEventListener('click', runOpenPathCleanupAll);
modePanBtn.addEventListener('click', () => {
  setMode('pan');
  saveUiSettings();
});
viewToggleBtn?.addEventListener('click', () => {
  viewMode = viewMode === 'fills' ? 'strokes' : 'fills';
  applyViewMode();
  saveUiSettings();
});
undoBtn.addEventListener('click', undo);
downloadBtn.addEventListener('click', downloadSvg);
mergeTwoColorsBtn?.addEventListener('click', mergeSelectedColors);
deleteBaseColorBtn?.addEventListener('click', deleteSelectedBaseColor);
applyCropBtn?.addEventListener('click', () => {
  if (!loadedSvg) {
    setStatus('Crop skipped: load an SVG first.');
    return;
  }
  pushHistory(snapshot());
  applyCrop();
});
canvasWrap.addEventListener('contextmenu', onPathContextMenu);

mergeBtn.addEventListener('click', async () => {
  if (!loadedSvg) return;
  if (isMerging) return;
  isMerging = true;
  mergeBtn.disabled = true;
  const undoWasDisabled = undoBtn.disabled;
  const previousViewMode = viewMode;
  let mergeAttempted = false;
  let merged = 0;
  let mergeFailed = false;
  let workingColor = null;
  try {
    if (viewMode !== 'fills') {
      viewMode = 'fills';
      applyViewMode();
      await waitForUiFrame();
    }

    workingColor = toHexColor(selectedTargetColor || replaceColorEl.value);
    if (!workingColor) {
      setStatus('Merge skipped: choose a working color first.');
      return;
    }
    mergeAttempted = true;
    pushHistory(snapshot());
    setStatus('Merge started (0%).');
    await waitForUiFrame();
    merged = await mergeSameColorShapes(
      [workingColor],
      ({ current, total, groupCurrent, groupTotal, merged: mergedSoFar }) => {
        const pct = Math.round((current / Math.max(1, total)) * 100);
        if (groupCurrent && groupTotal) {
          setStatus(
            `Merging ${pct}% (${current}/${total} colors, group ${groupCurrent}/${groupTotal}). United so far: ${mergedSoFar}.`
          );
        } else {
          setStatus(`Merging ${pct}% (${current}/${total} colors). United so far: ${mergedSoFar}.`);
        }
      }
    );
  } catch {
    mergeFailed = true;
  } finally {
    if (mergeAttempted) {
      const cleanup = cleanupAllOpenPathsAndStrokes();
      buildPalette();
      if (mergeFailed) {
        setStatus(
          `Merge finished with errors (working color ${workingColor}). United ${merged} overlap(s), removed ${cleanup.removed} open/stroke element(s), rewrote ${cleanup.rewrittenOpenSubpaths} mixed path(s), stripped stroke from ${cleanup.strippedStroke} filled element(s).`
        );
      } else {
        setStatus(
          `Merge complete (working color ${workingColor}). United ${merged} overlap(s), removed ${cleanup.removed} open/stroke element(s), rewrote ${cleanup.rewrittenOpenSubpaths} mixed path(s), stripped stroke from ${cleanup.strippedStroke} filled element(s).`
        );
      }
    }

    if (viewMode !== previousViewMode) {
      viewMode = previousViewMode;
      applyViewMode();
    }
    isMerging = false;
    mergeBtn.disabled = false;
    if (!undoWasDisabled) undoBtn.disabled = false;
  }
});

zoomInBtn.addEventListener('click', () => {
  zoom = Math.min(6, zoom * 1.2);
  applyZoom();
});
zoomOutBtn.addEventListener('click', () => {
  zoom = Math.max(0.1, zoom / 1.2);
  applyZoom();
});
zoomResetBtn.addEventListener('click', () => {
  zoom = 1;
  applyZoom();
});

document.addEventListener('dragenter', (event) => {
  event.preventDefault();
  pageDragDepth += 1;
  dropOverlay.classList.add('active');
});

document.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropOverlay.classList.add('active');
});

document.addEventListener('dragleave', (event) => {
  event.preventDefault();
  pageDragDepth = Math.max(0, pageDragDepth - 1);
  if (pageDragDepth === 0) dropOverlay.classList.remove('active');
});

document.addEventListener('drop', (event) => {
  event.preventDefault();
  pageDragDepth = 0;
  dropOverlay.classList.remove('active');
  handleFile(event.dataTransfer?.files?.[0]);
});

applyLoadedUiSettings();
updateSpeckleAreaControl(Number(speckleAreaEl?.value));
selectedTargetColor = replaceColorEl?.value || selectedTargetColor;
mergeColorA = mergeColorAEl?.value || mergeColorA;
mergeColorB = mergeColorBEl?.value || mergeColorB;
setMode(mode);
applyViewMode();
applyZoom();
applyCanvasBackground(canvasBgColorEl?.value || '#0a0b0f');
renderCropPreview();
saveUiSettings();

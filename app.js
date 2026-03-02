const fileInput = document.getElementById('fileInput');
const stageViewportEl = document.getElementById('stageViewport');
const stageContentEl = document.getElementById('stageContent');
const svgStage = document.getElementById('svgStage');
const canvasWrap = document.getElementById('canvasWrap');
const emptyCanvasMessageEl = document.getElementById('emptyCanvasMessage');
const cropPreviewEl = document.getElementById('cropPreview');
const rotationPivotEl = document.getElementById('rotationPivot');
const selectionMarqueeEl = document.getElementById('selectionMarquee');
const artboardTransformEl = document.getElementById('artboardTransform');
const dropOverlay = document.getElementById('dropOverlay');
const statusEl = document.getElementById('status');
const speckleAreaEl = document.getElementById('speckleArea');
const speckleAreaValueEl = document.getElementById('speckleAreaValue');
const speckleAreaQuickEl = document.getElementById('speckleAreaQuick');
const speckleAreaQuickValueEl = document.getElementById('speckleAreaQuickValue');
const cleanupOptionsGroupEl = document.getElementById('cleanupOptionsGroup');
const speckleAreaGroupEl = document.getElementById('speckleAreaGroup');
const despeckleHudEl = document.getElementById('despeckleHud');
const canvasBgColorEl = document.getElementById('canvasBgColor');
const targetPaletteEl = document.getElementById('targetPalette');
const replaceColorEl = document.getElementById('replaceColor');
const cmykCEl = document.getElementById('cmykC');
const cmykMEl = document.getElementById('cmykM');
const cmykYEl = document.getElementById('cmykY');
const cmykKEl = document.getElementById('cmykK');
const cmykPreviewEl = document.getElementById('cmykPreview');
const workingColorPreviewEl = document.getElementById('workingColorPreview');
const colorAdjustModelEl = document.getElementById('colorAdjustModel');
const colorChannel1LabelEl = document.getElementById('colorChannel1Label');
const colorChannel2LabelEl = document.getElementById('colorChannel2Label');
const colorChannel3LabelEl = document.getElementById('colorChannel3Label');
const colorChannel4LabelEl = document.getElementById('colorChannel4Label');
const applyCmykBtn = document.getElementById('applyCmykBtn');
const modeSelectBtn = document.getElementById('modeSelectBtn');
const modeFloodFillBtn = document.getElementById('modeFloodFillBtn');
const modeColorSwapBtn = document.getElementById('modeColorSwapBtn');
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
const deleteCurrentColorBtn = document.getElementById('deleteCurrentColorBtn');
const restoreBackgroundBtn = document.getElementById('restoreBackgroundBtn');
const undoBtn = document.getElementById('undoBtn');
const downloadBtn = document.getElementById('downloadBtn');
const cropRatioEl = document.getElementById('cropRatio');
const cropTransformBtn = document.getElementById('cropTransformBtn');
const applyCropBtn = document.getElementById('applyCropBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomResetBtn = document.getElementById('zoomResetBtn');
const zoomFitBtn = document.getElementById('zoomFitBtn');
const rotationPopupEl = document.getElementById('rotationPopup');
const rotationSliderEl = document.getElementById('rotationSlider');
const rotationValueEl = document.getElementById('rotationValue');
const rotationCancelBtn = document.getElementById('rotationCancelBtn');
const rotationApplyBtn = document.getElementById('rotationApplyBtn');

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
let heldPreviewColor = null;
let heldPreviewTimer = null;
const HOLD_PREVIEW_DELAY_MS = 260;
let artboardTransformMode = false;
let customCropRect = null;
let artboardTransformDrag = null;
let selectedPaths = new Set();
let marqueeState = null;
let pathDragState = null;
let rotationUiState = null;
let statusToastTimer = null;
let lastKnownBackgroundColor = null;
let colorAdjustMode = 'cmyk';

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
      canvasBgColor: canvasBgColorEl?.value || '#0a0b0f',
      workingColor: replaceColorEl?.value || '#111111',
      mergeColorA: mergeColorAEl?.value || '#111111',
      mergeColorB: mergeColorBEl?.value || '#222222',
      cropRatio: cropRatioEl?.value || 'current',
      colorAdjustMode: colorAdjustModelEl?.value || colorAdjustMode || 'cmyk',
      mode,
      viewMode
    };
    localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage failures.
  }
}

function setStatus(message) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.add('show');
  if (statusToastTimer) clearTimeout(statusToastTimer);
  statusToastTimer = setTimeout(() => {
    statusEl.classList.remove('show');
    statusToastTimer = null;
  }, 2400);
}

function applyCanvasBackground(color) {
  const normalized = toHexColor(color);
  if (!normalized) return;
  canvasWrap.style.setProperty('--canvas-bg', normalized);
}

function setCanvasTransparencyMode(enabled) {
  canvasWrap.classList.toggle('transparent-checker', Boolean(enabled));
}

function updateDespeckleOptionsVisibility() {
  const show = mode === 'brush';
  cleanupOptionsGroupEl?.classList.toggle('hidden', !show);
  speckleAreaGroupEl?.classList.toggle('hidden', !show);
  despeckleHudEl?.classList.toggle('active', show);
  if (despeckleHudEl) despeckleHudEl.setAttribute('aria-hidden', show ? 'false' : 'true');
}

function resetCropUiControls({ persist = true, rerender = true } = {}) {
  if (cropRatioEl) cropRatioEl.value = 'current';
  if (rerender) renderCropPreview();
  if (persist) saveUiSettings();
}

function updateEmptyCanvasState() {
  const isEmpty = !loadedSvg;
  canvasWrap?.classList.toggle('empty-state', isEmpty);
  emptyCanvasMessageEl?.classList.toggle('hidden', !isEmpty);
}

function hideArtboardTransformOverlay() {
  if (!artboardTransformEl) return;
  artboardTransformEl.classList.remove('active');
}

function setArtboardTransformMode(enabled, { seedFromUi = true, rerender = true } = {}) {
  const next = Boolean(enabled) && Boolean(loadedSvg);
  artboardTransformMode = next;
  if (!artboardTransformMode) {
    customCropRect = null;
    artboardTransformDrag = null;
  } else if (seedFromUi || !customCropRect) {
    customCropRect = computeCropRectFromUi() || getSvgViewportBounds(loadedSvg);
  }
  cropTransformBtn?.classList.toggle('active', artboardTransformMode);
  if (!artboardTransformMode) hideArtboardTransformOverlay();
  if (rerender) renderCropPreview();
}

function getEffectiveCropRect() {
  if (artboardTransformMode && customCropRect) return customCropRect;
  return computeCropRectFromUi();
}

function updateCanvasStrokeBackdrop() {
  canvasWrap.classList.remove('strokes-bg');
}

function updateToolCursorState() {
  if (!stageViewportEl) return;
  stageViewportEl.classList.remove('cursor-cleanup', 'cursor-flood-fill', 'cursor-color-swap', 'cursor-select');
}

function clampCanvasScroll() {
  if (!stageViewportEl) return;
  const maxLeft = Math.max(0, stageViewportEl.scrollWidth - stageViewportEl.clientWidth);
  const maxTop = Math.max(0, stageViewportEl.scrollHeight - stageViewportEl.clientHeight);
  if (stageViewportEl.scrollLeft < 0) stageViewportEl.scrollLeft = 0;
  if (stageViewportEl.scrollTop < 0) stageViewportEl.scrollTop = 0;
  if (stageViewportEl.scrollLeft > maxLeft) stageViewportEl.scrollLeft = maxLeft;
  if (stageViewportEl.scrollTop > maxTop) stageViewportEl.scrollTop = maxTop;
}

function getAvailableCanvasSpace() {
  const rect = stageViewportEl?.getBoundingClientRect();
  if (!rect) return { width: 640, height: 640 };
  return {
    width: Math.max(1, Math.floor(rect.width - 2)),
    height: Math.max(1, Math.floor(rect.height - 2))
  };
}

function resizeCanvasToImage() {
  if (!loadedSvg) {
    canvasWrap.style.removeProperty('width');
    canvasWrap.style.removeProperty('height');
    stageContentEl?.style.removeProperty('width');
    stageContentEl?.style.removeProperty('height');
    return;
  }
  const viewport = getSvgViewportBounds(loadedSvg);
  if (!viewport || !(viewport.width > 0 && viewport.height > 0)) return;

  const available = getAvailableCanvasSpace();
  const stagePadding = 0;
  const targetWidth = Math.ceil(viewport.width * zoom) + stagePadding;
  const targetHeight = Math.ceil(viewport.height * zoom) + stagePadding;
  const width = Math.max(1, targetWidth);
  const height = Math.max(1, targetHeight);
  canvasWrap.style.width = `${width}px`;
  canvasWrap.style.height = `${height}px`;
  if (stageContentEl) {
    stageContentEl.style.width = `${Math.max(available.width, width + 64)}px`;
    stageContentEl.style.height = `${Math.max(available.height, height + 64)}px`;
  }
}

function computeFitZoom() {
  const viewport = getSvgViewportBounds(loadedSvg);
  if (!viewport || !(viewport.width > 0 && viewport.height > 0)) return 1;
  const available = getAvailableCanvasSpace();
  const stagePadding = 0;
  const fitX = (available.width - stagePadding) / viewport.width;
  const fitY = (available.height - stagePadding) / viewport.height;
  return Math.max(0.1, Math.min(6, Math.min(fitX, fitY)));
}

function fitToScreen() {
  if (!loadedSvg) return;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  zoom = computeFitZoom();
  applyZoom();
  if (stageViewportEl) {
    stageViewportEl.scrollLeft = 0;
    stageViewportEl.scrollTop = 0;
  }
  setStatus(`Fit to screen (${Math.round(zoom * 100)}%).`);
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
  if (typeof settings.cropRatio === 'string' && cropRatioEl) {
    const allowed = new Set(['current', 'custom', '1:1', '2:3', '3:2', '4:5', '5:4']);
    if (allowed.has(settings.cropRatio)) cropRatioEl.value = settings.cropRatio;
  }
  if (
    settings.mode === 'pan'
    || settings.mode === 'brush'
    || settings.mode === 'openPathDel'
    || settings.mode === 'select'
    || settings.mode === 'floodFill'
    || settings.mode === 'colorSwap'
  ) {
    mode = settings.mode;
  }
  if (settings.viewMode === 'strokes' || settings.viewMode === 'fills') {
    viewMode = settings.viewMode;
  }
  if (settings.colorAdjustMode === 'hsl' || settings.colorAdjustMode === 'rgb' || settings.colorAdjustMode === 'cmyk') {
    colorAdjustMode = settings.colorAdjustMode;
    if (colorAdjustModelEl) colorAdjustModelEl.value = settings.colorAdjustMode;
  } else if (colorAdjustModelEl) {
    colorAdjustMode = colorAdjustModelEl.value || colorAdjustMode;
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

function hexToRgb(hex) {
  const normalized = toHexColor(hex);
  if (!normalized || normalized.length < 7) return null;
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  if (![r, g, b].every(Number.isFinite)) return null;
  return { r, g, b };
}

function rgbToHsl({ r, g, b }) {
  const nr = clampNumber((Number(r) || 0) / 255, 0, 1);
  const ng = clampNumber((Number(g) || 0) / 255, 0, 1);
  const nb = clampNumber((Number(b) || 0) / 255, 0, 1);
  const max = Math.max(nr, ng, nb);
  const min = Math.min(nr, ng, nb);
  const delta = max - min;

  let h = 0;
  if (delta > 0) {
    if (max === nr) h = ((ng - nb) / delta) % 6;
    else if (max === ng) h = (nb - nr) / delta + 2;
    else h = (nr - ng) / delta + 4;
  }

  h = Math.round(((h * 60) + 360) % 360);
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs((2 * l) - 1));

  return {
    h,
    s: Math.round(clampNumber(s * 100, 0, 100)),
    l: Math.round(clampNumber(l * 100, 0, 100))
  };
}

function rgbToCmyk({ r, g, b }) {
  const nr = clampNumber((Number(r) || 0) / 255, 0, 1);
  const ng = clampNumber((Number(g) || 0) / 255, 0, 1);
  const nb = clampNumber((Number(b) || 0) / 255, 0, 1);
  const k = 1 - Math.max(nr, ng, nb);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };

  const denom = 1 - k;
  const c = ((1 - nr - k) / denom) * 100;
  const m = ((1 - ng - k) / denom) * 100;
  const y = ((1 - nb - k) / denom) * 100;
  return {
    c: Math.round(clampNumber(c, 0, 100)),
    m: Math.round(clampNumber(m, 0, 100)),
    y: Math.round(clampNumber(y, 0, 100)),
    k: Math.round(clampNumber(k * 100, 0, 100))
  };
}

function cmykToHex(c, m, y, k) {
  const nc = clampNumber((Number(c) || 0) / 100, 0, 1);
  const nm = clampNumber((Number(m) || 0) / 100, 0, 1);
  const ny = clampNumber((Number(y) || 0) / 100, 0, 1);
  const nk = clampNumber((Number(k) || 0) / 100, 0, 1);
  const r = Math.round(255 * (1 - nc) * (1 - nk));
  const g = Math.round(255 * (1 - nm) * (1 - nk));
  const b = Math.round(255 * (1 - ny) * (1 - nk));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function hslToHex(h, s, l) {
  const nh = ((Number(h) || 0) % 360 + 360) % 360;
  const ns = clampNumber((Number(s) || 0) / 100, 0, 1);
  const nl = clampNumber((Number(l) || 0) / 100, 0, 1);
  const c = (1 - Math.abs((2 * nl) - 1)) * ns;
  const x = c * (1 - Math.abs(((nh / 60) % 2) - 1));
  const m = nl - (c / 2);

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (nh < 60) [r1, g1, b1] = [c, x, 0];
  else if (nh < 120) [r1, g1, b1] = [x, c, 0];
  else if (nh < 180) [r1, g1, b1] = [0, c, x];
  else if (nh < 240) [r1, g1, b1] = [0, x, c];
  else if (nh < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];

  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function rgbChannelsToHex(r, g, b) {
  const nr = clampNumber(Math.round(Number(r) || 0), 0, 255);
  const ng = clampNumber(Math.round(Number(g) || 0), 0, 255);
  const nb = clampNumber(Math.round(Number(b) || 0), 0, 255);
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

const COLOR_ADJUST_CONFIG = {
  cmyk: {
    channels: [
      { label: 'C', min: 0, max: 100, step: 1 },
      { label: 'M', min: 0, max: 100, step: 1 },
      { label: 'Y', min: 0, max: 100, step: 1 },
      { label: 'K', min: 0, max: 100, step: 1 }
    ]
  },
  rgb: {
    channels: [
      { label: 'R', min: 0, max: 255, step: 1 },
      { label: 'G', min: 0, max: 255, step: 1 },
      { label: 'B', min: 0, max: 255, step: 1 }
    ]
  },
  hsl: {
    channels: [
      { label: 'H', min: 0, max: 360, step: 1 },
      { label: 'S', min: 0, max: 100, step: 1 },
      { label: 'L', min: 0, max: 100, step: 1 }
    ]
  }
};

function getColorAdjustMode() {
  const next = (colorAdjustModelEl?.value || colorAdjustMode || 'cmyk').toLowerCase();
  return Object.prototype.hasOwnProperty.call(COLOR_ADJUST_CONFIG, next) ? next : 'cmyk';
}

function setAdjustControlVisibility(labelEl, inputEl, show) {
  labelEl?.classList.toggle('hidden', !show);
  inputEl?.classList.toggle('hidden', !show);
}

function updateColorAdjustControlUi() {
  const mode = getColorAdjustMode();
  colorAdjustMode = mode;
  const config = COLOR_ADJUST_CONFIG[mode];
  const controls = [
    { labelEl: colorChannel1LabelEl, inputEl: cmykCEl },
    { labelEl: colorChannel2LabelEl, inputEl: cmykMEl },
    { labelEl: colorChannel3LabelEl, inputEl: cmykYEl },
    { labelEl: colorChannel4LabelEl, inputEl: cmykKEl }
  ];

  controls.forEach((control, index) => {
    const channel = config.channels[index];
    setAdjustControlVisibility(control.labelEl, control.inputEl, Boolean(channel));
    if (!channel || !control.inputEl) return;
    if (control.labelEl) control.labelEl.textContent = channel.label;
    control.inputEl.min = String(channel.min);
    control.inputEl.max = String(channel.max);
    control.inputEl.step = String(channel.step);
  });
  updateColorAdjustTrackGradients();
}

function getColorAdjustResultHex() {
  const mode = getColorAdjustMode();
  const v1 = Number(cmykCEl?.value);
  const v2 = Number(cmykMEl?.value);
  const v3 = Number(cmykYEl?.value);
  const v4 = Number(cmykKEl?.value);

  if (mode === 'rgb') return toHexColor(rgbChannelsToHex(v1, v2, v3));
  if (mode === 'hsl') return toHexColor(hslToHex(v1, v2, v3));
  return toHexColor(cmykToHex(v1, v2, v3, v4));
}

function setTrackGradient(inputEl, gradient) {
  if (!inputEl) return;
  inputEl.style.setProperty('--track-gradient', gradient);
}

function updateColorAdjustTrackGradients() {
  const mode = getColorAdjustMode();
  const v1 = Number(cmykCEl?.value);
  const v2 = Number(cmykMEl?.value);
  const v3 = Number(cmykYEl?.value);
  const v4 = Number(cmykKEl?.value);

  if (mode === 'hsl') {
    const hue = clampNumber(v1, 0, 360);
    const sat = clampNumber(v2, 0, 100);
    const light = clampNumber(v3, 0, 100);
    setTrackGradient(cmykCEl, 'linear-gradient(90deg, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)');
    setTrackGradient(cmykMEl, `linear-gradient(90deg, hsl(${hue}, 0%, ${light}%), hsl(${hue}, 100%, ${light}%))`);
    setTrackGradient(cmykYEl, `linear-gradient(90deg, hsl(${hue}, ${sat}%, 0%), hsl(${hue}, ${sat}%, 50%), hsl(${hue}, ${sat}%, 100%))`);
    setTrackGradient(cmykKEl, 'linear-gradient(90deg, #2a2a2a, #8a8a8a)');
    return;
  }

  if (mode === 'rgb') {
    const r = clampNumber(v1, 0, 255);
    const g = clampNumber(v2, 0, 255);
    const b = clampNumber(v3, 0, 255);
    setTrackGradient(cmykCEl, `linear-gradient(90deg, rgb(0, ${g}, ${b}), rgb(255, ${g}, ${b}))`);
    setTrackGradient(cmykMEl, `linear-gradient(90deg, rgb(${r}, 0, ${b}), rgb(${r}, 255, ${b}))`);
    setTrackGradient(cmykYEl, `linear-gradient(90deg, rgb(${r}, ${g}, 0), rgb(${r}, ${g}, 255))`);
    setTrackGradient(cmykKEl, 'linear-gradient(90deg, #2a2a2a, #8a8a8a)');
    return;
  }

  const black = clampNumber(v4, 0, 100);
  setTrackGradient(cmykCEl, `linear-gradient(90deg, hsl(0, 0%, ${100 - black}%), hsl(190, 100%, ${52 - black * 0.25}%))`);
  setTrackGradient(cmykMEl, `linear-gradient(90deg, hsl(0, 0%, ${100 - black}%), hsl(320, 95%, ${58 - black * 0.25}%))`);
  setTrackGradient(cmykYEl, `linear-gradient(90deg, hsl(0, 0%, ${100 - black}%), hsl(54, 100%, ${58 - black * 0.2}%))`);
  setTrackGradient(cmykKEl, 'linear-gradient(90deg, #f3f3f3, #1a1a1a)');
}

function updateCmykPreview() {
  if (!cmykPreviewEl) return;
  updateColorAdjustTrackGradients();
  const color = getColorAdjustResultHex() || '#111111';
  cmykPreviewEl.style.background = color;
}

function updateWorkingColorPreview() {
  if (!workingColorPreviewEl) return;
  const color = toHexColor(selectedTargetColor || replaceColorEl?.value) || '#111111';
  workingColorPreviewEl.style.background = color;
}

function syncCmykControlsFromWorkingColor() {
  if (!(cmykCEl && cmykMEl && cmykYEl && cmykKEl)) return;
  const mode = getColorAdjustMode();
  const rgb = hexToRgb(selectedTargetColor || replaceColorEl?.value);
  if (!rgb) return;

  if (mode === 'rgb') {
    cmykCEl.value = String(Math.round(clampNumber(rgb.r, 0, 255)));
    cmykMEl.value = String(Math.round(clampNumber(rgb.g, 0, 255)));
    cmykYEl.value = String(Math.round(clampNumber(rgb.b, 0, 255)));
    cmykKEl.value = '0';
  } else if (mode === 'hsl') {
    const hsl = rgbToHsl(rgb);
    cmykCEl.value = String(hsl.h);
    cmykMEl.value = String(hsl.s);
    cmykYEl.value = String(hsl.l);
    cmykKEl.value = '0';
  } else {
    const cmyk = rgbToCmyk(rgb);
    cmykCEl.value = String(cmyk.c);
    cmykMEl.value = String(cmyk.m);
    cmykYEl.value = String(cmyk.y);
    cmykKEl.value = String(cmyk.k);
  }

  updateCmykPreview();
  updateWorkingColorPreview();
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
  const valueText = `${current} / ${max}`;
  speckleAreaValueEl.textContent = valueText;
  if (speckleAreaQuickValueEl) speckleAreaQuickValueEl.textContent = valueText;
  speckleAreaEl.title = `Range: ${min} to ${max}`;
  if (speckleAreaQuickEl) speckleAreaQuickEl.title = `Range: ${min} to ${max}`;
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
  if (speckleAreaQuickEl) {
    speckleAreaQuickEl.min = String(min);
    speckleAreaQuickEl.max = String(max);
    speckleAreaQuickEl.value = String(nextValue);
  }
  renderSpeckleAreaValue();
}

function detectEdgeTouchingBackgroundColor() {
  if (!loadedSvg) return null;
  const viewport = getSvgViewportBounds(loadedSvg);
  if (!viewport) return null;
  const viewportArea = Math.max(1, viewport.width * viewport.height);

  const isInDefinitionTree = (el) => Boolean(el?.closest?.('defs,clipPath,mask,pattern,symbol,marker'));
  const edgeTouchFlags = (box) => {
    if (!box) return { left: false, right: false, top: false, bottom: false };
    const epsilon = 0.5;
    return {
      left: box.x <= viewport.left + epsilon,
      right: box.x + box.width >= viewport.right - epsilon,
      top: box.y <= viewport.top + epsilon,
      bottom: box.y + box.height >= viewport.bottom - epsilon
    };
  };

  const edgeItems = getShapeItems({ includeBackground: true }).filter((item) => {
    if (!item.fillHex) return false;
    if (isInDefinitionTree(item.el)) return false;
    return boxTouchesViewportEdge(item.box, viewport);
  });
  if (edgeItems.length === 0) return null;

  const byColor = new Map();
  edgeItems.forEach((item) => {
    const stats = byColor.get(item.fillHex) || {
      color: item.fillHex,
      totalArea: 0,
      maxArea: 0,
      left: false,
      right: false,
      top: false,
      bottom: false,
      items: []
    };
    stats.totalArea += Math.max(1, item.area);
    stats.maxArea = Math.max(stats.maxArea, item.area);
    const touch = edgeTouchFlags(item.box);
    stats.left = stats.left || touch.left;
    stats.right = stats.right || touch.right;
    stats.top = stats.top || touch.top;
    stats.bottom = stats.bottom || touch.bottom;
    stats.items.push(item);
    byColor.set(item.fillHex, stats);
  });

  const qualifying = [...byColor.values()]
    .filter((stats) => {
      const edgeCount = Number(stats.left) + Number(stats.right) + Number(stats.top) + Number(stats.bottom);
      const largestCoverage = stats.maxArea / viewportArea;
      const totalCoverage = stats.totalArea / viewportArea;
      return (largestCoverage >= 0.6 && edgeCount >= 2) || (totalCoverage >= 0.75 && edgeCount >= 3);
    })
    .sort((a, b) => {
      if (b.maxArea !== a.maxArea) return b.maxArea - a.maxArea;
      return b.totalArea - a.totalArea;
    });

  if (qualifying.length === 0) return null;
  const winner = qualifying[0];
  const minRemovalArea = viewportArea * 0.2;
  const removableItems = winner.items.filter((item) => item.area >= minRemovalArea);
  const items = removableItems.length > 0 ? removableItems : [winner.items[0]].filter(Boolean);
  if (items.length === 0) return null;

  return {
    color: winner.color,
    items
  };
}

function findBackgroundInsertAnchor(svg) {
  if (!svg) return null;
  const skip = new Set(['defs', 'title', 'desc', 'metadata']);
  return [...svg.children].find((node) => !skip.has(node.tagName.toLowerCase())) || null;
}

function insertBackgroundRectForViewport(color) {
  if (!loadedSvg) return false;
  const normalizedColor = toHexColor(color);
  if (!normalizedColor) return false;
  const viewport = getSvgViewportBounds(loadedSvg);
  if (!viewport) return false;

  [...loadedSvg.querySelectorAll(`[${BACKGROUND_LAYER_ATTR}="1"]`)].forEach((node) => node.remove());

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', String(viewport.x));
  rect.setAttribute('y', String(viewport.y));
  rect.setAttribute('width', String(viewport.width));
  rect.setAttribute('height', String(viewport.height));
  rect.setAttribute(BACKGROUND_LAYER_ATTR, '1');
  rect.setAttribute('pointer-events', 'none');
  setElementFill(rect, normalizedColor);

  const anchor = findBackgroundInsertAnchor(loadedSvg);
  if (anchor) loadedSvg.insertBefore(rect, anchor);
  else loadedSvg.appendChild(rect);

  return true;
}

function normalizeBackgroundToViewportRect() {
  if (!loadedSvg) return { color: null, removed: 0, inserted: false };

  [...loadedSvg.querySelectorAll(`[${BACKGROUND_LAYER_ATTR}="1"]`)].forEach((node) => node.remove());

  const backgroundCandidate = detectEdgeTouchingBackgroundColor();
  if (!backgroundCandidate?.color) return { color: null, removed: 0, inserted: false };
  const backgroundColor = backgroundCandidate.color;
  lastKnownBackgroundColor = backgroundColor;

  let removed = 0;
  backgroundCandidate.items.forEach((item) => {
    if (!(item?.el instanceof Element)) return;
    if (!item.el.isConnected) return;
    item.el.remove();
    removed += 1;
  });

  const inserted = insertBackgroundRectForViewport(backgroundColor);
  return { color: backgroundColor, removed, inserted };
}

function getBackgroundFillHex() {
  if (!loadedSvg) return null;
  const bgNode = loadedSvg.querySelector(`[${BACKGROUND_LAYER_ATTR}="1"]`);
  if (!(bgNode instanceof Element)) return null;
  return toHexColor(getFill(bgNode));
}

function restoreBackgroundColorPath() {
  if (!loadedSvg) {
    setStatus('Restore background skipped: load an SVG first.');
    return;
  }

  const before = snapshot();
  const normalized = normalizeBackgroundToViewportRect();
  if (normalized.color) {
    if (before) pushHistory(before);
    buildPalette();
    applyViewMode();
    renderCropPreview();
    setStatus(
      `Background restored to ${normalized.color} (${normalized.removed} shape(s) normalized to viewport background).`
    );
    return;
  }

  const fallback =
    toHexColor(lastKnownBackgroundColor)
    || toHexColor(getBackgroundFillHex())
    || toHexColor(canvasBgColorEl?.value)
    || '#ffffff';
  if (!insertBackgroundRectForViewport(fallback)) {
    setStatus('Restore background skipped: viewport unavailable.');
    return;
  }

  lastKnownBackgroundColor = fallback;
  if (before) pushHistory(before);
  buildPalette();
  applyViewMode();
  renderCropPreview();
  setStatus(`Background restored using ${fallback}.`);
}

function buildPalette() {
  if (!loadedSvg) return;
  pruneSelectedPaths();
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
    syncCmykControlsFromWorkingColor();
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
  syncCmykControlsFromWorkingColor();
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
  updateCanvasStrokeBackdrop();
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

function cancelHeldColorPreviewTimer() {
  if (!heldPreviewTimer) return;
  clearTimeout(heldPreviewTimer);
  heldPreviewTimer = null;
}

function activateHeldColorPreview(color) {
  const focusColor = toHexColor(color);
  if (!focusColor || !loadedSvg) return;
  heldPreviewColor = focusColor;
  applyHeldColorPreview();
}

function beginHeldColorPreview(color) {
  cancelHeldColorPreviewTimer();
  heldPreviewTimer = setTimeout(() => {
    heldPreviewTimer = null;
    activateHeldColorPreview(color);
  }, HOLD_PREVIEW_DELAY_MS);
}

function endHeldColorPreview() {
  cancelHeldColorPreviewTimer();
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
  if (mode !== 'select' && rotationUiState) closeRotationPopup({ apply: false });
  if (mode !== 'select') {
    endPathDrag();
    clearSelectedPaths();
    selectionMarqueeEl?.classList.remove('active');
    marqueeState = null;
  }
  modeSelectBtn?.classList.toggle('active', mode === 'select');
  modeFloodFillBtn?.classList.toggle('active', mode === 'floodFill');
  modeColorSwapBtn?.classList.toggle('active', mode === 'colorSwap');
  modeBrushBtn.classList.toggle('active', mode === 'brush');
  modeOpenPathBtn?.classList.toggle('active', mode === 'openPathDel');
  modePanBtn.classList.toggle('active', mode === 'pan');
  stageViewportEl?.classList.toggle('select-mode', mode === 'select');
  stageViewportEl?.classList.toggle('pan-enabled', mode === 'pan');
  updateDespeckleOptionsVisibility();
  updateToolCursorState();
}

function applyZoom() {
  svgStage.style.transform = `scale(${zoom})`;
  zoomResetBtn.textContent = `${Math.round(zoom * 100)}%`;
  resizeCanvasToImage();
  clampCanvasScroll();
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

function getCropRatioValue(ratioSetting, viewport = getSvgViewportBounds(loadedSvg)) {
  if (ratioSetting === 'custom') return null;
  if (ratioSetting === 'current') {
    if (!(viewport?.width > 0 && viewport?.height > 0)) return null;
    return viewport.width / viewport.height;
  }
  return parseAspectRatio(ratioSetting);
}

function buildCenteredRect(width, height, center, viewport) {
  if (!(viewport?.width > 0 && viewport?.height > 0)) return null;
  const nextWidth = clampNumber(width, 1, viewport.width);
  const nextHeight = clampNumber(height, 1, viewport.height);
  const centerX = Number.isFinite(center?.x) ? center.x : viewport.x + viewport.width / 2;
  const centerY = Number.isFinite(center?.y) ? center.y : viewport.y + viewport.height / 2;
  return {
    x: clampNumber(centerX - nextWidth / 2, viewport.x, viewport.x + viewport.width - nextWidth),
    y: clampNumber(centerY - nextHeight / 2, viewport.y, viewport.y + viewport.height - nextHeight),
    width: nextWidth,
    height: nextHeight
  };
}

function computeCropRectFromUi() {
  if (!loadedSvg) return null;
  const ratioSetting = cropRatioEl?.value || 'current';
  const viewport = getSvgViewportBounds(loadedSvg);
  if (!viewport) return null;
  const bounds = getContentBounds() || viewport;
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2
  };
  const ratio = getCropRatioValue(ratioSetting, viewport);

  let rect = null;
  if (ratio && Number.isFinite(ratio) && ratio > 0) {
    let width = viewport.width;
    let height = width / ratio;
    if (height > viewport.height) {
      height = viewport.height;
      width = height * ratio;
    }
    rect = buildCenteredRect(width, height, center, viewport);
  } else {
    rect = buildCenteredRect(bounds.width, bounds.height, center, viewport);
  }
  if (!rect) return null;
  return {
    ...rect,
    ratioLabel: ratioSetting === 'current' ? 'Current Aspect Ratio' : ratioSetting === 'custom' ? 'Custom' : ratioSetting,
    ratioLocked: Boolean(ratio && Number.isFinite(ratio) && ratio > 0),
    ratio
  };
}

function projectCropRectToCanvas(cropRect) {
  if (!loadedSvg || !cropRect) return null;
  const viewport = getSvgViewportBounds(loadedSvg);
  if (!viewport || !(viewport.width > 0 && viewport.height > 0)) return null;
  const svgRect = loadedSvg.getBoundingClientRect();
  if (!(svgRect.width > 0 && svgRect.height > 0)) return null;

  const par = parsePreserveAspectRatioValue(loadedSvg.getAttribute('preserveAspectRatio') || '');
  const p1 = mapSvgPointToScreen({ x: cropRect.x, y: cropRect.y }, viewport, svgRect, par);
  const p2 = mapSvgPointToScreen(
    { x: cropRect.x + cropRect.width, y: cropRect.y + cropRect.height },
    viewport,
    svgRect,
    par
  );
  if (!p1 || !p2) return null;

  const screenLeft = Math.min(p1.x, p2.x);
  const screenTop = Math.min(p1.y, p2.y);
  const screenWidth = Math.max(1, Math.abs(p2.x - p1.x));
  const screenHeight = Math.max(1, Math.abs(p2.y - p1.y));
  const wrapRect = canvasWrap.getBoundingClientRect();
  return {
    left: screenLeft - wrapRect.left,
    top: screenTop - wrapRect.top,
    width: screenWidth,
    height: screenHeight
  };
}

function projectSvgPointToCanvas(point) {
  if (!loadedSvg || !point) return null;
  const viewport = getSvgViewportBounds(loadedSvg);
  if (!viewport || !(viewport.width > 0 && viewport.height > 0)) return null;
  const svgRect = loadedSvg.getBoundingClientRect();
  if (!(svgRect.width > 0 && svgRect.height > 0)) return null;
  const par = parsePreserveAspectRatioValue(loadedSvg.getAttribute('preserveAspectRatio') || '');
  const mapped = mapSvgPointToScreen(point, viewport, svgRect, par);
  if (!mapped) return null;
  const wrapRect = canvasWrap.getBoundingClientRect();
  return {
    left: mapped.x - wrapRect.left,
    top: mapped.y - wrapRect.top
  };
}

function renderArtboardTransformOverlay(projectedRect) {
  if (!artboardTransformEl || !projectedRect) return;
  artboardTransformEl.style.left = `${projectedRect.left}px`;
  artboardTransformEl.style.top = `${projectedRect.top}px`;
  artboardTransformEl.style.width = `${projectedRect.width}px`;
  artboardTransformEl.style.height = `${projectedRect.height}px`;
  artboardTransformEl.classList.add('active');
}

function renderCropPreview() {
  if (!cropPreviewEl) return;
  if (!loadedSvg) {
    cropPreviewEl.classList.remove('active');
    hideArtboardTransformOverlay();
    rotationPivotEl?.classList.remove('active');
    return;
  }

  const cropRect = getEffectiveCropRect();
  if (!cropRect) {
    cropPreviewEl.classList.remove('active');
    hideArtboardTransformOverlay();
    rotationPivotEl?.classList.remove('active');
    return;
  }

  const projected = projectCropRectToCanvas(cropRect);
  if (!projected) {
    cropPreviewEl.classList.remove('active');
    hideArtboardTransformOverlay();
    rotationPivotEl?.classList.remove('active');
    return;
  }

  if (artboardTransformMode) {
    cropPreviewEl.classList.remove('active');
    renderArtboardTransformOverlay(projected);
    return;
  }
  hideArtboardTransformOverlay();

  if ((cropRatioEl?.value || 'current') === 'current') {
    cropPreviewEl.classList.remove('active');
    return;
  }

  cropPreviewEl.style.left = `${projected.left}px`;
  cropPreviewEl.style.top = `${projected.top}px`;
  cropPreviewEl.style.width = `${projected.width}px`;
  cropPreviewEl.style.height = `${projected.height}px`;
  cropPreviewEl.classList.add('active');
  if (rotationUiState) renderRotationPivotMarker();
}

function applyCrop() {
  if (!loadedSvg) {
    setStatus('Crop skipped: load an SVG first.');
    return;
  }
  const cropRect = getEffectiveCropRect();
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
  resizeCanvasToImage();
  setArtboardTransformMode(false, { rerender: false });
  resetCropUiControls({ persist: false, rerender: false });
  cropPreviewEl?.classList.remove('active');
  const ratioLabel = cropRect.ratioLabel || 'Custom';
  setStatus(`Crop applied (${ratioLabel}).`);
  saveUiSettings();
}

function beginArtboardTransformDrag(event) {
  if (!artboardTransformMode || !loadedSvg || !customCropRect) return;
  if (mode !== 'select') return;
  if (event.button !== 0) return;

  const handleEl = event.target instanceof Element ? event.target.closest('.artboard-handle') : null;
  const handle = handleEl?.getAttribute('data-handle') || null;
  const pointer = screenToSvg(event.clientX, event.clientY);
  const startRect = { ...customCropRect };
  artboardTransformDrag = {
    action: handle ? 'resize' : 'move',
    handle,
    startPointer: pointer,
    startRect
  };

  isDrawing = false;
  isPanning = false;
  event.preventDefault();
  event.stopPropagation();
}

function updateArtboardTransformDrag(event) {
  if (!artboardTransformDrag || !loadedSvg || !customCropRect) return;
  const pointer = screenToSvg(event.clientX, event.clientY);
  const dx = pointer.x - artboardTransformDrag.startPointer.x;
  const dy = pointer.y - artboardTransformDrag.startPointer.y;
  const viewport = getSvgViewportBounds(loadedSvg);
  const minSize = 1;
  const ratioSetting = cropRatioEl?.value || 'current';
  const lockedRatio = getCropRatioValue(ratioSetting, viewport);
  const ratioLocked = Number.isFinite(lockedRatio) && lockedRatio > 0;
  let nextRect = { ...artboardTransformDrag.startRect };

  if (artboardTransformDrag.action === 'move') {
    let x = artboardTransformDrag.startRect.x + dx;
    let y = artboardTransformDrag.startRect.y + dy;
    if (viewport) {
      const maxX = viewport.x + viewport.width - artboardTransformDrag.startRect.width;
      const maxY = viewport.y + viewport.height - artboardTransformDrag.startRect.height;
      x = maxX >= viewport.x ? clampNumber(x, viewport.x, maxX) : viewport.x;
      y = maxY >= viewport.y ? clampNumber(y, viewport.y, maxY) : viewport.y;
    }
    nextRect = {
      x,
      y,
      width: artboardTransformDrag.startRect.width,
      height: artboardTransformDrag.startRect.height
    };
  } else {
    const start = artboardTransformDrag.startRect;
    const handle = artboardTransformDrag.handle || '';
    const centerX = start.x + start.width / 2;
    const centerY = start.y + start.height / 2;

    if (ratioLocked) {
      const hasW = handle.includes('w');
      const hasE = handle.includes('e');
      const hasN = handle.includes('n');
      const hasS = handle.includes('s');
      const horizontalOnly = (hasW || hasE) && !hasN && !hasS;
      const verticalOnly = (hasN || hasS) && !hasW && !hasE;

      const widthFromDx = hasE ? start.width + dx : hasW ? start.width - dx : start.width;
      const heightFromDy = hasS ? start.height + dy : hasN ? start.height - dy : start.height;
      let width = start.width;
      let height = start.height;

      if (horizontalOnly) {
        width = Math.max(minSize, widthFromDx);
        height = width / lockedRatio;
      } else if (verticalOnly) {
        height = Math.max(minSize, heightFromDy);
        width = height * lockedRatio;
      } else {
        const scaleX = widthFromDx / Math.max(minSize, start.width);
        const scaleY = heightFromDy / Math.max(minSize, start.height);
        let scale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
        if (!Number.isFinite(scale) || scale <= 0) scale = minSize / Math.max(minSize, start.width);
        width = Math.max(minSize, start.width * scale);
        height = width / lockedRatio;
      }

      if (viewport) {
        const fitScale = Math.min(1, viewport.width / width, viewport.height / height);
        width *= fitScale;
        height *= fitScale;
      }

      let x = start.x;
      let y = start.y;
      if (hasW) x = start.x + start.width - width;
      else if (!(hasE || hasW)) x = centerX - width / 2;
      if (hasN) y = start.y + start.height - height;
      else if (!(hasN || hasS)) y = centerY - height / 2;

      if (viewport) {
        x = clampNumber(x, viewport.x, viewport.x + viewport.width - width);
        y = clampNumber(y, viewport.y, viewport.y + viewport.height - height);
      }

      nextRect = { x, y, width, height };
    } else {
      let left = start.x;
      let top = start.y;
      let right = start.x + start.width;
      let bottom = start.y + start.height;

      if (handle.includes('w')) left += dx;
      if (handle.includes('e')) right += dx;
      if (handle.includes('n')) top += dy;
      if (handle.includes('s')) bottom += dy;

      if (viewport) {
        left = clampNumber(left, viewport.x, viewport.x + viewport.width);
        right = clampNumber(right, viewport.x, viewport.x + viewport.width);
        top = clampNumber(top, viewport.y, viewport.y + viewport.height);
        bottom = clampNumber(bottom, viewport.y, viewport.y + viewport.height);
      }

      if (right - left < minSize) {
        if (handle.includes('w')) left = right - minSize;
        else right = left + minSize;
      }
      if (bottom - top < minSize) {
        if (handle.includes('n')) top = bottom - minSize;
        else bottom = top + minSize;
      }

      if (viewport) {
        left = clampNumber(left, viewport.x, viewport.x + viewport.width - minSize);
        top = clampNumber(top, viewport.y, viewport.y + viewport.height - minSize);
        right = clampNumber(right, left + minSize, viewport.x + viewport.width);
        bottom = clampNumber(bottom, top + minSize, viewport.y + viewport.height);
      }

      nextRect = {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top
      };
    }
  }

  customCropRect = nextRect;
  renderCropPreview();
}

function endArtboardTransformDrag() {
  artboardTransformDrag = null;
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

function itemContainsSvgPoint(item, point) {
  if (!item || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  if (item.el instanceof SVGGeometryElement) {
    return elementContainsSvgPoint(item.el, point);
  }
  const box = item.box;
  return (
    Number.isFinite(box?.x)
    && Number.isFinite(box?.y)
    && Number.isFinite(box?.width)
    && Number.isFinite(box?.height)
    && point.x >= box.x
    && point.x <= box.x + box.width
    && point.y >= box.y
    && point.y <= box.y + box.height
  );
}

function buildPointProbeSamples(point, step = 0.9) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return [];
  const n = Number.isFinite(step) ? Math.max(0, step) : 0.9;
  return [
    { x: point.x, y: point.y },
    { x: point.x + n, y: point.y },
    { x: point.x - n, y: point.y },
    { x: point.x, y: point.y + n },
    { x: point.x, y: point.y - n },
    { x: point.x + n, y: point.y + n },
    { x: point.x + n, y: point.y - n },
    { x: point.x - n, y: point.y + n },
    { x: point.x - n, y: point.y - n }
  ];
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
  if (!globalThis.paper || typeof globalThis.paper.PaperScope !== 'function') {
    return { hostsUpdated: 0, subpathsRemoved: 0, paperUnavailable: true };
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

    const scope = new globalThis.paper.PaperScope();
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

function getShapesAtClientPoint(clientX, clientY) {
  const stack = typeof document.elementsFromPoint === 'function'
    ? document.elementsFromPoint(clientX, clientY)
    : [document.elementFromPoint(clientX, clientY)];
  if (!Array.isArray(stack)) return [];
  const seen = new Set();
  const shapes = [];
  stack.forEach((hit) => {
    if (!(hit instanceof Element)) return;
    const shape = hit.closest(shapeSelector);
    if (!(shape instanceof Element)) return;
    if (!loadedSvg?.contains(shape)) return;
    if (shape.getAttribute(BACKGROUND_LAYER_ATTR) === '1') return;
    if (seen.has(shape)) return;
    seen.add(shape);
    shapes.push(shape);
  });
  return shapes;
}

function getShapeAtClientPoint(clientX, clientY) {
  const shapes = getShapesAtClientPoint(clientX, clientY);
  return shapes[0] || null;
}

function getFilledShapeAtClientPoint(clientX, clientY) {
  const shapes = getShapesAtClientPoint(clientX, clientY);
  return shapes.find((shape) => Boolean(toHexColor(getFill(shape)))) || null;
}

function getMovablePathAtClientPoint(clientX, clientY) {
  const hit = document.elementFromPoint(clientX, clientY);
  if (!(hit instanceof Element)) return null;
  const pathEl = hit.closest('path');
  if (!(pathEl instanceof SVGPathElement)) return null;
  if (!loadedSvg?.contains(pathEl)) return null;
  if (pathEl.getAttribute(BACKGROUND_LAYER_ATTR) === '1') return null;
  return pathEl;
}

function pruneSelectedPaths() {
  if (!loadedSvg || selectedPaths.size === 0) return;
  const next = new Set();
  selectedPaths.forEach((el) => {
    if (el instanceof SVGPathElement && loadedSvg.contains(el)) next.add(el);
    else if (el instanceof Element) el.classList.remove('selected-path');
  });
  selectedPaths = next;
}

function clearSelectedPaths() {
  selectedPaths.forEach((el) => el.classList.remove('selected-path'));
  selectedPaths.clear();
  if (rotationUiState) closeRotationPopup({ apply: false });
}

function addSelectedPath(pathEl) {
  if (!(pathEl instanceof SVGPathElement)) return;
  selectedPaths.add(pathEl);
  pathEl.classList.add('selected-path');
}

function removeSelectedPath(pathEl) {
  if (!(pathEl instanceof SVGPathElement)) return;
  selectedPaths.delete(pathEl);
  pathEl.classList.remove('selected-path');
}

function setSelectedPaths(paths) {
  clearSelectedPaths();
  (paths || []).forEach((pathEl) => addSelectedPath(pathEl));
}

function getSelectablePaths() {
  if (!loadedSvg) return [];
  return [...loadedSvg.querySelectorAll('path')].filter((el) => el.getAttribute(BACKGROUND_LAYER_ATTR) !== '1');
}

function showSelectionMarquee(clientX, clientY) {
  if (!selectionMarqueeEl) return;
  const canvasRect = canvasWrap.getBoundingClientRect();
  const left = Math.min(clientX, marqueeState.startClientX) - canvasRect.left;
  const top = Math.min(clientY, marqueeState.startClientY) - canvasRect.top;
  const width = Math.abs(clientX - marqueeState.startClientX);
  const height = Math.abs(clientY - marqueeState.startClientY);
  selectionMarqueeEl.style.left = `${left}px`;
  selectionMarqueeEl.style.top = `${top}px`;
  selectionMarqueeEl.style.width = `${Math.max(1, width)}px`;
  selectionMarqueeEl.style.height = `${Math.max(1, height)}px`;
  selectionMarqueeEl.classList.add('active');
}

function startMarqueeSelection(clientX, clientY, additive = false) {
  marqueeState = {
    startClientX: clientX,
    startClientY: clientY,
    currentClientX: clientX,
    currentClientY: clientY,
    additive
  };
  showSelectionMarquee(clientX, clientY);
}

function updateMarqueeSelection(clientX, clientY) {
  if (!marqueeState) return;
  marqueeState.currentClientX = clientX;
  marqueeState.currentClientY = clientY;
  showSelectionMarquee(clientX, clientY);
}

function finalizeMarqueeSelection() {
  if (!marqueeState) return;
  const left = Math.min(marqueeState.startClientX, marqueeState.currentClientX);
  const right = Math.max(marqueeState.startClientX, marqueeState.currentClientX);
  const top = Math.min(marqueeState.startClientY, marqueeState.currentClientY);
  const bottom = Math.max(marqueeState.startClientY, marqueeState.currentClientY);
  const add = marqueeState.additive;
  if (!add) clearSelectedPaths();

  getSelectablePaths().forEach((pathEl) => {
    const rect = pathEl.getBoundingClientRect();
    const overlaps = rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom;
    if (overlaps) addSelectedPath(pathEl);
  });

  selectionMarqueeEl?.classList.remove('active');
  marqueeState = null;
}

function startPathDrag(clientX, clientY) {
  if (selectedPaths.size === 0) return;
  const startPointer = screenToSvg(clientX, clientY);
  const items = [...selectedPaths].map((pathEl) => ({
    el: pathEl,
    baseTransform: (pathEl.getAttribute('transform') || '').trim()
  }));
  pathDragState = {
    startPointer,
    items,
    historyPushed: false
  };
}

function updatePathDrag(clientX, clientY) {
  if (!pathDragState) return;
  const pointer = screenToSvg(clientX, clientY);
  const dx = pointer.x - pathDragState.startPointer.x;
  const dy = pointer.y - pathDragState.startPointer.y;
  if (!pathDragState.historyPushed && (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001)) {
    pushHistory(snapshot());
    pathDragState.historyPushed = true;
  }
  const translate = `translate(${formatSvgNumber(dx)} ${formatSvgNumber(dy)})`;
  pathDragState.items.forEach((item) => {
    const nextTransform = item.baseTransform ? `${translate} ${item.baseTransform}` : translate;
    item.el.setAttribute('transform', nextTransform);
  });
  renderCropPreview();
}

function endPathDrag() {
  pathDragState = null;
}

function nudgeSelectedPaths(dx, dy) {
  pruneSelectedPaths();
  if (selectedPaths.size === 0) return;
  pushHistory(snapshot());
  selectedPaths.forEach((pathEl) => {
    const base = (pathEl.getAttribute('transform') || '').trim();
    const translate = `translate(${formatSvgNumber(dx)} ${formatSvgNumber(dy)})`;
    pathEl.setAttribute('transform', base ? `${translate} ${base}` : translate);
  });
  renderCropPreview();
}

function deleteSelectedPaths() {
  pruneSelectedPaths();
  if (selectedPaths.size === 0) return;
  pushHistory(snapshot());
  const count = selectedPaths.size;
  selectedPaths.forEach((pathEl) => pathEl.remove());
  clearSelectedPaths();
  buildPalette();
  setStatus(`Deleted ${count} selected path(s).`);
}

function getSelectedPathsBounds() {
  pruneSelectedPaths();
  if (selectedPaths.size === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  selectedPaths.forEach((pathEl) => {
    const box = getElementTransformedBox(pathEl);
    if (!box) return;
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  });
  if (!(Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY))) return null;
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

function setRotationPopupVisible(visible) {
  if (!rotationPopupEl) return;
  rotationPopupEl.classList.toggle('active', Boolean(visible));
  rotationPopupEl.setAttribute('aria-hidden', visible ? 'false' : 'true');
  if (!visible) rotationPivotEl?.classList.remove('active');
}

function renderRotationPivotMarker() {
  if (!rotationPivotEl || !rotationUiState) return;
  const projected = projectSvgPointToCanvas({ x: rotationUiState.cx, y: rotationUiState.cy });
  if (!projected) {
    rotationPivotEl.classList.remove('active');
    return;
  }
  rotationPivotEl.style.left = `${projected.left}px`;
  rotationPivotEl.style.top = `${projected.top}px`;
  rotationPivotEl.classList.add('active');
}

function setRotationPivot(pointX, pointY) {
  if (!rotationUiState) return;
  const x = Number(pointX);
  const y = Number(pointY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (Math.abs(rotationUiState.angle) > 0.0001) {
    // Keep geometry fixed while changing pivot by baking current preview into base.
    commitRotationPreviewToBase();
  }
  rotationUiState.cx = x;
  rotationUiState.cy = y;
  renderRotationPivotMarker();
  renderCropPreview();
}

function applyRotationPreview(angle) {
  if (!rotationUiState) return;
  const n = Number(angle);
  const nextAngle = Number.isFinite(n) ? n : 0;
  rotationUiState.angle = nextAngle;
  const rotatePart = `rotate(${formatSvgNumber(nextAngle)} ${formatSvgNumber(rotationUiState.cx)} ${formatSvgNumber(rotationUiState.cy)})`;
  rotationUiState.items.forEach((item) => {
    if (!(item.el instanceof SVGPathElement) || !item.el.isConnected) return;
    if (Math.abs(nextAngle) < 0.0001) {
      item.el.setAttribute('transform', item.baseTransform || '');
      return;
    }
    item.el.setAttribute('transform', item.baseTransform ? `${item.baseTransform} ${rotatePart}` : rotatePart);
  });
  if (rotationValueEl) rotationValueEl.textContent = `${Math.round(nextAngle)}\u00B0`;
  renderRotationPivotMarker();
  renderCropPreview();
}

function getConsolidatedTransformString(el) {
  if (!(el instanceof SVGPathElement) || !el.isConnected) return '';
  const transformBase = el.transform?.baseVal;
  if (!transformBase || transformBase.numberOfItems === 0) return '';
  const consolidated = transformBase.consolidate();
  const m = consolidated?.matrix;
  if (!m) return '';
  const isIdentity = (
    Math.abs(m.a - 1) < 1e-6
    && Math.abs(m.b) < 1e-6
    && Math.abs(m.c) < 1e-6
    && Math.abs(m.d - 1) < 1e-6
    && Math.abs(m.e) < 1e-6
    && Math.abs(m.f) < 1e-6
  );
  if (isIdentity) return '';
  return `matrix(${formatSvgNumber(m.a)} ${formatSvgNumber(m.b)} ${formatSvgNumber(m.c)} ${formatSvgNumber(m.d)} ${formatSvgNumber(m.e)} ${formatSvgNumber(m.f)})`;
}

function commitRotationPreviewToBase() {
  if (!rotationUiState) return;
  let changed = false;
  rotationUiState.items.forEach((item) => {
    if (!(item.el instanceof SVGPathElement) || !item.el.isConnected) return;
    const consolidated = getConsolidatedTransformString(item.el);
    const next = (consolidated || '').trim();
    const previous = (item.baseTransform || '').trim();
    if (next !== previous) changed = true;
    item.baseTransform = next;
    if (next) item.el.setAttribute('transform', next);
    else item.el.removeAttribute('transform');
  });
  if (changed) rotationUiState.hasCommittedPreview = true;
  rotationUiState.angle = 0;
  if (rotationSliderEl) rotationSliderEl.value = '0';
  if (rotationValueEl) rotationValueEl.textContent = `0\u00B0`;
}

function normalizePathTransforms(paths) {
  let normalized = 0;
  (paths || []).forEach((item) => {
    const pathEl = item?.el || item;
    if (!(pathEl instanceof SVGPathElement) || !pathEl.isConnected) return;
    const transformBase = pathEl.transform?.baseVal;
    if (!transformBase || transformBase.numberOfItems === 0) {
      pathEl.removeAttribute('transform');
      return;
    }
    const consolidated = transformBase.consolidate();
    if (!consolidated) {
      pathEl.removeAttribute('transform');
      return;
    }
    const m = consolidated.matrix;
    if (!m) {
      pathEl.removeAttribute('transform');
      return;
    }
    const isIdentity = (
      Math.abs(m.a - 1) < 1e-6
      && Math.abs(m.b) < 1e-6
      && Math.abs(m.c) < 1e-6
      && Math.abs(m.d - 1) < 1e-6
      && Math.abs(m.e) < 1e-6
      && Math.abs(m.f) < 1e-6
    );
    if (isIdentity) {
      pathEl.removeAttribute('transform');
      return;
    }
    pathEl.setAttribute(
      'transform',
      `matrix(${formatSvgNumber(m.a)} ${formatSvgNumber(m.b)} ${formatSvgNumber(m.c)} ${formatSvgNumber(m.d)} ${formatSvgNumber(m.e)} ${formatSvgNumber(m.f)})`
    );
    normalized += 1;
  });
  return normalized;
}

function closeRotationPopup({ apply = false } = {}) {
  if (!rotationUiState) {
    setRotationPopupVisible(false);
    return;
  }
  const state = rotationUiState;
  if (apply) {
    if (Math.abs(state.angle) > 0.0001 || state.hasCommittedPreview) {
      const normalized = normalizePathTransforms(state.items);
      pushHistory(state.beforeMarkup);
      if (Math.abs(state.angle) > 0.0001) {
        setStatus(`Rotated ${state.items.length} selected path(s) by ${Math.round(state.angle)} degrees (normalized ${normalized}).`);
      } else {
        setStatus(`Rotation applied to ${state.items.length} selected path(s) (normalized ${normalized}).`);
      }
    } else {
      state.items.forEach((item) => {
        if (!(item.el instanceof SVGPathElement) || !item.el.isConnected) return;
        item.el.setAttribute('transform', item.baseTransform || '');
      });
      setStatus('Rotate canceled: no angle change.');
    }
  } else {
    state.items.forEach((item) => {
      if (!(item.el instanceof SVGPathElement) || !item.el.isConnected) return;
      if (item.originalTransform) item.el.setAttribute('transform', item.originalTransform);
      else item.el.removeAttribute('transform');
    });
  }
  rotationUiState = null;
  if (rotationSliderEl) rotationSliderEl.value = '0';
  if (rotationValueEl) rotationValueEl.textContent = `0\u00B0`;
  setRotationPopupVisible(false);
  renderCropPreview();
}

function openRotationPopupForSelection(pivotPathEl = null) {
  pruneSelectedPaths();
  if (selectedPaths.size === 0) return;
  const bounds = getSelectedPathsBounds();
  if (!bounds || !(bounds.width > 0 || bounds.height > 0)) return;
  const pivotFromPath = pivotPathEl ? getElementCenterInSvg(pivotPathEl) : null;
  const items = [...selectedPaths].map((el) => ({
    el,
    originalTransform: (el.getAttribute('transform') || '').trim(),
    baseTransform: (el.getAttribute('transform') || '').trim()
  }));
  rotationUiState = {
    items,
    cx: Number.isFinite(pivotFromPath?.x) ? pivotFromPath.x : bounds.x + bounds.width / 2,
    cy: Number.isFinite(pivotFromPath?.y) ? pivotFromPath.y : bounds.y + bounds.height / 2,
    angle: 0,
    hasCommittedPreview: false,
    beforeMarkup: snapshot()
  };
  if (rotationSliderEl) rotationSliderEl.value = '0';
  if (rotationValueEl) rotationValueEl.textContent = `0\u00B0`;
  applyRotationPreview(0);
  setRotationPopupVisible(true);
  setStatus('Rotation mode: move slider for live preview, click canvas to set pivot, then Apply.');
}

function onSelectDoubleClick(event) {
  if (!loadedSvg || mode !== 'select') return;
  const hitPath = getMovablePathAtClientPoint(event.clientX, event.clientY);
  if (!hitPath) return;
  event.preventDefault();
  event.stopPropagation();
  if (!selectedPaths.has(hitPath)) setSelectedPaths([hitPath]);
  openRotationPopupForSelection(hitPath);
}

async function mergeTargetColorAfterEdit(targetColor, seedElements = []) {
  if (!loadedSvg || !targetColor || isMerging) return { merged: 0, cleanup: { removed: 0 } };
  isMerging = true;
  let merged = 0;
  let cleanup = { removed: 0 };
  try {
    await waitForUiFrame();
    merged = await mergeSameColorShapes([targetColor], null, seedElements);
  } catch {
    // Keep edits even if merge fails.
  } finally {
    cleanup = cleanupAllOpenPathsAndStrokes();
    isMerging = false;
  }
  return { merged, cleanup };
}

function applyFloodDelete(clientX, clientY) {
  if (!loadedSvg) return;
  const activeColor = toHexColor(selectedTargetColor || replaceColorEl.value);
  if (!activeColor) {
    setStatus('Flood Delete skipped: choose a working color first.');
    return;
  }
  const hitShape = getFilledShapeAtClientPoint(clientX, clientY);
  if (!hitShape) {
    setStatus('Flood Delete: click a filled shape.');
    return;
  }
  const sourceColor = toHexColor(getFill(hitShape));
  if (!sourceColor) {
    setStatus('Flood Delete: selected shape has no fill color.');
    return;
  }
  if (sourceColor !== activeColor) {
    setStatus(`Flood Delete: clicked shape color ${sourceColor} does not match working color ${activeColor}.`);
    return;
  }
  pushHistory(snapshot());
  hitShape.remove();
  buildPalette();
  setStatus(`Flood Delete removed clicked shape with working color ${activeColor}.`);
}

async function applyFloodFill(clientX, clientY) {
  if (!loadedSvg) return;
  const activeColor = toHexColor(selectedTargetColor || replaceColorEl.value);
  if (!activeColor) {
    setStatus('Flood Fill skipped: choose a working color first.');
    return;
  }

  const hitShape = getFilledShapeAtClientPoint(clientX, clientY);
  if (!hitShape) {
    setStatus('Flood Fill: click a filled shape.');
    return;
  }

  const sourceColor = toHexColor(getFill(hitShape));
  if (!sourceColor) {
    setStatus('Flood Fill: selected shape has no fill color.');
    return;
  }

  if (sourceColor !== activeColor) {
    pushHistory(snapshot());
    setElementFill(hitShape, activeColor);
    setStatus(`Flood Fill updated clicked shape from ${sourceColor} to ${activeColor}. Merging...`);
    const mergeResult = await mergeTargetColorAfterEdit(activeColor, [hitShape]);
    buildPalette();
    setStatus(
      `Flood Fill updated clicked shape from ${sourceColor} to ${activeColor}; merged ${mergeResult.merged} overlap(s), cleaned ${mergeResult.cleanup.removed} open/stroke artifact(s).`
    );
  } else {
    setStatus(`Flood Fill: clicked shape already matches ${activeColor}.`);
  }
}

async function applyColorSwapAll(clientX, clientY) {
  if (!loadedSvg || isMerging) return;
  const activeColor = toHexColor(selectedTargetColor || replaceColorEl.value);
  if (!activeColor) {
    setStatus('Recolor skipped: choose a working color first.');
    return;
  }

  const hitShape = getFilledShapeAtClientPoint(clientX, clientY);
  if (!hitShape) {
    setStatus('Recolor skipped: click a filled shape.');
    return;
  }

  const sourceColor = toHexColor(getFill(hitShape));
  if (!sourceColor) {
    setStatus('Recolor skipped: selected shape has no fill color.');
    return;
  }
  if (sourceColor === activeColor) {
    setStatus(`Recolor skipped: clicked color already matches ${activeColor}.`);
    return;
  }

  pushHistory(snapshot());
  const recolorResult = recolorFilledShapes(sourceColor, activeColor, { collectElements: true });
  const recolored = recolorResult.count;
  const recoloredElements = recolorResult.elements;
  setStatus(`Recolored ${recolored} matching path(s). Merging with working color ${activeColor}...`);
  const mergeResult = await mergeTargetColorAfterEdit(activeColor, recoloredElements);
  buildPalette();
  setStatus(
    `Recolored ${recolored} matching path(s) from ${sourceColor} to ${activeColor}; merged ${mergeResult.merged} overlap(s), cleaned ${mergeResult.cleanup.removed} open/stroke artifact(s).`
  );
}

function applyBrush(clientX, clientY) {
  if (!loadedSvg) return;
  if (mode === 'openPathDel') {
    applyOpenPathDeleteBrush(clientX, clientY);
    return;
  }

  const maxArea = Number(speckleAreaEl.value);
  if (!Number.isFinite(maxArea) || maxArea <= 0) return;
  const activeColor = toHexColor(selectedTargetColor || replaceColorEl.value);
  if (!activeColor) return;

  const hitStack = getShapesAtClientPoint(clientX, clientY);
  const targetEl = hitStack[0] || null;
  if (!targetEl) return;

  const items = getShapeItems();
  const pointer = screenToSvg(clientX, clientY);
  const targetItem = items.find((item) => item.el === targetEl) || null;
  let hostItem = null;
  for (const hitShape of hitStack) {
    hostItem = items.find((item) => item.el === hitShape && item.fillHex === activeColor) || null;
    if (hostItem) break;
  }
  if (!hostItem) {
    const probes = buildPointProbeSamples(pointer, 0.9);
    const candidates = items
      .filter((item) => item.fillHex === activeColor && probes.some((probe) => itemContainsSvgPoint(item, probe)))
      .sort((a, b) => a.area - b.area);
    hostItem = candidates[0] || null;
  }
  if (!hostItem) {
    setStatus(`Despeckle: click within working color ${activeColor}.`);
    return;
  }

  const touchedInside = [];
  let insideCandidateCount = 0;
  items.forEach((item) => {
    if (item.el === hostItem.el) return;
    const inside = itemInsideHost(hostItem, item);
    if (!inside) return;
    insideCandidateCount += 1;
    if (item.area > maxArea) return;
    touchedInside.push(item);
  });

  const toDelete = new Set(touchedInside.map((item) => item.el));
  // If user clicks a tiny interior artifact directly, remove it even if strict
  // containment heuristics are borderline around anti-aliased edges.
  if (
    targetItem
    && targetItem.el !== hostItem.el
    && targetItem.area <= maxArea
    && !toDelete.has(targetItem.el)
  ) {
    const center = getElementCenterInSvg(targetItem.el);
    const targetInsideHost = itemInsideHost(hostItem, targetItem)
      || (center ? itemContainsSvgPoint(hostItem, center) : false)
      || itemContainsSvgPoint(hostItem, pointer);
    if (targetInsideHost) toDelete.add(targetItem.el);
  }
  toDelete.forEach((el) => {
    el.remove();
  });

  const subpathCleanup = stripTinyInteriorSubpathsFromTouchedHosts([hostItem], maxArea);
  if (toDelete.size > 0 || subpathCleanup.subpathsRemoved > 0) {
    buildPalette();
    setStatus(
      `Removed ${toDelete.size} interior path(s) and stripped ${subpathCleanup.subpathsRemoved} tiny interior subpath(s) in ${subpathCleanup.hostsUpdated} host path(s).`
    );
    return;
  }
  if (subpathCleanup.paperUnavailable) {
    setStatus('Despeckle fallback active: subpath cleanup unavailable (Paper.js not loaded).');
    return;
  }
  if (insideCandidateCount > 0) {
    setStatus(`No interior paths removed at max size ${Math.round(maxArea)}. Increase Path max size to remove.`);
    return;
  }
  setStatus(`Despeckle found no interior artifacts in the selected ${activeColor} region.`);
}

function applyOpenPathDeleteBrush(clientX, clientY) {
  if (!loadedSvg) return;
  const targetEl = getShapeAtClientPoint(clientX, clientY);
  if (!targetEl) return;
  const item = getShapeItems({ includeZeroArea: true }).find((entry) => entry.el === targetEl);
  if (!item) return;

  let removed = 0;
  let strippedSubpaths = 0;
  let strippedStroke = 0;
  const el = item.el;
  const tag = el.tagName.toLowerCase();
  const fillHex = toHexColor(getFill(el));
  const strokeHex = toHexColor(getStroke(el));
  const hasFill = Boolean(fillHex);
  const hasStroke = Boolean(strokeHex);

  if (tag === 'line' || tag === 'polyline') {
    el.remove();
    removed += 1;
  } else if (tag !== 'path') {
    if (hasStroke && !hasFill) {
      el.remove();
      removed += 1;
    } else if (hasStroke && hasFill) {
      removeElementStroke(el);
      strippedStroke += 1;
    }
  } else {
    const original = (el.getAttribute('d') || '').trim();
    if (!original) {
      el.remove();
      removed += 1;
    } else {
      if (pathHasOpenSubpath(original)) {
        const sanitized = sanitizePathData(original);
        if (!sanitized) {
          el.remove();
          removed += 1;
        } else if (sanitized !== original) {
          el.setAttribute('d', sanitized);
          strippedSubpaths += 1;
        }
      }

      const nowHasFill = Boolean(toHexColor(getFill(el)));
      const nowHasStroke = Boolean(toHexColor(getStroke(el)));
      if (nowHasStroke && !nowHasFill) {
        el.remove();
        removed += 1;
      } else if (nowHasStroke && nowHasFill) {
        removeElementStroke(el);
        strippedStroke += 1;
      }
    }
  }

  if (removed > 0 || strippedSubpaths > 0 || strippedStroke > 0) {
    buildPalette();
    setStatus(
      `Delete Open Paths removed ${removed} open/stroke element(s), stripped open subpaths from ${strippedSubpaths} mixed path(s), and removed stroke from ${strippedStroke} filled path(s).`
    );
  }
}

async function mergeSameColorShapes(colors = null, onProgress = null, seedElements = null) {
  if (!loadedSvg) return 0;
  const palette = colors || [...new Set(getShapeItems().map((i) => i.fillHex).filter(Boolean))];
  const mergeSelector = 'path,rect,circle,ellipse,polygon';
  const totalColors = palette.length || 1;
  let mergedCount = 0;
  const seedSet = seedElements && seedElements.length > 0 ? new Set(seedElements.filter((el) => el instanceof Element)) : null;

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
      if (group.length > 1) {
        const els = group.map((entry) => entry.el);
        if (!seedSet || els.some((el) => seedSet.has(el))) activeGroups.push(els);
      }
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
    setStatus('Remove all open paths skipped: load an SVG first.');
    return;
  }
  pushHistory(snapshot());
  const cleanup = cleanupAllOpenPathsAndStrokes();
  buildPalette();
  setStatus(
    `Remove all open paths complete. Removed ${cleanup.removed} open/stroke element(s), rewrote ${cleanup.rewrittenOpenSubpaths} mixed path(s), stripped stroke from ${cleanup.strippedStroke} filled element(s).`
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

function recolorFilledShapes(fromColor, toColor, { collectElements = false } = {}) {
  if (!loadedSvg || !fromColor || !toColor) return collectElements ? { count: 0, elements: [] } : 0;
  let recolored = 0;
  const elements = [];
  getShapeItems().forEach((item) => {
    if (item.fillHex !== fromColor) return;
    setElementFill(item.el, toColor);
    recolored += 1;
    if (collectElements) elements.push(item.el);
  });
  if (collectElements) return { count: recolored, elements };
  return recolored;
}

function applyCmykToWorkingColor() {
  if (!loadedSvg) {
    setStatus('Color change skipped: load an SVG first.');
    return;
  }
  const sourceColor = toHexColor(selectedTargetColor || replaceColorEl?.value);
  if (!sourceColor) {
    setStatus('Color change skipped: pick a working color first.');
    return;
  }
  const modeLabel = getColorAdjustMode().toUpperCase();
  const nextColor = getColorAdjustResultHex();
  if (!nextColor) {
    setStatus(`Color change skipped: invalid ${modeLabel} values.`);
    return;
  }
  if (nextColor === sourceColor) {
    setStatus(`Color change skipped: working color already ${sourceColor}.`);
    return;
  }

  pushHistory(snapshot());
  let recolored = 0;
  [...loadedSvg.querySelectorAll('path')].forEach((pathEl) => {
    if (toHexColor(getFill(pathEl)) !== sourceColor) return;
    setElementFill(pathEl, nextColor);
    recolored += 1;
  });
  selectedTargetColor = nextColor;
  if (replaceColorEl) replaceColorEl.value = nextColor;
  buildPalette();
  setStatus(`Color change applied (${modeLabel}): recolored ${recolored} path(s) from ${sourceColor} to ${nextColor}.`);
  saveUiSettings();
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

  const baseColor = toHexColor(selectedTargetColor || replaceColorEl?.value);
  if (!baseColor) {
    setStatus('Delete skipped: pick a valid current color.');
    return;
  }

  const targets = [...loadedSvg.querySelectorAll(shapeSelector)].filter((el) => toHexColor(getFill(el)) === baseColor);
  if (targets.length === 0) {
    setStatus(`Delete skipped: no shapes found with current color ${baseColor}.`);
    return;
  }

  pushHistory(snapshot());
  targets.forEach((el) => el.remove());
  const cleanup = cleanupAllOpenPathsAndStrokes();
  buildPalette();
  setStatus(
    `Deleted ${targets.length} shape(s) with current color ${baseColor}. Removed ${cleanup.removed} open/stroke element(s).`
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
  setArtboardTransformMode(false, { rerender: false });
  clearSelectedPaths();
  updateEmptyCanvasState();
  svgStage.innerHTML = '';
  svgStage.appendChild(loadedSvg);
  undoBtn.disabled = history.length === 0;
  buildPalette();
  applyViewMode();
  applyZoom();
  updateToolCursorState();
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
  setArtboardTransformMode(false, { rerender: false });
  clearSelectedPaths();
  updateEmptyCanvasState();
  svgStage.innerHTML = '';
  svgStage.appendChild(loadedSvg);
  loadedFilename = filename.toLowerCase().endsWith('.svg') ? filename : `${filename}.svg`;
  history = [];
  undoBtn.disabled = true;
  downloadBtn.disabled = false;
  const background = normalizeBackgroundToViewportRect();
  if (!background.color) {
    const existingBackground = getBackgroundFillHex();
    lastKnownBackgroundColor = existingBackground || null;
  }
  setCanvasTransparencyMode(!background.color);
  resetCropUiControls({ persist: false, rerender: false });
  buildPalette();
  applyViewMode();
  applyZoom();
  updateToolCursorState();
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

function startPan(event) {
  isPanning = true;
  stageViewportEl?.classList.add('panning');
  updateToolCursorState();
  panStart = {
    x: event.clientX,
    y: event.clientY,
    scrollLeft: stageViewportEl?.scrollLeft || 0,
    scrollTop: stageViewportEl?.scrollTop || 0
  };
}

function onMouseDown(event) {
  if (!loadedSvg) return;
  if (event.button !== 0) return;
  if (mode === 'pan' || isSpaceHeld) {
    startPan(event);
    return;
  }

  if (rotationUiState && mode === 'select') {
    const pivot = screenToSvg(event.clientX, event.clientY);
    setRotationPivot(pivot.x, pivot.y);
    event.preventDefault();
    return;
  }

  if (mode === 'select') {
    if (!canvasWrap.contains(event.target)) {
      if (!event.shiftKey) clearSelectedPaths();
      return;
    }
    const hitPath = getMovablePathAtClientPoint(event.clientX, event.clientY);
    if (!hitPath) {
      startMarqueeSelection(event.clientX, event.clientY, event.shiftKey);
      return;
    }

    if (event.shiftKey) {
      if (selectedPaths.has(hitPath)) removeSelectedPath(hitPath);
      else addSelectedPath(hitPath);
      return;
    }

    if (!selectedPaths.has(hitPath)) setSelectedPaths([hitPath]);
    startPathDrag(event.clientX, event.clientY);
    return;
  }

  if (mode === 'floodFill') {
    if (!canvasWrap.contains(event.target)) return;
    void applyFloodFill(event.clientX, event.clientY);
    return;
  }

  if (mode === 'colorSwap') {
    if (!canvasWrap.contains(event.target)) return;
    void applyColorSwapAll(event.clientX, event.clientY);
    return;
  }

  if (!canvasWrap.contains(event.target)) return;
  isDrawing = true;
  pushHistory(snapshot());
  applyBrush(event.clientX, event.clientY);
}

stageViewportEl?.addEventListener('mousemove', (event) => {
  if (!loadedSvg) return;

  if (marqueeState) {
    updateMarqueeSelection(event.clientX, event.clientY);
    return;
  }

  if (pathDragState) {
    updatePathDrag(event.clientX, event.clientY);
    return;
  }

  if (isPanning) {
    const dx = event.clientX - panStart.x;
    const dy = event.clientY - panStart.y;
    if (stageViewportEl) {
      stageViewportEl.scrollLeft = panStart.scrollLeft - dx;
      stageViewportEl.scrollTop = panStart.scrollTop - dy;
    }
    clampCanvasScroll();
    return;
  }

  if (isDrawing && canvasWrap.contains(event.target)) applyBrush(event.clientX, event.clientY);
});

document.addEventListener('mousemove', (event) => {
  if (artboardTransformDrag) {
    updateArtboardTransformDrag(event);
    return;
  }
  if (marqueeState) {
    updateMarqueeSelection(event.clientX, event.clientY);
    return;
  }
  if (pathDragState) updatePathDrag(event.clientX, event.clientY);
});

stageViewportEl?.addEventListener('mousedown', onMouseDown);
stageViewportEl?.addEventListener('dblclick', onSelectDoubleClick);
artboardTransformEl?.addEventListener('mousedown', beginArtboardTransformDrag);
stageViewportEl?.addEventListener('scroll', () => {
  clampCanvasScroll();
  renderCropPreview();
});
window.addEventListener('resize', () => {
  resizeCanvasToImage();
  clampCanvasScroll();
  renderCropPreview();
});

document.addEventListener('mouseup', () => {
  endArtboardTransformDrag();
  if (marqueeState) finalizeMarqueeSelection();
  endPathDrag();
  isDrawing = false;
  isPanning = false;
  endHeldColorPreview();
  stageViewportEl?.classList.remove('panning');
  updateToolCursorState();
});

document.addEventListener('keydown', (event) => {
  const tag = document.activeElement?.tagName?.toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable;
  if (event.key === 'Escape' && rotationUiState) {
    event.preventDefault();
    closeRotationPopup({ apply: false });
    return;
  }
  if (event.code === 'Space') {
    if (typing) return;
    event.preventDefault();
    isSpaceHeld = true;
    stageViewportEl?.classList.add('pan-enabled');
    updateToolCursorState();
    return;
  }

  if (typing || mode !== 'select') return;
  if (selectedPaths.size === 0) return;

  const step = event.shiftKey ? 10 : 1;
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    nudgeSelectedPaths(0, -step);
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    nudgeSelectedPaths(0, step);
    return;
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    nudgeSelectedPaths(-step, 0);
    return;
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    nudgeSelectedPaths(step, 0);
    return;
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    deleteSelectedPaths();
  }
});

document.addEventListener('keyup', (event) => {
  if (event.code !== 'Space') return;
  isSpaceHeld = false;
  isPanning = false;
  stageViewportEl?.classList.remove('pan-enabled', 'panning');
  updateToolCursorState();
});

stageViewportEl?.addEventListener(
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
  syncCmykControlsFromWorkingColor();
  saveUiSettings();
});
colorAdjustModelEl?.addEventListener('change', () => {
  updateColorAdjustControlUi();
  syncCmykControlsFromWorkingColor();
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
applyCmykBtn?.addEventListener('click', applyCmykToWorkingColor);

canvasBgColorEl?.addEventListener('input', () => {
  applyCanvasBackground(canvasBgColorEl.value);
  saveUiSettings();
});

const cmykControls = [cmykCEl, cmykMEl, cmykYEl, cmykKEl];
cmykControls.forEach((el) => {
  el?.addEventListener('input', updateCmykPreview);
});
rotationSliderEl?.addEventListener('input', () => {
  applyRotationPreview(Number(rotationSliderEl.value));
});
rotationApplyBtn?.addEventListener('click', () => {
  closeRotationPopup({ apply: true });
});
rotationCancelBtn?.addEventListener('click', () => {
  closeRotationPopup({ apply: false });
});
speckleAreaEl?.addEventListener('input', () => {
  if (speckleAreaQuickEl) speckleAreaQuickEl.value = speckleAreaEl.value;
  renderSpeckleAreaValue();
  saveUiSettings();
});
speckleAreaQuickEl?.addEventListener('input', () => {
  if (speckleAreaEl) speckleAreaEl.value = speckleAreaQuickEl.value;
  renderSpeckleAreaValue();
  saveUiSettings();
});
speckleAreaEl?.addEventListener(
  'wheel',
  (event) => {
    if (document.activeElement !== speckleAreaEl && !speckleAreaEl.matches(':hover')) return;
    event.preventDefault();
    const delta = event.deltaY < 0 ? 5 : -5;
    const min = Number(speckleAreaEl.min) || 10;
    const max = Number(speckleAreaEl.max) || min;
    const next = clampNumber(Number(speckleAreaEl.value) + delta, min, max);
    speckleAreaEl.value = String(Math.round(next));
    if (speckleAreaQuickEl) speckleAreaQuickEl.value = speckleAreaEl.value;
    renderSpeckleAreaValue();
    saveUiSettings();
  },
  { passive: false }
);
speckleAreaQuickEl?.addEventListener(
  'wheel',
  (event) => {
    if (document.activeElement !== speckleAreaQuickEl && !speckleAreaQuickEl.matches(':hover')) return;
    event.preventDefault();
    const delta = event.deltaY < 0 ? 5 : -5;
    const min = Number(speckleAreaQuickEl.min) || 10;
    const max = Number(speckleAreaQuickEl.max) || min;
    const next = clampNumber(Number(speckleAreaQuickEl.value) + delta, min, max);
    speckleAreaQuickEl.value = String(Math.round(next));
    if (speckleAreaEl) speckleAreaEl.value = speckleAreaQuickEl.value;
    renderSpeckleAreaValue();
    saveUiSettings();
  },
  { passive: false }
);
cropRatioEl?.addEventListener('change', () => {
  saveUiSettings();
  if (!loadedSvg) return;
  setArtboardTransformMode(true, { seedFromUi: true, rerender: true });
});
fileInput.addEventListener('change', () => handleFile(fileInput.files?.[0]));
modeSelectBtn?.addEventListener('click', () => {
  setMode('select');
  saveUiSettings();
});
modeFloodFillBtn?.addEventListener('click', () => {
  setMode('floodFill');
  saveUiSettings();
});
modeColorSwapBtn?.addEventListener('click', () => {
  setMode('colorSwap');
  saveUiSettings();
});
modeBrushBtn.addEventListener('click', () => {
  setMode('brush');
  saveUiSettings();
});
modeOpenPathBtn?.addEventListener('click', () => {
  setMode('openPathDel');
  saveUiSettings();
});
openPathCleanAllBtn?.addEventListener('click', runOpenPathCleanupAll);
restoreBackgroundBtn?.addEventListener('click', restoreBackgroundColorPath);
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
deleteCurrentColorBtn?.addEventListener('click', deleteSelectedBaseColor);
cropTransformBtn?.addEventListener('click', () => {
  if (!loadedSvg) {
    setStatus('Transform Artboard skipped: load an SVG first.');
    return;
  }
  setArtboardTransformMode(!artboardTransformMode, { seedFromUi: true, rerender: true });
  setStatus(artboardTransformMode ? 'Transform Artboard enabled.' : 'Transform Artboard disabled.');
});
applyCropBtn?.addEventListener('click', () => {
  if (!loadedSvg) {
    setStatus('Crop skipped: load an SVG first.');
    return;
  }
  pushHistory(snapshot());
  applyCrop();
});
stageViewportEl?.addEventListener('contextmenu', onPathContextMenu);

mergeBtn?.addEventListener('click', async () => {
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
zoomFitBtn?.addEventListener('click', fitToScreen);

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
resetCropUiControls({ persist: false, rerender: false });
setArtboardTransformMode(false, { rerender: false });
updateSpeckleAreaControl(Number(speckleAreaEl?.value));
updateEmptyCanvasState();
selectedTargetColor = replaceColorEl?.value || selectedTargetColor;
mergeColorA = mergeColorAEl?.value || mergeColorA;
mergeColorB = mergeColorBEl?.value || mergeColorB;
updateColorAdjustControlUi();
syncCmykControlsFromWorkingColor();
setMode(mode);
applyViewMode();
applyZoom();
applyCanvasBackground(canvasBgColorEl?.value || '#0a0b0f');
renderCropPreview();
saveUiSettings();

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const svgStage = document.getElementById('svgStage');
const canvasWrap = document.getElementById('canvasWrap');
const brushPreview = document.getElementById('brushPreview');
const statusEl = document.getElementById('status');
const speckleAreaEl = document.getElementById('speckleArea');
const speckleColorEl = document.getElementById('speckleColor');
const mergeColorEl = document.getElementById('mergeColor');
const specklePaletteEl = document.getElementById('specklePalette');
const mergePaletteEl = document.getElementById('mergePalette');
const allColorsBtn = document.getElementById('allColorsBtn');
const brushSizeEl = document.getElementById('brushSize');
const flattenBgBtn = document.getElementById('flattenBgBtn');
const togglePinkBgBtn = document.getElementById('togglePinkBgBtn');
const undoBtn = document.getElementById('undoBtn');
const downloadBtn = document.getElementById('downloadBtn');
const zoomInBtn = document.getElementById('zoomIn');
const zoomOutBtn = document.getElementById('zoomOut');
const zoomResetBtn = document.getElementById('zoomReset');

let zoom = 1;
let loadedSvg = null;
let loadedFilename = 'updated.svg';
let isDrawing = false;
let isSpaceHeld = false;
let isPanning = false;
let speckleColorMode = 'single';
let panStart = { x: 0, y: 0, scrollLeft: 0, scrollTop: 0 };
let history = [];
let strokeSnapshotTaken = false;

const shapeSelector = 'path,rect,circle,ellipse,polygon,polyline';

function setStatus(message) {
  statusEl.textContent = message;
}

function hexToRgb(hex) {
  const v = hex.replace('#', '');
  const full = v.length === 3 ? [...v].map((c) => c + c).join('') : v;
  const int = Number.parseInt(full, 16);
  return `rgb(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255})`;
}

function rgbToHex(rgb) {
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return '#000000';
  const [r, g, b] = [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0'));
  return `#${r}${g}${b}`;
}

function normalizeColor(color) {
  if (!color) return null;
  const t = color.trim().toLowerCase();
  if (t === 'none' || t === 'transparent') return null;
  if (t.startsWith('#')) return hexToRgb(t);
  return t.replace(/\s+/g, '');
}

function getComputedFill(el) {
  const direct = normalizeColor(el.getAttribute('fill'));
  if (direct) return direct;
  const styleFill = normalizeColor(el.style.fill || '');
  if (styleFill) return styleFill;
  if (el.ownerSVGElement) {
    return normalizeColor(getComputedStyle(el).fill);
  }
  return null;
}

function applyZoom() {
  svgStage.style.transform = `scale(${zoom})`;
  zoomResetBtn.textContent = `${Math.round(zoom * 100)}%`;
  updateBrushPreviewSize();
}

function clampZoom(value) {
  return Math.max(0.1, Math.min(8, value));
}

function snapshotSvg() {
  if (!loadedSvg) return null;
  return new XMLSerializer().serializeToString(loadedSvg);
}

function pushHistory() {
  if (!loadedSvg) return;
  const snap = snapshotSvg();
  if (!snap) return;
  history.push(snap);
  if (history.length > 4) history = history.slice(-4);
  undoBtn.disabled = history.length === 0;
}

function restoreFromMarkup(markup) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(markup, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg) return false;
  loadedSvg = document.importNode(svg, true);
  loadedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svgStage.innerHTML = '';
  svgStage.appendChild(loadedSvg);
  rebuildColorPalettes();
  return true;
}

function undoStep() {
  const last = history.pop();
  if (!last) {
    setStatus('Nothing to undo.');
    undoBtn.disabled = true;
    return;
  }

  const ok = restoreFromMarkup(last);
  undoBtn.disabled = history.length === 0;
  setStatus(ok ? `Undo complete. Remaining undo steps: ${history.length}.` : 'Undo failed due to parse error.');
}

function getShapeItems() {
  return [...loadedSvg.querySelectorAll(shapeSelector)].map((el) => {
    try {
      const box = getGlobalBBox(el);
      return {
        el,
        box,
        area: box.width * box.height,
        fill: getComputedFill(el),
        geometry: el instanceof SVGGeometryElement ? el : null
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function getSvgPaletteColors() {
  if (!loadedSvg) return [];
  const unique = new Set();
  getShapeItems().forEach((item) => {
    if (item.fill) unique.add(item.fill);
  });
  return [...unique].sort();
}

function selectSwatch(paletteEl, color) {
  [...paletteEl.querySelectorAll('.color-swatch')].forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.color === color);
  });
}

function renderPalette(paletteEl, colors, onPick) {
  paletteEl.innerHTML = '';
  colors.forEach((color) => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'color-swatch';
    swatch.title = `${rgbToHex(color)} / ${color}`;
    swatch.style.background = color;
    swatch.dataset.color = color;
    swatch.addEventListener('click', () => onPick(color));
    paletteEl.appendChild(swatch);
  });
}

function rebuildColorPalettes() {
  const colors = getSvgPaletteColors();
  renderPalette(specklePaletteEl, colors, (color) => {
    speckleColorMode = 'single';
    allColorsBtn.classList.remove('active');
    speckleColorEl.value = rgbToHex(color);
    selectSwatch(specklePaletteEl, color);
  });

  renderPalette(mergePaletteEl, colors, (color) => {
    mergeColorEl.value = rgbToHex(color);
    selectSwatch(mergePaletteEl, color);
  });

  selectSwatch(specklePaletteEl, normalizeColor(speckleColorEl.value));
  selectSwatch(mergePaletteEl, normalizeColor(mergeColorEl.value));
}

function loadSvgText(text, filename = 'SVG') {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg || doc.querySelector('parsererror')) {
    setStatus('Unable to parse SVG.');
    return;
  }

  loadedSvg = document.importNode(svg, true);
  loadedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  loadedFilename = filename.toLowerCase().endsWith('.svg') ? filename : `${filename}.svg`;
  svgStage.innerHTML = '';
  svgStage.appendChild(loadedSvg);
  rebuildColorPalettes();
  downloadBtn.disabled = false;
  history = [];
  undoBtn.disabled = true;
  setStatus(`Loaded ${filename}. Found ${loadedSvg.querySelectorAll(shapeSelector).length} drawable shapes.`);
}

function autoUniteSpeckles() {
  if (!loadedSvg) return 0;
  const minArea = Number(speckleAreaEl.value) || 0;
  const items = getShapeItems();
  let mergedCount = 0;

  for (const item of items) {
    if (!item.el.isConnected || item.area <= 0 || item.area > minArea || !item.fill) continue;
    const container = findContainerOfColor(items, item, item.fill);
    if (!container) continue;

    const mergedAsPath =
      item.el.tagName.toLowerCase() === 'path' &&
      container.el.tagName.toLowerCase() === 'path' &&
      mergePathIntoContainer(item.el, container.el);

    if (!mergedAsPath && item.el.isConnected) {
      item.el.remove();
    }
    mergedCount += 1;
  }

  if (mergedCount > 0) rebuildColorPalettes();
  return mergedCount;
}

function downloadUpdatedSvg() {
  if (!loadedSvg) return setStatus('Load an SVG first.');
  const merged = autoUniteSpeckles();
  const markup = new XMLSerializer().serializeToString(loadedSvg);
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const outputName = loadedFilename.replace(/\.svg$/i, '') + '-updated.svg';
  a.href = url;
  a.download = outputName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setStatus(`Downloaded ${outputName}.${merged > 0 ? ` Auto-united ${merged} speckle(s).` : ''}`);
}

function handleFile(file) {
  if (!file) return setStatus('Please provide an SVG file.');
  const looksLikeSvg = file.name.toLowerCase().endsWith('.svg') || file.type === 'image/svg+xml';
  file.text().then((content) => {
    if (!looksLikeSvg && !content.includes('<svg')) {
      setStatus('That file does not look like SVG content.');
      return;
    }
    loadSvgText(content, file.name || 'SVG');
  }).catch(() => setStatus('Unable to read that file.'));
}

function toGlobalPoint(el, x, y) {
  const matrix = el.getCTM();
  if (!matrix) return { x, y };
  const p = new DOMPoint(x, y).matrixTransform(matrix);
  return { x: p.x, y: p.y };
}

function toLocalPoint(el, x, y) {
  const matrix = el.getCTM();
  if (!matrix) return { x, y };
  const p = new DOMPoint(x, y).matrixTransform(matrix.inverse());
  return { x: p.x, y: p.y };
}

function getGlobalBBox(el) {
  const box = el.getBBox();
  const corners = [
    toGlobalPoint(el, box.x, box.y),
    toGlobalPoint(el, box.x + box.width, box.y),
    toGlobalPoint(el, box.x, box.y + box.height),
    toGlobalPoint(el, box.x + box.width, box.y + box.height)
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys)
  };
}

function circleIntersectsBox(center, radius, box) {
  const nearestX = Math.max(box.x, Math.min(center.x, box.x + box.width));
  const nearestY = Math.max(box.y, Math.min(center.y, box.y + box.height));
  const dx = center.x - nearestX;
  const dy = center.y - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}

function centerOfBox(box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function mergePathIntoContainer(innerPath, outerPath) {
  const innerD = innerPath.getAttribute('d');
  const outerD = outerPath.getAttribute('d');
  if (!innerD || !outerD) return false;
  outerPath.setAttribute('d', `${outerD} ${innerD}`);
  innerPath.remove();
  return true;
}

function findContainerOfColor(items, innerItem, targetColor) {
  const point = centerOfBox(innerItem.box);
  const candidates = items.filter((outer) => {
    if (outer.el === innerItem.el || !outer.el.isConnected) return false;
    if (outer.area <= innerItem.area) return false;
    if (outer.fill !== targetColor) return false;
    const local = toLocalPoint(outer.el, point.x, point.y);
    return outer.geometry?.isPointInFill?.(new DOMPoint(local.x, local.y));
  });

  candidates.sort((a, b) => a.area - b.area);
  return candidates[0] || null;
}

function screenToSvgPoint(clientX, clientY) {
  const rect = loadedSvg.getBoundingClientRect();
  return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
}

function updateBrushPreviewSize() {
  const radius = (Number(brushSizeEl.value) || 1) * zoom;
  brushPreview.style.width = `${radius * 2}px`;
  brushPreview.style.height = `${radius * 2}px`;
}

function updateBrushPreviewPosition(event) {
  const wrapRect = canvasWrap.getBoundingClientRect();
  brushPreview.style.left = `${event.clientX - wrapRect.left + canvasWrap.scrollLeft}px`;
  brushPreview.style.top = `${event.clientY - wrapRect.top + canvasWrap.scrollTop}px`;
}

function performBrushPass(clientX, clientY) {
  if (!loadedSvg) return;

  const minArea = Number(speckleAreaEl.value) || 0;
  const brushRadius = Number(brushSizeEl.value) || 1;
  const sourceColor = normalizeColor(speckleColorEl.value);
  const targetColor = normalizeColor(mergeColorEl.value);
  const pointer = screenToSvgPoint(clientX, clientY);
  const items = getShapeItems();

  const touched = items.filter((item) => {
    if (item.area <= 0 || item.area > minArea) return false;
    if (!circleIntersectsBox(pointer, brushRadius, item.box)) return false;
    return speckleColorMode === 'all' ? Boolean(item.fill) : item.fill === sourceColor;
  });

  let changed = 0;
  for (const item of touched) {
    item.el.setAttribute('fill', mergeColorEl.value);
    changed += 1;
  }

  if (changed > 0) {
    rebuildColorPalettes();
    setStatus(`Magic eraser updated ${changed} speckle(s).`);
  }
}

function flattenBackground() {
  if (!loadedSvg) return setStatus('Load an SVG first.');
  pushHistory();

  const all = getShapeItems();
  const svgBox = loadedSvg.getBBox();
  const eps = 0.75;
  const touchingEdge = (box) => (
    box.x <= svgBox.x + eps ||
    box.y <= svgBox.y + eps ||
    box.x + box.width >= svgBox.x + svgBox.width - eps ||
    box.y + box.height >= svgBox.y + svgBox.height - eps
  );

  const edgeItems = all.filter((item) => item.fill && touchingEdge(item.box));
  if (edgeItems.length === 0) {
    setStatus('No edge-contact shapes found for flattening.');
    return;
  }

  const counts = new Map();
  edgeItems.forEach((item) => counts.set(item.fill, (counts.get(item.fill) || 0) + 1));
  const dominantFill = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const candidates = edgeItems.filter((item) => item.fill === dominantFill);

  const dParts = [];
  candidates.forEach((item) => {
    if (item.el.tagName.toLowerCase() === 'path' && item.el.getAttribute('d')) {
      dParts.push(item.el.getAttribute('d'));
    }
    item.el.remove();
  });

  const background = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  background.setAttribute(
    'd',
    dParts.length > 0
      ? dParts.join(' ')
      : `M${svgBox.x} ${svgBox.y} H${svgBox.x + svgBox.width} V${svgBox.y + svgBox.height} H${svgBox.x} Z`
  );
  background.setAttribute('fill', rgbToHex(dominantFill));
  loadedSvg.prepend(background);
  rebuildColorPalettes();
  setStatus(`Flattened background with ${candidates.length} edge-contact shape(s).`);
}

['dragenter', 'dragover'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragover');
  });
});

dropZone.addEventListener('drop', (event) => handleFile(event.dataTransfer?.files?.[0]));
fileInput.addEventListener('change', () => handleFile(fileInput.files?.[0]));

allColorsBtn.addEventListener('click', () => {
  speckleColorMode = 'all';
  allColorsBtn.classList.add('active');
  [...specklePaletteEl.querySelectorAll('.color-swatch')].forEach((sw) => sw.classList.remove('active'));
});

speckleColorEl.addEventListener('input', () => {
  speckleColorMode = 'single';
  allColorsBtn.classList.remove('active');
  selectSwatch(specklePaletteEl, normalizeColor(speckleColorEl.value));
});

mergeColorEl.addEventListener('input', () => {
  selectSwatch(mergePaletteEl, normalizeColor(mergeColorEl.value));
});

downloadBtn.addEventListener('click', downloadUpdatedSvg);
undoBtn.addEventListener('click', undoStep);
flattenBgBtn.addEventListener('click', flattenBackground);
togglePinkBgBtn.addEventListener('click', () => {
  canvasWrap.classList.toggle('hot-pink-preview');
  setStatus(canvasWrap.classList.contains('hot-pink-preview')
    ? 'Hot pink preview background enabled (saved SVG is unchanged).'
    : 'Hot pink preview background disabled.');
});

zoomInBtn.addEventListener('click', () => {
  zoom = clampZoom(zoom * 1.2);
  applyZoom();
});
zoomOutBtn.addEventListener('click', () => {
  zoom = clampZoom(zoom / 1.2);
  applyZoom();
});
zoomResetBtn.addEventListener('click', () => {
  zoom = 1;
  applyZoom();
});

canvasWrap.addEventListener('wheel', (event) => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  zoom = clampZoom(zoom * (event.deltaY < 0 ? 1.08 : 0.92));
  applyZoom();
}, { passive: false });

document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space') return;
  const activeTag = document.activeElement?.tagName?.toLowerCase();
  if (activeTag === 'input' || activeTag === 'textarea' || document.activeElement?.isContentEditable) return;
  event.preventDefault();
  isSpaceHeld = true;
  canvasWrap.classList.add('space-pan');
});

document.addEventListener('keyup', (event) => {
  if (event.code !== 'Space') return;
  event.preventDefault();
  isSpaceHeld = false;
  isPanning = false;
  canvasWrap.classList.remove('space-pan', 'panning');
});

canvasWrap.addEventListener('mousedown', (event) => {
  if (!loadedSvg) return;
  if (isSpaceHeld) {
    isPanning = true;
    canvasWrap.classList.add('panning');
    panStart = {
      x: event.clientX,
      y: event.clientY,
      scrollLeft: canvasWrap.scrollLeft,
      scrollTop: canvasWrap.scrollTop
    };
    return;
  }

  isDrawing = true;
  strokeSnapshotTaken = false;
  updateBrushPreviewPosition(event);
  brushPreview.style.display = 'block';
  if (!strokeSnapshotTaken) {
    pushHistory();
    strokeSnapshotTaken = true;
  }
  performBrushPass(event.clientX, event.clientY);
});

canvasWrap.addEventListener('mousemove', (event) => {
  if (!loadedSvg) return;
  updateBrushPreviewPosition(event);
  brushPreview.style.display = isSpaceHeld ? 'none' : 'block';

  if (isPanning) {
    const dx = event.clientX - panStart.x;
    const dy = event.clientY - panStart.y;
    canvasWrap.scrollLeft = panStart.scrollLeft - dx;
    canvasWrap.scrollTop = panStart.scrollTop - dy;
    return;
  }

  if (!isDrawing) return;
  performBrushPass(event.clientX, event.clientY);
});

canvasWrap.addEventListener('mouseleave', () => {
  brushPreview.style.display = 'none';
});

canvasWrap.addEventListener('mouseup', () => {
  isDrawing = false;
  isPanning = false;
  canvasWrap.classList.remove('panning');
});

document.addEventListener('mouseup', () => {
  isDrawing = false;
  isPanning = false;
  canvasWrap.classList.remove('panning');
});

brushSizeEl.addEventListener('input', updateBrushPreviewSize);
applyZoom();
updateBrushPreviewSize();

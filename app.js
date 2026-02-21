const fileInput = document.getElementById('fileInput');
const svgStage = document.getElementById('svgStage');
const canvasWrap = document.getElementById('canvasWrap');
const brushPreview = document.getElementById('brushPreview');
const dropOverlay = document.getElementById('dropOverlay');
const statusEl = document.getElementById('status');
const speckleAreaEl = document.getElementById('speckleArea');
const specklePaletteEl = document.getElementById('specklePalette');
const mergePaletteEl = document.getElementById('mergePalette');
const allColorsBtn = document.getElementById('allColorsBtn');
const brushSizeEl = document.getElementById('brushSize');
const flattenBgBtn = document.getElementById('flattenBgBtn');
const removeBgBtn = document.getElementById('removeBgBtn');
const togglePinkBgBtn = document.getElementById('togglePinkBgBtn');
const toggleRenderModeBtn = document.getElementById('toggleRenderModeBtn');
const undoBtn = document.getElementById('undoBtn');
const downloadBtn = document.getElementById('downloadBtn');
const zoomInBtn = document.getElementById('zoomIn');
const zoomOutBtn = document.getElementById('zoomOut');
const zoomResetBtn = document.getElementById('zoomReset');

const shapeSelector = 'path,rect,circle,ellipse,polygon,polyline,line';
const MAX_HISTORY = 30;

let zoom = 1;
let loadedSvg = null;
let loadedFilename = 'updated.svg';
let isDrawing = false;
let isSpaceHeld = false;
let isPanning = false;
let speckleColorMode = 'single';
let selectedSpeckleColor = null;
let selectedMergeColor = null;
let panStart = { x: 0, y: 0, scrollLeft: 0, scrollTop: 0 };
let history = [];
let pageDragDepth = 0;
let renderMode = 'fill';

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
  const originalFill = normalizeColor(el.dataset.renderOriginalFill || '');
  if (originalFill) return originalFill;
  const direct = normalizeColor(el.getAttribute('fill'));
  if (direct) return direct;
  const styleFill = normalizeColor(el.style.fill || '');
  if (styleFill) return styleFill;
  if (!el.ownerSVGElement) return null;
  return normalizeColor(getComputedStyle(el).fill);
}

function snapshotSvg() {
  if (!loadedSvg) return null;
  return new XMLSerializer().serializeToString(loadedSvg);
}

function pushHistorySnapshot(markup) {
  if (!markup) return;
  history.push(markup);
  if (history.length > MAX_HISTORY) {
    history = history.slice(-MAX_HISTORY);
  }
  undoBtn.disabled = history.length === 0;
}

function captureHistory() {
  pushHistorySnapshot(snapshotSvg());
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
  applyRenderMode();
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

function toGlobalPoint(el, x, y) {
  const matrix = el.getCTM();
  if (!matrix) return { x, y };
  const p = new DOMPoint(x, y).matrixTransform(matrix);
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

function getShapeItems() {
  if (!loadedSvg) return [];
  return [...loadedSvg.querySelectorAll(shapeSelector)]
    .map((el) => {
      const box = getGlobalBBox(el);
      return {
        el,
        box,
        area: box.width * box.height,
        fill: getComputedFill(el),
        geometry: el instanceof SVGGeometryElement ? el : null,
        center: { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      };
    })
    .filter((item) => Number.isFinite(item.area) && item.area > 0);
}

function getSvgPaletteColors() {
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

  if (colors.length === 0) {
    selectedSpeckleColor = null;
    selectedMergeColor = null;
  } else {
    if (!selectedSpeckleColor || !colors.includes(selectedSpeckleColor)) {
      selectedSpeckleColor = colors[0];
    }
    if (!selectedMergeColor || !colors.includes(selectedMergeColor)) {
      selectedMergeColor = colors[0];
    }
  }

  renderPalette(specklePaletteEl, colors, (color) => {
    speckleColorMode = 'single';
    allColorsBtn.classList.remove('active');
    selectedSpeckleColor = color;
    selectSwatch(specklePaletteEl, color);
  });

  renderPalette(mergePaletteEl, colors, (color) => {
    selectedMergeColor = color;
    selectSwatch(mergePaletteEl, color);
  });

  selectSwatch(specklePaletteEl, selectedSpeckleColor);
  selectSwatch(mergePaletteEl, selectedMergeColor);
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
  applyRenderMode();
  rebuildColorPalettes();
  downloadBtn.disabled = false;
  history = [];
  undoBtn.disabled = true;
  setStatus(`Loaded ${filename}. Found ${loadedSvg.querySelectorAll(shapeSelector).length} drawable shapes.`);
}

function handleFile(file) {
  if (!file) {
    setStatus('Please provide an SVG file.');
    return;
  }

  const looksLikeSvg = file.name.toLowerCase().endsWith('.svg') || file.type === 'image/svg+xml';
  file.text()
    .then((content) => {
      if (!looksLikeSvg && !content.includes('<svg')) {
        setStatus('That file does not look like SVG content.');
        return;
      }
      loadSvgText(content, file.name || 'SVG');
    })
    .catch(() => setStatus('Unable to read that file.'));
}

function getSvgViewportRect() {
  const viewBox = loadedSvg.viewBox?.baseVal;
  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    return { x: viewBox.x, y: viewBox.y, width: viewBox.width, height: viewBox.height };
  }

  const width = Number.parseFloat(loadedSvg.getAttribute('width'));
  const height = Number.parseFloat(loadedSvg.getAttribute('height'));
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { x: 0, y: 0, width, height };
  }

  return loadedSvg.getBBox();
}

function circleIntersectsBox(center, radius, box) {
  const nearestX = Math.max(box.x, Math.min(center.x, box.x + box.width));
  const nearestY = Math.max(box.y, Math.min(center.y, box.y + box.height));
  const dx = center.x - nearestX;
  const dy = center.y - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}

function screenToSvgPoint(clientX, clientY) {
  const rect = loadedSvg.getBoundingClientRect();
  return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
}

function applyFill(item, fill) {
  item.el.setAttribute('fill', rgbToHex(fill));
  if (item.el.dataset.renderOriginalFill !== undefined) {
    item.el.dataset.renderOriginalFill = rgbToHex(fill);
  }
}

function pickMergeColorForSpeckle(speckle, items) {
  if (selectedMergeColor) return selectedMergeColor;

  const candidates = items
    .filter((item) => item.el !== speckle.el && item.area > speckle.area && item.fill)
    .filter((item) => {
      if (!item.geometry) return false;
      return item.geometry.isPointInFill(new DOMPoint(speckle.center.x, speckle.center.y));
    })
    .sort((a, b) => a.area - b.area);

  return candidates[0]?.fill || null;
}

function performBrushPass(clientX, clientY) {
  if (!loadedSvg) return;

  const minArea = Number(speckleAreaEl.value) || 0;
  const brushRadius = Number(brushSizeEl.value) || 1;
  const sourceColor = selectedSpeckleColor;
  const pointer = screenToSvgPoint(clientX, clientY);

  const items = getShapeItems();
  const touched = items.filter((item) => {
    if (item.area > minArea) return false;
    if (!circleIntersectsBox(pointer, brushRadius, item.box)) return false;
    return speckleColorMode === 'all' ? Boolean(item.fill) : item.fill === sourceColor;
  });

  if (touched.length === 0) return;

  const before = snapshotSvg();
  let changed = 0;

  touched.forEach((speckle) => {
    if (!speckle.el.isConnected || !speckle.fill) return;
    const mergeColor = pickMergeColorForSpeckle(speckle, items);
    if (!mergeColor || mergeColor === speckle.fill) return;
    applyFill(speckle, mergeColor);
    changed += 1;
  });

  if (changed === 0) return;
  pushHistorySnapshot(before);
  applyRenderMode();
  rebuildColorPalettes();
  setStatus(`Merged ${changed} speckle(s) into ${rgbToHex(selectedMergeColor || '#000000')}.`);
}

function getEdgeTouchingItems(items, targetFill = null) {
  const svgBox = getSvgViewportRect();
  const eps = 0.75;
  return items.filter((item) => {
    if (!item.fill) return false;
    if (targetFill && item.fill !== targetFill) return false;
    return (
      item.box.x <= svgBox.x + eps ||
      item.box.y <= svgBox.y + eps ||
      item.box.x + item.box.width >= svgBox.x + svgBox.width - eps ||
      item.box.y + item.box.height >= svgBox.y + svgBox.height - eps
    );
  });
}

function getDominantEdgeFill(items) {
  const edgeItems = getEdgeTouchingItems(items);
  if (edgeItems.length === 0) return null;

  const areaByFill = new Map();
  edgeItems.forEach((item) => {
    areaByFill.set(item.fill, (areaByFill.get(item.fill) || 0) + item.area);
  });
  return [...areaByFill.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function removeEdgeTouchingByColor(fillColor) {
  const all = getShapeItems();
  const edgeItems = getEdgeTouchingItems(all, fillColor);
  edgeItems.forEach((item) => item.el.remove());
  return edgeItems.length;
}

function flattenBackground() {
  if (!loadedSvg) return setStatus('Load an SVG first.');
  const all = getShapeItems();
  const dominantFill = getDominantEdgeFill(all);
  if (!dominantFill) return setStatus('No edge-touching color found for flattening.');

  captureHistory();
  const removed = removeEdgeTouchingByColor(dominantFill);
  const svgBox = getSvgViewportRect();

  const background = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  background.setAttribute(
    'd',
    `M${svgBox.x} ${svgBox.y} H${svgBox.x + svgBox.width} V${svgBox.y + svgBox.height} H${svgBox.x} Z`
  );
  background.setAttribute('fill', rgbToHex(dominantFill));
  loadedSvg.prepend(background);

  applyRenderMode();
  rebuildColorPalettes();
  setStatus(`Flattened background color ${rgbToHex(dominantFill)} by replacing ${removed} shape(s).`);
}

function removeBackgroundColor() {
  if (!loadedSvg) return setStatus('Load an SVG first.');
  const all = getShapeItems();
  const dominantFill = getDominantEdgeFill(all);
  if (!dominantFill) return setStatus('No edge-touching color found to remove.');

  captureHistory();
  const removed = removeEdgeTouchingByColor(dominantFill);
  applyRenderMode();
  rebuildColorPalettes();
  setStatus(`Removed ${removed} shape(s) using edge color ${rgbToHex(dominantFill)}.`);
}

function downloadUpdatedSvg() {
  if (!loadedSvg) return setStatus('Load an SVG first.');
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
  setStatus(`Downloaded ${outputName}.`);
}

function applyRenderMode() {
  if (!loadedSvg) return;
  const shapes = loadedSvg.querySelectorAll(shapeSelector);

  if (renderMode === 'stroke') {
    shapes.forEach((shape) => {
      if (shape.dataset.renderOriginalFill === undefined) {
        shape.dataset.renderOriginalFill = shape.getAttribute('fill') || '';
      }
      if (shape.dataset.renderOriginalStroke === undefined) {
        shape.dataset.renderOriginalStroke = shape.getAttribute('stroke') || '';
      }
      if (shape.dataset.renderOriginalStrokeWidth === undefined) {
        shape.dataset.renderOriginalStrokeWidth = shape.getAttribute('stroke-width') || '';
      }

      const fallbackColor = normalizeColor(shape.dataset.renderOriginalStroke)
        || normalizeColor(shape.dataset.renderOriginalFill)
        || '#bdbdbd';
      shape.setAttribute('fill', 'none');
      shape.setAttribute('stroke', rgbToHex(fallbackColor));
      shape.setAttribute('stroke-width', '0.75');
      shape.setAttribute('vector-effect', 'non-scaling-stroke');
    });
  } else {
    shapes.forEach((shape) => {
      const originalFill = shape.dataset.renderOriginalFill;
      const originalStroke = shape.dataset.renderOriginalStroke;
      const originalStrokeWidth = shape.dataset.renderOriginalStrokeWidth;

      if (originalFill !== undefined) {
        if (originalFill) shape.setAttribute('fill', originalFill);
        else shape.removeAttribute('fill');
        delete shape.dataset.renderOriginalFill;
      }
      if (originalStroke !== undefined) {
        if (originalStroke) shape.setAttribute('stroke', originalStroke);
        else shape.removeAttribute('stroke');
        delete shape.dataset.renderOriginalStroke;
      }
      if (originalStrokeWidth !== undefined) {
        if (originalStrokeWidth) shape.setAttribute('stroke-width', originalStrokeWidth);
        else shape.removeAttribute('stroke-width');
        delete shape.dataset.renderOriginalStrokeWidth;
      }
      shape.removeAttribute('vector-effect');
    });
  }

  toggleRenderModeBtn.textContent = renderMode === 'stroke' ? 'View: Thin Stroke' : 'View: Filled';
}

function applyZoom() {
  svgStage.style.transform = `scale(${zoom})`;
  zoomResetBtn.textContent = `${Math.round(zoom * 100)}%`;
  updateBrushPreviewSize();
}

function clampZoom(value) {
  return Math.max(0.1, Math.min(8, value));
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

function showDropOverlay() {
  dropOverlay.classList.add('active');
  dropOverlay.setAttribute('aria-hidden', 'false');
}

function hideDropOverlay() {
  dropOverlay.classList.remove('active');
  dropOverlay.setAttribute('aria-hidden', 'true');
}

fileInput.addEventListener('change', () => handleFile(fileInput.files?.[0]));

allColorsBtn.addEventListener('click', () => {
  speckleColorMode = speckleColorMode === 'all' ? 'single' : 'all';
  allColorsBtn.classList.toggle('active', speckleColorMode === 'all');
  if (speckleColorMode === 'all') {
    [...specklePaletteEl.querySelectorAll('.color-swatch')].forEach((sw) => sw.classList.remove('active'));
  } else {
    selectSwatch(specklePaletteEl, selectedSpeckleColor);
  }
});

downloadBtn.addEventListener('click', downloadUpdatedSvg);
undoBtn.addEventListener('click', undoStep);
flattenBgBtn.addEventListener('click', flattenBackground);
removeBgBtn.addEventListener('click', removeBackgroundColor);
togglePinkBgBtn.addEventListener('click', () => {
  canvasWrap.classList.toggle('hot-pink-preview');
  setStatus(
    canvasWrap.classList.contains('hot-pink-preview')
      ? 'Hot pink preview background enabled (saved SVG is unchanged).'
      : 'Hot pink preview background disabled.'
  );
});

toggleRenderModeBtn.addEventListener('click', () => {
  if (!loadedSvg) return setStatus('Load an SVG first.');
  renderMode = renderMode === 'fill' ? 'stroke' : 'fill';
  applyRenderMode();
  setStatus(renderMode === 'stroke' ? 'Thin stroke view enabled.' : 'Filled view enabled.');
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

canvasWrap.addEventListener(
  'wheel',
  (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    zoom = clampZoom(zoom * (event.deltaY < 0 ? 1.08 : 0.92));
    applyZoom();
  },
  { passive: false }
);

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
  updateBrushPreviewPosition(event);
  brushPreview.style.display = 'block';
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

  if (isDrawing) {
    performBrushPass(event.clientX, event.clientY);
  }
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

document.addEventListener('dragenter', (event) => {
  event.preventDefault();
  pageDragDepth += 1;
  showDropOverlay();
});

document.addEventListener('dragover', (event) => {
  event.preventDefault();
  showDropOverlay();
});

document.addEventListener('dragleave', (event) => {
  event.preventDefault();
  pageDragDepth = Math.max(0, pageDragDepth - 1);
  if (pageDragDepth === 0) hideDropOverlay();
});

document.addEventListener('drop', (event) => {
  event.preventDefault();
  pageDragDepth = 0;
  hideDropOverlay();
  handleFile(event.dataTransfer?.files?.[0]);
});

brushSizeEl.addEventListener('input', updateBrushPreviewSize);
applyZoom();
updateBrushPreviewSize();

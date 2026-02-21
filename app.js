const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const svgStage = document.getElementById('svgStage');
const canvasWrap = document.getElementById('canvasWrap');
const brushPreview = document.getElementById('brushPreview');
const statusEl = document.getElementById('status');
const speckleAreaEl = document.getElementById('speckleArea');
const speckleColorEl = document.getElementById('speckleColor');
const mergeColorEl = document.getElementById('mergeColor');
const brushSizeEl = document.getElementById('brushSize');
const flattenBgBtn = document.getElementById('flattenBgBtn');
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
    const computed = getComputedStyle(el).fill;
    return normalizeColor(computed);
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
  if (ok) {
    setStatus(`Undo complete. Remaining undo steps: ${history.length}.`);
  } else {
    setStatus('Undo failed due to parse error.');
  }
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
  downloadBtn.disabled = false;
  history = [];
  undoBtn.disabled = true;
  setStatus(`Loaded ${filename}. Found ${loadedSvg.querySelectorAll(shapeSelector).length} drawable shapes.`);
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
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
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
  const x = (clientX - rect.left) / zoom;
  const y = (clientY - rect.top) / zoom;
  return { x, y };
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

  const items = [...loadedSvg.querySelectorAll(shapeSelector)].map((el) => {
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

  const touched = items.filter((item) => {
    if (item.area <= 0 || item.area > minArea) return false;
    if (item.fill !== sourceColor) return false;
    return circleIntersectsBox(pointer, brushRadius, item.box);
  });

  let changed = 0;
  for (const item of touched) {
    const container = findContainerOfColor(items, item, targetColor);
    const merged =
      item.el.tagName.toLowerCase() === 'path' &&
      container?.el?.tagName?.toLowerCase() === 'path' &&
      mergePathIntoContainer(item.el, container.el);

    if (!merged) {
      item.el.setAttribute('fill', mergeColorEl.value);
    }
    changed += 1;
  }

  if (changed > 0) {
    setStatus(`Magic eraser updated ${changed} speckle(s).`);
  }
}

function flattenBackground() {
  if (!loadedSvg) return setStatus('Load an SVG first.');
  pushHistory();

  const edgeColor = normalizeColor(mergeColorEl.value);
  const all = [...loadedSvg.querySelectorAll(shapeSelector)].map((el) => {
    try {
      return { el, box: getGlobalBBox(el), fill: getComputedFill(el) };
    } catch {
      return null;
    }
  }).filter(Boolean);

  const svgBox = loadedSvg.getBBox();
  const touchingEdge = (box) => {
    const eps = 0.5;
    return (
      box.x <= svgBox.x + eps ||
      box.y <= svgBox.y + eps ||
      box.x + box.width >= svgBox.x + svgBox.width - eps ||
      box.y + box.height >= svgBox.y + svgBox.height - eps
    );
  };

  const candidates = all.filter((item) => item.fill === edgeColor && touchingEdge(item.box));
  if (candidates.length === 0) {
    setStatus('No edge-contact shapes found for selected merge color.');
    return;
  }

  const dParts = [];
  candidates.forEach((item) => {
    const tag = item.el.tagName.toLowerCase();
    if (tag === 'path' && item.el.getAttribute('d')) {
      dParts.push(item.el.getAttribute('d'));
    }
    item.el.remove();
  });

  const background = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  if (dParts.length > 0) {
    background.setAttribute('d', dParts.join(' '));
  } else {
    background.setAttribute('d', `M${svgBox.x} ${svgBox.y} H${svgBox.x + svgBox.width} V${svgBox.y + svgBox.height} H${svgBox.x} Z`);
  }
  background.setAttribute('fill', mergeColorEl.value);
  loadedSvg.prepend(background);
  setStatus(`Flattened background from ${candidates.length} edge-contact shape(s).`);
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

downloadBtn.addEventListener('click', downloadUpdatedSvg);
undoBtn.addEventListener('click', undoStep);
flattenBgBtn.addEventListener('click', flattenBackground);

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
  if (event.code === 'Space') {
    isSpaceHeld = true;
    canvasWrap.classList.add('space-pan');
  }
});

document.addEventListener('keyup', (event) => {
  if (event.code === 'Space') {
    isSpaceHeld = false;
    isPanning = false;
    canvasWrap.classList.remove('space-pan', 'panning');
  }
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

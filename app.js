const fileInput = document.getElementById('fileInput');
const svgStage = document.getElementById('svgStage');
const canvasWrap = document.getElementById('canvasWrap');
const brushPreview = document.getElementById('brushPreview');
const dropOverlay = document.getElementById('dropOverlay');
const statusEl = document.getElementById('status');
const speckleAreaEl = document.getElementById('speckleArea');
const sourcePaletteEl = document.getElementById('sourcePalette');
const targetPaletteEl = document.getElementById('targetPalette');
const replaceColorEl = document.getElementById('replaceColor');
const allColorsBtn = document.getElementById('allColorsBtn');
const brushSizeEl = document.getElementById('brushSize');
const modeBrushBtn = document.getElementById('modeBrushBtn');
const modePanBtn = document.getElementById('modePanBtn');
const viewFillsBtn = document.getElementById('viewFillsBtn');
const viewStrokesBtn = document.getElementById('viewStrokesBtn');
const mergeBtn = document.getElementById('mergeBtn');
const undoBtn = document.getElementById('undoBtn');
const downloadBtn = document.getElementById('downloadBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomResetBtn = document.getElementById('zoomResetBtn');

const shapeSelector = 'path,rect,circle,ellipse,polygon,polyline,line';
const MAX_HISTORY = 25;

let loadedSvg = null;
let loadedFilename = 'updated.svg';
let zoom = 1;
let isDrawing = false;
let pageDragDepth = 0;
let mode = 'brush';
let isSpaceHeld = false;
let isPanning = false;
let sourceColorMode = 'all';
let selectedSourceColor = null;
let selectedTargetColor = '#111111';
let viewMode = 'fills';
let panStart = { x: 0, y: 0, scrollLeft: 0, scrollTop: 0 };
let history = [];

function setStatus(message) {
  statusEl.textContent = message;
}

function normalizeColor(raw) {
  if (!raw) return null;
  const c = raw.trim().toLowerCase();
  if (!c || c === 'none' || c === 'transparent') return null;
  return c;
}

function rgbToHex(rgb) {
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return rgb;
  const [r, g, b] = [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0'));
  return `#${r}${g}${b}`;
}

function toHexColor(rawColor) {
  const c = normalizeColor(rawColor);
  if (!c) return null;
  if (c.startsWith('#')) {
    if (c.length === 4) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
    return c;
  }
  if (c.startsWith('rgb')) return rgbToHex(c);
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
  const commands = pathData.match(/[a-zA-Z]/g);
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

function setElementFill(el, color) {
  el.setAttribute('fill', color);
  el.style.fill = color;
  el.style.fillOpacity = '1';
  el.removeAttribute('fill-opacity');
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

function pushHistory(markup) {
  if (!markup) return;
  history.push(markup);
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
  undoBtn.disabled = history.length === 0;
}

function getShapeItems() {
  if (!loadedSvg) return [];
  return [...loadedSvg.querySelectorAll(shapeSelector)]
    .map((el) => {
      const box = el.getBBox();
      const ctm = el.getCTM();
      if (!ctm) return null;
      const p1 = new DOMPoint(box.x, box.y).matrixTransform(ctm);
      const p2 = new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(ctm);
      const bbox = {
        x: Math.min(p1.x, p2.x),
        y: Math.min(p1.y, p2.y),
        width: Math.abs(p2.x - p1.x),
        height: Math.abs(p2.y - p1.y)
      };
      const fill = getFill(el);
      return {
        el,
        fill,
        fillHex: toHexColor(fill),
        area: bbox.width * bbox.height,
        box: bbox
      };
    })
    .filter((item) => item && item.area > 0 && Number.isFinite(item.area));
}

function getDominantFillHex() {
  const items = getShapeItems().filter((i) => i.fillHex);
  if (!items.length) return null;
  const totals = new Map();
  for (const it of items) totals.set(it.fillHex, (totals.get(it.fillHex) || 0) + it.area);
  let best = null;
  let bestScore = -Infinity;
  for (const [fill, score] of totals.entries()) {
    if (score > bestScore) {
      bestScore = score;
      best = fill;
    }
  }
  return best;
}

function getBackgroundFillHex() {
  // Heuristic: background/counter color is usually the most common fill by total area OR near-white.
  // We’ll treat the DOMINANT fill as background IF it is very light; otherwise treat the most dominant as "primary ink"
  // and background as the lightest fill present.
  const items = getShapeItems().filter((i) => i.fillHex);
  if (!items.length) return null;

  const fills = [...new Set(items.map((i) => i.fillHex))];
  const dominant = getDominantFillHex();

  // pick lightest fill as background candidate
  const lum = (hex) => {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  let lightest = fills[0];
  let bestLum = -Infinity;
  for (const f of fills) {
    const L = lum(f);
    if (L > bestLum) {
      bestLum = L;
      lightest = f;
    }
  }

  // If there is an obviously light background, use it.
  if (bestLum >= 220) return lightest;

  // Otherwise assume no explicit background fill; return null.
  return null;
}

function buildPalette() {
  if (!loadedSvg) return;
  const unique = [...new Set(getShapeItems().map((i) => i.fillHex).filter(Boolean))].sort();
  const dominant = getDominantFillHex() || unique[0] || null;

  if (!selectedSourceColor || !unique.includes(selectedSourceColor)) {
    selectedSourceColor = dominant;
  }
  if (!selectedTargetColor || !unique.includes(selectedTargetColor) || selectedTargetColor === '#111111') {
    selectedTargetColor = dominant || '#111111';
  }
  replaceColorEl.value = selectedTargetColor;

  renderPalette(sourcePaletteEl, unique, (color) => {
    sourceColorMode = 'single';
    allColorsBtn.classList.remove('active');
    selectedSourceColor = color;
    renderSwatchSelection(sourcePaletteEl, color);
  });

  renderPalette(targetPaletteEl, unique, (color) => {
    selectedTargetColor = color;
    replaceColorEl.value = color;
    renderSwatchSelection(targetPaletteEl, color);
  });

  renderSwatchSelection(sourcePaletteEl, selectedSourceColor);
  if (sourceColorMode === 'all') {
    [...sourcePaletteEl.querySelectorAll('.swatch')].forEach((swatch) => swatch.classList.remove('active'));
  }
  renderSwatchSelection(targetPaletteEl, selectedTargetColor);
}

function applyViewMode() {
  if (!loadedSvg) return;
  loadedSvg.classList.toggle('preview-strokes', viewMode === 'strokes');
  viewFillsBtn.classList.toggle('active', viewMode === 'fills');
  viewStrokesBtn.classList.toggle('active', viewMode === 'strokes');
}

function renderPalette(container, colors, onClick) {
  container.innerHTML = '';
  colors.forEach((color) => {
    const swatch = document.createElement('button');
    swatch.className = 'swatch';
    swatch.type = 'button';
    swatch.style.background = color;
    swatch.dataset.color = color;
    swatch.title = color;
    swatch.addEventListener('click', () => onClick(color));
    container.appendChild(swatch);
  });
}

function renderSwatchSelection(container, color) {
  [...container.querySelectorAll('.swatch')].forEach((swatch) => {
    swatch.classList.toggle('active', swatch.dataset.color === color);
  });
}

function setMode(nextMode) {
  mode = nextMode;
  modeBrushBtn.classList.toggle('active', mode === 'brush');
  modePanBtn.classList.toggle('active', mode === 'pan');
  canvasWrap.classList.toggle('pan-enabled', mode === 'pan');
}

function applyZoom() {
  svgStage.style.transform = `scale(${zoom})`;
  zoomResetBtn.textContent = `${Math.round(zoom * 100)}%`;
  const radius = Number(brushSizeEl.value) * zoom;
  brushPreview.style.width = `${radius * 2}px`;
  brushPreview.style.height = `${radius * 2}px`;
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

function boxesOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
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

function applyBrush(clientX, clientY) {
  if (!loadedSvg) return;
  const brushRadius = Number(brushSizeEl.value);
  const maxArea = Number(speckleAreaEl.value);
  if (!Number.isFinite(maxArea) || maxArea <= 0) return;

  const targetColor = toHexColor(selectedTargetColor || replaceColorEl.value);
  if (!targetColor) return;

  const pointer = screenToSvg(clientX, clientY);
  const items = getShapeItems();
  const bgFill = getBackgroundFillHex();

  let changed = 0;
  items.forEach((item) => {
    // Allow merged compound paths (paths) to remain brush-editable
    if (item.area > maxArea) {
      if (item.el.tagName.toLowerCase() !== 'path') return;
    }
    if (!elementIntersectsBrush(item, pointer, brushRadius)) return;
    if (!item.fillHex) return;
    if (sourceColorMode === 'single' && item.fillHex !== selectedSourceColor) return;
    if (sourceColorMode === 'all' && bgFill && item.fillHex === bgFill) return;
    const userChoseSource = sourceColorMode === 'single';
    if (sourceColorMode === 'all' && !userChoseSource) {
      if (item.area > maxArea) return;
    }
    if (item.fillHex === targetColor) return;
    setElementFill(item.el, targetColor);
    changed += 1;
  });

  if (changed > 0) {
    cleanupOpenStrokeArtifacts();
    buildPalette();
    setStatus(`Magic fix recolored ${changed} speckle(s) to ${targetColor}.`);
  }
}

function mergeSameColorShapes(colors = null) {
  if (!loadedSvg) return 0;
  const palette = colors || [...new Set(getShapeItems().map((i) => i.fillHex).filter(Boolean))];
  const mergeSelector = 'path,rect,circle,ellipse,polygon';
  let mergedCount = 0;

  palette.forEach((fill) => {
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
    if (nodes.length < 2) return;

    const visited = new Set();
    const groups = [];
    for (let i = 0; i < nodes.length; i += 1) {
      if (visited.has(i)) continue;
      const group = [nodes[i]];
      visited.add(i);
      let changed = true;
      while (changed) {
        changed = false;
        for (let j = 0; j < nodes.length; j += 1) {
          if (visited.has(j)) continue;
          if (group.some((entry) => boxesOverlap(entry.box, nodes[j].box))) {
            group.push(nodes[j]);
            visited.add(j);
            changed = true;
          }
        }
      }
      if (group.length > 1) groups.push(group.map((entry) => entry.el));
    }

    if (groups.length === 0) return;

    groups.forEach((groupNodes) => {
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
        return;
      }

      let united = imported[0];
      for (let i = 1; i < imported.length; i += 1) {
        try {
          united = united.unite(imported[i]);
        } catch {
          // continue with next pair; bad geometry can fail boolean ops.
        }
      }

      if (!united || !united.exportSVG) {
        scope.remove();
        return;
      }

      const exported = united.exportSVG({ asString: false });
      if (!exported) {
        scope.remove();
        return;
      }

      groupNodes.forEach((node) => node.remove());
      stripStrokeRecursively(exported);
      setElementFill(exported, fill);
      loadedSvg.appendChild(exported);
      mergedCount += Math.max(0, groupNodes.length - 1);
      scope.remove();
    });
  });

  return mergedCount;
}

function cleanupOpenStrokeArtifacts(maxArea = Number(speckleAreaEl.value) * 4) {
  if (!loadedSvg) return 0;

  const areaLimit = Number.isFinite(maxArea) && maxArea > 0 ? maxArea : 2000;
  let removed = 0;

  [...loadedSvg.querySelectorAll(shapeSelector)].forEach((el) => {
    const tag = el.tagName.toLowerCase();

    // Remove lines and polylines
    if (tag === 'line' || tag === 'polyline') {
      el.remove();
      removed++;
      return;
    }

    const fillHex = toHexColor(getFill(el));
    const stroke = getStroke(el);

    const box = el.getBBox();
    const area = box.width * box.height;

    // Remove tiny fragments
    if (Number.isFinite(area) && area <= areaLimit) {
      el.remove();
      removed++;
      return;
    }

    // Remove open or invalid paths
    if (tag === 'path') {
      const d = (el.getAttribute('d') || '').trim();
      if (!d || pathHasOpenSubpath(d)) {
        el.remove();
        removed++;
        return;
      }
    }

    // Remove stroke-only leftovers
    if (!fillHex && stroke) {
      el.remove();
      removed++;
      return;
    }
  });

  return removed;
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
  svgStage.innerHTML = '';
  svgStage.appendChild(loadedSvg);
  undoBtn.disabled = history.length === 0;
  buildPalette();
  applyViewMode();
  setStatus(`Undo complete. Remaining steps: ${history.length}.`);
}

function downloadSvg() {
  if (!loadedSvg) return;
  const markup = new XMLSerializer().serializeToString(loadedSvg);
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = loadedFilename.replace(/\.svg$/i, '') + '-fixed.svg';
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
  svgStage.innerHTML = '';
  svgStage.appendChild(loadedSvg);
  loadedFilename = filename.toLowerCase().endsWith('.svg') ? filename : `${filename}.svg`;
  history = [];
  sourceColorMode = 'single';
  allColorsBtn.classList.remove('active');
  undoBtn.disabled = true;
  downloadBtn.disabled = false;
  buildPalette();
  applyViewMode();
  applyZoom();
  setStatus(`Loaded ${loadedFilename}. Brush to magic-fix selected areas.`);
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
  if (mode === 'pan' || isSpaceHeld) {
    startPan(event);
    return;
  }
  isDrawing = true;
  pushHistory(snapshot());
  applyBrush(event.clientX, event.clientY);
}

canvasWrap.addEventListener('mousemove', (event) => {
  if (!loadedSvg) return;
  updateBrushCursor(event);
  brushPreview.style.display = mode === 'brush' && !isSpaceHeld ? 'block' : 'none';

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

document.addEventListener('mouseup', () => {
  isDrawing = false;
  isPanning = false;
  canvasWrap.classList.remove('panning');
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

allColorsBtn.addEventListener('click', () => {
  sourceColorMode = sourceColorMode === 'all' ? 'single' : 'all';
  allColorsBtn.classList.toggle('active', sourceColorMode === 'all');
  if (sourceColorMode === 'all') {
    [...sourcePaletteEl.querySelectorAll('.swatch')].forEach((swatch) => swatch.classList.remove('active'));
  } else {
    renderSwatchSelection(sourcePaletteEl, selectedSourceColor);
  }
});

replaceColorEl.addEventListener('input', () => {
  selectedTargetColor = replaceColorEl.value;
  renderSwatchSelection(targetPaletteEl, selectedTargetColor);
});

brushSizeEl.addEventListener('input', applyZoom);
fileInput.addEventListener('change', () => handleFile(fileInput.files?.[0]));
modeBrushBtn.addEventListener('click', () => setMode('brush'));
modePanBtn.addEventListener('click', () => setMode('pan'));
viewFillsBtn.addEventListener('click', () => {
  viewMode = 'fills';
  applyViewMode();
});
viewStrokesBtn.addEventListener('click', () => {
  viewMode = 'strokes';
  applyViewMode();
});
undoBtn.addEventListener('click', undo);
downloadBtn.addEventListener('click', downloadSvg);

mergeBtn.addEventListener('click', () => {
  if (!loadedSvg) return;
  pushHistory(snapshot());
  const merged = mergeSameColorShapes();
  const removed1 = cleanupOpenStrokeArtifacts();
  const removed2 = cleanupOpenStrokeArtifacts();
  const removed = removed1 + removed2;
  buildPalette();
  setStatus(`Merge complete. United ${merged} overlap(s) and removed ${removed} open stroke artifact(s).`);
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

applyZoom();

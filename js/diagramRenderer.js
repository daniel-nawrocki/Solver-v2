import { relationshipColor } from "./relationshipManager.js";

function timingColor(value, min, max) {
  if (!Number.isFinite(value)) return "#64748b";
  if (max <= min) return "#0ea5e9";
  const t = (value - min) / (max - min);
  const hue = 210 - t * 210;
  return `hsl(${hue} 78% 46%)`;
}

function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  const px = start.x + t * dx;
  const py = start.y + t * dy;
  return Math.hypot(point.x - px, point.y - py);
}

function formatMetricValue(value, suffix) {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}${suffix}`;
}

function formatWholeNumber(value, suffix = "") {
  if (!Number.isFinite(value)) return null;
  return `${Math.round(value)}${suffix}`;
}

function angleColor(value) {
  switch (Math.round(value)) {
    case 5: return "#f59e0b";
    case 10: return "#22c55e";
    case 15: return "#eab308";
    case 20: return "#ef4444";
    case 25: return "#3b82f6";
    case 30: return "#ec4899";
    default: return "#52657c";
  }
}

function diagramAnnotationSizeConfig(size) {
  switch (size) {
    case "small":
      return { strokeWidth: 2, textSize: 14 };
    case "large":
      return { strokeWidth: 6, textSize: 28 };
    default:
      return { strokeWidth: 4, textSize: 20 };
  }
}

function formatDiameterLabel(value) {
  if (!Number.isFinite(Number(value))) return null;
  const numeric = Number(value);
  const whole = Math.trunc(numeric);
  if (Math.abs(numeric - whole) >= 0.49 && Math.abs(numeric - whole) <= 0.51) return `${whole} 1/2"`;
  return `${numeric}"`;
}

function canvasUiFont(sizePx, weight = 600) {
  return `${weight} ${sizePx}px "Trebuchet MS", "Segoe UI", sans-serif`;
}

function printHeaderTitleFont(sizePx) {
  return `700 ${sizePx}px Cambria, Georgia, "Times New Roman", serif`;
}

function printHeaderMetaFont(sizePx, weight = 600) {
  return `${weight} ${sizePx}px "Trebuchet MS", "Segoe UI", sans-serif`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class DiagramRenderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onHoleClick = options.onHoleClick || (() => {});
    this.onHoleHover = options.onHoleHover || (() => {});
    this.onPointerUp = options.onPointerUp || (() => {});
    this.onPointerDown = options.onPointerDown || (() => false);
    this.onPointerMove = options.onPointerMove || (() => false);
    this.onDoubleClick = options.onDoubleClick || (() => false);
    this.onHoleContextMenu = options.onHoleContextMenu || (() => {});
    this.onCanvasContextMenu = options.onCanvasContextMenu || (() => false);
    this.stateRef = options.stateRef;
    this.isPrintRenderer = options.isPrintRenderer === true;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.dragging = false;
    this.lastMouse = null;
    this.pointerScreen = null;
    this.holeRadius = 5;
    this.rotationDeg = 0;

    this.resize();
    this.attachEvents();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(400, Math.floor(rect.width));
    this.canvas.height = Math.max(300, Math.floor(rect.height));
    this.render();
  }

  textScale() {
    return Number(this.stateRef?.ui?.textScale) || 1;
  }

  isDiagramMode() {
    return this.stateRef?.ui?.workspaceMode === "diagram";
  }

  activeTimingPreview() {
    if (this.isDiagramMode()) return null;
    return this.stateRef.timingResults?.[this.stateRef.ui.activeTimingPreviewIndex] || null;
  }

  timingVisualization() {
    return this.stateRef?.ui?.timingVisualization || null;
  }

  diagramLabelSettings() {
    const ui = this.stateRef?.ui || {};
    return {
      showAngleLabels: ui.showAngleLabels !== false,
      showBearingLabels: ui.showBearingLabels !== false,
      showBearingArrows: ui.showBearingArrows === true,
      showDepthLabels: ui.showDepthLabels !== false,
    };
  }

  rotatePoint(x, y) {
    const theta = (this.rotationDeg * Math.PI) / 180;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    return { x: x * c - y * s, y: x * s + y * c };
  }

  inverseRotatePoint(x, y) {
    const theta = (-this.rotationDeg * Math.PI) / 180;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    return { x: x * c - y * s, y: x * s + y * c };
  }

  worldToScreen(x, y) {
    const rotated = this.rotatePoint(x, y);
    return {
      x: rotated.x * this.zoom + this.panX,
      y: this.canvas.height - (rotated.y * this.zoom + this.panY),
    };
  }

  screenToWorld(x, y) {
    const xr = (x - this.panX) / this.zoom;
    const yr = (this.canvas.height - y - this.panY) / this.zoom;
    return this.inverseRotatePoint(xr, yr);
  }

  fitToData(options = {}) {
    const holes = this.stateRef.holes;
    if (!holes.length) return;
    const rotated = holes.map((hole) => this.rotatePoint(hole.x, hole.y));
    const xs = rotated.map((hole) => hole.x);
    const ys = rotated.map((hole) => hole.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const marginTop = Number.isFinite(options.marginTop) ? options.marginTop : 40;
    const marginRight = Number.isFinite(options.marginRight) ? options.marginRight : 40;
    const marginBottom = Number.isFinite(options.marginBottom) ? options.marginBottom : 40;
    const marginLeft = Number.isFinite(options.marginLeft) ? options.marginLeft : 40;
    const availableWidth = Math.max(80, this.canvas.width - marginLeft - marginRight);
    const availableHeight = Math.max(80, this.canvas.height - marginTop - marginBottom);
    this.zoom = Math.max(0.02, Math.min(availableWidth / width, availableHeight / height));
    const contentWidth = width * this.zoom;
    const contentHeight = height * this.zoom;
    const offsetX = marginLeft + ((availableWidth - contentWidth) / 2);
    const offsetY = marginBottom + ((availableHeight - contentHeight) / 2);
    this.panX = offsetX - (minX * this.zoom);
    this.panY = offsetY - (minY * this.zoom);
    this.render();
  }

  drawGrid() {
    if (!this.stateRef.ui.showGrid) return;
    const stepPx = 50;
    this.ctx.save();
    this.ctx.strokeStyle = "#edf2f7";
    this.ctx.lineWidth = 1;
    for (let x = this.panX % stepPx; x < this.canvas.width; x += stepPx) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.canvas.height);
      this.ctx.stroke();
    }
    for (let y = this.panY % stepPx; y < this.canvas.height; y += stepPx) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.canvas.width, y);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  drawNorthArrow() {
    const x = this.canvas.width - 50;
    const y = this.isPrintRenderer && this.isDiagramMode() ? 146 : 65;
    const theta = (this.rotationDeg * Math.PI) / 180;
    const ux = Math.sin(theta);
    const uy = -Math.cos(theta);
    const tx = x + ux * 20;
    const ty = y + uy * 20;
    const bx = x - ux * 20;
    const by = y - uy * 20;
    const nx = x + ux * 28;
    const ny = y + uy * 28;
    this.ctx.save();
    this.ctx.fillStyle = "#0f172a";
    this.ctx.strokeStyle = "#0f172a";
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(nx, ny);
    this.ctx.lineTo(tx - uy * 6, ty + ux * 6);
    this.ctx.lineTo(tx + uy * 6, ty - ux * 6);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.beginPath();
    this.ctx.moveTo(tx, ty);
    this.ctx.lineTo(bx, by);
    this.ctx.stroke();
    this.ctx.font = canvasUiFont(Math.max(10, Math.round(13 * this.textScale())), 700);
    this.ctx.fillText("N", nx - 5, ny - 8);
    this.ctx.restore();
  }

  drawArrow(start, end, color, dashed = false) {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const head = 10;
    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.fillStyle = color;
    this.ctx.lineWidth = 2;
    if (dashed) this.ctx.setLineDash([6, 4]);
    this.ctx.beginPath();
    this.ctx.moveTo(start.x, start.y);
    this.ctx.lineTo(end.x, end.y);
    this.ctx.stroke();
    this.ctx.setLineDash([]);
    this.ctx.beginPath();
    this.ctx.moveTo(end.x, end.y);
    this.ctx.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
    this.ctx.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.restore();
  }

  drawRelationships() {
    if (this.isDiagramMode()) return;
    if (this.stateRef.ui.showRelationships === false) return;
    const edges = this.stateRef.relationships?.edges || [];
    edges.forEach((edge) => {
      const fromHole = this.stateRef.holesById.get(edge.fromHoleId);
      const toHole = this.stateRef.holesById.get(edge.toHoleId);
      if (!fromHole || !toHole) return;
      const start = this.worldToScreen(fromHole.x, fromHole.y);
      const end = this.worldToScreen(toHole.x, toHole.y);
      this.drawArrow(start, end, relationshipColor(edge.type));
    });
  }

  drawRelationshipDraft() {
    if (this.isDiagramMode()) return;
    if (this.stateRef.ui.showRelationships === false) return;
    const draft = this.stateRef.ui.relationshipDraft;
    if (!draft?.holeIds?.length) return;
    const points = draft.holeIds
      .map((holeId) => this.stateRef.holesById.get(holeId))
      .filter(Boolean)
      .map((hole) => this.worldToScreen(hole.x, hole.y));
    if (!points.length) return;
    if (this.pointerScreen && draft.type !== "offset") points.push(this.pointerScreen);
    if (draft.type === "offset" && draft.holeIds.length === 1 && this.pointerScreen) points.push(this.pointerScreen);
    if (points.length < 2) return;

    this.ctx.save();
    this.ctx.strokeStyle = relationshipColor(draft.type || "holeToHole");
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([6, 4]);
    this.ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) this.ctx.moveTo(point.x, point.y);
      else this.ctx.lineTo(point.x, point.y);
    });
    this.ctx.stroke();
    this.ctx.restore();
  }

  diagramMetadataLines(hole) {
    const settings = this.diagramLabelSettings();
    const lines = [];
    if (settings.showAngleLabels) {
      const angleText = formatWholeNumber(hole.angle, "°");
      if (angleText) lines.push({ text: angleText, color: angleColor(hole.angle) });
    }
    if (settings.showBearingLabels) {
      const bearingText = formatWholeNumber(hole.bearing, "°");
      if (bearingText) lines.push({ text: bearingText, color: "#52657c" });
    }
    if (settings.showDepthLabels) {
      const depthText = formatWholeNumber(hole.depth, "'");
      if (depthText) lines.push({ text: depthText, color: "#52657c" });
    }
    return lines;
  }

  drawBearingArrows() {
    if (!this.isDiagramMode()) return;
    const settings = this.diagramLabelSettings();
    if (!settings.showBearingArrows) return;
    const weightScale = this.isPrintRenderer ? Math.max(1, Math.min(3, Number(this.stateRef?.ui?.bearingArrowWeight) || 1)) : 1;

    this.ctx.save();
    this.ctx.strokeStyle = "rgba(61, 79, 102, 0.45)";
    this.ctx.fillStyle = "rgba(61, 79, 102, 0.45)";
    this.ctx.lineWidth = 1.2 * weightScale;

    for (const hole of this.stateRef.holes) {
      if (!Number.isFinite(hole.bearing)) continue;
      if (!Number.isFinite(hole.angle) || Number(hole.angle) === 0) continue;
      const start = this.worldToScreen(hole.x, hole.y);
      const length = 16;
      const radians = ((Math.round(hole.bearing) - this.rotationDeg - 90) * Math.PI) / 180;
      const end = {
        x: start.x + (Math.cos(radians) * length),
        y: start.y + (Math.sin(radians) * length),
      };
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const head = 4 * weightScale;

      this.ctx.beginPath();
      this.ctx.moveTo(start.x, start.y);
      this.ctx.lineTo(end.x, end.y);
      this.ctx.stroke();

      this.ctx.beginPath();
      this.ctx.moveTo(end.x, end.y);
      this.ctx.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
      this.ctx.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
      this.ctx.closePath();
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  drawSelectionOverlays() {
    if (!this.isDiagramMode()) return;
    const boxDraft = this.stateRef?.ui?.selectionBoxDraft;
    const polygonDraft = this.stateRef?.ui?.selectionPolygonDraft;

    if (boxDraft?.start && boxDraft?.current) {
      const x = Math.min(boxDraft.start.x, boxDraft.current.x);
      const y = Math.min(boxDraft.start.y, boxDraft.current.y);
      const width = Math.abs(boxDraft.current.x - boxDraft.start.x);
      const height = Math.abs(boxDraft.current.y - boxDraft.start.y);
      this.ctx.save();
      this.ctx.strokeStyle = "rgba(47, 125, 246, 0.8)";
      this.ctx.fillStyle = "rgba(47, 125, 246, 0.12)";
      this.ctx.lineWidth = 1.5;
      this.ctx.setLineDash([6, 4]);
      this.ctx.fillRect(x, y, width, height);
      this.ctx.strokeRect(x, y, width, height);
      this.ctx.restore();
    }

    if (polygonDraft?.points?.length) {
      const points = [...polygonDraft.points];
      if (polygonDraft.hoverPoint) points.push(polygonDraft.hoverPoint);
      this.ctx.save();
      this.ctx.strokeStyle = "rgba(47, 125, 246, 0.8)";
      this.ctx.fillStyle = "rgba(47, 125, 246, 0.10)";
      this.ctx.lineWidth = 1.5;
      this.ctx.setLineDash([6, 4]);
      this.ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) this.ctx.moveTo(point.x, point.y);
        else this.ctx.lineTo(point.x, point.y);
      });
      this.ctx.stroke();
      if (polygonDraft.points.length >= 3) {
        this.ctx.beginPath();
        polygonDraft.points.forEach((point, index) => {
          if (index === 0) this.ctx.moveTo(point.x, point.y);
          else this.ctx.lineTo(point.x, point.y);
        });
        this.ctx.closePath();
        this.ctx.fill();
      }
      this.ctx.setLineDash([]);
      polygonDraft.points.forEach((point) => {
        this.ctx.beginPath();
        this.ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
        this.ctx.fillStyle = "rgba(47, 125, 246, 0.95)";
        this.ctx.fill();
      });
      this.ctx.restore();
    }
  }

  drawDiagramAnnotations() {
    if (!this.isDiagramMode()) return;

    const strokes = this.stateRef.annotations?.strokes || [];
    const draft = this.stateRef.ui?.currentStrokeDraft || null;
    const strokeItems = draft ? [...strokes, draft] : strokes;

    strokeItems.forEach((stroke) => {
      if (!stroke?.points?.length || stroke.points.length < 2) return;
      const size = diagramAnnotationSizeConfig(stroke.size);
      this.ctx.save();
      this.ctx.strokeStyle = stroke.color || "#000000";
      this.ctx.lineWidth = size.strokeWidth;
      this.ctx.lineCap = "round";
      this.ctx.lineJoin = "round";
      this.ctx.beginPath();
      stroke.points.forEach((point, index) => {
        const screenPoint = this.worldToScreen(point.x, point.y);
        if (index === 0) this.ctx.moveTo(screenPoint.x, screenPoint.y);
        else this.ctx.lineTo(screenPoint.x, screenPoint.y);
      });
      this.ctx.stroke();
      this.ctx.restore();
    });

    (this.stateRef.annotations?.texts || []).forEach((item) => {
      if (!item?.text || !item.anchor) return;
      const size = diagramAnnotationSizeConfig(item.size);
      const anchor = this.worldToScreen(item.anchor.x, item.anchor.y);
      this.ctx.save();
      this.ctx.fillStyle = item.color || "#000000";
      this.ctx.font = canvasUiFont(Math.max(10, Math.round(size.textSize * this.textScale())), 700);
      this.ctx.textBaseline = "alphabetic";
      this.ctx.fillText(item.text, anchor.x, anchor.y);
      this.ctx.restore();
    });
  }

  isDiagramPrintMode() {
    return this.isPrintRenderer && this.isDiagramMode();
  }

  diagramPrintLabelLines(hole) {
    if (!this.isDiagramPrintMode()) return [];
    const settings = this.diagramLabelSettings();
    const lines = [{ text: hole.holeNumber || hole.id, color: "#111827", weight: 700, size: Math.max(9, Math.round(11 * this.textScale())) }];
    if (settings.showAngleLabels) {
      const angleText = formatWholeNumber(hole.angle, "°");
      if (angleText) lines.push({ text: angleText, color: angleColor(hole.angle), weight: 700, size: Math.max(8, Math.round(10 * this.textScale())) });
    }
    if (settings.showBearingLabels) {
      const bearingText = formatWholeNumber(hole.bearing, "°");
      if (bearingText) lines.push({ text: bearingText, color: "#52657c", weight: 700, size: Math.max(8, Math.round(10 * this.textScale())) });
    }
    if (settings.showDepthLabels) {
      const depthText = formatWholeNumber(hole.depth, "'");
      if (depthText) lines.push({ text: depthText, color: "#52657c", weight: 700, size: Math.max(8, Math.round(10 * this.textScale())) });
    }
    return lines;
  }

  measureDiagramPrintLabel(lines) {
    const paddingX = 7;
    const paddingY = 6;
    const gap = 2;
    this.ctx.save();
    let maxWidth = 0;
    let totalHeight = paddingY * 2;
    lines.forEach((line, index) => {
      this.ctx.font = canvasUiFont(line.size, line.weight);
      maxWidth = Math.max(maxWidth, this.ctx.measureText(line.text).width);
      totalHeight += line.size;
      if (index < lines.length - 1) totalHeight += gap;
    });
    this.ctx.restore();
    return {
      width: Math.ceil(maxWidth + paddingX * 2),
      height: Math.ceil(totalHeight),
      paddingX,
      paddingY,
      gap,
    };
  }

  getDiagramPrintLabelLayout(hole, { ignoreOffset = false } = {}) {
    const point = this.worldToScreen(hole.x, hole.y);
    const lines = this.diagramPrintLabelLines(hole);
    const metrics = this.measureDiagramPrintLabel(lines);
    const defaultRect = {
      left: point.x + 8,
      top: point.y - (metrics.paddingY + Math.max(10, Math.round(11 * this.textScale())) + 2),
      width: metrics.width,
      height: metrics.height,
    };
    const offset = !ignoreOffset ? this.stateRef?.labelLayoutByHoleId?.get(hole.id) : null;
    const rect = {
      left: defaultRect.left + (offset?.offsetX || 0),
      top: defaultRect.top + (offset?.offsetY || 0),
      width: defaultRect.width,
      height: defaultRect.height,
    };
    return {
      hole,
      point,
      lines,
      metrics,
      defaultRect,
      rect,
    };
  }

  findDiagramPrintLabelAtScreen(x, y) {
    if (!this.isDiagramPrintMode()) return null;
    for (let index = this.stateRef.holes.length - 1; index >= 0; index -= 1) {
      const hole = this.stateRef.holes[index];
      const layout = this.getDiagramPrintLabelLayout(hole);
      const { rect } = layout;
      if (x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height) return layout;
    }
    return null;
  }

  drawDiagramPrintLabelLeader(layout) {
    const { point, rect } = layout;
    const nearest = {
      x: clamp(point.x, rect.left, rect.left + rect.width),
      y: clamp(point.y, rect.top, rect.top + rect.height),
    };
    const distance = Math.hypot(point.x - nearest.x, point.y - nearest.y);
    if (distance <= 26) return;
    this.ctx.save();
    this.ctx.strokeStyle = "rgba(82, 101, 124, 0.55)";
    this.ctx.lineWidth = 1.1;
    this.ctx.beginPath();
    this.ctx.moveTo(point.x, point.y);
    this.ctx.lineTo(nearest.x, nearest.y);
    this.ctx.stroke();
    this.ctx.restore();
  }

  drawDiagramPrintLabelBox(layout) {
    const { hole, rect, lines, metrics } = layout;
    const isHovered = this.stateRef?.ui?.hoverLabelHoleId === hole.id;
    const isDragging = this.stateRef?.dragLabelHoleId === hole.id;
    if (this.stateRef?.ui?.showPrintLabelBoxes !== false) {
      this.ctx.save();
      this.ctx.shadowColor = "rgba(15, 23, 42, 0.10)";
      this.ctx.shadowBlur = isDragging ? 12 : 8;
      this.ctx.shadowOffsetY = 2;
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
      this.ctx.strokeStyle = isDragging ? "rgba(47, 125, 246, 0.72)" : isHovered ? "rgba(71, 85, 105, 0.55)" : "rgba(203, 213, 225, 0.95)";
      this.ctx.lineWidth = isDragging ? 1.8 : isHovered ? 1.4 : 1;
      this.ctx.beginPath();
      this.ctx.roundRect(rect.left, rect.top, rect.width, rect.height, 8);
      this.ctx.fill();
      this.ctx.stroke();
      this.ctx.restore();
    }

    this.drawDiagramPrintLabelLeader(layout);

    this.ctx.save();
    let y = rect.top + metrics.paddingY;
    lines.forEach((line, index) => {
      this.ctx.fillStyle = line.color;
      this.ctx.font = canvasUiFont(line.size, line.weight);
      y += line.size;
      this.ctx.fillText(line.text, rect.left + metrics.paddingX, y);
      if (index < lines.length - 1) y += metrics.gap;
    });
    this.ctx.restore();
  }

  drawDiagramPrintLabels() {
    if (!this.isDiagramPrintMode()) return;
    this.stateRef.holes.forEach((hole) => {
      const layout = this.getDiagramPrintLabelLayout(hole);
      if (layout.lines.length) this.drawDiagramPrintLabelBox(layout);
    });
  }

  drawHoles(preview) {
    const times = preview ? this.stateRef.holes.map((hole) => preview.holeTimes.get(hole.id)).filter((v) => Number.isFinite(v)) : [];
    const minT = times.length ? Math.min(...times) : 0;
    const maxT = times.length ? Math.max(...times) : 0;
    const originHoleId = this.stateRef.relationships?.originHoleId || null;
    const diagramMode = this.isDiagramMode();

    for (const hole of this.stateRef.holes) {
      const point = this.worldToScreen(hole.x, hole.y);
      const selected = this.stateRef.selection.has(hole.id);
      const isOrigin = !diagramMode && hole.id === originHoleId;
      const time = preview ? preview.holeTimes.get(hole.id) : null;
      this.ctx.beginPath();
      this.ctx.arc(point.x, point.y, this.holeRadius, 0, Math.PI * 2);
      this.ctx.fillStyle = preview ? timingColor(time, minT, maxT) : diagramMode ? "#3c4f66" : "#475569";
      this.ctx.fill();
      this.ctx.lineWidth = isOrigin ? 4 : selected ? 3 : 1;
      this.ctx.strokeStyle = isOrigin ? "#f59e0b" : selected ? "#0f172a" : "#dbe4ee";
      this.ctx.stroke();

      if (isOrigin) {
        this.ctx.beginPath();
        this.ctx.arc(point.x, point.y, this.holeRadius + 6, 0, Math.PI * 2);
        this.ctx.strokeStyle = "rgba(245, 158, 11, 0.55)";
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
      }

      if (!this.isDiagramPrintMode()) {
        const label = hole.holeNumber || hole.id;
        this.ctx.fillStyle = "#111827";
        const labelSize = Math.max(9, Math.round(11 * this.textScale()));
        this.ctx.font = canvasUiFont(labelSize, selected || isOrigin ? 700 : 600);
        this.ctx.fillText(label, point.x + 8, point.y - 6);
      }

      if (diagramMode && !this.isDiagramPrintMode()) {
        const metadataLines = this.diagramMetadataLines(hole);
        if (metadataLines.length) {
          this.ctx.font = canvasUiFont(Math.max(8, Math.round(10 * this.textScale())), 700);
          metadataLines.forEach((line, index) => {
            this.ctx.fillStyle = line.color || "#52657c";
            this.ctx.fillText(line.text, point.x + 8, point.y + 9 + (index * 12));
          });
        }
      } else if (!diagramMode && preview && Number.isFinite(time)) {
        this.ctx.fillStyle = "#334155";
        this.ctx.font = canvasUiFont(Math.max(8, Math.round(10 * this.textScale())), 600);
        this.ctx.fillText(`${time.toFixed(0)}ms`, point.x + 8, point.y + 8);
      }
    }
  }

  drawTimingVisualization(preview) {
    const playback = this.timingVisualization();
    if (!preview || !playback?.isPlaying) return;
    if (playback.resultIndexAtStart !== this.stateRef.ui.activeTimingPreviewIndex) return;
    const elapsedMs = Number(playback.elapsedMs);
    if (!Number.isFinite(elapsedMs)) return;

    const pulseWindowMs = 120;
    this.ctx.save();
    for (const hole of this.stateRef.holes) {
      const holeTime = preview.holeTimes.get(hole.id);
      if (!Number.isFinite(holeTime)) continue;
      const delta = elapsedMs - holeTime;
      if (delta < 0 || delta > pulseWindowMs) continue;

      const point = this.worldToScreen(hole.x, hole.y);
      const progress = delta / pulseWindowMs;
      const alpha = 1 - progress;
      const ringRadius = this.holeRadius + 6 + (progress * 18);

      this.ctx.globalAlpha = 0.42 * alpha;
      this.ctx.fillStyle = "#f59e0b";
      this.ctx.beginPath();
      this.ctx.arc(point.x, point.y, this.holeRadius + 2 + (progress * 8), 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.globalAlpha = 0.95 * alpha;
      this.ctx.strokeStyle = "#f97316";
      this.ctx.lineWidth = 3;
      this.ctx.beginPath();
      this.ctx.arc(point.x, point.y, ringRadius, 0, Math.PI * 2);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  drawTimingPreviewInfo(preview) {
    if (!preview || this.isDiagramMode()) return;
    const topOverlayOffset = 92;
    this.ctx.save();
    this.ctx.fillStyle = "#0f172a";
    this.ctx.font = `${Math.max(10, Math.round(12 * this.textScale()))}px Segoe UI`;
    this.ctx.fillText(
      `Timing Preview: H2H ${preview.holeDelay}ms | R2R ${preview.rowDelay}ms | Peak(8ms): ${preview.density8ms}`,
      14,
      topOverlayOffset
    );
    this.ctx.restore();
  }

  drawDiagramPrintHeader() {
    if (!this.isPrintRenderer || !this.isDiagramMode()) return;
    const metadata = this.stateRef.metadata || {};
    const shotNumber = metadata.shotNumber || "Shot Number";
    const leftLines = [
      metadata.location ? `Location: ${metadata.location}` : null,
      metadata.bench ? `Bench: ${metadata.bench}` : null,
    ].filter(Boolean);
    const rightLines = [
      Number.isFinite(Number(metadata.defaultDiameter)) ? `Hole Diameter: ${formatDiameterLabel(metadata.defaultDiameter)}` : null,
      metadata.facePattern ? `Face Pattern: ${metadata.facePattern}` : null,
      metadata.interiorPattern ? `Interior Pattern: ${metadata.interiorPattern}` : null,
    ].filter(Boolean);

    this.ctx.save();
    this.ctx.fillStyle = "#0f172a";
    this.ctx.font = printHeaderTitleFont(34);
    this.ctx.fillText(shotNumber, 28, 44);
    this.ctx.strokeStyle = "rgba(51, 65, 85, 0.30)";
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.moveTo(28, 54);
    this.ctx.lineTo(170, 54);
    this.ctx.stroke();

    this.ctx.font = printHeaderMetaFont(13, 600);
    leftLines.forEach((line, index) => {
      this.ctx.fillText(line, 30, 72 + (index * 19));
    });

    this.ctx.textAlign = "right";
    rightLines.forEach((line, index) => {
      this.ctx.fillText(line, this.canvas.width - 30, 58 + (index * 19));
    });
    this.ctx.textAlign = "left";
    this.ctx.restore();
  }

  render() {
    const preview = this.activeTimingPreview();
    this.clear();
    this.drawGrid();
    this.drawRelationships();
    this.drawRelationshipDraft();
    this.drawBearingArrows();
    this.drawHoles(preview);
    this.drawDiagramAnnotations();
    this.drawDiagramPrintLabels();
    this.drawSelectionOverlays();
    if (!this.isDiagramMode()) this.drawTimingVisualization(preview);
    this.drawNorthArrow();
    this.drawDiagramPrintHeader();
    if (this.stateRef.ui.showOverlayText !== false) this.drawTimingPreviewInfo(preview);
  }

  rotateBy(deltaDeg) {
    this.setRotation(this.rotationDeg + deltaDeg);
  }

  setRotation(deg) {
    if (!Number.isFinite(deg)) return;
    this.rotationDeg = ((deg % 360) + 360) % 360;
    if (this.rotationDeg > 180) this.rotationDeg -= 360;
    this.render();
  }

  resetRotation() {
    this.setRotation(0);
  }

  findHoleAtScreen(x, y) {
    for (const hole of this.stateRef.holes) {
      const point = this.worldToScreen(hole.x, hole.y);
      if (Math.hypot(x - point.x, y - point.y) <= this.holeRadius + 4) return hole;
    }
    return null;
  }

  findRelationshipAtScreen(x, y) {
    const point = { x, y };
    return (this.stateRef.relationships?.edges || []).find((edge) => {
      const fromHole = this.stateRef.holesById.get(edge.fromHoleId);
      const toHole = this.stateRef.holesById.get(edge.toHoleId);
      if (!fromHole || !toHole) return false;
      const start = this.worldToScreen(fromHole.x, fromHole.y);
      const end = this.worldToScreen(toHole.x, toHole.y);
      return pointToSegmentDistance(point, start, end) <= 8;
    }) || null;
  }

  attachEvents() {
    this.canvas.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      this.pointerScreen = { x, y };
      const downHandled = this.onPointerDown({ x, y, event, hole: this.findHoleAtScreen(x, y) });
      if (downHandled) return;
      const hole = this.findHoleAtScreen(x, y);
      if (hole) {
        this.onHoleClick(hole, event);
        return;
      }
      this.dragging = true;
      this.lastMouse = { x: event.clientX, y: event.clientY };
    });

    window.addEventListener("mousemove", (event) => {
      const rect = this.canvas.getBoundingClientRect();
      this.pointerScreen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const moveHandled = this.onPointerMove({ x: this.pointerScreen.x, y: this.pointerScreen.y, event, hole: this.findHoleAtScreen(this.pointerScreen.x, this.pointerScreen.y) });
      if (moveHandled) return;
      const hoverHole = this.findHoleAtScreen(this.pointerScreen.x, this.pointerScreen.y);
      if ((event.buttons & 1) === 1 && hoverHole) this.onHoleHover(hoverHole, event);
      if (!this.dragging || !this.lastMouse) {
        if (this.stateRef.ui.relationshipDraft?.holeIds?.length) this.render();
        return;
      }
      const dx = event.clientX - this.lastMouse.x;
      const dy = event.clientY - this.lastMouse.y;
      this.panX += dx;
      this.panY -= dy;
      this.lastMouse = { x: event.clientX, y: event.clientY };
      this.render();
    });

    window.addEventListener("mouseup", (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      this.pointerScreen = { x, y };
      this.dragging = false;
      this.lastMouse = null;
      const upHandled = this.onPointerUp({ hole: this.findHoleAtScreen(x, y), event, x, y });
      if (upHandled) return;
    });

    this.canvas.addEventListener("dblclick", (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      this.pointerScreen = { x, y };
      const handled = this.onDoubleClick({ x, y, event, hole: this.findHoleAtScreen(x, y) });
      if (handled) event.preventDefault();
    });

    this.canvas.addEventListener("contextmenu", (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const hole = this.findHoleAtScreen(x, y);
      if (hole) {
        const handled = this.onHoleContextMenu(hole, event, { x, y });
        if (handled !== false) event.preventDefault();
        return;
      }
      const canvasHandled = this.onCanvasContextMenu({ x, y, event, hole: null });
      if (canvasHandled) {
        event.preventDefault();
        return;
      }
      const relationship = this.findRelationshipAtScreen(x, y);
      if (relationship) event.preventDefault();
    });

    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      if (event.ctrlKey) {
        this.rotateBy(event.deltaY < 0 ? 1 : -1);
        return;
      }
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      const before = this.screenToWorld(mouseX, mouseY);
      this.zoom = Math.max(0.01, Math.min(300, this.zoom * (event.deltaY < 0 ? 1.1 : 0.9)));
      const after = this.screenToWorld(mouseX, mouseY);
      this.panX += (after.x - before.x) * this.zoom;
      this.panY += (after.y - before.y) * this.zoom;
      this.render();
    }, { passive: false });
  }
}

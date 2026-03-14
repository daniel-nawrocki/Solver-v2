import { parseCsvText, buildHolesFromMapping } from "./csvParser.js";
import { DiagramRenderer } from "./diagramRenderer.js";
import { initTimingControls } from "./timingControls.js";
import { solveTimingCombinations, formatTimingResult, validateTimingGraph } from "./timingSolver.js";
import {
  addRelationship,
  clearRelationships,
  deleteRelationship,
  describeRelationship,
  ensureRelationshipState,
  relationToolLabel,
  setOriginHole,
  updateRelationship,
} from "./relationshipManager.js";

const TOOL_TO_RELATIONSHIP_TYPE = {
  holeRelationshipPositive: "holeToHole",
  holeRelationshipNegative: "holeToHole",
  rowRelationshipPositive: "rowToRow",
  rowRelationshipNegative: "rowToRow",
  offsetRelationship: "offset",
};

const TOOL_TO_SIGN = {
  holeRelationshipPositive: 1,
  holeRelationshipNegative: -1,
  rowRelationshipPositive: 1,
  rowRelationshipNegative: -1,
};

const TIMING_VISUALIZATION_PULSE_WINDOW_MS = 120;
const TIMING_VISUALIZATION_TAIL_MS = 1000;
const WORKSPACE_TITLES = {
  home: "Home",
  delaySolver: "Delay Solver",
  diagramMaker: "Diagram Maker",
};
const DIAGRAM_FIELDS = ["burden", "spacing", "diameter", "angle", "bearing", "depth", "stemHeight"];

const appUi = { activeWorkspace: "home" };

function createSolverState() {
  return {
    holes: [],
    holesById: new Map(),
    selection: new Set(),
    ui: {
      workspaceMode: "solver",
      showGrid: true,
      showRelationships: true,
      showOverlayText: true,
      toolMode: "origin",
      coordView: "collar",
      activeTimingPreviewIndex: -1,
      relationshipDraft: null,
      timingVisualization: {
        speedMultiplier: 1,
        activeSpeedMultiplier: 1,
        isPlaying: false,
        startTimestamp: 0,
        lastFrameTimestamp: 0,
        tailStartTimestamp: 0,
        elapsedMs: 0,
        completed: false,
        resultIndexAtStart: -1,
        frameRequestId: null,
      },
    },
    timing: {
      holeToHole: { min: 16, max: 34 },
      rowToRow: { min: 84, max: 142 },
      offset: { min: 17, max: 42 },
    },
    relationships: { originHoleId: null, edges: [], nextId: 1 },
    csvCache: null,
    timingResults: [],
    solverMessage: "",
  };
}

function createDiagramState() {
  return {
    holes: [],
    holesById: new Map(),
    selection: new Set(),
    ui: {
      workspaceMode: "diagram",
      showGrid: true,
      showRelationships: false,
      showOverlayText: false,
      coordView: "collar",
      showAngleLabels: true,
      showDepthLabels: true,
    },
    csvCache: null,
  };
}

function createPrintState() {
  return {
    holes: [],
    holesById: new Map(),
    selection: new Set(),
    ui: {
      workspaceMode: "solver",
      showGrid: false,
      showRelationships: true,
      showOverlayText: true,
      activeTimingPreviewIndex: 0,
      relationshipDraft: null,
      textScale: 1,
      orientation: "landscape",
      showAngleLabels: true,
      showDepthLabels: true,
    },
    relationships: { originHoleId: null, edges: [], nextId: 1 },
    timingResults: [],
  };
}

const solverState = createSolverState();
const diagramState = createDiagramState();
const printState = createPrintState();

const els = {
  homeWorkspace: document.getElementById("homeWorkspace"),
  delaySolverWorkspace: document.getElementById("delaySolverWorkspace"),
  diagramMakerWorkspace: document.getElementById("diagramMakerWorkspace"),
  workspaceTitle: document.getElementById("workspaceTitle"),
  homeNavBtn: document.getElementById("homeNavBtn"),
  openDelaySolverBtn: document.getElementById("openDelaySolverBtn"),
  openDiagramMakerBtn: document.getElementById("openDiagramMakerBtn"),
  helpBtn: document.getElementById("helpBtn"),
  csvExportBtn: document.getElementById("csvExportBtn"),
  exportPdfBtn: document.getElementById("exportPdfBtn"),
  timingVisualizationControls: document.getElementById("timingVisualizationControls"),
  timingVisualizationBtn: document.getElementById("timingVisualizationBtn"),
  timingVisualizationSpeed: document.getElementById("timingVisualizationSpeed"),
  timingVisualizationStatus: document.getElementById("timingVisualizationStatus"),
  menuToggles: [...document.querySelectorAll("[data-menu-toggle]")],
  menuPanels: [...document.querySelectorAll(".menu-panel")],
  csvInput: document.getElementById("csvInput"),
  mappingPanel: document.getElementById("mappingPanel"),
  coordTypeSelect: document.getElementById("coordTypeSelect"),
  xColumnSelect: document.getElementById("xColumnSelect"),
  yColumnSelect: document.getElementById("yColumnSelect"),
  toeXColumnSelect: document.getElementById("toeXColumnSelect"),
  toeYColumnSelect: document.getElementById("toeYColumnSelect"),
  idColumnSelect: document.getElementById("idColumnSelect"),
  importMappedBtn: document.getElementById("importMappedBtn"),
  gridToggle: document.getElementById("gridToggle"),
  relationshipVisibilityToggle: document.getElementById("relationshipVisibilityToggle"),
  relationshipVisibilityToggleSecondary: document.getElementById("relationshipVisibilityToggleSecondary"),
  fitViewBtn: document.getElementById("fitViewBtn"),
  coordViewSelect: document.getElementById("coordViewSelect"),
  rotateLeftBtn: document.getElementById("rotateLeftBtn"),
  rotateRightBtn: document.getElementById("rotateRightBtn"),
  rotateFineLeftBtn: document.getElementById("rotateFineLeftBtn"),
  rotateFineRightBtn: document.getElementById("rotateFineRightBtn"),
  rotateResetBtn: document.getElementById("rotateResetBtn"),
  originStatus: document.getElementById("originStatus"),
  toolModeStatus: document.getElementById("toolModeStatus"),
  clearRelationshipsBtn: document.getElementById("clearRelationshipsBtn"),
  clearOriginBtn: document.getElementById("clearOriginBtn"),
  relationshipList: document.getElementById("relationshipList"),
  holeDelayMin: document.getElementById("holeDelayMinInput"),
  holeDelayMax: document.getElementById("holeDelayMaxInput"),
  rowDelayMin: document.getElementById("rowDelayMinInput"),
  rowDelayMax: document.getElementById("rowDelayMaxInput"),
  offsetDelayMin: document.getElementById("offsetDelayMinInput"),
  offsetDelayMax: document.getElementById("offsetDelayMaxInput"),
  solveTimingBtn: document.getElementById("solveTimingBtn"),
  timingResults: document.getElementById("timingResults"),
  timingResultsMenuWrap: document.getElementById("timingResultsMenuWrap"),
  originToolBtn: document.getElementById("originToolBtn"),
  holeRelationPositiveToolBtn: document.getElementById("holeRelationPositiveToolBtn"),
  holeRelationNegativeToolBtn: document.getElementById("holeRelationNegativeToolBtn"),
  rowRelationPositiveToolBtn: document.getElementById("rowRelationPositiveToolBtn"),
  rowRelationNegativeToolBtn: document.getElementById("rowRelationNegativeToolBtn"),
  offsetRelationToolBtn: document.getElementById("offsetRelationToolBtn"),
  diagramCsvInput: document.getElementById("diagramCsvInput"),
  diagramMappingPanel: document.getElementById("diagramMappingPanel"),
  diagramCoordTypeSelect: document.getElementById("diagramCoordTypeSelect"),
  diagramXColumnSelect: document.getElementById("diagramXColumnSelect"),
  diagramYColumnSelect: document.getElementById("diagramYColumnSelect"),
  diagramToeXColumnSelect: document.getElementById("diagramToeXColumnSelect"),
  diagramToeYColumnSelect: document.getElementById("diagramToeYColumnSelect"),
  diagramIdColumnSelect: document.getElementById("diagramIdColumnSelect"),
  diagramAngleColumnSelect: document.getElementById("diagramAngleColumnSelect"),
  diagramBearingColumnSelect: document.getElementById("diagramBearingColumnSelect"),
  diagramDepthColumnSelect: document.getElementById("diagramDepthColumnSelect"),
  diagramImportMappedBtn: document.getElementById("diagramImportMappedBtn"),
  diagramGridToggle: document.getElementById("diagramGridToggle"),
  diagramAngleLabelToggle: document.getElementById("diagramAngleLabelToggle"),
  diagramDepthLabelToggle: document.getElementById("diagramDepthLabelToggle"),
  diagramFitViewBtn: document.getElementById("diagramFitViewBtn"),
  diagramCoordViewSelect: document.getElementById("diagramCoordViewSelect"),
  diagramRotateLeftBtn: document.getElementById("diagramRotateLeftBtn"),
  diagramRotateRightBtn: document.getElementById("diagramRotateRightBtn"),
  diagramRotateFineLeftBtn: document.getElementById("diagramRotateFineLeftBtn"),
  diagramRotateFineRightBtn: document.getElementById("diagramRotateFineRightBtn"),
  diagramRotateResetBtn: document.getElementById("diagramRotateResetBtn"),
  diagramSelectionStatus: document.getElementById("diagramSelectionStatus"),
  diagramSelectionList: document.getElementById("diagramSelectionList"),
  diagramDefaultDiameterInput: document.getElementById("diagramDefaultDiameterInput"),
  diagramApplyDefaultDiameterBtn: document.getElementById("diagramApplyDefaultDiameterBtn"),
  diagramBurdenInput: document.getElementById("diagramBurdenInput"),
  diagramSpacingInput: document.getElementById("diagramSpacingInput"),
  diagramDiameterInput: document.getElementById("diagramDiameterInput"),
  diagramAngleInput: document.getElementById("diagramAngleInput"),
  diagramBearingInput: document.getElementById("diagramBearingInput"),
  diagramDepthInput: document.getElementById("diagramDepthInput"),
  diagramStemHeightInput: document.getElementById("diagramStemHeightInput"),
  diagramApplyPropertiesBtn: document.getElementById("diagramApplyPropertiesBtn"),
  diagramClearSelectionBtn: document.getElementById("diagramClearSelectionBtn"),
  printWorkspace: document.getElementById("printWorkspace"),
  printCanvas: document.getElementById("printCanvas"),
  printPaperFrame: document.getElementById("printPaperFrame"),
  printBackBtn: document.getElementById("printBackBtn"),
  printActionBtn: document.getElementById("printActionBtn"),
  printFitBtn: document.getElementById("printFitBtn"),
  printTextScaleInput: document.getElementById("printTextScaleInput"),
  printColorModeToggle: document.getElementById("printColorModeToggle"),
  printRelationshipToggleWrap: document.getElementById("printRelationshipToggleWrap"),
  printRelationshipToggle: document.getElementById("printRelationshipToggle"),
  printAngleToggleWrap: document.getElementById("printAngleToggleWrap"),
  printAngleToggle: document.getElementById("printAngleToggle"),
  printDepthToggleWrap: document.getElementById("printDepthToggleWrap"),
  printDepthToggle: document.getElementById("printDepthToggle"),
  helpWorkspace: document.getElementById("helpWorkspace"),
  helpBackBtn: document.getElementById("helpBackBtn"),
};

const solverRenderer = new DiagramRenderer(document.getElementById("diagramCanvas"), {
  stateRef: solverState,
  onHoleClick: handleSolverHoleClick,
  onHoleHover: handleSolverHoleHover,
  onPointerUp: handleSolverPointerUp,
  onHoleContextMenu: () => {},
});

const diagramRenderer = new DiagramRenderer(document.getElementById("diagramMakerCanvas"), {
  stateRef: diagramState,
  onHoleClick: handleDiagramHoleClick,
  onHoleHover: () => {},
  onPointerUp: () => {},
  onHoleContextMenu: () => {},
});

const printRenderer = new DiagramRenderer(document.getElementById("printCanvas"), {
  stateRef: printState,
  onHoleClick: () => {},
  onHoleHover: () => {},
  onPointerUp: () => {},
  onHoleContextMenu: () => {},
});

initTimingControls(solverState, els, () => {
  resetTimingResults();
  solverRenderer.render();
});

function isSolverWorkspaceActive() {
  return appUi.activeWorkspace === "delaySolver";
}

function isDiagramWorkspaceActive() {
  return appUi.activeWorkspace === "diagramMaker";
}

function activeRenderer() {
  return isDiagramWorkspaceActive() ? diagramRenderer : solverRenderer;
}

function closeAllMenus() {
  els.menuPanels.forEach((panel) => panel.classList.add("hidden"));
  els.menuToggles.forEach((button) => button.classList.remove("active"));
}

function renderWorkspaceChrome() {
  const workspace = appUi.activeWorkspace;
  const solverActive = workspace === "delaySolver";
  const diagramActive = workspace === "diagramMaker";

  els.homeWorkspace.classList.toggle("hidden", workspace !== "home");
  els.delaySolverWorkspace.classList.toggle("hidden", !solverActive);
  els.diagramMakerWorkspace.classList.toggle("hidden", !diagramActive);
  els.homeNavBtn.classList.toggle("hidden", workspace === "home");
  els.helpBtn.classList.toggle("hidden", !solverActive);
  els.csvExportBtn.classList.toggle("hidden", !solverActive);
  els.exportPdfBtn.classList.toggle("hidden", !(solverActive || diagramActive));
  els.workspaceTitle.textContent = WORKSPACE_TITLES[workspace] || "Workspace";

  if (!solverActive) {
    els.timingVisualizationControls.classList.add("hidden");
  } else {
    renderTimingVisualizationControls();
  }
}

function setActiveWorkspace(workspaceId) {
  if (!Object.hasOwn(WORKSPACE_TITLES, workspaceId)) return;
  closeAllMenus();
  closeHelpWorkspace();
  closePrintWorkspace();
  appUi.activeWorkspace = workspaceId;
  renderWorkspaceChrome();

  requestAnimationFrame(() => {
    if (workspaceId === "delaySolver") solverRenderer.resize();
    if (workspaceId === "diagramMaker") diagramRenderer.resize();
  });
}

function toggleMenu(menuId) {
  const panel = document.getElementById(menuId);
  const button = els.menuToggles.find((item) => item.dataset.menuToggle === menuId);
  if (!panel || !button) return;
  const opening = panel.classList.contains("hidden");
  closeAllMenus();
  if (!opening) return;
  panel.classList.remove("hidden");
  button.classList.add("active");
}

function initMenuToggles() {
  els.menuToggles.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleMenu(button.dataset.menuToggle);
    });
  });

  els.menuPanels.forEach((panel) => {
    panel.addEventListener("click", (event) => event.stopPropagation());
  });

  document.addEventListener("click", () => closeAllMenus());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAllMenus();
  });
}

function openMenu(menuId) {
  if (!menuId) return;
  const panel = document.getElementById(menuId);
  const button = els.menuToggles.find((item) => item.dataset.menuToggle === menuId);
  if (!panel || !button) return;
  closeAllMenus();
  panel.classList.remove("hidden");
  button.classList.add("active");
}

function cloneSelectedTiming(selectedTiming) {
  if (!selectedTiming) return [];
  return [{
    ...selectedTiming,
    holeTimes: new Map(selectedTiming.holeTimes),
    offsetAssignments: selectedTiming.offsetAssignments ? new Map(selectedTiming.offsetAssignments) : new Map(),
  }];
}

function cloneHole(hole) {
  return {
    ...hole,
    collar: hole.collar ? { ...hole.collar, original: hole.collar.original ? { ...hole.collar.original } : hole.collar.original } : hole.collar,
    toe: hole.toe ? { ...hole.toe, original: hole.toe.original ? { ...hole.toe.original } : hole.toe.original } : hole.toe,
    original: hole.original ? { ...hole.original } : hole.original,
  };
}

function syncPrintControls() {
  const diagramMode = printState.ui.workspaceMode === "diagram";
  els.printTextScaleInput.value = String(printState.ui.textScale || 1);
  els.printColorModeToggle.checked = !els.printPaperFrame.classList.contains("greyscale");
  els.printRelationshipToggleWrap.classList.toggle("hidden", diagramMode);
  els.printAngleToggleWrap.classList.toggle("hidden", !diagramMode);
  els.printDepthToggleWrap.classList.toggle("hidden", !diagramMode);
  els.printRelationshipToggle.checked = printState.ui.showRelationships !== false;
  els.printAngleToggle.checked = printState.ui.showAngleLabels !== false;
  els.printDepthToggle.checked = printState.ui.showDepthLabels !== false;
}

function applyPrintOrientation() {
  printState.ui.orientation = "landscape";
}

function loadSolverPrintState(selectedTiming) {
  printState.holes = solverState.holes.map(cloneHole);
  printState.holesById = new Map(printState.holes.map((hole) => [hole.id, hole]));
  printState.selection = new Set();
  printState.relationships = {
    originHoleId: solverState.relationships.originHoleId,
    edges: solverState.relationships.edges.map((edge) => ({ ...edge })),
    nextId: solverState.relationships.nextId,
  };
  printState.timingResults = cloneSelectedTiming(selectedTiming);
  printState.ui.workspaceMode = "solver";
  printState.ui.activeTimingPreviewIndex = printState.timingResults.length ? 0 : -1;
  printState.ui.showGrid = false;
  printState.ui.showRelationships = solverState.ui.showRelationships;
  printState.ui.showOverlayText = true;
  printState.ui.showAngleLabels = false;
  printState.ui.showDepthLabels = false;
  printState.ui.textScale = Number(els.printTextScaleInput.value) || 1;
  applyPrintOrientation();
}

function loadDiagramPrintState() {
  printState.holes = diagramState.holes.map(cloneHole);
  printState.holesById = new Map(printState.holes.map((hole) => [hole.id, hole]));
  printState.selection = new Set();
  printState.relationships = { originHoleId: null, edges: [], nextId: 1 };
  printState.timingResults = [];
  printState.ui.workspaceMode = "diagram";
  printState.ui.activeTimingPreviewIndex = -1;
  printState.ui.showGrid = false;
  printState.ui.showRelationships = false;
  printState.ui.showOverlayText = false;
  printState.ui.showAngleLabels = diagramState.ui.showAngleLabels;
  printState.ui.showDepthLabels = diagramState.ui.showDepthLabels;
  printState.ui.textScale = Number(els.printTextScaleInput.value) || 1;
  applyPrintOrientation();
}

function openPrintWorkspace() {
  if (isSolverWorkspaceActive()) {
    const selectedTiming = solverState.timingResults[solverState.ui.activeTimingPreviewIndex] || null;
    if (!selectedTiming) {
      window.alert("Select a timing result first, then open print preview.");
      return;
    }
    loadSolverPrintState(selectedTiming);
  } else if (isDiagramWorkspaceActive()) {
    loadDiagramPrintState();
  } else {
    return;
  }

  els.printPaperFrame.classList.remove("greyscale");
  els.printColorModeToggle.checked = true;
  syncPrintControls();
  closeHelpWorkspace();
  document.body.classList.add("print-preview-active");
  els.printWorkspace.classList.remove("hidden");
  closeAllMenus();
  requestAnimationFrame(() => {
    printRenderer.resize();
    printRenderer.rotationDeg = activeRenderer().rotationDeg;
    printRenderer.fitToData();
  });
}

function closePrintWorkspace() {
  document.body.classList.remove("print-preview-active");
  els.printWorkspace.classList.add("hidden");
}

function openHelpWorkspace() {
  if (!isSolverWorkspaceActive()) return;
  closeAllMenus();
  closePrintWorkspace();
  document.body.classList.add("help-active");
  els.helpWorkspace.classList.remove("hidden");
}

function closeHelpWorkspace() {
  document.body.classList.remove("help-active");
  els.helpWorkspace.classList.add("hidden");
}

function applyPrintSettings() {
  printState.ui.textScale = Number(els.printTextScaleInput.value) || 1;
  printState.ui.showRelationships = els.printRelationshipToggle.checked;
  printState.ui.showAngleLabels = els.printAngleToggle.checked;
  printState.ui.showDepthLabels = els.printDepthToggle.checked;
  els.printPaperFrame.classList.toggle("greyscale", !els.printColorModeToggle.checked);
  applyPrintOrientation();
  printRenderer.render();
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function exportSelectedTimingCsv() {
  const selectedTiming = solverState.timingResults[solverState.ui.activeTimingPreviewIndex] || null;
  if (!selectedTiming) {
    window.alert("Select a timing result first, then export CSV.");
    return;
  }

  const rows = solverState.holes.map((hole) => {
    const originalX = hole.collar?.original?.x ?? hole.original?.x ?? "";
    const originalY = hole.collar?.original?.y ?? hole.original?.y ?? "";
    const delayTime = selectedTiming.holeTimes instanceof Map ? selectedTiming.holeTimes.get(hole.id) : undefined;
    return [hole.holeNumber || hole.id, originalX, originalY, Number.isFinite(delayTime) ? delayTime : ""];
  });

  const csvText = [["hole_number", "x", "y", "delay_time_ms"], ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "timing-delays.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function selectedTimingResult() {
  return solverState.timingResults[solverState.ui.activeTimingPreviewIndex] || null;
}

function timingVisualizationState() {
  return solverState.ui.timingVisualization;
}

function resetTimingVisualization({ preserveSpeed = true } = {}) {
  const playback = timingVisualizationState();
  if (playback.frameRequestId) cancelAnimationFrame(playback.frameRequestId);
  const speedMultiplier = preserveSpeed ? playback.speedMultiplier : 1;
  playback.speedMultiplier = speedMultiplier;
  playback.activeSpeedMultiplier = speedMultiplier;
  playback.isPlaying = false;
  playback.startTimestamp = 0;
  playback.lastFrameTimestamp = 0;
  playback.tailStartTimestamp = 0;
  playback.elapsedMs = 0;
  playback.completed = false;
  playback.resultIndexAtStart = -1;
  playback.frameRequestId = null;
}

function stopTimingVisualization({ completed = false, preserveElapsed = false } = {}) {
  const playback = timingVisualizationState();
  if (playback.frameRequestId) cancelAnimationFrame(playback.frameRequestId);
  playback.frameRequestId = null;
  playback.isPlaying = false;
  playback.startTimestamp = 0;
  playback.lastFrameTimestamp = 0;
  playback.tailStartTimestamp = 0;
  playback.completed = completed;
  playback.resultIndexAtStart = -1;
  if (!preserveElapsed) playback.elapsedMs = 0;
  renderTimingVisualizationControls();
  solverRenderer.render();
}

function renderTimingVisualizationControls() {
  const hasResults = solverState.timingResults.length > 0;
  const playback = timingVisualizationState();
  const hasSelectedTiming = Boolean(selectedTimingResult());

  els.timingVisualizationControls.classList.toggle("hidden", !hasResults || !isSolverWorkspaceActive());
  if (!hasResults || !isSolverWorkspaceActive()) return;

  els.timingVisualizationSpeed.value = String(playback.speedMultiplier);
  els.timingVisualizationBtn.disabled = !hasSelectedTiming || playback.isPlaying;

  if (playback.isPlaying) {
    els.timingVisualizationBtn.textContent = "Playing...";
    els.timingVisualizationStatus.textContent = "Playing";
    return;
  }

  els.timingVisualizationBtn.textContent = playback.completed || playback.elapsedMs > 0 ? "Replay" : "Simulate";
  if (!hasSelectedTiming) els.timingVisualizationStatus.textContent = "No timing selected";
  else if (playback.completed) els.timingVisualizationStatus.textContent = "Complete";
  else if (playback.elapsedMs > 0) els.timingVisualizationStatus.textContent = "Ready to replay";
  else els.timingVisualizationStatus.textContent = "Ready";
}

function stepTimingVisualization(now) {
  const playback = timingVisualizationState();
  if (!playback.isPlaying) return;

  const result = solverState.timingResults[playback.resultIndexAtStart] || null;
  if (!result || solverState.ui.activeTimingPreviewIndex !== playback.resultIndexAtStart) {
    stopTimingVisualization();
    return;
  }

  const durationMs = Number.isFinite(result.endTime) ? result.endTime : 0;
  const finalVisualTimeMs = durationMs + TIMING_VISUALIZATION_PULSE_WINDOW_MS;
  if (durationMs <= 0) {
    playback.elapsedMs = 0;
    stopTimingVisualization({ completed: true });
    return;
  }

  if (!playback.lastFrameTimestamp) playback.lastFrameTimestamp = now;
  const deltaMs = Math.max(0, now - playback.lastFrameTimestamp);
  playback.lastFrameTimestamp = now;
  if (!playback.tailStartTimestamp) {
    playback.elapsedMs += deltaMs * playback.activeSpeedMultiplier;
    if (playback.elapsedMs >= finalVisualTimeMs) {
      playback.elapsedMs = finalVisualTimeMs;
      playback.tailStartTimestamp = now;
    }
  } else if ((now - playback.tailStartTimestamp) >= TIMING_VISUALIZATION_TAIL_MS) {
    solverRenderer.render();
    stopTimingVisualization({ completed: true, preserveElapsed: true });
    return;
  }

  solverRenderer.render();
  playback.frameRequestId = requestAnimationFrame(stepTimingVisualization);
}

function startTimingVisualization() {
  const result = selectedTimingResult();
  if (!result) {
    renderTimingVisualizationControls();
    return;
  }

  const playback = timingVisualizationState();
  if (playback.frameRequestId) cancelAnimationFrame(playback.frameRequestId);
  playback.activeSpeedMultiplier = playback.speedMultiplier;
  playback.isPlaying = true;
  playback.startTimestamp = performance.now();
  playback.lastFrameTimestamp = playback.startTimestamp;
  playback.tailStartTimestamp = 0;
  playback.elapsedMs = 0;
  playback.completed = false;
  playback.resultIndexAtStart = solverState.ui.activeTimingPreviewIndex;
  playback.frameRequestId = requestAnimationFrame(stepTimingVisualization);
  renderTimingVisualizationControls();
  solverRenderer.render();
}

function resetTimingResults(message = "") {
  resetTimingVisualization();
  solverState.timingResults = [];
  solverState.ui.activeTimingPreviewIndex = -1;
  solverState.solverMessage = message;
  renderTimingResults();
}

function uniqueHoleIds(holes, records, idColumn) {
  const seen = new Set();
  holes.forEach((hole) => {
    let id = String(hole.id);
    if (idColumn && records[hole.sourceIndex]?.[idColumn]) id = String(records[hole.sourceIndex][idColumn]);
    while (seen.has(id)) id = `${id}_dup`;
    hole.id = id;
    hole.holeNumber = id;
    seen.add(id);
  });
}

function inferHeaderByPriority(headers, priorityGroups) {
  const lower = headers.map((header) => ({ raw: header, low: header.toLowerCase() }));
  for (const group of priorityGroups) {
    const match = lower.find((entry) => group.every((needle) => entry.low.includes(needle)));
    if (match) return match.raw;
  }
  return "";
}

function appendOptions(select, headers, emptyLabel = null) {
  select.innerHTML = "";
  if (emptyLabel) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = emptyLabel;
    select.appendChild(option);
  }
  headers.forEach((header) => {
    const option = document.createElement("option");
    option.value = header;
    option.textContent = header;
    select.appendChild(option);
  });
}

function setSolverColumnOptions(headers) {
  [els.xColumnSelect, els.yColumnSelect, els.toeXColumnSelect, els.toeYColumnSelect, els.idColumnSelect].forEach((select) => {
    const emptyLabel = select === els.idColumnSelect ? "(Auto)" : (select === els.toeXColumnSelect || select === els.toeYColumnSelect ? "(None)" : null);
    appendOptions(select, headers, emptyLabel);
  });

  const xGuess = inferHeaderByPriority(headers, [["start", "point", "easting"], ["start", "easting"], ["easting"], ["longitude"], ["x"]]);
  const yGuess = inferHeaderByPriority(headers, [["start", "point", "northing"], ["start", "northing"], ["northing"], ["latitude"], ["y"]]);
  const toeXGuess = inferHeaderByPriority(headers, [["toe", "easting"], ["end", "point", "easting"], ["toe", "longitude"], ["end", "point", "longitude"], ["toe", "x"]]);
  const toeYGuess = inferHeaderByPriority(headers, [["toe", "northing"], ["end", "point", "northing"], ["toe", "latitude"], ["end", "point", "latitude"], ["toe", "y"]]);
  const idGuess = inferHeaderByPriority(headers, [["hole"], ["id"]]);

  if (xGuess) els.xColumnSelect.value = xGuess;
  if (yGuess) els.yColumnSelect.value = yGuess;
  if (toeXGuess) els.toeXColumnSelect.value = toeXGuess;
  if (toeYGuess) els.toeYColumnSelect.value = toeYGuess;
  if (idGuess) els.idColumnSelect.value = idGuess;

  const lowerHeaders = headers.map((header) => header.toLowerCase());
  if (lowerHeaders.some((header) => header.includes("lat")) && lowerHeaders.some((header) => header.includes("lon"))) {
    els.coordTypeSelect.value = "latlon";
  }
}

function setDiagramColumnOptions(headers) {
  [
    els.diagramXColumnSelect,
    els.diagramYColumnSelect,
    els.diagramToeXColumnSelect,
    els.diagramToeYColumnSelect,
    els.diagramIdColumnSelect,
    els.diagramAngleColumnSelect,
    els.diagramBearingColumnSelect,
    els.diagramDepthColumnSelect,
  ].forEach((select) => {
    let emptyLabel = null;
    if (select === els.diagramIdColumnSelect) emptyLabel = "(Auto)";
    if (select !== els.diagramXColumnSelect && select !== els.diagramYColumnSelect) emptyLabel = emptyLabel || "(None)";
    appendOptions(select, headers, emptyLabel);
  });

  const xGuess = inferHeaderByPriority(headers, [["start", "point", "easting"], ["start", "easting"], ["easting"], ["longitude"], ["x"]]);
  const yGuess = inferHeaderByPriority(headers, [["start", "point", "northing"], ["start", "northing"], ["northing"], ["latitude"], ["y"]]);
  const toeXGuess = inferHeaderByPriority(headers, [["toe", "easting"], ["end", "point", "easting"], ["toe", "longitude"], ["end", "point", "longitude"], ["toe", "x"]]);
  const toeYGuess = inferHeaderByPriority(headers, [["toe", "northing"], ["end", "point", "northing"], ["toe", "latitude"], ["end", "point", "latitude"], ["toe", "y"]]);
  const idGuess = inferHeaderByPriority(headers, [["hole"], ["id"]]);
  const angleGuess = inferHeaderByPriority(headers, [["angle"], ["dip"]]);
  const bearingGuess = inferHeaderByPriority(headers, [["bearing"], ["azimuth"], ["azi"]]);
  const depthGuess = inferHeaderByPriority(headers, [["depth"], ["length"]]);

  if (xGuess) els.diagramXColumnSelect.value = xGuess;
  if (yGuess) els.diagramYColumnSelect.value = yGuess;
  if (toeXGuess) els.diagramToeXColumnSelect.value = toeXGuess;
  if (toeYGuess) els.diagramToeYColumnSelect.value = toeYGuess;
  if (idGuess) els.diagramIdColumnSelect.value = idGuess;
  if (angleGuess) els.diagramAngleColumnSelect.value = angleGuess;
  if (bearingGuess) els.diagramBearingColumnSelect.value = bearingGuess;
  if (depthGuess) els.diagramDepthColumnSelect.value = depthGuess;
}

function rebuildHolesById(targetState) {
  targetState.holesById = new Map(targetState.holes.map((hole) => [hole.id, hole]));
}

function normalizeHoleCoordinateSets(hole) {
  if (!hole.collar || !Number.isFinite(hole.collar.x) || !Number.isFinite(hole.collar.y)) {
    hole.collar = { x: Number.isFinite(hole.x) ? hole.x : 0, y: Number.isFinite(hole.y) ? hole.y : 0, original: hole.original || null };
  }
  if (hole.toe && (!Number.isFinite(hole.toe.x) || !Number.isFinite(hole.toe.y))) hole.toe = null;
}

function ensureDiagramHoleFields(hole) {
  DIAGRAM_FIELDS.forEach((field) => {
    if (!Object.hasOwn(hole, field) || hole[field] === undefined) hole[field] = null;
  });
}

function hasAnyToeCoordinates(targetState) {
  return targetState.holes.some((hole) => hole.toe && Number.isFinite(hole.toe.x) && Number.isFinite(hole.toe.y));
}

function applyCoordinateView(targetState, selectEl, renderer, view, { fit = false } = {}) {
  const hasToe = hasAnyToeCoordinates(targetState);
  const targetView = view === "toe" && hasToe ? "toe" : "collar";
  targetState.ui.coordView = targetView;
  targetState.holes.forEach((hole) => {
    normalizeHoleCoordinateSets(hole);
    const target = targetView === "toe" && hole.toe ? hole.toe : hole.collar;
    hole.x = target.x;
    hole.y = target.y;
  });
  selectEl.disabled = !hasToe;
  selectEl.value = targetView;
  renderer.render();
  if (fit) renderer.fitToData();
}

function renderOriginStatus() {
  const hole = solverState.holesById.get(solverState.relationships.originHoleId || "");
  els.originStatus.textContent = hole ? `Origin: ${hole.holeNumber || hole.id}` : "Origin: not set";
}

function renderRelationshipList() {
  if (!solverState.relationships.edges.length) {
    els.relationshipList.innerHTML = "<div>No relationships defined</div>";
    return;
  }
  els.relationshipList.innerHTML = solverState.relationships.edges.map((edge) => {
    const description = describeRelationship(edge, solverState.holesById);
    const actions = edge.type === "offset"
      ? `<button data-rel-action="delete" data-rel-id="${edge.id}">Delete</button>`
      : `<button data-rel-action="edit" data-rel-id="${edge.id}">Edit</button><button data-rel-action="delete" data-rel-id="${edge.id}">Delete</button>`;
    return `<div class="relationship-row"><div>${description}</div><div class="row-actions">${actions}</div></div>`;
  }).join("");
}

function syncRelationshipVisibilityUi() {
  els.relationshipVisibilityToggle.checked = solverState.ui.showRelationships;
  els.relationshipVisibilityToggleSecondary.checked = solverState.ui.showRelationships;
}

function renderTimingResults() {
  const hasResults = solverState.timingResults.length > 0;
  els.timingResultsMenuWrap.classList.toggle("hidden", !hasResults);
  if (!hasResults) {
    const resultsButton = els.menuToggles.find((button) => button.dataset.menuToggle === "timingResultsMenu");
    document.getElementById("timingResultsMenu")?.classList.add("hidden");
    resultsButton?.classList.remove("active");
  }
  if (!solverState.timingResults.length) {
    els.timingResults.innerHTML = `<div>${solverState.solverMessage || "Run solver to see best delay combinations."}</div>`;
    renderTimingVisualizationControls();
    return;
  }
  els.timingResults.innerHTML = solverState.timingResults.map((result, index) => {
    const active = index === solverState.ui.activeTimingPreviewIndex ? "active" : "";
    return `<button class="timing-item ${active}" data-timing-index="${index}">${formatTimingResult(result, index)}</button>`;
  }).join("");
  renderTimingVisualizationControls();
}

function fullSolverRefresh({ fit = false } = {}) {
  renderOriginStatus();
  renderRelationshipList();
  renderTimingResults();
  solverRenderer.render();
  if (fit) solverRenderer.fitToData();
}

function resetGraphState() {
  ensureRelationshipState(solverState);
  clearRelationships(solverState);
  solverState.ui.relationshipDraft = null;
}

function applyImportedHoles(holes) {
  holes.forEach((hole) => normalizeHoleCoordinateSets(hole));
  solverState.holes = holes;
  solverState.selection = new Set();
  solverState.ui.coordView = "collar";
  solverState.ui.relationshipDraft = null;
  rebuildHolesById(solverState);
  resetGraphState();
  resetTimingResults();
  applyCoordinateView(solverState, els.coordViewSelect, solverRenderer, "collar");
}

function setToolMode(mode) {
  solverState.ui.toolMode = mode;
  solverState.ui.relationshipDraft = null;
  els.toolModeStatus.textContent = `Tool: ${relationToolLabel(mode)}`;
  els.originToolBtn.classList.toggle("active", mode === "origin");
  els.holeRelationPositiveToolBtn.classList.toggle("active", mode === "holeRelationshipPositive");
  els.holeRelationNegativeToolBtn.classList.toggle("active", mode === "holeRelationshipNegative");
  els.rowRelationPositiveToolBtn.classList.toggle("active", mode === "rowRelationshipPositive");
  els.rowRelationNegativeToolBtn.classList.toggle("active", mode === "rowRelationshipNegative");
  els.offsetRelationToolBtn.classList.toggle("active", mode === "offsetRelationship");
  solverRenderer.render();
}

function promptRelationshipConfig(existing = null) {
  const input = window.prompt("Enter relationship sign: + or -", existing?.sign === -1 ? "-" : "+");
  if (input === null) return null;
  const normalized = input.trim().toLowerCase();
  if (!["+", "-", "positive", "negative"].includes(normalized)) {
    window.alert("Enter + or -.");
    return null;
  }
  return { sign: normalized === "-" || normalized === "negative" ? -1 : 1 };
}

function finalizeRelationshipPath(holeIds, relationshipType, sign) {
  const uniquePath = [];
  holeIds.forEach((holeId) => {
    if (!holeId) return;
    if (uniquePath[uniquePath.length - 1] === holeId) return;
    uniquePath.push(holeId);
  });
  if (uniquePath.length < 2) return false;
  for (let index = 0; index < uniquePath.length - 1; index += 1) {
    const fromHoleId = uniquePath[index];
    const toHoleId = uniquePath[index + 1];
    if (fromHoleId === toHoleId) continue;
    addRelationship(solverState, { type: relationshipType, fromHoleId, toHoleId, sign });
  }
  return true;
}

function finalizeOffsetRelationship(toHoleId) {
  const draft = solverState.ui.relationshipDraft;
  const fromHoleId = draft?.holeIds?.[0] || null;
  if (!fromHoleId || !toHoleId || fromHoleId === toHoleId) {
    solverState.ui.relationshipDraft = null;
    solverRenderer.render();
    return;
  }
  solverState.ui.relationshipDraft = null;
  addRelationship(solverState, { type: draft.type, fromHoleId, toHoleId });
  resetTimingResults();
  fullSolverRefresh();
}

function handleSolverHoleClick(hole, event) {
  if (solverState.ui.toolMode === "origin") {
    setOriginHole(solverState, hole.id);
    resetTimingResults();
    fullSolverRefresh();
    return;
  }

  const relationshipType = TOOL_TO_RELATIONSHIP_TYPE[solverState.ui.toolMode];
  if (relationshipType) {
    if (!solverState.ui.relationshipDraft?.holeIds?.length) solverState.ui.relationshipDraft = { type: relationshipType, sign: TOOL_TO_SIGN[solverState.ui.toolMode] ?? 1, holeIds: [hole.id] };
    else if (solverState.ui.relationshipDraft.type === relationshipType) {
      const holeIds = solverState.ui.relationshipDraft.holeIds;
      if (holeIds[holeIds.length - 1] !== hole.id) holeIds.push(hole.id);
    } else solverState.ui.relationshipDraft = { type: relationshipType, sign: TOOL_TO_SIGN[solverState.ui.toolMode] ?? 1, holeIds: [hole.id] };
    solverRenderer.render();
    return;
  }

  if (!event.shiftKey) solverState.selection = new Set([hole.id]);
  else if (solverState.selection.has(hole.id)) solverState.selection.delete(hole.id);
  else solverState.selection.add(hole.id);
  solverRenderer.render();
}

function handleSolverHoleHover(hole) {
  if (!solverState.ui.relationshipDraft?.holeIds?.length) return;
  if (solverState.ui.relationshipDraft.type === "offset") return;
  const holeIds = solverState.ui.relationshipDraft.holeIds;
  if (holeIds[holeIds.length - 1] === hole.id) return;
  holeIds.push(hole.id);
  solverRenderer.render();
}

function handleSolverPointerUp(payload) {
  const draft = solverState.ui.relationshipDraft;
  if (!draft?.holeIds?.length) return;
  if (draft.type === "offset") {
    finalizeOffsetRelationship(payload?.hole?.id || null);
    return;
  }
  const created = finalizeRelationshipPath(draft.holeIds, draft.type, draft.sign);
  solverState.ui.relationshipDraft = null;
  if (created) {
    resetTimingResults();
    fullSolverRefresh();
    return;
  }
  solverRenderer.render();
}

function editRelationship(edge) {
  if (edge.type === "offset") return;
  const config = promptRelationshipConfig(edge);
  if (!config) return;
  updateRelationship(solverState, edge.id, config);
  resetTimingResults();
  fullSolverRefresh();
}

function selectedDiagramHoles() {
  return [...diagramState.selection].map((id) => diagramState.holesById.get(id)).filter(Boolean);
}

function renderDiagramPropertiesPanel() {
  const selected = selectedDiagramHoles();
  const inputs = [
    els.diagramBurdenInput,
    els.diagramSpacingInput,
    els.diagramDiameterInput,
    els.diagramAngleInput,
    els.diagramBearingInput,
    els.diagramDepthInput,
    els.diagramStemHeightInput,
  ];
  if (!selected.length) {
    els.diagramSelectionStatus.textContent = "Selection: no holes selected";
    els.diagramSelectionList.innerHTML = "<div>Select a hole to edit its properties, or shift-select multiple holes.</div>";
    inputs.forEach((input) => {
      input.value = "";
      input.placeholder = "";
      input.disabled = true;
    });
    els.diagramApplyPropertiesBtn.disabled = true;
    els.diagramClearSelectionBtn.disabled = true;
    els.diagramApplyDefaultDiameterBtn.disabled = !diagramState.holes.length;
    return;
  }

  els.diagramSelectionStatus.textContent = selected.length === 1
    ? `Selection: ${selected[0].holeNumber || selected[0].id}`
    : `Selection: ${selected.length} holes selected`;
  els.diagramSelectionList.innerHTML = selected.slice(0, 8).map((hole) => `<div>${hole.holeNumber || hole.id}</div>`).join("")
    + (selected.length > 8 ? `<div>+${selected.length - 8} more</div>` : "");

  const fieldToInput = {
    burden: els.diagramBurdenInput,
    spacing: els.diagramSpacingInput,
    diameter: els.diagramDiameterInput,
    angle: els.diagramAngleInput,
    bearing: els.diagramBearingInput,
    depth: els.diagramDepthInput,
    stemHeight: els.diagramStemHeightInput,
  };

  Object.entries(fieldToInput).forEach(([field, input]) => {
    const firstValue = selected[0][field];
    const allSame = selected.every((hole) => hole[field] === firstValue);
    input.value = allSame && firstValue !== null ? String(firstValue) : "";
    input.placeholder = !allSame && selected.length > 1 ? "Mixed values" : "";
    input.disabled = false;
  });

  els.diagramApplyPropertiesBtn.disabled = false;
  els.diagramClearSelectionBtn.disabled = false;
  els.diagramApplyDefaultDiameterBtn.disabled = !diagramState.holes.length;
}

function fullDiagramRefresh({ fit = false } = {}) {
  renderDiagramPropertiesPanel();
  diagramRenderer.render();
  if (fit) diagramRenderer.fitToData();
}

function handleDiagramHoleClick(hole, event) {
  if (!event.shiftKey) diagramState.selection = new Set([hole.id]);
  else if (diagramState.selection.has(hole.id)) diagramState.selection.delete(hole.id);
  else diagramState.selection.add(hole.id);
  fullDiagramRefresh();
}

function applyDiagramImportedHoles(holes) {
  const defaultDiameter = Number(els.diagramDefaultDiameterInput.value);
  holes.forEach((hole) => {
    normalizeHoleCoordinateSets(hole);
    ensureDiagramHoleFields(hole);
    if (Number.isFinite(defaultDiameter) && hole.diameter === null) hole.diameter = defaultDiameter;
  });
  diagramState.holes = holes;
  diagramState.selection = new Set();
  diagramState.ui.coordView = "collar";
  rebuildHolesById(diagramState);
  applyCoordinateView(diagramState, els.diagramCoordViewSelect, diagramRenderer, "collar");
  fullDiagramRefresh({ fit: true });
}

function collectDiagramPropertyPatch() {
  const patch = {};
  const fieldToInput = {
    burden: els.diagramBurdenInput,
    spacing: els.diagramSpacingInput,
    diameter: els.diagramDiameterInput,
    angle: els.diagramAngleInput,
    bearing: els.diagramBearingInput,
    depth: els.diagramDepthInput,
    stemHeight: els.diagramStemHeightInput,
  };
  Object.entries(fieldToInput).forEach(([field, input]) => {
    const raw = input.value.trim();
    if (!raw) return;
    const value = Number(raw);
    if (Number.isFinite(value)) patch[field] = value;
  });
  return patch;
}

function applyDiagramPropertyPatchToSelection(patch) {
  const selected = selectedDiagramHoles();
  if (!selected.length) {
    window.alert("Select one or more holes first.");
    return;
  }
  if (!Object.keys(patch).length) {
    window.alert("Enter at least one property value to apply.");
    return;
  }
  selected.forEach((hole) => Object.assign(hole, patch));
  renderDiagramPropertiesPanel();
  diagramRenderer.render();
}

function applyDefaultDiameterToDiagramSelection() {
  const defaultDiameter = Number(els.diagramDefaultDiameterInput.value);
  if (!Number.isFinite(defaultDiameter)) {
    window.alert("Enter a default diameter first.");
    return;
  }
  const selected = selectedDiagramHoles();
  const targets = selected.length ? selected : diagramState.holes;
  if (!targets.length) {
    window.alert("Import holes first.");
    return;
  }
  targets.forEach((hole) => {
    hole.diameter = defaultDiameter;
  });
  renderDiagramPropertiesPanel();
  diagramRenderer.render();
}

function buildToeMap(records, coordType, xColumn, yColumn, idColumn) {
  if (!xColumn || !yColumn) return new Map();
  const toeHoles = buildHolesFromMapping({ records, coordType, xColumn, yColumn, idColumn });
  return new Map(toeHoles.map((hole) => [hole.sourceIndex, { x: hole.x, y: hole.y, original: hole.original }]));
}

els.csvInput.addEventListener("change", async () => {
  const file = els.csvInput.files[0];
  if (!file) return;
  const parsed = parseCsvText(await file.text());
  solverState.csvCache = parsed;
  setSolverColumnOptions(parsed.headers);
  els.mappingPanel.classList.remove("hidden");
});

els.importMappedBtn.addEventListener("click", () => {
  if (!solverState.csvCache) return;
  const { headers, records } = solverState.csvCache;
  if (!headers.length || !records.length) return;
  const idColumn = els.idColumnSelect.value || null;
  const toeXColumn = els.toeXColumnSelect.value || null;
  const toeYColumn = els.toeYColumnSelect.value || null;
  if ((toeXColumn && !toeYColumn) || (!toeXColumn && toeYColumn)) {
    window.alert("Select both Toe X and Toe Y columns, or leave both empty.");
    return;
  }
  const holes = buildHolesFromMapping({
    records,
    coordType: els.coordTypeSelect.value,
    xColumn: els.xColumnSelect.value,
    yColumn: els.yColumnSelect.value,
    idColumn,
  });
  if (!holes.length) {
    window.alert("No valid collar coordinates found for selected columns.");
    return;
  }
  const toeBySource = buildToeMap(records, els.coordTypeSelect.value, toeXColumn, toeYColumn, idColumn);
  holes.forEach((hole) => {
    hole.collar = { x: hole.x, y: hole.y, original: hole.original };
    hole.toe = toeBySource.get(hole.sourceIndex) || null;
  });
  uniqueHoleIds(holes, records, idColumn);
  applyImportedHoles(holes);
  fullSolverRefresh({ fit: true });
});

els.diagramCsvInput.addEventListener("change", async () => {
  const file = els.diagramCsvInput.files[0];
  if (!file) return;
  const parsed = parseCsvText(await file.text());
  diagramState.csvCache = parsed;
  setDiagramColumnOptions(parsed.headers);
  els.diagramMappingPanel.classList.remove("hidden");
});

els.diagramImportMappedBtn.addEventListener("click", () => {
  if (!diagramState.csvCache) return;
  const { headers, records } = diagramState.csvCache;
  if (!headers.length || !records.length) return;
  const idColumn = els.diagramIdColumnSelect.value || null;
  const toeXColumn = els.diagramToeXColumnSelect.value || null;
  const toeYColumn = els.diagramToeYColumnSelect.value || null;
  if ((toeXColumn && !toeYColumn) || (!toeXColumn && toeYColumn)) {
    window.alert("Select both Toe X and Toe Y columns, or leave both empty.");
    return;
  }
  const holes = buildHolesFromMapping({
    records,
    coordType: els.diagramCoordTypeSelect.value,
    xColumn: els.diagramXColumnSelect.value,
    yColumn: els.diagramYColumnSelect.value,
    idColumn,
    fieldColumns: {
      angle: els.diagramAngleColumnSelect.value || null,
      bearing: els.diagramBearingColumnSelect.value || null,
      depth: els.diagramDepthColumnSelect.value || null,
    },
  });
  if (!holes.length) {
    window.alert("No valid collar coordinates found for selected columns.");
    return;
  }
  const toeBySource = buildToeMap(records, els.diagramCoordTypeSelect.value, toeXColumn, toeYColumn, idColumn);
  holes.forEach((hole) => {
    hole.collar = { x: hole.x, y: hole.y, original: hole.original };
    hole.toe = toeBySource.get(hole.sourceIndex) || null;
    ensureDiagramHoleFields(hole);
  });
  uniqueHoleIds(holes, records, idColumn);
  applyDiagramImportedHoles(holes);
});

els.gridToggle.addEventListener("change", () => {
  solverState.ui.showGrid = els.gridToggle.checked;
  solverRenderer.render();
});
els.relationshipVisibilityToggle.addEventListener("change", () => {
  solverState.ui.showRelationships = els.relationshipVisibilityToggle.checked;
  syncRelationshipVisibilityUi();
  solverRenderer.render();
});
els.relationshipVisibilityToggleSecondary.addEventListener("change", () => {
  solverState.ui.showRelationships = els.relationshipVisibilityToggleSecondary.checked;
  syncRelationshipVisibilityUi();
  solverRenderer.render();
});
els.fitViewBtn.addEventListener("click", () => solverRenderer.fitToData());
els.coordViewSelect.addEventListener("change", () => applyCoordinateView(solverState, els.coordViewSelect, solverRenderer, els.coordViewSelect.value, { fit: true }));
els.rotateLeftBtn.addEventListener("click", () => solverRenderer.rotateBy(-15));
els.rotateRightBtn.addEventListener("click", () => solverRenderer.rotateBy(15));
els.rotateFineLeftBtn.addEventListener("click", () => solverRenderer.rotateBy(-1));
els.rotateFineRightBtn.addEventListener("click", () => solverRenderer.rotateBy(1));
els.rotateResetBtn.addEventListener("click", () => solverRenderer.resetRotation());

els.diagramGridToggle.addEventListener("change", () => {
  diagramState.ui.showGrid = els.diagramGridToggle.checked;
  diagramRenderer.render();
});
els.diagramAngleLabelToggle.addEventListener("change", () => {
  diagramState.ui.showAngleLabels = els.diagramAngleLabelToggle.checked;
  diagramRenderer.render();
});
els.diagramDepthLabelToggle.addEventListener("change", () => {
  diagramState.ui.showDepthLabels = els.diagramDepthLabelToggle.checked;
  diagramRenderer.render();
});
els.diagramFitViewBtn.addEventListener("click", () => diagramRenderer.fitToData());
els.diagramCoordViewSelect.addEventListener("change", () => applyCoordinateView(diagramState, els.diagramCoordViewSelect, diagramRenderer, els.diagramCoordViewSelect.value, { fit: true }));
els.diagramRotateLeftBtn.addEventListener("click", () => diagramRenderer.rotateBy(-15));
els.diagramRotateRightBtn.addEventListener("click", () => diagramRenderer.rotateBy(15));
els.diagramRotateFineLeftBtn.addEventListener("click", () => diagramRenderer.rotateBy(-1));
els.diagramRotateFineRightBtn.addEventListener("click", () => diagramRenderer.rotateBy(1));
els.diagramRotateResetBtn.addEventListener("click", () => diagramRenderer.resetRotation());
els.diagramApplyPropertiesBtn.addEventListener("click", () => applyDiagramPropertyPatchToSelection(collectDiagramPropertyPatch()));
els.diagramApplyDefaultDiameterBtn.addEventListener("click", () => applyDefaultDiameterToDiagramSelection());
els.diagramClearSelectionBtn.addEventListener("click", () => {
  diagramState.selection = new Set();
  renderDiagramPropertiesPanel();
  diagramRenderer.render();
});

els.homeNavBtn.addEventListener("click", () => setActiveWorkspace("home"));
els.openDelaySolverBtn.addEventListener("click", () => setActiveWorkspace("delaySolver"));
els.openDiagramMakerBtn.addEventListener("click", () => setActiveWorkspace("diagramMaker"));

els.originToolBtn.addEventListener("click", () => setToolMode("origin"));
els.holeRelationPositiveToolBtn.addEventListener("click", () => setToolMode("holeRelationshipPositive"));
els.holeRelationNegativeToolBtn.addEventListener("click", () => setToolMode("holeRelationshipNegative"));
els.rowRelationPositiveToolBtn.addEventListener("click", () => setToolMode("rowRelationshipPositive"));
els.rowRelationNegativeToolBtn.addEventListener("click", () => setToolMode("rowRelationshipNegative"));
els.offsetRelationToolBtn.addEventListener("click", () => setToolMode("offsetRelationship"));
els.clearRelationshipsBtn.addEventListener("click", () => {
  solverState.relationships.edges = [];
  solverState.ui.relationshipDraft = null;
  resetTimingResults();
  fullSolverRefresh();
});
els.clearOriginBtn.addEventListener("click", () => {
  setOriginHole(solverState, null);
  resetTimingResults();
  fullSolverRefresh();
});

els.relationshipList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-rel-action]");
  if (!button) return;
  const edge = solverState.relationships.edges.find((item) => item.id === button.getAttribute("data-rel-id"));
  if (!edge) return;
  const action = button.getAttribute("data-rel-action");
  if (action === "edit") editRelationship(edge);
  if (action === "delete") {
    deleteRelationship(solverState, edge.id);
    resetTimingResults();
    fullSolverRefresh();
  }
});

els.solveTimingBtn.addEventListener("click", () => {
  resetTimingVisualization();
  const validation = validateTimingGraph(solverState);
  if (!validation.valid) {
    resetTimingResults(validation.reason);
    solverRenderer.render();
    return;
  }
  solverState.timingResults = solveTimingCombinations(solverState);
  solverState.ui.activeTimingPreviewIndex = solverState.timingResults.length ? 0 : -1;
  solverState.solverMessage = solverState.timingResults.length ? "" : "No valid timing combinations were produced for the current graph.";
  renderTimingResults();
  if (solverState.timingResults.length) openMenu("timingResultsMenu");
  solverRenderer.render();
});

els.timingResults.addEventListener("click", (event) => {
  const target = event.target.closest("[data-timing-index]");
  if (!target) return;
  const index = Number(target.getAttribute("data-timing-index"));
  if (!Number.isFinite(index)) return;
  resetTimingVisualization();
  solverState.ui.activeTimingPreviewIndex = index;
  renderTimingResults();
  solverRenderer.render();
});

els.timingVisualizationBtn.addEventListener("click", () => startTimingVisualization());
els.timingVisualizationSpeed.addEventListener("change", () => {
  const speedMultiplier = Number(els.timingVisualizationSpeed.value);
  const playback = timingVisualizationState();
  const normalizedSpeed = Number.isFinite(speedMultiplier) && speedMultiplier > 0 ? speedMultiplier : 1;
  playback.speedMultiplier = normalizedSpeed;
  if (playback.isPlaying) playback.activeSpeedMultiplier = normalizedSpeed;
  renderTimingVisualizationControls();
});

els.exportPdfBtn.addEventListener("click", () => openPrintWorkspace());
els.helpBtn.addEventListener("click", () => openHelpWorkspace());
els.csvExportBtn.addEventListener("click", () => exportSelectedTimingCsv());
els.helpBackBtn.addEventListener("click", () => closeHelpWorkspace());
els.printBackBtn.addEventListener("click", () => closePrintWorkspace());
els.printFitBtn.addEventListener("click", () => printRenderer.fitToData());
els.printTextScaleInput.addEventListener("input", () => applyPrintSettings());
els.printColorModeToggle.addEventListener("change", () => applyPrintSettings());
els.printRelationshipToggle.addEventListener("change", () => applyPrintSettings());
els.printAngleToggle.addEventListener("change", () => applyPrintSettings());
els.printDepthToggle.addEventListener("change", () => applyPrintSettings());
els.printActionBtn.addEventListener("click", () => {
  window.print();
  closePrintWorkspace();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.helpWorkspace.classList.contains("hidden")) closeHelpWorkspace();
});

ensureRelationshipState(solverState);
setToolMode(solverState.ui.toolMode);
els.coordViewSelect.value = solverState.ui.coordView;
els.coordViewSelect.disabled = true;
els.diagramCoordViewSelect.value = diagramState.ui.coordView;
els.diagramCoordViewSelect.disabled = true;
syncRelationshipVisibilityUi();
renderOriginStatus();
renderRelationshipList();
renderTimingResults();
renderDiagramPropertiesPanel();
initMenuToggles();
renderWorkspaceChrome();
solverRenderer.render();
diagramRenderer.render();

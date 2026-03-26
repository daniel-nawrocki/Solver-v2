import { parseCsvText, buildHolesFromMapping } from "./csvParser.js";
import { DiagramRenderer } from "./diagramRenderer.js";
import { latLonToStatePlane, normalizeGeoContext, statePlaneToLatLon, supportsStatePlaneEpsg } from "./geo.js";
import {
  BOOSTER_TYPES,
  DETONATOR_TYPES,
  DEFAULT_LOADING_DENSITY_GCC,
  calculateColumnDepthFeet,
  cloneMaterialEntries,
  normalizeLoadingDensity,
  normalizeMaterialEntries,
  recalculateHoleLoading,
  summarizeShotLoading,
} from "./loading.js";
import { parseProjectDocument, serializeProjectDocument } from "./projectDocument.js";
import {
  createCloudProject,
  deleteCloudProject,
  getDefaultQuarries,
  getAuthSession,
  isSupabaseConfigured,
  listCloudProjects,
  listQuarries,
  loadCloudProject,
  onAuthStateChange,
  renameCloudProject,
  signInWithPassword,
  signOutSession,
  signUpWithPassword,
  supabaseConfigMessage,
  updateCloudProject,
} from "./supabaseService.js";
import { initTimingControls } from "./timingControls.js";
import {
  formatTimingResult,
  validateTimingGraph,
  buildManualTimingResult,
  deriveTimingAnalysis,
  solveTimingCombinations,
} from "./timingSolver.js";
import {
  addRelationship,
  clearRelationships,
  deleteRelationship,
  describeRelationship,
  ensureRelationshipState,
  findRelationshipLimitConflict,
  relationToolLabel,
  relationshipLabel,
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
const WORKSPACE_TO_MODE = {
  delaySolver: "timing",
  diagramMaker: "diagram",
};
const DIAGRAM_FIELDS = ["burden", "spacing", "diameter", "angle", "bearing", "depth", "subdrill", "stemHeight"];
const ALLOWED_ANGLES = new Set([5, 10, 15, 20, 25, 30]);
const PRINT_FIT_MARGINS = { marginTop: 180, marginRight: 80, marginBottom: 80, marginLeft: 80 };
const PRINT_LABEL_DISTANCE_MIN = -15;
const PRINT_LABEL_DISTANCE_MAX = 20;
const PRINT_LABEL_DISTANCE_DEFAULT_TICK = 3;
const TIMING_SOLVE_WARNING_LIMIT = 10000000;
const DIAGRAM_TOOL_MODES = new Set(["single", "box", "polygon", "markup", "text"]);
const DIAGRAM_ANNOTATION_SIZE_MAP = {
  small: { strokeWidth: 2, textSize: 14 },
  medium: { strokeWidth: 4, textSize: 20 },
  large: { strokeWidth: 6, textSize: 28 },
};

const appUi = {
  activeWorkspace: "home",
  plannerMode: "diagram",
  plannerPanelCards: new Map(),
  plannerImportUi: {},
  activeMappingTarget: null,
  currentProjectId: null,
  currentProjectName: "",
  cloudProjects: [],
  quarries: [],
  authSession: null,
  dirty: false,
  suspendDirtyTracking: true,
};

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
      timingMode: "solver",
      toolMode: "origin",
      coordView: "collar",
      activeTimingPreviewIndex: -1,
      showOverlapAnalysis: false,
      activeOverlapBinKey: null,
      relationshipDraft: null,
      readinessDismissed: false,
      solveProgress: { current: 0, total: 0 },
      isSolving: false,
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
      interdeck: { min: 0, max: 0 },
    },
    manualTiming: {
      holeDelay: 16,
      rowDelay: 84,
      offsetDelay: 17,
      interdeckDelay: 0,
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
      showBearingLabels: false,
      showBearingArrows: true,
      showDepthLabels: true,
      activeTool: "single",
      selectionBoxDraft: null,
      selectionPolygonDraft: null,
      annotationColor: "#000000",
      annotationSize: "medium",
      loadingDraft: {
        detonators: [],
        boosters: [],
      },
      deckingDraft: {
        interdeckTimingMode: "top-first",
        decks: [],
        stemIntervals: [],
      },
      pendingDeckingApplyMode: null,
      currentStrokeDraft: null,
      selectedTextId: null,
      dragTextId: null,
      dragTextPointerDelta: null,
      pendingFaceDesignation: false,
      faceDesignationReturnTool: "single",
      holePopupHoleId: null,
    },
    metadata: {
      shotNumber: "",
      location: "",
      bench: "",
      defaultDiameter: null,
      patternSubdrill: null,
      faceBurden: null,
      faceSpacing: null,
      interiorBurden: null,
      interiorSpacing: null,
      loadingDensityGcc: DEFAULT_LOADING_DENSITY_GCC,
      rockDensityTonsPerCubicYard: 2.3,
      quarryStatePlaneEpsg: null,
      quarryStatePlaneUnit: "ft",
    },
    annotations: {
      strokes: [],
      texts: [],
    },
    shotCorners: [null, null, null, null],
    csvCache: null,
  };
}

function createPrintPageState() {
  return {
    pageType: "solver",
    holes: [],
    holesById: new Map(),
    fullShotHoles: [],
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
      showBearingLabels: false,
      showBearingArrows: true,
      bearingArrowWeight: 1,
      bearingArrowLength: 16,
      labelAngleDeg: 315,
      labelDistancePx: PRINT_LABEL_DISTANCE_MIN + PRINT_LABEL_DISTANCE_DEFAULT_TICK,
      showDepthLabels: true,
      showCornerCoordinates: false,
      labelEditMode: false,
      hoverLabelHoleId: null,
      selectionBoxDraft: null,
    },
    labelLayoutByHoleId: new Map(),
    cornerLabelLayoutByHoleId: new Map(),
    dragLabelHoleId: null,
    dragLabelKind: null,
    dragPointerDelta: null,
    metadata: {
      shotNumber: "",
      location: "",
      bench: "",
      defaultDiameter: null,
      patternSubdrill: null,
      faceBurden: null,
      faceSpacing: null,
      interiorBurden: null,
      interiorSpacing: null,
      loadingDensityGcc: DEFAULT_LOADING_DENSITY_GCC,
      rockDensityTonsPerCubicYard: 2.3,
      quarryStatePlaneEpsg: null,
      quarryStatePlaneUnit: "ft",
    },
    annotations: {
      strokes: [],
      texts: [],
    },
    shotCorners: [null, null, null, null],
    relationships: { originHoleId: null, edges: [], nextId: 1 },
    timingResults: [],
    viewport: {
      zoom: 1,
      panX: 0,
      panY: 0,
      rotationDeg: 0,
    },
    colorMode: "color",
  };
}

const solverState = createSolverState();
const diagramState = createDiagramState();
const projectState = {
  holes: [],
  holesById: new Map(),
  csvCache: null,
  geo: {
    quarryName: "",
    statePlaneEpsg: null,
    statePlaneUnit: "ft",
  },
  view: {
    coordView: "collar",
    zoom: 1,
    panX: 0,
    panY: 0,
    rotationDeg: 0,
  },
  diagram: {
    metadata: cloneDiagramMetadata(),
    shotCorners: [null, null, null, null],
    annotations: cloneDiagramAnnotations(),
    ui: {
      showGrid: true,
      showOverlayText: false,
      showAngleLabels: true,
      showBearingLabels: false,
      showBearingArrows: true,
      showDepthLabels: true,
      activeTool: "single",
      annotationColor: "#000000",
      annotationSize: "medium",
      pendingFaceDesignation: false,
      faceDesignationReturnTool: "single",
    },
  },
  timing: {
    ui: {
      showGrid: true,
      showRelationships: true,
      showOverlayText: true,
      timingMode: "solver",
      toolMode: "origin",
      activeTimingPreviewIndex: -1,
      showOverlapAnalysis: false,
      activeOverlapBinKey: null,
    },
    timing: {
      holeToHole: { min: 16, max: 34 },
      rowToRow: { min: 84, max: 142 },
      offset: { min: 17, max: 42 },
      interdeck: { min: 0, max: 0 },
    },
    manualTiming: {
      holeDelay: 16,
      rowDelay: 84,
      offsetDelay: 17,
      interdeckDelay: 0,
    },
    relationships: { originHoleId: null, edges: [], nextId: 1 },
    timingResults: [],
    solverMessage: "",
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
};
const printSession = {
  pages: [],
  activePageIndex: -1,
};

const printLabelDialState = {
  dragging: false,
};

const timingSolveFloatingState = {
  dragging: false,
  pointerOffsetX: 0,
  pointerOffsetY: 0,
  hasMoved: false,
};

let solverWorker = null;

const els = {
  homeWorkspace: document.getElementById("homeWorkspace"),
  delaySolverWorkspace: document.getElementById("delaySolverWorkspace"),
  diagramMakerWorkspace: document.getElementById("diagramMakerWorkspace"),
  workspaceTitle: document.getElementById("workspaceTitle"),
  homeNavBtn: document.getElementById("homeNavBtn"),
  authStatus: document.getElementById("authStatus"),
  cloudMenuBtn: document.getElementById("cloudMenuBtn"),
  cloudProjectStatus: document.getElementById("cloudProjectStatus"),
  cloudSaveBtn: document.getElementById("cloudSaveBtn"),
  cloudSaveAsBtn: document.getElementById("cloudSaveAsBtn"),
  cloudRefreshProjectsBtn: document.getElementById("cloudRefreshProjectsBtn"),
  cloudProjectsList: document.getElementById("cloudProjectsList"),
  localProjectExportBtn: document.getElementById("localProjectExportBtn"),
  projectFileInput: document.getElementById("projectFileInput"),
  accountMenuBtn: document.getElementById("accountMenuBtn"),
  accountStatus: document.getElementById("accountStatus"),
  authEmailInput: document.getElementById("authEmailInput"),
  authPasswordInput: document.getElementById("authPasswordInput"),
  authSignInBtn: document.getElementById("authSignInBtn"),
  authSignUpBtn: document.getElementById("authSignUpBtn"),
  authSignOutBtn: document.getElementById("authSignOutBtn"),
  plannerModeToggle: document.getElementById("plannerModeToggle"),
  plannerDiagramModeBtn: document.getElementById("plannerDiagramModeBtn"),
  plannerTimingModeBtn: document.getElementById("plannerTimingModeBtn"),
  plannerLoadingModeBtn: document.getElementById("plannerLoadingModeBtn"),
  plannerStatusIndicator: document.getElementById("plannerStatusIndicator"),
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
  importMenu: document.getElementById("importMenu"),
  viewMenu: document.getElementById("viewMenu"),
  relationshipMenu: document.getElementById("relationshipMenu"),
  timingMenu: document.getElementById("timingMenu"),
  timingResultsMenu: document.getElementById("timingResultsMenu"),
  csvInput: document.getElementById("csvInput"),
  mappingPanel: document.getElementById("mappingPanel"),
  coordTypeSelect: document.getElementById("coordTypeSelect"),
  xColumnSelect: document.getElementById("xColumnSelect"),
  yColumnSelect: document.getElementById("yColumnSelect"),
  toeXColumnSelect: document.getElementById("toeXColumnSelect"),
  toeYColumnSelect: document.getElementById("toeYColumnSelect"),
  idColumnSelect: document.getElementById("idColumnSelect"),
  solverAngleColumnSelect: document.getElementById("solverAngleColumnSelect"),
  solverBearingColumnSelect: document.getElementById("solverBearingColumnSelect"),
  solverDepthColumnSelect: document.getElementById("solverDepthColumnSelect"),
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
  timingSolverModeBtn: document.getElementById("timingSolverModeBtn"),
  timingManualModeBtn: document.getElementById("timingManualModeBtn"),
  timingMenuTitle: document.getElementById("timingMenuTitle"),
  timingSolverFields: document.getElementById("timingSolverFields"),
  timingManualFields: document.getElementById("timingManualFields"),
  holeDelayMin: document.getElementById("holeDelayMinInput"),
  holeDelayMax: document.getElementById("holeDelayMaxInput"),
  rowDelayMin: document.getElementById("rowDelayMinInput"),
  rowDelayMax: document.getElementById("rowDelayMaxInput"),
  offsetDelayMin: document.getElementById("offsetDelayMinInput"),
  offsetDelayMax: document.getElementById("offsetDelayMaxInput"),
  interdeckDelayMin: document.getElementById("interdeckDelayMinInput"),
  interdeckDelayMax: document.getElementById("interdeckDelayMaxInput"),
  manualHoleDelayInput: document.getElementById("manualHoleDelayInput"),
  manualRowDelayInput: document.getElementById("manualRowDelayInput"),
  manualOffsetDelayInput: document.getElementById("manualOffsetDelayInput"),
  manualInterdeckDelayInput: document.getElementById("manualInterdeckDelayInput"),
  timingSolveFloating: document.getElementById("timingSolveFloating"),
  timingSolveFloatingHandle: document.getElementById("timingSolveFloatingHandle"),
  timingFloatingOriginValue: document.getElementById("timingFloatingOriginValue"),
  timingFloatingReachableValue: document.getElementById("timingFloatingReachableValue"),
  timingFloatingConflictsValue: document.getElementById("timingFloatingConflictsValue"),
  solveTimingBtn: document.getElementById("solveTimingBtn"),
  cancelTimingSolveBtn: document.getElementById("cancelTimingSolveBtn"),
  timingResults: document.getElementById("timingResults"),
  timingResultsMenuWrap: document.getElementById("timingResultsMenuWrap"),
  timingOverlapAnalysisBtn: document.getElementById("timingOverlapAnalysisBtn"),
  timingOverlapClearBtn: document.getElementById("timingOverlapClearBtn"),
  timingOverlapAnalysisPanel: document.getElementById("timingOverlapAnalysisPanel"),
  timingOverlapSummary: document.getElementById("timingOverlapSummary"),
  timingOverlapChart: document.getElementById("timingOverlapChart"),
  printAdditionalPagesBtn: document.getElementById("printAdditionalPagesBtn"),
  printAdditionalPagesMenu: document.getElementById("printAdditionalPagesMenu"),
  printLabelAngleWrap: document.getElementById("printLabelAngleWrap"),
  printLabelAngleDial: document.getElementById("printLabelAngleDial"),
  printLabelAnglePointer: document.getElementById("printLabelAnglePointer"),
  printLabelAngleValue: document.getElementById("printLabelAngleValue"),
  printLabelDistanceValue: document.getElementById("printLabelDistanceValue"),
  printLabelDistanceTickValue: document.getElementById("printLabelDistanceTickValue"),
  printLabelDistanceDownBtn: document.getElementById("printLabelDistanceDownBtn"),
  printLabelDistanceUpBtn: document.getElementById("printLabelDistanceUpBtn"),
  printAddHoleTablePageBtn: document.getElementById("printAddHoleTablePageBtn"),
  printAddShotOrderPageBtn: document.getElementById("printAddShotOrderPageBtn"),
  printAddHoleLoadProfilePageBtn: document.getElementById("printAddHoleLoadProfilePageBtn"),
  printHoleTablePreview: document.getElementById("printHoleTablePreview"),
  originToolBtn: document.getElementById("originToolBtn"),
  holeRelationPositiveToolBtn: document.getElementById("holeRelationPositiveToolBtn"),
  holeRelationNegativeToolBtn: document.getElementById("holeRelationNegativeToolBtn"),
  rowRelationPositiveToolBtn: document.getElementById("rowRelationPositiveToolBtn"),
  rowRelationNegativeToolBtn: document.getElementById("rowRelationNegativeToolBtn"),
  offsetRelationToolBtn: document.getElementById("offsetRelationToolBtn"),
  diagramCsvInput: document.getElementById("diagramCsvInput"),
  diagramShotMenu: document.getElementById("diagramShotMenu"),
  diagramImportMenu: document.getElementById("diagramImportMenu"),
  diagramPatternMenu: document.getElementById("diagramPatternMenu"),
  diagramViewMenu: document.getElementById("diagramViewMenu"),
  diagramPropertiesMenu: document.getElementById("diagramPropertiesMenu"),
  diagramLoadingMenu: document.getElementById("diagramLoadingMenu"),
  diagramVolumeMenu: document.getElementById("diagramVolumeMenu"),
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
  diagramShotNumberInput: document.getElementById("diagramShotNumberInput"),
  diagramShotLocationSelect: document.getElementById("diagramShotLocationSelect"),
  diagramBenchInput: document.getElementById("diagramBenchInput"),
  diagramShotDefaultDiameterSelect: document.getElementById("diagramShotDefaultDiameterSelect"),
  diagramPatternSubdrillInput: document.getElementById("diagramPatternSubdrillInput"),
  diagramFaceBurdenInput: document.getElementById("diagramFaceBurdenInput"),
  diagramFaceSpacingInput: document.getElementById("diagramFaceSpacingInput"),
  diagramInteriorBurdenInput: document.getElementById("diagramInteriorBurdenInput"),
  diagramInteriorSpacingInput: document.getElementById("diagramInteriorSpacingInput"),
  diagramFaceStatus: document.getElementById("diagramFaceStatus"),
  diagramGeoStatus: document.getElementById("diagramGeoStatus"),
  diagramAssignFaceBtn: document.getElementById("diagramAssignFaceBtn"),
  diagramClearFaceBtn: document.getElementById("diagramClearFaceBtn"),
  diagramApplyPatternBtn: document.getElementById("diagramApplyPatternBtn"),
  diagramLoadingDensityInput: document.getElementById("diagramLoadingDensityInput"),
  diagramLoadingTotalWeightStatus: document.getElementById("diagramLoadingTotalWeightStatus"),
  diagramLoadingIncludedCountStatus: document.getElementById("diagramLoadingIncludedCountStatus"),
  diagramLoadingAverageStatus: document.getElementById("diagramLoadingAverageStatus"),
  diagramLoadingSelectionStatus: document.getElementById("diagramLoadingSelectionStatus"),
  diagramLoadingDetonatorEditor: document.getElementById("diagramLoadingDetonatorEditor"),
  diagramLoadingAddDetonatorBtn: document.getElementById("diagramLoadingAddDetonatorBtn"),
  diagramLoadingBoosterEditor: document.getElementById("diagramLoadingBoosterEditor"),
  diagramLoadingAddBoosterBtn: document.getElementById("diagramLoadingAddBoosterBtn"),
  diagramLoadingApplyBtn: document.getElementById("diagramLoadingApplyBtn"),
  diagramLoadingSummary: document.getElementById("diagramLoadingSummary"),
  diagramRockDensityInput: document.getElementById("diagramRockDensityInput"),
  diagramVolumeRuleStatus: document.getElementById("diagramVolumeRuleStatus"),
  diagramVolumeIncludedStatus: document.getElementById("diagramVolumeIncludedStatus"),
  diagramVolumeCubicYardsStatus: document.getElementById("diagramVolumeCubicYardsStatus"),
  diagramVolumeTonsStatus: document.getElementById("diagramVolumeTonsStatus"),
  diagramGridToggle: document.getElementById("diagramGridToggle"),
  diagramAngleLabelToggle: document.getElementById("diagramAngleLabelToggle"),
  diagramBearingLabelToggle: document.getElementById("diagramBearingLabelToggle"),
  diagramBearingArrowToggle: document.getElementById("diagramBearingArrowToggle"),
  diagramDepthLabelToggle: document.getElementById("diagramDepthLabelToggle"),
  diagramFitViewBtn: document.getElementById("diagramFitViewBtn"),
  diagramCoordViewSelect: document.getElementById("diagramCoordViewSelect"),
  diagramRotateLeftBtn: document.getElementById("diagramRotateLeftBtn"),
  diagramRotateRightBtn: document.getElementById("diagramRotateRightBtn"),
  diagramRotateFineLeftBtn: document.getElementById("diagramRotateFineLeftBtn"),
  diagramRotateFineRightBtn: document.getElementById("diagramRotateFineRightBtn"),
  diagramRotateResetBtn: document.getElementById("diagramRotateResetBtn"),
  diagramSingleSelectToolBtn: document.getElementById("diagramSingleSelectToolBtn"),
  diagramBoxSelectToolBtn: document.getElementById("diagramBoxSelectToolBtn"),
  diagramPolygonSelectToolBtn: document.getElementById("diagramPolygonSelectToolBtn"),
  diagramMarkupToolBtn: document.getElementById("diagramMarkupToolBtn"),
  diagramTextToolBtn: document.getElementById("diagramTextToolBtn"),
  diagramAnnotationColorInput: document.getElementById("diagramAnnotationColorInput"),
  diagramAnnotationSizeSelect: document.getElementById("diagramAnnotationSizeSelect"),
  diagramClearMarkupBtn: document.getElementById("diagramClearMarkupBtn"),
  diagramClearTextBtn: document.getElementById("diagramClearTextBtn"),
  diagramSelectionStatus: document.getElementById("diagramSelectionStatus"),
  diagramSelectionList: document.getElementById("diagramSelectionList"),
  diagramDefaultDiameterStatus: document.getElementById("diagramDefaultDiameterStatus"),
  diagramApplyDefaultDiameterBtn: document.getElementById("diagramApplyDefaultDiameterBtn"),
  diagramBurdenInput: document.getElementById("diagramBurdenInput"),
  diagramSpacingInput: document.getElementById("diagramSpacingInput"),
  diagramDiameterInput: document.getElementById("diagramDiameterInput"),
  diagramAngleInput: document.getElementById("diagramAngleInput"),
  diagramBearingInput: document.getElementById("diagramBearingInput"),
  diagramDepthInput: document.getElementById("diagramDepthInput"),
  diagramSubdrillInput: document.getElementById("diagramSubdrillInput"),
  diagramStemHeightInput: document.getElementById("diagramStemHeightInput"),
  diagramApplyPropertiesBtn: document.getElementById("diagramApplyPropertiesBtn"),
  diagramClearSelectionBtn: document.getElementById("diagramClearSelectionBtn"),
  diagramHoleLoadingSection: document.getElementById("diagramHoleLoadingSection"),
  diagramHoleLoadingDepthInput: document.getElementById("diagramHoleLoadingDepthInput"),
  diagramHoleLoadingStemHeightInput: document.getElementById("diagramHoleLoadingStemHeightInput"),
  diagramHoleLoadingColumnDepthStatus: document.getElementById("diagramHoleLoadingColumnDepthStatus"),
  diagramHoleLoadingWeightStatus: document.getElementById("diagramHoleLoadingWeightStatus"),
  diagramHoleLoadingWarning: document.getElementById("diagramHoleLoadingWarning"),
  diagramHoleLoadingDetonatorEditor: document.getElementById("diagramHoleLoadingDetonatorEditor"),
  diagramHoleLoadingAddDetonatorBtn: document.getElementById("diagramHoleLoadingAddDetonatorBtn"),
  diagramHoleLoadingBoosterEditor: document.getElementById("diagramHoleLoadingBoosterEditor"),
  diagramHoleLoadingAddBoosterBtn: document.getElementById("diagramHoleLoadingAddBoosterBtn"),
  diagramHoleDeckingSection: document.getElementById("diagramHoleDeckingSection"),
  diagramDeckingEnabledInput: document.getElementById("diagramDeckingEnabledInput"),
  diagramDeckCountSelect: document.getElementById("diagramDeckCountSelect"),
  diagramInterdeckTimingModeSelect: document.getElementById("diagramInterdeckTimingModeSelect"),
  diagramHoleDeckingStatus: document.getElementById("diagramHoleDeckingStatus"),
  diagramHoleDeckingDelaySummary: document.getElementById("diagramHoleDeckingDelaySummary"),
  diagramHoleDeckingEditor: document.getElementById("diagramHoleDeckingEditor"),
  diagramDeckPresetSelect: document.getElementById("diagramDeckPresetSelect"),
  diagramDeckingDraftStatus: document.getElementById("diagramDeckingDraftStatus"),
  diagramDeckingDraftEditor: document.getElementById("diagramDeckingDraftEditor"),
  diagramApplyDeckingToSelectionBtn: document.getElementById("diagramApplyDeckingToSelectionBtn"),
  diagramApplyDeckingToBoxBtn: document.getElementById("diagramApplyDeckingToBoxBtn"),
  diagramApplyDeckingToPolygonBtn: document.getElementById("diagramApplyDeckingToPolygonBtn"),
  diagramClearDeckingBtn: document.getElementById("diagramClearDeckingBtn"),
  diagramDeckingApplyStatus: document.getElementById("diagramDeckingApplyStatus"),
  diagramHolePopupBackdrop: document.getElementById("diagramHolePopupBackdrop"),
  diagramHolePopup: document.getElementById("diagramHolePopup"),
  diagramHolePopupTitle: document.getElementById("diagramHolePopupTitle"),
  diagramHolePopupStatus: document.getElementById("diagramHolePopupStatus"),
  diagramHolePopupBurdenInput: document.getElementById("diagramHolePopupBurdenInput"),
  diagramHolePopupSpacingInput: document.getElementById("diagramHolePopupSpacingInput"),
  diagramHolePopupDiameterInput: document.getElementById("diagramHolePopupDiameterInput"),
  diagramHolePopupAngleInput: document.getElementById("diagramHolePopupAngleInput"),
  diagramHolePopupBearingInput: document.getElementById("diagramHolePopupBearingInput"),
  diagramHolePopupDepthInput: document.getElementById("diagramHolePopupDepthInput"),
  diagramHolePopupSubdrillInput: document.getElementById("diagramHolePopupSubdrillInput"),
  diagramHolePopupStemHeightInput: document.getElementById("diagramHolePopupStemHeightInput"),
  diagramHolePopupCornerStatus: document.getElementById("diagramHolePopupCornerStatus"),
  diagramHolePopupSetCornerBtns: [...document.querySelectorAll("[data-hole-popup-corner-set]")],
  diagramHolePopupClearCornerBtn: document.getElementById("diagramHolePopupClearCornerBtn"),
  diagramHolePopupSaveBtn: document.getElementById("diagramHolePopupSaveBtn"),
  diagramHolePopupCancelBtn: document.getElementById("diagramHolePopupCancelBtn"),
  plannerMappingOverlay: document.getElementById("plannerMappingOverlay"),
  plannerMappingDialog: document.getElementById("plannerMappingDialog"),
  plannerMappingTitle: document.getElementById("plannerMappingTitle"),
  plannerMappingSummary: document.getElementById("plannerMappingSummary"),
  plannerMappingBody: document.getElementById("plannerMappingBody"),
  plannerMappingCloseBtn: document.getElementById("plannerMappingCloseBtn"),
  printWorkspace: document.getElementById("printWorkspace"),
  printToolbar: document.querySelector(".print-toolbar"),
  printPageStrip: document.getElementById("printPageStrip"),
  printPageTabs: document.getElementById("printPageTabs"),
  printAddPageBreakBtn: document.getElementById("printAddPageBreakBtn"),
  printAddTimingPageBtn: document.getElementById("printAddTimingPageBtn"),
  printAddPageBtn: document.getElementById("printAddPageBtn"),
  printCanvas: document.getElementById("printCanvas"),
  printPaperFrame: document.getElementById("printPaperFrame"),
  printPagesOutput: document.getElementById("printPagesOutput"),
  printBackBtn: document.getElementById("printBackBtn"),
  printActionBtn: document.getElementById("printActionBtn"),
  printFitBtn: document.getElementById("printFitBtn"),
  printPageBreakBtn: document.getElementById("printPageBreakBtn"),
  printCancelPageBreakBtn: document.getElementById("printCancelPageBreakBtn"),
  printEditLabelsBtn: document.getElementById("printEditLabelsBtn"),
  printResetLabelsBtn: document.getElementById("printResetLabelsBtn"),
  printTextScaleInput: document.getElementById("printTextScaleInput"),
  printColorModeToggle: document.getElementById("printColorModeToggle"),
  printRelationshipToggleWrap: document.getElementById("printRelationshipToggleWrap"),
  printRelationshipToggle: document.getElementById("printRelationshipToggle"),
  printTimingToggleWrap: document.getElementById("printTimingToggleWrap"),
  printTimingToggle: document.getElementById("printTimingToggle"),
  printAngleToggleWrap: document.getElementById("printAngleToggleWrap"),
  printAngleToggle: document.getElementById("printAngleToggle"),
  printBearingToggleWrap: document.getElementById("printBearingToggleWrap"),
  printBearingToggle: document.getElementById("printBearingToggle"),
  printBearingArrowWeightWrap: document.getElementById("printBearingArrowWeightWrap"),
  printBearingArrowWeightInput: document.getElementById("printBearingArrowWeightInput"),
  printBearingArrowLengthWrap: document.getElementById("printBearingArrowLengthWrap"),
  printBearingArrowLengthInput: document.getElementById("printBearingArrowLengthInput"),
  printDepthToggleWrap: document.getElementById("printDepthToggleWrap"),
  printDepthToggle: document.getElementById("printDepthToggle"),
  printCornerCoordsToggleWrap: document.getElementById("printCornerCoordsToggleWrap"),
  printCornerCoordsToggle: document.getElementById("printCornerCoordsToggle"),
  helpWorkspace: document.getElementById("helpWorkspace"),
  helpBackBtn: document.getElementById("helpBackBtn"),
};

const solverRenderer = new DiagramRenderer(document.getElementById("diagramCanvas"), {
  stateRef: solverState,
  onHoleClick: handleSolverHoleClick,
  onHoleHover: handleSolverHoleHover,
  onPointerUp: handleSolverPointerUp,
  onHoleContextMenu: () => {},
  onViewChange: handleSolverRendererViewChange,
});

const diagramRenderer = new DiagramRenderer(document.getElementById("diagramMakerCanvas"), {
  stateRef: diagramState,
  onHoleClick: handleDiagramHoleClick,
  onHoleHover: () => {},
  onPointerUp: handleDiagramPointerUp,
  onPointerDown: handleDiagramPointerDown,
  onPointerMove: handleDiagramPointerMove,
  onDoubleClick: () => false,
  onHoleContextMenu: handleDiagramHoleContextMenu,
  onCanvasContextMenu: handleDiagramCanvasContextMenu,
  onViewChange: handleDiagramRendererViewChange,
});

const printRenderer = new DiagramRenderer(document.getElementById("printCanvas"), {
  stateRef: null,
  isPrintRenderer: true,
  onHoleClick: handlePrintHoleClick,
  onHoleHover: () => {},
  onPointerUp: handlePrintPointerUp,
  onPointerDown: handlePrintPointerDown,
  onPointerMove: handlePrintPointerMove,
  onHoleContextMenu: () => {},
  onViewChange: handlePrintRendererViewChange,
});

const timingControlsApi = initTimingControls(solverState, els, () => {
  resetTimingResults();
  solverRenderer.render();
});

function isSolverWorkspaceActive() {
  return appUi.activeWorkspace === "delaySolver";
}

function isDiagramWorkspaceActive() {
  return appUi.activeWorkspace === "diagramMaker";
}

function activePlannerMode() {
  if (appUi.activeWorkspace === "delaySolver") return "timing";
  if (appUi.activeWorkspace === "diagramMaker") return appUi.plannerMode === "loading" ? "loading" : "diagram";
  return WORKSPACE_TO_MODE[appUi.activeWorkspace] || null;
}

function activeRenderer() {
  return isDiagramWorkspaceActive() ? diagramRenderer : solverRenderer;
}

function closeAllMenus() {
  const stickyMenuId = isDiagramWorkspaceActive() && diagramState.ui.pendingFaceDesignation ? "diagramPatternMenu" : null;
  els.menuPanels.forEach((panel) => {
    if (panel.classList.contains("planner-docked-panel")) {
      panel.classList.remove("hidden");
      return;
    }
    panel.classList.toggle("hidden", panel.id !== stickyMenuId);
  });
  els.menuToggles.forEach((button) => {
    const panel = document.getElementById(button.dataset.menuToggle || "");
    if (panel?.classList.contains("planner-docked-panel")) {
      button.classList.remove("active");
      return;
    }
    button.classList.toggle("active", button.dataset.menuToggle === stickyMenuId);
  });
}

function renderPlannerStatusIndicator() {
  const mode = activePlannerMode();
  if (!mode) {
    els.plannerStatusIndicator.classList.add("hidden");
    els.plannerStatusIndicator.textContent = "";
    return;
  }
  const totalHoles = projectState.holes.length;
  const selectedCount = diagramState.selection.size;
  const loadedSummary = summarizeShotLoading(diagramState.holes, diagramState.metadata.loadingDensityGcc);
  const hasTiming = solverState.timingResults.length > 0;
  let text = "Shot status unavailable";
  if (mode === "timing") {
    const readiness = analyzeSolverReadiness();
    text = totalHoles
      ? `${totalHoles} holes | ${hasTiming ? `${solverState.timingResults.length} timing` : (readiness.originSelected ? "ready" : "set origin")}`
      : "No shot loaded";
  } else if (mode === "loading") {
    text = totalHoles
      ? `${totalHoles} holes | ${loadedSummary.includedHoleCount ? `${loadedSummary.includedHoleCount} loaded` : "no loading"}`
      : "No shot loaded";
  } else {
    text = totalHoles
      ? `${totalHoles} holes | ${selectedCount || 0} selected`
      : "No shot loaded";
  }
  els.plannerStatusIndicator.textContent = text;
  els.plannerStatusIndicator.classList.remove("hidden");
}

function renderWorkspaceChrome() {
  const workspace = appUi.activeWorkspace;
  const solverActive = workspace === "delaySolver";
  const diagramActive = workspace === "diagramMaker";
  const plannerMode = activePlannerMode();

  els.homeWorkspace.classList.toggle("hidden", workspace !== "home");
  els.delaySolverWorkspace.classList.toggle("hidden", !solverActive);
  els.diagramMakerWorkspace.classList.toggle("hidden", !diagramActive);
  els.homeNavBtn.classList.toggle("hidden", workspace === "home");
  els.plannerModeToggle.classList.toggle("hidden", workspace === "home");
  els.helpBtn.classList.toggle("hidden", !(solverActive || diagramActive));
  els.csvExportBtn.classList.toggle("hidden", !solverActive);
  els.exportPdfBtn.classList.toggle("hidden", !(solverActive || diagramActive));
  els.workspaceTitle.textContent = plannerMode ? plannerMode.charAt(0).toUpperCase() + plannerMode.slice(1) : (WORKSPACE_TITLES[workspace] || "Workspace");
  els.plannerDiagramModeBtn.classList.toggle("active", plannerMode === "diagram");
  els.plannerTimingModeBtn.classList.toggle("active", plannerMode === "timing");
  if (els.plannerLoadingModeBtn) els.plannerLoadingModeBtn.classList.toggle("active", plannerMode === "loading");

  if (!solverActive) {
    els.timingVisualizationControls.classList.add("hidden");
  } else {
    renderTimingVisualizationControls();
  }
  syncPlannerModePanels();
  syncTimingSolveFloating();
  renderPlannerStatusIndicator();
  refreshPlannerCardSummaries();
}

function setActiveWorkspace(workspaceId) {
  if (!Object.hasOwn(WORKSPACE_TITLES, workspaceId)) return;
  if (appUi.activeWorkspace === "delaySolver" && workspaceId !== "delaySolver") resetTimingVisualization();
  if (appUi.activeWorkspace === "diagramMaker" && workspaceId !== "diagramMaker") {
    diagramState.ui.pendingFaceDesignation = false;
    diagramState.ui.selectionPolygonDraft = null;
  }
  if (workspaceId !== "diagramMaker") closeDiagramHolePopup();
  closeMappingOverlay();
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

function switchPlannerMode(nextMode) {
  if (!["diagram", "timing", "loading"].includes(nextMode)) return;
  const nextWorkspace = nextMode === "timing" ? "delaySolver" : "diagramMaker";
  if (appUi.activeWorkspace === nextWorkspace && activePlannerMode() === nextMode) return;
  syncCurrentWorkspaceToProject();
  appUi.plannerMode = nextMode;
  if (nextMode === "diagram" || nextMode === "loading") {
    hydrateDiagramFromProject();
    setActiveWorkspace("diagramMaker");
    requestAnimationFrame(() => {
      setDiagramToolMode(diagramState.ui.activeTool);
      applyProjectViewToMode(diagramState, els.diagramCoordViewSelect, diagramRenderer, projectState.view.coordView, projectState.view);
      fullDiagramRefresh();
    });
    return;
  }
  hydrateSolverFromProject();
  setActiveWorkspace("delaySolver");
  requestAnimationFrame(() => {
    setToolMode(solverState.ui.toolMode);
    applyProjectViewToMode(solverState, els.coordViewSelect, solverRenderer, projectState.view.coordView, projectState.view);
    fullSolverRefresh();
  });
}

function toggleMenu(menuId) {
  const panel = document.getElementById(menuId);
  const button = els.menuToggles.find((item) => item.dataset.menuToggle === menuId);
  if (!panel || !button) return;
  if (panel.classList.contains("planner-docked-panel")) return;
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

els.diagramHolePopup.addEventListener("click", (event) => event.stopPropagation());
els.diagramHolePopup.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  event.stopPropagation();
});
els.diagramHolePopupBackdrop.addEventListener("click", () => closeDiagramHolePopup());
els.diagramHolePopupBackdrop.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  event.stopPropagation();
});
els.plannerMappingDialog?.addEventListener("click", (event) => event.stopPropagation());
els.plannerMappingOverlay?.addEventListener("click", () => closeMappingOverlay());

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
  if (panel.classList.contains("planner-docked-panel")) return;
  closeAllMenus();
  panel.classList.remove("hidden");
  button.classList.add("active");
}

function createPlannerSidebar(className) {
  const sidebar = document.createElement("aside");
  sidebar.className = `planner-sidebar ${className}`;
  return sidebar;
}

function createPlannerSection(className = "") {
  const section = document.createElement("div");
  section.className = `planner-sidebar-section ${className}`.trim();
  return section;
}

function dockPlannerPanel(container, panel, modes) {
  if (!container || !panel) return;
  panel.classList.add("planner-docked-panel");
  panel.classList.remove("hidden");
  if (modes) panel.dataset.plannerModes = modes;
  container.appendChild(panel);
}

function dockPlannerNode(container, node, modes, extraClass = "") {
  if (!container || !node) return;
  if (extraClass) node.classList.add(extraClass);
  if (modes) node.dataset.plannerModes = modes;
  container.appendChild(node);
}

function initTimingPlannerLayout() {
  if (els.delaySolverWorkspace.querySelector(".planner-sidebar-left")) return;
  els.delaySolverWorkspace.classList.add("planner-workspace");
  const canvasWrap = els.delaySolverWorkspace.querySelector(".canvas-wrap");
  const left = createPlannerSidebar("planner-sidebar-left");
  const right = createPlannerSidebar("planner-sidebar-right");
  const leftHeader = createPlannerSection("planner-sidebar-header");
  const leftMain = createPlannerSection();
  const rightMain = createPlannerSection();
  const timingModeToggle = canvasWrap.querySelector(".timing-mode-toggle");
  const timingActions = canvasWrap.querySelector(".timing-toolbar-actions");
  const toolkit = els.delaySolverWorkspace.querySelector(".floating-toolkit");
  const centerOverlay = document.createElement("div");
  centerOverlay.className = "planner-center-overlay";
  left.append(leftHeader, leftMain);
  right.append(rightMain);
  els.delaySolverWorkspace.insertBefore(left, canvasWrap);
  els.delaySolverWorkspace.insertBefore(right, canvasWrap.nextSibling);
  dockPlannerNode(leftHeader, timingModeToggle, "timing");
  dockPlannerNode(leftHeader, timingActions, "timing");
  dockPlannerPanel(leftMain, els.viewMenu, "timing");
  dockPlannerPanel(leftMain, els.relationshipMenu, "timing");
  dockPlannerPanel(leftMain, els.timingMenu, "timing");
  dockPlannerPanel(rightMain, els.timingResultsMenu, "timing");
  if (toolkit) {
    centerOverlay.appendChild(toolkit);
    canvasWrap.appendChild(centerOverlay);
  }
}

function initDiagramPlannerLayout() {
  if (els.diagramMakerWorkspace.querySelector(".planner-sidebar-left")) return;
  els.diagramMakerWorkspace.classList.add("planner-workspace");
  const canvasWrap = els.diagramMakerWorkspace.querySelector(".canvas-wrap");
  const left = createPlannerSidebar("planner-sidebar-left");
  const right = createPlannerSidebar("planner-sidebar-right");
  const leftMain = createPlannerSection();
  const rightMain = createPlannerSection();
  const toolkit = els.diagramMakerWorkspace.querySelector(".floating-toolkit");
  const centerOverlay = document.createElement("div");
  centerOverlay.className = "planner-center-overlay";
  left.append(leftMain);
  right.append(rightMain);
  els.diagramMakerWorkspace.insertBefore(left, canvasWrap);
  els.diagramMakerWorkspace.insertBefore(right, canvasWrap.nextSibling);
  dockPlannerPanel(leftMain, els.diagramShotMenu, "diagram");
  dockPlannerPanel(leftMain, els.diagramImportMenu, "diagram");
  dockPlannerPanel(leftMain, els.diagramPatternMenu, "diagram");
  dockPlannerPanel(leftMain, els.diagramViewMenu, "diagram");
  dockPlannerPanel(leftMain, els.diagramLoadingMenu, "loading");
  dockPlannerPanel(rightMain, els.diagramPropertiesMenu, "diagram,loading");
  dockPlannerPanel(rightMain, els.diagramVolumeMenu, "diagram,loading");
  if (toolkit) {
    centerOverlay.appendChild(toolkit);
    canvasWrap.appendChild(centerOverlay);
  }
}

function initPrintLayout() {
  if (els.printWorkspace.querySelector(".print-sidebar-left")) return;
  els.printWorkspace.classList.add("print-layout");
  const left = document.createElement("aside");
  left.className = "print-sidebar print-sidebar-left";
  const right = document.createElement("aside");
  right.className = "print-sidebar print-sidebar-right";
  els.printWorkspace.insertBefore(left, els.printPageStrip);
  left.appendChild(els.printPageStrip);
  els.printWorkspace.insertBefore(right, els.printStage);
  right.appendChild(els.printToolbar);
}

function syncPlannerModePanels() {
  const mode = activePlannerMode();
  document.querySelectorAll("[data-planner-modes]").forEach((node) => {
    const modes = String(node.dataset.plannerModes || "").split(",").map((item) => item.trim()).filter(Boolean);
    const visible = mode && modes.includes(mode);
    node.classList.toggle("planner-mode-hidden", !visible);
  });
  if (!mode) return;
  const annotationControls = els.diagramAnnotationColorInput?.closest(".toolkit-inline-controls");
  els.diagramMarkupToolBtn?.classList.toggle("planner-mode-hidden", mode === "loading");
  els.diagramTextToolBtn?.classList.toggle("planner-mode-hidden", mode === "loading");
  annotationControls?.classList.toggle("planner-mode-hidden", mode === "loading");
}

function initPlannerLayouts() {
  initTimingPlannerLayout();
  initDiagramPlannerLayout();
  initPrintLayout();
}

function plannerCardSummaryText(panelId) {
  if (panelId === "importMenu") {
    if (solverState.csvCache?.headers?.length) return `${solverState.csvCache.records.length} rows loaded. Map columns to import.`;
    return projectState.holes.length ? `${projectState.holes.length} holes currently in project.` : "Choose a CSV to start timing import.";
  }
  if (panelId === "diagramImportMenu") {
    if (diagramState.csvCache?.headers?.length) return `${diagramState.csvCache.records.length} rows loaded. Map columns to import.`;
    return diagramState.holes.length ? `${diagramState.holes.length} holes currently in diagram.` : "Choose a CSV to start diagram import.";
  }
  if (panelId === "diagramShotMenu") {
    const shot = diagramState.metadata.shotNumber || "No shot number";
    const location = diagramState.metadata.location || "No location";
    return `${shot} | ${location}`;
  }
  if (panelId === "diagramPatternMenu") {
    return `${faceHoleCount()} face holes designated`;
  }
  if (panelId === "diagramViewMenu") {
    return `Coord view: ${diagramState.ui.coordView || "collar"}`;
  }
  if (panelId === "diagramPropertiesMenu") {
    return diagramState.selection.size
      ? `${diagramState.selection.size} hole${diagramState.selection.size === 1 ? "" : "s"} selected`
      : "No holes selected";
  }
  if (panelId === "diagramLoadingMenu") {
    const summary = summarizeDiagramLoading();
    return summary.includedHoleCount
      ? `${summary.includedHoleCount} loaded hole${summary.includedHoleCount === 1 ? "" : "s"}`
      : "No loading assigned yet";
  }
  if (panelId === "diagramVolumeMenu") {
    const summary = summarizeDiagramVolume();
    return summary.includedHoleCount
      ? `${summary.includedHoleCount} holes | ${formatVolumeNumber(summary.tons)} tons`
      : "Volume unavailable";
  }
  if (panelId === "relationshipMenu") {
    const readiness = analyzeSolverReadiness();
    return readiness.relationshipsCount
      ? `${readiness.relationshipsCount} relationships | origin ${readiness.originSelected ? "set" : "missing"}`
      : "No timing pathing defined";
  }
  if (panelId === "viewMenu") {
    return `Coord view: ${solverState.ui.coordView || "collar"}`;
  }
  if (panelId === "timingMenu") {
    return activeTimingMode() === "manual" ? "Manual timing values ready" : "Solver ranges ready";
  }
  if (panelId === "timingResultsMenu") {
    return solverState.timingResults.length
      ? `${solverState.timingResults.length} timing result${solverState.timingResults.length === 1 ? "" : "s"}`
      : (solverState.solverMessage || defaultTimingMessage());
  }
  return "";
}

function setPlannerCardSummary(panelId, text) {
  const card = appUi.plannerPanelCards.get(panelId);
  if (!card?.summary) return;
  card.summary.textContent = text || "";
}

function collapsePlannerCard(card, collapsed) {
  if (!card) return;
  card.panel.classList.toggle("collapsed", collapsed);
  card.header.setAttribute("aria-expanded", collapsed ? "false" : "true");
  if (card.chevron) card.chevron.textContent = collapsed ? "+" : "-";
}

function setPlannerCardExpanded(panelId, expanded, { exclusive = true } = {}) {
  const card = appUi.plannerPanelCards.get(panelId);
  if (!card) return;
  if (expanded && exclusive) {
    appUi.plannerPanelCards.forEach((other) => {
      if (other === card || other.rail !== card.rail) return;
      collapsePlannerCard(other, true);
    });
  }
  collapsePlannerCard(card, !expanded);
}

function initPlannerCard(panel, { defaultExpanded = false, compactImport = false } = {}) {
  if (!panel || appUi.plannerPanelCards.has(panel.id)) return;
  const titleNode = panel.querySelector("h2");
  const title = titleNode?.textContent?.trim() || "Panel";
  const header = document.createElement("button");
  header.type = "button";
  header.className = "planner-card-header";
  header.setAttribute("aria-expanded", defaultExpanded ? "true" : "false");
  const titleRow = document.createElement("span");
  titleRow.className = "planner-card-title-row";
  const titleSpan = document.createElement("span");
  titleSpan.className = "planner-card-title";
  titleSpan.textContent = title;
  const chevron = document.createElement("span");
  chevron.className = "planner-card-chevron";
  chevron.textContent = defaultExpanded ? "-" : "+";
  titleRow.append(titleSpan, chevron);
  const summary = document.createElement("span");
  summary.className = "planner-card-summary";
  header.append(titleRow, summary);
  const body = document.createElement("div");
  body.className = "planner-card-body";
  const nodes = [...panel.childNodes];
  nodes.forEach((node) => {
    if (node === titleNode) return;
    body.appendChild(node);
  });
  if (titleNode) titleNode.remove();
  panel.prepend(body);
  panel.prepend(header);
  panel.classList.add("planner-card");
  if (compactImport) panel.classList.add("compact-import");
  const rail = panel.closest(".planner-sidebar");
  const card = { panel, header, summary, body, chevron, rail };
  appUi.plannerPanelCards.set(panel.id, card);
  collapsePlannerCard(card, !defaultExpanded);
  header.addEventListener("click", () => {
    const currentlyExpanded = header.getAttribute("aria-expanded") === "true";
    setPlannerCardExpanded(panel.id, !currentlyExpanded);
  });
  setPlannerCardSummary(panel.id, plannerCardSummaryText(panel.id));
}

function refreshPlannerCardSummaries() {
  appUi.plannerPanelCards.forEach((_, panelId) => setPlannerCardSummary(panelId, plannerCardSummaryText(panelId)));
  syncImportPanelUi("solver");
  syncImportPanelUi("diagram");
}

function ensureImportPanelUi(mode) {
  const key = mode === "diagram" ? "diagram" : "solver";
  if (appUi.plannerImportUi[key]) return appUi.plannerImportUi[key];
  const panel = key === "diagram" ? els.diagramImportMenu : els.importMenu;
  const body = panel?.querySelector(".planner-card-body");
  if (!panel || !body) return null;
  const summary = document.createElement("div");
  summary.className = "status-note planner-import-summary";
  const actions = document.createElement("div");
  actions.className = "planner-import-actions";
  const mapBtn = document.createElement("button");
  mapBtn.type = "button";
  mapBtn.textContent = "Map Columns";
  actions.appendChild(mapBtn);
  body.append(summary, actions);
  mapBtn.addEventListener("click", () => openMappingOverlay(key));
  appUi.plannerImportUi[key] = { summary, mapBtn };
  return appUi.plannerImportUi[key];
}

function syncImportPanelUi(mode) {
  const ui = ensureImportPanelUi(mode);
  if (!ui) return;
  const isDiagram = mode === "diagram";
  const cache = isDiagram ? diagramState.csvCache : solverState.csvCache;
  const importedCount = isDiagram ? diagramState.holes.length : projectState.holes.length;
  if (cache?.headers?.length && importedCount) {
    ui.summary.textContent = `${importedCount} holes imported. Open mapping to remap this CSV or choose a new file.`;
    ui.mapBtn.disabled = false;
    ui.mapBtn.textContent = "Remap Columns";
    return;
  }
  if (cache?.headers?.length) {
    ui.summary.textContent = `${cache.records.length} rows ready. Open mapping to choose columns.`;
    ui.mapBtn.disabled = false;
    ui.mapBtn.textContent = "Map Columns";
    return;
  }
  if (importedCount) {
    ui.summary.textContent = `${importedCount} holes imported. Choose a new CSV or remap if you load one.`;
    ui.mapBtn.disabled = true;
    ui.mapBtn.textContent = "Map Columns";
    return;
  }
  ui.summary.textContent = "No CSV selected yet.";
  ui.mapBtn.disabled = true;
  ui.mapBtn.textContent = "Map Columns";
}

function initPlannerCards() {
  initPlannerCard(els.importMenu, { compactImport: true });
  initPlannerCard(els.viewMenu);
  initPlannerCard(els.relationshipMenu, { defaultExpanded: true });
  initPlannerCard(els.timingMenu);
  initPlannerCard(els.timingResultsMenu, { defaultExpanded: true });
  initPlannerCard(els.diagramShotMenu, { defaultExpanded: true });
  initPlannerCard(els.diagramImportMenu, { compactImport: true });
  initPlannerCard(els.diagramPatternMenu);
  initPlannerCard(els.diagramViewMenu);
  initPlannerCard(els.diagramLoadingMenu, { defaultExpanded: true });
  initPlannerCard(els.diagramPropertiesMenu, { defaultExpanded: true });
  initPlannerCard(els.diagramVolumeMenu);
  refreshPlannerCardSummaries();
}

function closeMappingOverlay() {
  appUi.activeMappingTarget = null;
  els.plannerMappingOverlay.classList.add("hidden");
  els.plannerMappingOverlay.setAttribute("aria-hidden", "true");
  els.mappingPanel.classList.add("hidden");
  els.diagramMappingPanel.classList.add("hidden");
}

function openMappingOverlay(target) {
  const isDiagram = target === "diagram";
  const panel = isDiagram ? els.diagramMappingPanel : els.mappingPanel;
  const cache = isDiagram ? diagramState.csvCache : solverState.csvCache;
  if (!panel || !cache?.headers?.length) return;
  appUi.activeMappingTarget = isDiagram ? "diagram" : "solver";
  els.plannerMappingTitle.textContent = isDiagram ? "Diagram CSV Mapping" : "Timing CSV Mapping";
  els.plannerMappingSummary.textContent = `${cache.records.length} rows loaded. Choose columns, then import.`;
  if (!panel.parentElement || panel.parentElement !== els.plannerMappingBody) els.plannerMappingBody.appendChild(panel);
  els.mappingPanel.classList.toggle("hidden", isDiagram);
  els.diagramMappingPanel.classList.toggle("hidden", !isDiagram);
  panel.classList.remove("hidden");
  els.plannerMappingOverlay.classList.remove("hidden");
  els.plannerMappingOverlay.setAttribute("aria-hidden", "false");
}

function isSignedIn() {
  return Boolean(appUi.authSession?.user);
}

function activeUserEmail() {
  return appUi.authSession?.user?.email || "";
}

function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function setCurrentProjectRef(projectId, projectName = "") {
  appUi.currentProjectId = projectId || null;
  appUi.currentProjectName = projectName || "";
}

function markProjectDirty() {
  if (appUi.suspendDirtyTracking) return;
  appUi.dirty = true;
  renderCloudProjectUi();
}

function setProjectSavedState(projectId, projectName = "") {
  setCurrentProjectRef(projectId, projectName);
  appUi.dirty = false;
  renderCloudProjectUi();
}

function resetCurrentProjectRef() {
  setCurrentProjectRef(null, "");
  appUi.dirty = false;
  renderCloudProjectUi();
}

function requireConfiguredSupabase() {
  if (isSupabaseConfigured()) return true;
  window.alert(supabaseConfigMessage());
  return false;
}

function requireSignedIn() {
  if (!requireConfiguredSupabase()) return false;
  if (isSignedIn()) return true;
  window.alert("Sign in with your email and password before using cloud projects.");
  openMenu("accountMenu");
  return false;
}

function serializeCurrentProject() {
  syncCurrentWorkspaceToProject();
  return serializeProjectDocument(projectState);
}

function replaceProjectStateFromDocument(document) {
  const parsed = parseProjectDocument(document);
  appUi.suspendDirtyTracking = true;
  refreshProjectHoles(parsed.holes);
  projectState.csvCache = parsed.csvCache;
  projectState.geo = cloneGeoMetadata(parsed.geo);
  projectState.view.coordView = parsed.view.coordView || "collar";
  projectState.view.zoom = Number(parsed.view.zoom) || 1;
  projectState.view.panX = Number(parsed.view.panX) || 0;
  projectState.view.panY = Number(parsed.view.panY) || 0;
  projectState.view.rotationDeg = Number(parsed.view.rotationDeg) || 0;
  projectState.diagram.ui = {
    ...projectState.diagram.ui,
    ...(parsed.diagram.ui || {}),
    pendingFaceDesignation: false,
    faceDesignationReturnTool: "single",
  };
  projectState.diagram.metadata = cloneDiagramMetadata(parsed.diagram.metadata);
  projectState.diagram.shotCorners = cloneShotCorners(parsed.diagram.shotCorners);
  projectState.diagram.annotations = cloneDiagramAnnotations(parsed.diagram.annotations);
  projectState.timing.ui = {
    ...projectState.timing.ui,
    ...(parsed.timing.ui || {}),
  };
  projectState.timing.timing = cloneTimingRanges(parsed.timing.timing);
  projectState.timing.manualTiming = cloneManualTiming(parsed.timing.manualTiming);
  projectState.timing.relationships = cloneRelationshipsState(parsed.timing.relationships);
  projectState.timing.timingResults = cloneTimingResults(parsed.timing.timingResults);
  projectState.timing.solverMessage = parsed.timing.solverMessage || "";
  projectState.timing.timingVisualization = cloneTimingVisualizationState(parsed.timing.timingVisualization);
  if (!projectState.geo.statePlaneEpsg && projectState.diagram.metadata.location) {
    applyProjectGeoFromLocation(projectState.diagram.metadata.location);
  }
  if (projectState.geo.statePlaneEpsg) {
    projectState.holes.forEach((hole) => refreshHoleDerivedCoordinatesForGeo(hole, projectState.geo));
    refreshProjectHoles(projectState.holes);
  }
  hydrateDiagramFromProject();
  hydrateSolverFromProject();
  renderCloudProjectUi();
  renderQuarryOptions();
  requestAnimationFrame(() => {
    if (isDiagramWorkspaceActive()) {
      applyProjectViewToMode(diagramState, els.diagramCoordViewSelect, diagramRenderer, projectState.view.coordView, projectState.view);
      fullDiagramRefresh();
    } else if (isSolverWorkspaceActive()) {
      applyProjectViewToMode(solverState, els.coordViewSelect, solverRenderer, projectState.view.coordView, projectState.view);
      fullSolverRefresh();
    } else {
      renderDiagramShotPanel();
      renderDiagramVolumePanel();
    }
    appUi.suspendDirtyTracking = false;
  });
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportProjectFile() {
  const filename = `${(appUi.currentProjectName || "blast-project").replace(/[^\w-]+/g, "-")}.json`;
  downloadJsonFile(filename, serializeCurrentProject());
}

async function importProjectFile(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid project file.");
  }
  replaceProjectStateFromDocument(parsed);
  resetCurrentProjectRef();
  appUi.dirty = true;
  renderCloudProjectUi();
}

function renderCloudProjectsList() {
  if (!isSupabaseConfigured()) {
    els.cloudProjectsList.innerHTML = `<div class="status-note">${escapeHtml(supabaseConfigMessage())}</div>`;
    return;
  }
  if (!isSignedIn()) {
    els.cloudProjectsList.innerHTML = '<div class="status-note">Sign in to load, rename, or delete cloud projects.</div>';
    return;
  }
  if (!appUi.cloudProjects.length) {
    els.cloudProjectsList.innerHTML = '<div class="status-note">No cloud projects yet.</div>';
    return;
  }
  els.cloudProjectsList.innerHTML = appUi.cloudProjects.map((project) => `
    <div class="project-row">
      <div class="project-row-title">
        <strong>${escapeHtml(project.name || "Untitled Project")}</strong>
        <span>${escapeHtml(formatTimestamp(project.updated_at) || "No timestamp")}</span>
      </div>
      <div class="project-row-actions">
        <button type="button" data-cloud-action="load" data-cloud-id="${escapeHtml(project.id)}">Load</button>
        <button type="button" data-cloud-action="rename" data-cloud-id="${escapeHtml(project.id)}">Rename</button>
        <button type="button" data-cloud-action="delete" data-cloud-id="${escapeHtml(project.id)}">Delete</button>
      </div>
    </div>
  `).join("");
}

function renderAuthUi() {
  if (!isSupabaseConfigured()) {
    els.authStatus.textContent = "Supabase not configured";
    els.accountStatus.textContent = supabaseConfigMessage();
    els.authSignInBtn.disabled = true;
    els.authSignUpBtn.disabled = true;
    els.authSignOutBtn.disabled = true;
    return;
  }
  if (isSignedIn()) {
    els.authStatus.textContent = `Signed in as ${activeUserEmail()}`;
    els.accountStatus.textContent = `Signed in as ${activeUserEmail()}`;
    els.authSignInBtn.disabled = false;
    els.authSignUpBtn.disabled = false;
    els.authSignOutBtn.disabled = false;
    return;
  }
  els.authStatus.textContent = "Signed out";
  els.accountStatus.textContent = "Enter your email and password to sign in or create an account.";
  els.authSignInBtn.disabled = false;
  els.authSignUpBtn.disabled = false;
  els.authSignOutBtn.disabled = true;
}

function renderCloudProjectUi() {
  const currentName = appUi.currentProjectName || "Local draft";
  const dirtySuffix = appUi.dirty ? " (unsaved)" : "";
  if (!isSupabaseConfigured()) {
    els.cloudProjectStatus.textContent = supabaseConfigMessage();
    els.cloudSaveBtn.disabled = true;
    els.cloudSaveAsBtn.disabled = true;
    els.cloudRefreshProjectsBtn.disabled = true;
    els.cloudMenuBtn.disabled = false;
    renderCloudProjectsList();
    return;
  }
  els.cloudSaveBtn.disabled = !isSignedIn();
  els.cloudSaveAsBtn.disabled = !isSignedIn();
  els.cloudRefreshProjectsBtn.disabled = !isSignedIn();
  els.cloudProjectStatus.textContent = isSignedIn()
    ? `Current project: ${currentName}${dirtySuffix}`
    : `Current project: ${currentName}${dirtySuffix}. Sign in to use cloud save.`;
  renderCloudProjectsList();
}

function renderQuarryOptions() {
  const select = els.diagramShotLocationSelect;
  const currentValue = diagramState.metadata.location || projectState.diagram.metadata.location || "";
  const quarries = appUi.quarries || [];
  const optionMarkup = ['<option value="">Select location</option>']
    .concat(quarries.map((quarry) => `<option value="${escapeHtml(quarry.name)}">${escapeHtml(quarry.name)}</option>`));
  if (currentValue && !quarries.some((quarry) => quarry.name === currentValue)) {
    optionMarkup.push(`<option value="${escapeHtml(currentValue)}">${escapeHtml(currentValue)}</option>`);
  }
  select.innerHTML = optionMarkup.join("");
  select.value = currentValue;
}

async function refreshCloudProjects() {
  if (!requireSignedIn()) return;
  const projects = await listCloudProjects();
  appUi.cloudProjects = projects;
  renderCloudProjectUi();
}

async function refreshQuarries() {
  if (!isSupabaseConfigured() || !isSignedIn()) {
    appUi.quarries = getDefaultQuarries();
    if (!projectState.geo.statePlaneEpsg && (diagramState.metadata.location || projectState.diagram.metadata.location)) {
      applyProjectGeoFromLocation(diagramState.metadata.location || projectState.diagram.metadata.location);
    }
    renderQuarryOptions();
    return;
  }
  appUi.quarries = await listQuarries();
  if (!projectState.geo.statePlaneEpsg && (diagramState.metadata.location || projectState.diagram.metadata.location)) {
    applyProjectGeoFromLocation(diagramState.metadata.location || projectState.diagram.metadata.location);
  }
  renderQuarryOptions();
}

async function saveProjectToCloud({ forcePrompt = false } = {}) {
  if (!requireSignedIn()) return;
  const document = serializeCurrentProject();
  let projectName = appUi.currentProjectName;
  if (forcePrompt || !appUi.currentProjectId || !projectName) {
    const proposed = window.prompt("Project name", projectName || "Untitled Project");
    if (!proposed) return;
    projectName = proposed.trim();
    if (!projectName) return;
  }
  let saved;
  if (appUi.currentProjectId && !forcePrompt) {
    saved = await updateCloudProject({ id: appUi.currentProjectId, name: projectName, document });
  } else {
    saved = await createCloudProject({ name: projectName, document });
  }
  setProjectSavedState(saved.id, saved.name || projectName);
  await refreshCloudProjects();
}

async function loadProjectFromCloud(projectId) {
  if (!requireSignedIn()) return;
  const record = await loadCloudProject(projectId);
  replaceProjectStateFromDocument(record.document);
  setProjectSavedState(record.id, record.name || "");
  closeAllMenus();
}

async function renameProjectInCloud(projectId) {
  if (!requireSignedIn()) return;
  const existing = appUi.cloudProjects.find((project) => project.id === projectId);
  const nextName = window.prompt("Rename project", existing?.name || appUi.currentProjectName || "Untitled Project");
  if (!nextName) return;
  const trimmedName = nextName.trim();
  if (!trimmedName) return;
  const saved = await renameCloudProject(projectId, trimmedName);
  if (appUi.currentProjectId === projectId) setCurrentProjectRef(projectId, saved.name || trimmedName);
  await refreshCloudProjects();
  renderCloudProjectUi();
}

async function deleteProjectFromCloud(projectId) {
  if (!requireSignedIn()) return;
  const existing = appUi.cloudProjects.find((project) => project.id === projectId);
  if (!window.confirm(`Delete "${existing?.name || "this project"}" from the cloud?`)) return;
  await deleteCloudProject(projectId);
  if (appUi.currentProjectId === projectId) resetCurrentProjectRef();
  await refreshCloudProjects();
}

async function syncAuthSession(session) {
  appUi.authSession = session || null;
  renderAuthUi();
  renderCloudProjectUi();
  try {
    if (isSignedIn()) {
      await refreshCloudProjects();
      await refreshQuarries();
    } else {
      appUi.cloudProjects = [];
      appUi.quarries = getDefaultQuarries();
      renderCloudProjectUi();
      renderQuarryOptions();
    }
  } catch (error) {
    console.error(error);
    window.alert(error.message || "Supabase sync failed.");
  }
}

async function initializeCloudIntegration() {
  renderAuthUi();
  appUi.quarries = getDefaultQuarries();
  renderCloudProjectUi();
  renderQuarryOptions();
  if (!isSupabaseConfigured()) return;
  onAuthStateChange((session) => {
    syncAuthSession(session);
  });
  const session = await getAuthSession();
  await syncAuthSession(session);
}

function cloneSelectedTiming(selectedTiming) {
  if (!selectedTiming) return [];
  const holeTimes = new Map(selectedTiming.holeTimes);
  const originalHoleTimes = selectedTiming.originalHoleTimes ? new Map(selectedTiming.originalHoleTimes) : new Map(holeTimes);
  const adjustedHoleTimes = selectedTiming.adjustedHoleTimes ? new Map(selectedTiming.adjustedHoleTimes) : new Map(holeTimes);
  const derived = deriveTimingAnalysis(holeTimes, 8);
  return [{
    ...selectedTiming,
    holeTimes,
    originalHoleTimes,
    adjustedHoleTimes,
    deckTimes: selectedTiming.deckTimes ? new Map(selectedTiming.deckTimes) : new Map(),
    displayTimesByHoleId: selectedTiming.displayTimesByHoleId ? new Map(selectedTiming.displayTimesByHoleId) : new Map(),
    offsetAssignments: selectedTiming.offsetAssignments ? new Map(selectedTiming.offsetAssignments) : new Map(),
    timingAdjustments: Array.isArray(selectedTiming.timingAdjustments) ? selectedTiming.timingAdjustments.map((entry) => ({ ...entry })) : [],
    delayCounts: Array.isArray(selectedTiming.delayCounts) ? selectedTiming.delayCounts.map((entry) => ({ ...entry })) : [],
    peakBinCount: Number.isFinite(selectedTiming.peakBinCount) ? selectedTiming.peakBinCount : derived.peakBinCount,
    peakBinWeightLb: Number.isFinite(selectedTiming.peakBinWeightLb) ? selectedTiming.peakBinWeightLb : derived.peakBinWeightLb,
    overlapGroupCount: Number.isFinite(selectedTiming.overlapGroupCount) ? selectedTiming.overlapGroupCount : derived.overlapGroupCount,
    overlapGroups: Array.isArray(selectedTiming.overlapGroups) && selectedTiming.overlapGroups.length
      ? selectedTiming.overlapGroups.map((group) => ({ ...group, holeIds: [...(group.holeIds || [])], deckIds: [...(group.deckIds || [])] }))
      : derived.overlapGroups,
  }];
}

function cloneHole(hole) {
  return {
    ...hole,
    collar: cloneHolePoint(hole.collar),
    toe: cloneHolePoint(hole.toe),
    original: hole.original ? { ...hole.original } : hole.original,
    coordinates: cloneCoordinateBundle(hole.coordinates),
    detonators: cloneMaterialEntries(hole.detonators),
    boosters: cloneMaterialEntries(hole.boosters),
    deckStemIntervals: Array.isArray(hole.deckStemIntervals)
      ? hole.deckStemIntervals.map((interval) => ({
        startDepth: Number.isFinite(Number(interval.startDepth)) ? Number(interval.startDepth) : 0,
        endDepth: Number.isFinite(Number(interval.endDepth)) ? Number(interval.endDepth) : 0,
      }))
      : [],
    decks: Array.isArray(hole.decks)
      ? hole.decks.map((deck) => ({
        ...deck,
        detonators: cloneMaterialEntries(deck.detonators),
        boosters: cloneMaterialEntries(deck.boosters),
      }))
      : [],
  };
}

function cloneHolePoint(point = null) {
  if (!point || typeof point !== "object") return point;
  return {
    ...point,
    original: point.original ? { ...point.original } : point.original,
    coordinates: cloneCoordinateBundle(point.coordinates),
  };
}

function cloneCoordinateValue(point = null) {
  if (!point || typeof point !== "object") return point;
  return {
    x: Number.isFinite(Number(point.x)) ? Number(point.x) : point.x ?? null,
    y: Number.isFinite(Number(point.y)) ? Number(point.y) : point.y ?? null,
    lat: Number.isFinite(Number(point.lat)) ? Number(point.lat) : point.lat ?? null,
    lon: Number.isFinite(Number(point.lon)) ? Number(point.lon) : point.lon ?? null,
    unit: point.unit || null,
    epsg: Number.isFinite(Number(point.epsg)) ? Number(point.epsg) : point.epsg ?? null,
  };
}

function cloneCoordinateBundle(bundle = null) {
  if (!bundle || typeof bundle !== "object") return bundle;
  return {
    local: cloneCoordinateValue(bundle.local),
    statePlane: cloneCoordinateValue(bundle.statePlane),
    latLon: cloneCoordinateValue(bundle.latLon),
  };
}

function cloneGeoMetadata(geo = {}) {
  return {
    quarryName: geo.quarryName || "",
    statePlaneEpsg: Number.isFinite(Number(geo.statePlaneEpsg)) ? Number(geo.statePlaneEpsg) : null,
    statePlaneUnit: geo.statePlaneUnit || "ft",
  };
}

function cloneShotCorners(corners = []) {
  return Array.isArray(corners) ? corners.map((corner) => (corner ? String(corner) : null)) : [null, null, null, null];
}

function cloneDiagramMetadata(metadata = {}) {
  return {
    shotNumber: metadata.shotNumber || "",
    location: metadata.location || "",
    bench: metadata.bench || "",
    defaultDiameter: Number.isFinite(Number(metadata.defaultDiameter)) ? Number(metadata.defaultDiameter) : null,
    patternSubdrill: Number.isFinite(Number(metadata.patternSubdrill)) ? Number(metadata.patternSubdrill) : null,
    faceBurden: Number.isFinite(Number(metadata.faceBurden)) ? Number(metadata.faceBurden) : null,
    faceSpacing: Number.isFinite(Number(metadata.faceSpacing)) ? Number(metadata.faceSpacing) : null,
    interiorBurden: Number.isFinite(Number(metadata.interiorBurden)) ? Number(metadata.interiorBurden) : null,
    interiorSpacing: Number.isFinite(Number(metadata.interiorSpacing)) ? Number(metadata.interiorSpacing) : null,
    loadingDensityGcc: normalizeLoadingDensity(metadata.loadingDensityGcc),
    rockDensityTonsPerCubicYard: Number.isFinite(Number(metadata.rockDensityTonsPerCubicYard)) ? Number(metadata.rockDensityTonsPerCubicYard) : 2.3,
    quarryStatePlaneEpsg: Number.isFinite(Number(metadata.quarryStatePlaneEpsg)) ? Number(metadata.quarryStatePlaneEpsg) : null,
    quarryStatePlaneUnit: metadata.quarryStatePlaneUnit || "ft",
  };
}

function cloneDiagramAnnotations(annotations = {}) {
  return {
    strokes: (annotations.strokes || []).map((stroke) => ({
      color: stroke.color || "#000000",
      size: stroke.size || "medium",
      points: (stroke.points || []).map((point) => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 })),
    })),
    texts: (annotations.texts || []).map((item) => ({
      id: item.id || `text-${Math.random().toString(36).slice(2, 10)}`,
      text: item.text || "",
      color: item.color || "#000000",
      size: item.size || "medium",
      anchor: item.anchor ? { x: Number(item.anchor.x) || 0, y: Number(item.anchor.y) || 0 } : { x: 0, y: 0 },
    })),
  };
}

function cloneRelationshipsState(relationships = {}) {
  return {
    originHoleId: relationships.originHoleId || null,
    edges: (relationships.edges || []).map((edge) => ({ ...edge })),
    nextId: relationships.nextId || 1,
  };
}

function cloneTimingRanges(timing = {}) {
  return {
    holeToHole: {
      min: Number(timing.holeToHole?.min) || 16,
      max: Number(timing.holeToHole?.max) || 34,
    },
    rowToRow: {
      min: Number(timing.rowToRow?.min) || 84,
      max: Number(timing.rowToRow?.max) || 142,
    },
    offset: {
      min: Number(timing.offset?.min) || 17,
      max: Number(timing.offset?.max) || 42,
    },
    interdeck: {
      min: Number(timing.interdeck?.min) || 0,
      max: Number(timing.interdeck?.max) || 0,
    },
  };
}

function cloneManualTiming(manualTiming = {}) {
  return {
    holeDelay: Number.isFinite(Number(manualTiming.holeDelay)) ? Number(manualTiming.holeDelay) : 16,
    rowDelay: Number.isFinite(Number(manualTiming.rowDelay)) ? Number(manualTiming.rowDelay) : 84,
    offsetDelay: Number.isFinite(Number(manualTiming.offsetDelay)) ? Number(manualTiming.offsetDelay) : 17,
    interdeckDelay: Number.isFinite(Number(manualTiming.interdeckDelay)) ? Number(manualTiming.interdeckDelay) : 0,
  };
}

function cloneTimingResults(results = []) {
  return results.map((result) => {
    const holeTimes = result.holeTimes ? new Map(result.holeTimes) : new Map();
    const originalHoleTimes = result.originalHoleTimes ? new Map(result.originalHoleTimes) : new Map(holeTimes);
    const derived = deriveTimingAnalysis(holeTimes, 8);
    return {
      ...result,
      holeTimes,
      originalHoleTimes,
      deckTimes: result.deckTimes ? new Map(result.deckTimes) : new Map(),
      displayTimesByHoleId: result.displayTimesByHoleId ? new Map(result.displayTimesByHoleId) : new Map(),
      offsetAssignments: result.offsetAssignments ? new Map(result.offsetAssignments) : new Map(),
      timingAdjustments: Array.isArray(result.timingAdjustments) ? result.timingAdjustments.map((entry) => ({ ...entry })) : [],
      delayCounts: Array.isArray(result.delayCounts) ? result.delayCounts.map((entry) => ({ ...entry })) : [],
      peakBinCount: Number.isFinite(result.peakBinCount) ? result.peakBinCount : derived.peakBinCount,
      peakBinWeightLb: Number.isFinite(result.peakBinWeightLb) ? result.peakBinWeightLb : derived.peakBinWeightLb,
      overlapGroupCount: Number.isFinite(result.overlapGroupCount) ? result.overlapGroupCount : derived.overlapGroupCount,
      overlapGroups: Array.isArray(result.overlapGroups) && result.overlapGroups.length
        ? result.overlapGroups.map((group) => ({ ...group, holeIds: [...(group.holeIds || [])], deckIds: [...(group.deckIds || [])] }))
        : derived.overlapGroups,
    };
  });
}

function cloneTimingVisualizationState(playback = {}) {
  return {
    speedMultiplier: Number(playback.speedMultiplier) || 1,
    activeSpeedMultiplier: Number(playback.activeSpeedMultiplier) || Number(playback.speedMultiplier) || 1,
    isPlaying: false,
    startTimestamp: 0,
    lastFrameTimestamp: 0,
    tailStartTimestamp: 0,
    elapsedMs: Number(playback.elapsedMs) || 0,
    completed: playback.completed === true,
    resultIndexAtStart: -1,
    frameRequestId: null,
  };
}

function resetTimingOverlapAnalysis({ preservePanel = false } = {}) {
  solverState.ui.activeOverlapBinKey = null;
  if (!preservePanel) solverState.ui.showOverlapAnalysis = false;
}

function refreshProjectHoles(holes = []) {
  projectState.holes = holes.map(cloneHole);
  projectState.holesById = new Map(projectState.holes.map((hole) => [hole.id, hole]));
}

function updateProjectViewFromRenderer(renderer) {
  if (!renderer?.viewState) return;
  const view = renderer.viewState();
  projectState.view.zoom = Number(view.zoom) || 1;
  projectState.view.panX = Number(view.panX) || 0;
  projectState.view.panY = Number(view.panY) || 0;
  projectState.view.rotationDeg = Number(view.rotationDeg) || 0;
}

function hydrateSolverFromProject() {
  solverState.holes = projectState.holes.map(cloneHole);
  rebuildHolesById(solverState);
  solverState.selection = new Set();
  solverState.csvCache = projectState.csvCache;
  solverState.relationships = cloneRelationshipsState(projectState.timing.relationships);
  solverState.timing = cloneTimingRanges(projectState.timing.timing);
  solverState.manualTiming = cloneManualTiming(projectState.timing.manualTiming);
  solverState.timingResults = cloneTimingResults(projectState.timing.timingResults);
  solverState.solverMessage = projectState.timing.solverMessage || "";
  solverState.ui.showGrid = projectState.timing.ui.showGrid !== false;
  solverState.ui.showRelationships = projectState.timing.ui.showRelationships !== false;
  solverState.ui.showOverlayText = projectState.timing.ui.showOverlayText !== false;
  solverState.ui.timingMode = projectState.timing.ui.timingMode === "manual" ? "manual" : "solver";
  solverState.ui.toolMode = projectState.timing.ui.toolMode || "origin";
  solverState.ui.coordView = projectState.view.coordView || "collar";
  solverState.ui.activeTimingPreviewIndex = Number.isInteger(projectState.timing.ui.activeTimingPreviewIndex)
    ? projectState.timing.ui.activeTimingPreviewIndex
    : -1;
  solverState.ui.showOverlapAnalysis = false;
  solverState.ui.activeOverlapBinKey = null;
  solverState.ui.relationshipDraft = null;
  solverState.ui.readinessDismissed = false;
  solverState.ui.solveProgress = { current: 0, total: 0 };
  solverState.ui.isSolving = false;
  solverState.ui.timingVisualization = cloneTimingVisualizationState(projectState.timing.timingVisualization);
  timingControlsApi?.syncFromState?.();
  syncManualTimingInputs();
  renderTimingModeControls();
}

function hydrateDiagramFromProject() {
  diagramState.holes = projectState.holes.map(cloneHole);
  rebuildHolesById(diagramState);
  diagramState.selection = new Set();
  diagramState.csvCache = projectState.csvCache;
  diagramState.ui.showGrid = projectState.diagram.ui.showGrid !== false;
  diagramState.ui.showOverlayText = projectState.diagram.ui.showOverlayText === true;
  diagramState.ui.coordView = projectState.view.coordView || "collar";
  diagramState.ui.showAngleLabels = projectState.diagram.ui.showAngleLabels !== false;
  diagramState.ui.showBearingLabels = projectState.diagram.ui.showBearingLabels === true;
  diagramState.ui.showBearingArrows = projectState.diagram.ui.showBearingArrows === true;
  diagramState.ui.showDepthLabels = projectState.diagram.ui.showDepthLabels !== false;
  diagramState.ui.activeTool = normalizeAnnotationTool(projectState.diagram.ui.activeTool || "single");
  diagramState.ui.selectionBoxDraft = null;
  diagramState.ui.selectionPolygonDraft = null;
  diagramState.ui.annotationColor = projectState.diagram.ui.annotationColor || "#000000";
  diagramState.ui.annotationSize = projectState.diagram.ui.annotationSize || "medium";
  diagramState.ui.loadingDraft = {
    detonators: [],
    boosters: [],
  };
  diagramState.ui.deckingDraft = {
    interdeckTimingMode: "top-first",
    decks: [],
    stemIntervals: [],
  };
  diagramState.ui.pendingDeckingApplyMode = null;
  diagramState.ui.currentStrokeDraft = null;
  diagramState.ui.selectedTextId = null;
  diagramState.ui.dragTextId = null;
  diagramState.ui.dragTextPointerDelta = null;
  diagramState.ui.pendingFaceDesignation = false;
  diagramState.ui.faceDesignationReturnTool = "single";
  diagramState.metadata = cloneDiagramMetadata(projectState.diagram.metadata);
  diagramState.shotCorners = cloneShotCorners(projectState.diagram.shotCorners);
  diagramState.annotations = cloneDiagramAnnotations(projectState.diagram.annotations);
  sanitizeShotCorners(diagramState);
}

function persistTimingStateToProject() {
  refreshProjectHoles(solverState.holes);
  projectState.csvCache = solverState.csvCache;
  projectState.view.coordView = solverState.ui.coordView || "collar";
  updateProjectViewFromRenderer(solverRenderer);
  projectState.timing.ui.showGrid = solverState.ui.showGrid !== false;
  projectState.timing.ui.showRelationships = solverState.ui.showRelationships !== false;
  projectState.timing.ui.showOverlayText = solverState.ui.showOverlayText !== false;
  projectState.timing.ui.timingMode = solverState.ui.timingMode === "manual" ? "manual" : "solver";
  projectState.timing.ui.toolMode = solverState.ui.toolMode || "origin";
  projectState.timing.ui.activeTimingPreviewIndex = Number.isInteger(solverState.ui.activeTimingPreviewIndex)
    ? solverState.ui.activeTimingPreviewIndex
    : -1;
  delete projectState.timing.ui.showOverlapAnalysis;
  delete projectState.timing.ui.activeOverlapBinKey;
  projectState.timing.timing = cloneTimingRanges(solverState.timing);
  projectState.timing.manualTiming = cloneManualTiming(solverState.manualTiming);
  projectState.timing.relationships = cloneRelationshipsState(solverState.relationships);
  projectState.timing.timingResults = cloneTimingResults(solverState.timingResults);
  projectState.timing.solverMessage = solverState.solverMessage || "";
  projectState.timing.timingVisualization = cloneTimingVisualizationState(solverState.ui.timingVisualization);
  markProjectDirty();
}

function persistDiagramStateToProject() {
  refreshProjectHoles(diagramState.holes);
  projectState.csvCache = diagramState.csvCache;
  projectState.geo = activeProjectGeo();
  projectState.view.coordView = diagramState.ui.coordView || "collar";
  updateProjectViewFromRenderer(diagramRenderer);
  projectState.diagram.ui.showGrid = diagramState.ui.showGrid !== false;
  projectState.diagram.ui.showOverlayText = diagramState.ui.showOverlayText === true;
  projectState.diagram.ui.showAngleLabels = diagramState.ui.showAngleLabels !== false;
  projectState.diagram.ui.showBearingLabels = diagramState.ui.showBearingLabels === true;
  projectState.diagram.ui.showBearingArrows = diagramState.ui.showBearingArrows === true;
  projectState.diagram.ui.showDepthLabels = diagramState.ui.showDepthLabels !== false;
  projectState.diagram.ui.activeTool = diagramState.ui.activeTool || "single";
  projectState.diagram.ui.annotationColor = diagramState.ui.annotationColor || "#000000";
  projectState.diagram.ui.annotationSize = diagramState.ui.annotationSize || "medium";
  projectState.diagram.ui.pendingFaceDesignation = false;
  projectState.diagram.ui.faceDesignationReturnTool = "single";
  projectState.diagram.metadata = cloneDiagramMetadata(diagramState.metadata);
  projectState.diagram.shotCorners = cloneShotCorners(diagramState.shotCorners);
  projectState.diagram.annotations = cloneDiagramAnnotations(diagramState.annotations);
  markProjectDirty();
}

function syncCurrentWorkspaceToProject() {
  if (isDiagramWorkspaceActive()) persistDiagramStateToProject();
  if (isSolverWorkspaceActive()) persistTimingStateToProject();
}

function handleSolverRendererViewChange() {
  if (!isSolverWorkspaceActive()) return;
  projectState.view.coordView = solverState.ui.coordView || "collar";
  updateProjectViewFromRenderer(solverRenderer);
}

function handleDiagramRendererViewChange() {
  if (!isDiagramWorkspaceActive()) return;
  projectState.view.coordView = diagramState.ui.coordView || "collar";
  updateProjectViewFromRenderer(diagramRenderer);
}

function applyProjectViewToMode(targetState, selectEl, renderer, targetView, view) {
  applyCoordinateView(targetState, selectEl, renderer, targetView, { fit: false });
  renderer.applyViewState({
    zoom: Number(view?.zoom) || 1,
    panX: Number(view?.panX) || 0,
    panY: Number(view?.panY) || 0,
    rotationDeg: Number(view?.rotationDeg) || 0,
  });
}

function initializeProjectFromHoles(holes, csvCache = null) {
  refreshProjectHoles(holes);
  projectState.csvCache = csvCache;
  projectState.geo = activeProjectGeo();
  projectState.view.coordView = "collar";
  projectState.view.zoom = 1;
  projectState.view.panX = 0;
  projectState.view.panY = 0;
  projectState.view.rotationDeg = 0;
  projectState.diagram.metadata = cloneDiagramMetadata();
  Object.assign(projectState.diagram.metadata, {
    location: diagramState.metadata.location || "",
    quarryStatePlaneEpsg: activeProjectGeo().statePlaneEpsg,
    quarryStatePlaneUnit: activeProjectGeo().statePlaneUnit,
  });
  projectState.diagram.shotCorners = [null, null, null, null];
  projectState.diagram.annotations = cloneDiagramAnnotations();
  projectState.diagram.ui.showGrid = true;
  projectState.diagram.ui.showOverlayText = false;
  projectState.diagram.ui.showAngleLabels = true;
  projectState.diagram.ui.showBearingLabels = false;
  projectState.diagram.ui.showBearingArrows = true;
  projectState.diagram.ui.showDepthLabels = true;
  projectState.diagram.ui.activeTool = "single";
  projectState.diagram.ui.annotationColor = "#000000";
  projectState.diagram.ui.annotationSize = "medium";
  projectState.diagram.ui.pendingFaceDesignation = false;
  projectState.diagram.ui.faceDesignationReturnTool = "single";
  projectState.timing.relationships = { originHoleId: null, edges: [], nextId: 1 };
  projectState.timing.timingResults = [];
  projectState.timing.solverMessage = "";
  projectState.timing.ui.showGrid = true;
  projectState.timing.ui.showRelationships = true;
  projectState.timing.ui.showOverlayText = true;
  projectState.timing.ui.timingMode = "solver";
  projectState.timing.ui.toolMode = "origin";
  projectState.timing.ui.activeTimingPreviewIndex = -1;
  projectState.timing.manualTiming = cloneManualTiming();
  projectState.timing.timingVisualization = cloneTimingVisualizationState();
  resetCurrentProjectRef();
  appUi.dirty = true;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function activeTimingMode() {
  return solverState.ui.timingMode === "manual" ? "manual" : "solver";
}

function defaultTimingMessage() {
  return activeTimingMode() === "manual"
    ? "Enter manual H2H, R2R, Offset, and Interdeck values, then apply manual timing."
    : "Run solver to see best delay combinations.";
}

function timingRangeCount(min, max) {
  const a = Math.floor(Number(min) || 0);
  const b = Math.floor(Number(max) || 0);
  return Math.max(0, Math.abs(b - a)) + 1;
}

function advancedSolveCombinationCount() {
  const offsetEdgeCount = solverState.relationships.edges.filter((edge) => edge.type === "offset").length;
  return timingRangeCount(solverState.timing.holeToHole.min, solverState.timing.holeToHole.max)
    * timingRangeCount(solverState.timing.rowToRow.min, solverState.timing.rowToRow.max)
    * timingRangeCount(solverState.timing.interdeck.min, solverState.timing.interdeck.max)
    * (timingRangeCount(solverState.timing.offset.min, solverState.timing.offset.max) ** offsetEdgeCount);
}

function formatSolveCount(value) {
  return Number.isFinite(value) ? value.toLocaleString() : "0";
}

function clampTimingSolveFloatingPosition(left, top) {
  const rect = els.timingSolveFloating.getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
  const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
  return {
    left: Math.min(Math.max(8, left), maxLeft),
    top: Math.min(Math.max(8, top), maxTop),
  };
}

function setTimingSolveFloatingPosition(left, top) {
  const clamped = clampTimingSolveFloatingPosition(left, top);
  els.timingSolveFloating.style.left = `${clamped.left}px`;
  els.timingSolveFloating.style.top = `${clamped.top}px`;
  els.timingSolveFloating.style.right = "auto";
}

function ensureTimingSolveFloatingDefaultPosition() {
  if (timingSolveFloatingState.hasMoved) return;
  els.timingSolveFloating.style.left = "auto";
  els.timingSolveFloating.style.top = "84px";
  els.timingSolveFloating.style.right = "18px";
}

function startTimingSolveFloatingDrag(event) {
  const rect = els.timingSolveFloating.getBoundingClientRect();
  timingSolveFloatingState.dragging = true;
  timingSolveFloatingState.pointerOffsetX = event.clientX - rect.left;
  timingSolveFloatingState.pointerOffsetY = event.clientY - rect.top;
}

function shouldShowTimingSolveFloating() {
  return isSolverWorkspaceActive()
    && !els.delaySolverWorkspace.classList.contains("planner-workspace")
    && activeTimingMode() === "solver"
    && solverState.ui.readinessDismissed !== true;
}

function showTimingSolveFloating() {
  ensureTimingSolveFloatingDefaultPosition();
  els.timingSolveFloating.classList.remove("hidden");
}

function hideTimingSolveFloating() {
  els.timingSolveFloating.classList.add("hidden");
}

function solverReadinessFlags(readiness = analyzeSolverReadiness()) {
  return {
    originReady: readiness.originSelected,
    reachableReady: readiness.totalHoles > 0 && readiness.reachableCount === readiness.totalHoles,
    conflictsReady: readiness.relationshipsCount > 0 && !readiness.conflictingPaths,
  };
}

function syncSolveButtonState(readiness = analyzeSolverReadiness()) {
  const manualMode = activeTimingMode() === "manual";
  const { originReady, reachableReady, conflictsReady } = solverReadinessFlags(readiness);
  const readyToRun = originReady && reachableReady && conflictsReady;
  els.solveTimingBtn.classList.toggle("solver-ready", !manualMode && readyToRun);
  els.solveTimingBtn.classList.toggle("solver-not-ready", !manualMode && !readyToRun);
}

function syncTimingSolveFloating() {
  if (!shouldShowTimingSolveFloating()) {
    hideTimingSolveFloating();
    syncSolveButtonState();
    return;
  }
  showTimingSolveFloating();
  const readiness = analyzeSolverReadiness();
  const { originReady, reachableReady, conflictsReady } = solverReadinessFlags(readiness);
  els.timingFloatingOriginValue.closest(".timing-solve-floating-row")?.classList.toggle("is-ready", originReady);
  els.timingFloatingReachableValue.closest(".timing-solve-floating-row")?.classList.toggle("is-ready", reachableReady);
  els.timingFloatingConflictsValue.closest(".timing-solve-floating-row")?.classList.toggle("is-ready", conflictsReady);
  els.timingFloatingOriginValue.textContent = originReady ? "Ready" : "No";
  els.timingFloatingReachableValue.textContent = `${readiness.reachableCount} / ${readiness.totalHoles}`;
  els.timingFloatingConflictsValue.textContent = readiness.conflictingPaths ? "Conflict" : "Clear";
  syncSolveButtonState(readiness);
}

function updateTimingSolveProgress(current = 0, total = 0) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeCurrent = Math.max(0, Math.min(safeTotal || Number(current) || 0, Number(current) || 0));
  solverState.ui.solveProgress = { current: safeCurrent, total: safeTotal };
  syncTimingSolveFloating();
}

function createSolverWorker() {
  const worker = new Worker(new URL("./solverWorker.js", import.meta.url), { type: "module" });
  worker.onmessage = (event) => {
    const data = event.data || {};
    if (data.type === "progress") {
      updateTimingSolveProgress(data.current, data.total);
      if (solverState.ui.isSolving) renderTimingResults();
      return;
    }
    if (data.type === "result") {
      solverState.timingResults = cloneTimingResults(data.results || []);
      solverState.ui.activeTimingPreviewIndex = solverState.timingResults.length ? 0 : -1;
      solverState.ui.readinessDismissed = solverState.timingResults.length > 0;
      solverState.solverMessage = solverState.timingResults.length
        ? ""
        : (data.message || "No valid timing combinations were produced for the current graph.");
      renderTimingResults();
      if (solverState.timingResults.length) openMenu("timingResultsMenu");
      solverRenderer.render();
      return;
    }
    if (data.type === "error") {
      solverState.timingResults = [];
      solverState.ui.activeTimingPreviewIndex = -1;
      solverState.ui.readinessDismissed = false;
      solverState.solverMessage = data.message || "Timing solver failed.";
      renderTimingResults();
      solverRenderer.render();
      return;
    }
    if (data.type === "done") {
      solverState.ui.isSolving = false;
      syncTimingSolveFloating();
      renderTimingModeControls();
      persistTimingStateToProject();
    }
  };
  worker.onerror = (event) => {
    solverState.ui.isSolving = false;
    solverState.timingResults = [];
    solverState.ui.activeTimingPreviewIndex = -1;
    solverState.ui.readinessDismissed = false;
    solverState.solverMessage = event.message || "Timing solver worker failed.";
    syncTimingSolveFloating();
    renderTimingModeControls();
    renderTimingResults();
    solverRenderer.render();
  };
  return worker;
}

function ensureSolverWorker() {
  if (!solverWorker) solverWorker = createSolverWorker();
  return solverWorker;
}

function resetSolverWorker() {
  if (solverWorker) solverWorker.terminate();
  solverWorker = createSolverWorker();
}

function cancelTimingSolve({ keepMessage = false } = {}) {
  if (!solverState.ui.isSolving) return;
  solverState.ui.isSolving = false;
  resetSolverWorker();
  updateTimingSolveProgress(0, 0);
  if (!keepMessage) solverState.solverMessage = "Solve canceled.";
  syncTimingSolveFloating();
  renderTimingModeControls();
  renderTimingResults();
  solverRenderer.render();
}

function buildSolverWorkerPayload() {
  return {
    holes: solverState.holes.map((hole) => ({ id: hole.id, holeNumber: hole.holeNumber || hole.id })),
    relationships: {
      originHoleId: solverState.relationships.originHoleId,
      edges: solverState.relationships.edges.map((edge) => ({
        id: edge.id,
        type: edge.type,
        sign: edge.sign,
        fromHoleId: edge.fromHoleId,
        toHoleId: edge.toHoleId,
      })),
    },
  };
}

function addSymbolicEdgeKey(baseKey, edge) {
  const entries = [];
  if (baseKey) {
    for (const part of baseKey.split("|")) {
      if (!part) continue;
      const separatorIndex = part.lastIndexOf(":");
      if (separatorIndex <= 0) continue;
      const name = part.slice(0, separatorIndex);
      const rawValue = part.slice(separatorIndex + 1);
      const numericValue = Number(rawValue);
      if (name && numericValue) entries.push([name, numericValue]);
    }
  }
  const next = new Map(entries);
  if (edge.type === "holeToHole") {
    next.set("h2h", (next.get("h2h") || 0) + (edge.sign === -1 ? -1 : 1));
  } else if (edge.type === "rowToRow") {
    next.set("r2r", (next.get("r2r") || 0) + (edge.sign === -1 ? -1 : 1));
  } else if (edge.type === "offset") {
    next.set(`offset:${edge.id}`, (next.get(`offset:${edge.id}`) || 0) + 1);
  }
  return [...next.entries()]
    .filter(([, value]) => value)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, value]) => `${name}:${value}`)
    .join("|");
}

function analyzeSolverReadiness() {
  const holes = solverState.holes || [];
  const holeIds = new Set(holes.map((hole) => hole.id));
  const edges = (solverState.relationships?.edges || []).filter((edge) => holeIds.has(edge.fromHoleId) && holeIds.has(edge.toHoleId));
  const originHoleId = solverState.relationships?.originHoleId || null;
  const adjacency = new Map();
  edges.forEach((edge) => {
    if (!adjacency.has(edge.fromHoleId)) adjacency.set(edge.fromHoleId, []);
    adjacency.get(edge.fromHoleId).push(edge);
  });

  let reachableCount = 0;
  let conflictingPaths = false;

  if (originHoleId && holeIds.has(originHoleId)) {
    const visited = new Set();
    const expressionByHoleId = new Map([[originHoleId, ""]]);
    const queue = [originHoleId];
    while (queue.length) {
      const holeId = queue.shift();
      if (visited.has(holeId)) continue;
      visited.add(holeId);
      reachableCount += 1;
      const baseKey = expressionByHoleId.get(holeId) || "";
      for (const edge of adjacency.get(holeId) || []) {
        const nextKey = addSymbolicEdgeKey(baseKey, edge);
        if (!expressionByHoleId.has(edge.toHoleId)) {
          expressionByHoleId.set(edge.toHoleId, nextKey);
          queue.push(edge.toHoleId);
          continue;
        }
        if (expressionByHoleId.get(edge.toHoleId) !== nextKey) conflictingPaths = true;
      }
    }
  }

  return {
    originSelected: Boolean(originHoleId && holeIds.has(originHoleId)),
    relationshipsCount: edges.length,
    reachableCount,
    totalHoles: holes.length,
    conflictingPaths,
    offsetEdgesCount: edges.filter((edge) => edge.type === "offset").length,
    estimatedCombinations: advancedSolveCombinationCount(),
  };
}

function syncManualTimingInputs() {
  els.manualHoleDelayInput.value = String(solverState.manualTiming.holeDelay);
  els.manualRowDelayInput.value = String(solverState.manualTiming.rowDelay);
  els.manualOffsetDelayInput.value = String(solverState.manualTiming.offsetDelay);
  els.manualInterdeckDelayInput.value = String(solverState.manualTiming.interdeckDelay || 0);
}

function renderTimingModeControls() {
  const manualMode = activeTimingMode() === "manual";
  els.timingSolverModeBtn.classList.toggle("active", !manualMode);
  els.timingManualModeBtn.classList.toggle("active", manualMode);
  els.timingMenuTitle.textContent = manualMode ? "Manual Timing" : "Timing Ranges";
  els.timingSolverFields.classList.toggle("hidden", manualMode);
  els.timingManualFields.classList.toggle("hidden", !manualMode);
  els.solveTimingBtn.textContent = manualMode ? "Apply Manual Timing" : "Solve";
  els.solveTimingBtn.disabled = solverState.ui.isSolving && !manualMode;
  els.cancelTimingSolveBtn.classList.toggle("hidden", manualMode || !solverState.ui.isSolving);
  els.cancelTimingSolveBtn.disabled = !solverState.ui.isSolving;
  els.holeDelayMin.value = String(solverState.timing.holeToHole.min);
  els.holeDelayMax.value = String(solverState.timing.holeToHole.max);
  els.rowDelayMin.value = String(solverState.timing.rowToRow.min);
  els.rowDelayMax.value = String(solverState.timing.rowToRow.max);
  els.offsetDelayMin.value = String(solverState.timing.offset.min);
  els.offsetDelayMax.value = String(solverState.timing.offset.max);
  els.interdeckDelayMin.value = String(solverState.timing.interdeck.min);
  els.interdeckDelayMax.value = String(solverState.timing.interdeck.max);
  syncManualTimingInputs();
  updateTimingSolveProgress(solverState.ui.solveProgress.current, solverState.ui.solveProgress.total);
  syncTimingSolveFloating();
}

function setTimingMode(mode) {
  const nextMode = mode === "manual" ? "manual" : "solver";
  if (solverState.ui.timingMode === nextMode) return;
  if (solverState.ui.isSolving) cancelTimingSolve({ keepMessage: true });
  resetTimingVisualization();
  resetTimingOverlapAnalysis();
  solverState.ui.timingMode = nextMode;
  solverState.timingResults = [];
  solverState.ui.activeTimingPreviewIndex = -1;
  solverState.solverMessage = defaultTimingMessage();
  renderTimingModeControls();
  fullSolverRefresh();
}

function manualDelayCountsMarkup(result) {
  if (!Array.isArray(result.delayCounts) || !result.delayCounts.length) return "";
  const rows = result.delayCounts
    .map((entry) => `<div class="timing-delay-count-row"><span>${escapeHtml(`${entry.time}ms`)}</span><strong>${escapeHtml(`${entry.count} ${result.hasDecking ? `hole start${entry.count === 1 ? "" : "s"}` : `hole${entry.count === 1 ? "" : "s"}`}`)}</strong></div>`)
    .join("");
  return `<div class="timing-delay-counts">${rows}</div>`;
}

function currentTimingOverlapBin() {
  const result = selectedTimingResult();
  if (!result || !solverState.ui.activeOverlapBinKey) return null;
  return (result.overlapGroups || []).find((group) => group.key === solverState.ui.activeOverlapBinKey) || null;
}

function overlapHoleLabel(holeId) {
  const hole = solverState.holesById.get(holeId);
  return hole?.holeNumber || hole?.id || holeId;
}

function renderTimingOverlapAnalysis() {
  const result = selectedTimingResult();
  const hasResult = Boolean(result);
  const showPanel = hasResult && solverState.ui.showOverlapAnalysis === true;
  const overlapGroups = (result?.overlapGroups || []).filter((group) => group.isOverlapGroup && (group.deckCount || group.count) > 1);
  const activeWindow = currentTimingOverlapBin();

  els.timingOverlapAnalysisBtn.classList.toggle("hidden", !hasResult);
  els.timingOverlapClearBtn.classList.toggle("hidden", !hasResult);
  els.timingOverlapAnalysisBtn.textContent = showPanel ? "Hide Analysis" : "Overlap Analysis";
  els.timingOverlapClearBtn.disabled = !activeWindow;
  els.timingOverlapAnalysisPanel.classList.toggle("hidden", !showPanel);
  if (!showPanel) {
    els.timingOverlapSummary.textContent = "Select a timing result to inspect 8 ms overlap windows.";
    els.timingOverlapChart.innerHTML = "";
    return;
  }

  if (!overlapGroups.length) {
    els.timingOverlapSummary.textContent = result.hasDecking
      ? `No decks are firing within the same sliding 8 ms overlap window for the active timing result. Peak 8 ms window: ${result.peakBinCount} deck${result.peakBinCount === 1 ? "" : "s"} | ${formatLoadingWeight(result.peakBinWeightLb || 0)} lb.`
      : `No holes are firing within the same sliding 8 ms overlap window for the active timing result. Peak 8 ms window: ${result.peakBinCount} hole${result.peakBinCount === 1 ? "" : "s"}.`;
    els.timingOverlapChart.innerHTML = "";
    return;
  }

  const sortedGroups = [...overlapGroups].sort((a, b) => (b.deckCount || b.count) - (a.deckCount || a.count) || a.startMs - b.startMs);
  els.timingOverlapSummary.textContent = result.hasDecking
    ? `Peak 8 ms window: ${result.peakBinCount} decks | ${formatLoadingWeight(result.peakBinWeightLb || 0)} lb | Sliding overlap windows: ${sortedGroups.length}. Click a window to highlight its holes.`
    : `Peak 8 ms window: ${result.peakBinCount} hole${result.peakBinCount === 1 ? "" : "s"} | Sliding overlap windows: ${sortedGroups.length}. Click a window to highlight its holes.`;
  els.timingOverlapChart.innerHTML = `
    <div class="timing-overlap-list">
      ${sortedGroups.map((group) => {
        const active = activeWindow?.key === group.key ? "active" : "";
        const durationMs = Math.max(0, group.endMs - group.startMs);
        const holeMarkup = [...new Set(group.holeIds || [])]
          .map((holeId) => `<span class="timing-overlap-hole">${escapeHtml(String(overlapHoleLabel(holeId)))}</span>`)
          .join("");
        return `
          <button class="timing-overlap-card ${active}" type="button" data-overlap-bin="${escapeHtml(group.key)}" aria-pressed="${active ? "true" : "false"}">
            <span class="timing-overlap-card-head">
              <span class="timing-overlap-card-title">${escapeHtml(result.hasDecking ? `${group.deckCount || group.count} decks | ${formatLoadingWeight(group.totalExplosiveWeightLb || 0)} lb` : `${group.count} holes within sliding 8 ms`)}</span>
              <span class="timing-overlap-card-window">${escapeHtml(`${group.startMs.toFixed(1)}-${group.endMs.toFixed(1)} ms`)}</span>
            </span>
            <span class="timing-overlap-card-meta">${escapeHtml(`Spread: ${durationMs.toFixed(1)} ms`)}</span>
            <span class="timing-overlap-hole-list">${holeMarkup}</span>
          </button>
        `;
      }).join("")}
      <div class="timing-overlap-note">${escapeHtml(result.hasDecking ? "Each row lists the holes contributing decks that fire within the same sliding 8 ms overlap window." : "Each row lists the holes whose firing times land within the same sliding 8 ms overlap window.")}</div>
    </div>
  `;
}

function syncManualTimingFromInputs() {
  solverState.manualTiming.holeDelay = Number(els.manualHoleDelayInput.value) || 0;
  solverState.manualTiming.rowDelay = Number(els.manualRowDelayInput.value) || 0;
  solverState.manualTiming.offsetDelay = Number(els.manualOffsetDelayInput.value) || 0;
  solverState.manualTiming.interdeckDelay = Number(els.manualInterdeckDelayInput.value) || 0;
  persistTimingStateToProject();
}

function confirmLargeSolveIfNeeded() {
  const estimate = advancedSolveCombinationCount();
  if (estimate <= TIMING_SOLVE_WARNING_LIMIT) return true;
  return window.confirm(`Advanced solve is estimated at ${formatSolveCount(estimate)} combinations. Continue?`);
}

function startWorkerTimingSolve() {
  const validation = validateTimingGraph(solverState);
  if (!validation.valid) {
    resetTimingResults(validation.reason);
    solverRenderer.render();
    return;
  }
  if (!confirmLargeSolveIfNeeded()) return;
  resetTimingVisualization();
  resetTimingOverlapAnalysis();
  solverState.ui.readinessDismissed = false;
  solverState.solverMessage = "Running advanced solve...";
  const results = solveTimingCombinations(solverState);
  if (!results.length) {
    resetTimingResults("No valid timing combinations were found.");
    solverRenderer.render();
    return;
  }
  solverState.timingResults = results;
  solverState.ui.activeTimingPreviewIndex = 0;
  solverState.ui.isSolving = false;
  solverState.solverMessage = "";
  updateTimingSolveProgress(advancedSolveCombinationCount(), advancedSolveCombinationCount());
  renderTimingModeControls();
  renderTimingResults();
  if (solverState.timingResults.length) openMenu("timingResultsMenu");
  solverRenderer.render();
}

function cloneLabelLayoutMap(layoutMap = new Map()) {
  return new Map([...layoutMap.entries()].map(([holeId, offset]) => [holeId, { ...offset }]));
}

function normalizeDialAngle(angle) {
  const numeric = Number(angle);
  if (!Number.isFinite(numeric)) return 315;
  return ((numeric % 360) + 360) % 360;
}

function updatePrintLabelAngleDial(angle) {
  const normalized = normalizeDialAngle(angle);
  els.printLabelAngleDial.style.setProperty("--dial-angle", `${normalized}deg`);
  els.printLabelAngleDial.setAttribute("aria-valuenow", String(Math.round(normalized)));
  els.printLabelAngleValue.textContent = `${Math.round(normalized)} deg`;
}

function printLabelDistanceToTick(distance) {
  return clampPrintLabelDistance(distance) - PRINT_LABEL_DISTANCE_MIN;
}

function printLabelTickToDistance(tick) {
  return clampPrintLabelDistance(PRINT_LABEL_DISTANCE_MIN + (Number(tick) || 0));
}

function clampPrintLabelDistanceTick(tick) {
  return Math.max(0, Math.min(PRINT_LABEL_DISTANCE_MAX - PRINT_LABEL_DISTANCE_MIN, Number(tick) || 0));
}

function clampPrintLabelDistance(distance) {
  return Math.max(PRINT_LABEL_DISTANCE_MIN, Math.min(PRINT_LABEL_DISTANCE_MAX, Number(distance) || 0));
}

function updatePrintLabelDistanceControls(distance) {
  const clamped = clampPrintLabelDistance(distance);
  const tick = clampPrintLabelDistanceTick(printLabelDistanceToTick(clamped));
  els.printLabelDistanceValue.textContent = String(Math.round(tick));
  els.printLabelDistanceTickValue.textContent = String(Math.round(tick));
  els.printLabelDistanceDownBtn.disabled = tick <= 0;
  els.printLabelDistanceUpBtn.disabled = tick >= (PRINT_LABEL_DISTANCE_MAX - PRINT_LABEL_DISTANCE_MIN);
}

function activePrintLabelAngle() {
  return normalizeDialAngle(activePrintPage()?.ui?.labelAngleDeg);
}

function updatePrintLabelDistance(distance) {
  return clampPrintLabelDistance(distance);
}

function activePrintLabelDistance() {
  return clampPrintLabelDistance(activePrintPage()?.ui?.labelDistancePx);
}

function setActivePrintLabelAngle(angle) {
  const page = activePrintPage();
  if (!page || page.ui.workspaceMode !== "diagram") return;
  page.ui.labelAngleDeg = normalizeDialAngle(angle);
  updatePrintLabelAngleDial(page.ui.labelAngleDeg);
  printRenderer.render();
  renderPrintPageTabs();
}

function setActivePrintLabelDistance(distance) {
  const page = activePrintPage();
  if (!page || page.ui.workspaceMode !== "diagram") return;
  page.ui.labelDistancePx = clampPrintLabelDistance(distance);
  updatePrintLabelDistanceControls(page.ui.labelDistancePx);
  printRenderer.render();
  renderPrintPageTabs();
}

function pointerDialAngle(clientX, clientY) {
  const rect = els.printLabelAngleDial.getBoundingClientRect();
  const centerX = rect.left + (rect.width / 2);
  const centerY = rect.top + (rect.height / 2);
  const radians = Math.atan2(clientY - centerY, clientX - centerX);
  return normalizeDialAngle((radians * 180) / Math.PI + 90);
}

function clonePrintPage(page) {
  const holes = page.holes.map(cloneHole);
  const fullShotHoles = Array.isArray(page.fullShotHoles) && page.fullShotHoles.length
    ? page.fullShotHoles.map(cloneHole)
    : holes.map(cloneHole);
  return {
    pageType: page.pageType || (page?.ui?.workspaceMode === "diagram" ? "diagram" : "solver"),
    pageLabel: page?.pageLabel || null,
    pageBreakDraft: page?.pageBreakDraft === true,
    pageBreakSourcePage: null,
    profileHoleId: page.profileHoleId || null,
    holes,
    holesById: new Map(holes.map((hole) => [hole.id, hole])),
    fullShotHoles,
    selection: new Set(page.selection || []),
    ui: {
      ...page.ui,
      relationshipDraft: null,
      hoverLabelHoleId: null,
      selectionBoxDraft: null,
    },
    labelLayoutByHoleId: cloneLabelLayoutMap(page.labelLayoutByHoleId),
    cornerLabelLayoutByHoleId: cloneLabelLayoutMap(page.cornerLabelLayoutByHoleId),
    dragLabelHoleId: null,
    dragLabelKind: null,
    dragPointerDelta: null,
    metadata: cloneDiagramMetadata(page.metadata),
    annotations: cloneDiagramAnnotations(page.annotations),
    shotCorners: cloneShotCorners(page.shotCorners),
    relationships: {
      originHoleId: page.relationships?.originHoleId || null,
      edges: (page.relationships?.edges || []).map((edge) => ({ ...edge })),
      nextId: page.relationships?.nextId || 1,
    },
    timingResults: (page.timingResults || []).map((timing) => ({
      ...timing,
      holeTimes: new Map(timing.holeTimes),
      originalHoleTimes: timing.originalHoleTimes ? new Map(timing.originalHoleTimes) : new Map(timing.holeTimes),
      adjustedHoleTimes: timing.adjustedHoleTimes ? new Map(timing.adjustedHoleTimes) : new Map(timing.holeTimes),
      deckTimes: timing.deckTimes ? new Map(timing.deckTimes) : new Map(),
      displayTimesByHoleId: timing.displayTimesByHoleId ? new Map(timing.displayTimesByHoleId) : new Map(),
      offsetAssignments: timing.offsetAssignments ? new Map(timing.offsetAssignments) : new Map(),
      timingAdjustments: Array.isArray(timing.timingAdjustments) ? timing.timingAdjustments.map((entry) => ({ ...entry })) : [],
      delayCounts: Array.isArray(timing.delayCounts) ? timing.delayCounts.map((entry) => ({ ...entry })) : [],
      overlapGroups: Array.isArray(timing.overlapGroups)
        ? timing.overlapGroups.map((group) => ({ ...group, holeIds: [...(group.holeIds || [])], deckIds: [...(group.deckIds || [])] }))
        : [],
    })),
    viewport: {
      zoom: Number(page.viewport?.zoom) || 1,
      panX: Number(page.viewport?.panX) || 0,
      panY: Number(page.viewport?.panY) || 0,
      rotationDeg: Number(page.viewport?.rotationDeg) || 0,
    },
    colorMode: page.colorMode === "greyscale" ? "greyscale" : "color",
  };
}

function activePrintPage() {
  return printSession.pages[printSession.activePageIndex] || null;
}

function syncPrintPageHolesById(page) {
  page.holesById = new Map(page.holes.map((hole) => [hole.id, hole]));
}

function filterPrintPageToHoleIds(page, allowedHoleIds) {
  if (!page || page.pageType !== "diagram") return;
  const allowed = new Set(allowedHoleIds || []);
  page.holes = page.holes.filter((hole) => allowed.has(hole.id));
  syncPrintPageHolesById(page);
  page.selection = new Set([...page.selection].filter((holeId) => allowed.has(holeId)));
  page.labelLayoutByHoleId = new Map([...page.labelLayoutByHoleId.entries()].filter(([holeId]) => allowed.has(holeId)));
  page.cornerLabelLayoutByHoleId = new Map([...page.cornerLabelLayoutByHoleId.entries()].filter(([holeId]) => allowed.has(holeId)));
  page.shotCorners = page.shotCorners.map((holeId) => (holeId && allowed.has(holeId) ? holeId : null));
  if (page.dragLabelHoleId && !allowed.has(page.dragLabelHoleId)) {
    page.dragLabelHoleId = null;
    page.dragLabelKind = null;
    page.dragPointerDelta = null;
  }
  if (page.ui.hoverLabelHoleId && !allowed.has(page.ui.hoverLabelHoleId)) page.ui.hoverLabelHoleId = null;
  page.ui.selectionBoxDraft = null;
}

function startPrintPageBreakDraft() {
  const page = activePrintPage();
  if (!page || page.pageType !== "diagram" || page.ui.workspaceMode !== "diagram") return;
  if (page.pageBreakDraft) {
    window.alert("Confirm or cancel the current page break draft first.");
    return;
  }
  const draftPage = clonePrintPage(page);
  draftPage.pageBreakDraft = true;
  draftPage.pageBreakSourcePage = clonePrintPage(page);
  draftPage.pageLabel = "Page Break Draft";
  draftPage.selection = new Set();
  draftPage.ui.labelEditMode = false;
  draftPage.ui.hoverLabelHoleId = null;
  draftPage.ui.selectionBoxDraft = null;
  draftPage.dragLabelHoleId = null;
  draftPage.dragLabelKind = null;
  draftPage.dragPointerDelta = null;
  printSession.pages.splice(printSession.activePageIndex + 1, 0, draftPage);
  activatePrintPage(printSession.activePageIndex + 1, { render: true });
}

function confirmPrintPageBreakDraft() {
  const page = activePrintPage();
  if (!page || page.pageType !== "diagram" || page.ui.workspaceMode !== "diagram" || !page.pageBreakDraft) return;
  const selectedIds = [...(page.selection || [])].filter((holeId) => page.holesById.has(holeId));
  if (!selectedIds.length) {
    window.alert("Select one or more holes on the print page first.");
    return;
  }
  if (selectedIds.length >= page.holes.length) {
    window.alert("Select fewer than all holes to create a page break.");
    return;
  }

  const sourcePage = clonePrintPage(page.pageBreakSourcePage || page);
  const allHoleIds = sourcePage.holes.map((hole) => hole.id);
  const selectedSet = new Set(selectedIds);
  const remainingIds = allHoleIds.filter((holeId) => !selectedSet.has(holeId));
  const complementPage = clonePrintPage(sourcePage);

  filterPrintPageToHoleIds(page, selectedSet);
  page.pageBreakDraft = false;
  page.pageBreakSourcePage = null;
  page.pageLabel = "Diagram Split 1";
  page.selection = new Set();
  filterPrintPageToHoleIds(complementPage, remainingIds);
  complementPage.pageBreakDraft = false;
  complementPage.pageBreakSourcePage = null;
  complementPage.pageLabel = "Diagram Split 2";
  complementPage.selection = new Set();

  printSession.pages.splice(printSession.activePageIndex + 1, 0, complementPage);
  activatePrintPage(printSession.activePageIndex, { render: true });
}

function cancelPrintPageBreakDraft() {
  const page = activePrintPage();
  if (!page?.pageBreakDraft) return;
  removePrintPage(printSession.activePageIndex);
}

function selectedProjectTimingResult() {
  const index = Number.isInteger(projectState.timing.ui.activeTimingPreviewIndex)
    ? projectState.timing.ui.activeTimingPreviewIndex
    : -1;
  return projectState.timing.timingResults[index] || null;
}

function createSolverPrintPage(selectedTiming) {
  const page = createPrintPageState();
  page.pageType = "solver";
  page.holes = solverState.holes.map(cloneHole);
  syncPrintPageHolesById(page);
  page.selection = new Set();
  page.relationships = {
    originHoleId: solverState.relationships.originHoleId,
    edges: solverState.relationships.edges.map((edge) => ({ ...edge })),
    nextId: solverState.relationships.nextId,
  };
  page.timingResults = cloneSelectedTiming(selectedTiming);
  page.ui.workspaceMode = "solver";
  page.ui.activeTimingPreviewIndex = page.timingResults.length ? 0 : -1;
  page.ui.showGrid = false;
  page.ui.showRelationships = solverState.ui.showRelationships;
  page.ui.showOverlayText = true;
  page.ui.showAngleLabels = false;
  page.ui.showBearingLabels = false;
  page.ui.showBearingArrows = false;
  page.ui.bearingArrowWeight = 1;
  page.ui.bearingArrowLength = 16;
  page.ui.labelAngleDeg = 315;
  page.ui.labelDistancePx = PRINT_LABEL_DISTANCE_MIN + PRINT_LABEL_DISTANCE_DEFAULT_TICK;
  page.ui.showDepthLabels = false;
  page.ui.showCornerCoordinates = false;
  page.ui.labelEditMode = false;
  page.ui.hoverLabelHoleId = null;
  page.ui.textScale = Number(els.printTextScaleInput.value) || 1;
  page.ui.orientation = "landscape";
  page.labelLayoutByHoleId = new Map();
  page.cornerLabelLayoutByHoleId = new Map();
  page.metadata = cloneDiagramMetadata();
  page.annotations = cloneDiagramAnnotations();
  page.shotCorners = [null, null, null, null];
  page.colorMode = "color";
  return page;
}

function createSolverPrintPageFromProject() {
  const selectedTiming = selectedProjectTimingResult();
  if (!selectedTiming) return null;
  const page = createPrintPageState();
  page.pageType = "solver";
  page.holes = projectState.holes.map(cloneHole);
  syncPrintPageHolesById(page);
  page.selection = new Set();
  page.relationships = cloneRelationshipsState(projectState.timing.relationships);
  page.timingResults = cloneSelectedTiming(selectedTiming);
  page.ui.workspaceMode = "solver";
  page.ui.activeTimingPreviewIndex = 0;
  page.ui.showGrid = false;
  page.ui.showRelationships = projectState.timing.ui.showRelationships !== false;
  page.ui.showOverlayText = true;
  page.ui.showAngleLabels = false;
  page.ui.showBearingLabels = false;
  page.ui.showBearingArrows = false;
  page.ui.bearingArrowWeight = 1;
  page.ui.bearingArrowLength = 16;
  page.ui.labelAngleDeg = 315;
  page.ui.labelDistancePx = PRINT_LABEL_DISTANCE_MIN + PRINT_LABEL_DISTANCE_DEFAULT_TICK;
  page.ui.showDepthLabels = false;
  page.ui.showCornerCoordinates = false;
  page.ui.labelEditMode = false;
  page.ui.hoverLabelHoleId = null;
  page.ui.textScale = Number(els.printTextScaleInput.value) || 1;
  page.ui.orientation = "landscape";
  page.labelLayoutByHoleId = new Map();
  page.cornerLabelLayoutByHoleId = new Map();
  page.metadata = cloneDiagramMetadata(projectState.diagram.metadata);
  page.annotations = cloneDiagramAnnotations();
  page.shotCorners = cloneShotCorners(projectState.diagram.shotCorners);
  page.viewport.rotationDeg = Number(projectState.view.rotationDeg) || 0;
  page.colorMode = "color";
  return page;
}

function createDiagramPrintPage() {
  const page = createPrintPageState();
  page.pageType = "diagram";
  page.holes = diagramState.holes.map(cloneHole);
  syncPrintPageHolesById(page);
  page.fullShotHoles = diagramState.holes.map(cloneHole);
  page.selection = new Set();
  page.relationships = { originHoleId: null, edges: [], nextId: 1 };
  page.timingResults = [];
  page.ui.workspaceMode = "diagram";
  page.ui.activeTimingPreviewIndex = -1;
  page.ui.showGrid = false;
  page.ui.showRelationships = false;
  page.ui.showOverlayText = false;
  page.ui.showAngleLabels = diagramState.ui.showAngleLabels;
  page.ui.showBearingLabels = diagramState.ui.showBearingLabels;
  page.ui.showBearingArrows = diagramState.ui.showBearingArrows;
  page.ui.bearingArrowWeight = Number(els.printBearingArrowWeightInput.value) || 1;
  page.ui.bearingArrowLength = Number(els.printBearingArrowLengthInput.value) || 16;
  page.ui.labelAngleDeg = activePrintLabelAngle();
  page.ui.labelDistancePx = PRINT_LABEL_DISTANCE_MIN + PRINT_LABEL_DISTANCE_DEFAULT_TICK;
  page.ui.showDepthLabels = diagramState.ui.showDepthLabels;
  page.ui.showCornerCoordinates = false;
  page.ui.labelEditMode = false;
  page.ui.hoverLabelHoleId = null;
  page.ui.textScale = Number(els.printTextScaleInput.value) || 1;
  page.ui.orientation = "landscape";
  page.labelLayoutByHoleId = new Map();
  page.cornerLabelLayoutByHoleId = new Map();
  page.metadata = cloneDiagramMetadata(diagramState.metadata);
  page.annotations = cloneDiagramAnnotations(diagramState.annotations);
  page.shotCorners = cloneShotCorners(diagramState.shotCorners);
  page.colorMode = "color";
  return page;
}

function compareHoleTableRows(left, right) {
  const leftLabel = String(left?.holeNumber || left?.id || "");
  const rightLabel = String(right?.holeNumber || right?.id || "");
  const leftNumeric = Number.parseFloat(leftLabel);
  const rightNumeric = Number.parseFloat(rightLabel);
  const leftHasNumeric = Number.isFinite(leftNumeric);
  const rightHasNumeric = Number.isFinite(rightNumeric);
  if (leftHasNumeric && rightHasNumeric && leftNumeric !== rightNumeric) return leftNumeric - rightNumeric;
  if (leftHasNumeric !== rightHasNumeric) return leftHasNumeric ? -1 : 1;
  return leftLabel.localeCompare(rightLabel, undefined, { numeric: true, sensitivity: "base" });
}

function createHoleTablePrintPage() {
  const page = createPrintPageState();
  page.pageType = "holeTable";
  page.holes = diagramState.holes.map(cloneHole).sort(compareHoleTableRows);
  syncPrintPageHolesById(page);
  page.selection = new Set();
  page.relationships = { originHoleId: null, edges: [], nextId: 1 };
  page.timingResults = [];
  page.ui.workspaceMode = "diagram";
  page.ui.activeTimingPreviewIndex = -1;
  page.ui.showGrid = false;
  page.ui.showRelationships = false;
  page.ui.showOverlayText = false;
  page.ui.showAngleLabels = false;
  page.ui.showBearingLabels = false;
  page.ui.showBearingArrows = false;
  page.ui.bearingArrowWeight = 1;
  page.ui.bearingArrowLength = 16;
  page.ui.labelAngleDeg = 315;
  page.ui.labelDistancePx = PRINT_LABEL_DISTANCE_MIN + PRINT_LABEL_DISTANCE_DEFAULT_TICK;
  page.ui.showDepthLabels = false;
  page.ui.showCornerCoordinates = false;
  page.ui.labelEditMode = false;
  page.ui.hoverLabelHoleId = null;
  page.ui.textScale = Number(els.printTextScaleInput.value) || 1;
  page.ui.orientation = "landscape";
  page.labelLayoutByHoleId = new Map();
  page.cornerLabelLayoutByHoleId = new Map();
  page.metadata = cloneDiagramMetadata(diagramState.metadata);
  page.annotations = cloneDiagramAnnotations();
  page.shotCorners = cloneShotCorners(diagramState.shotCorners);
  page.colorMode = els.printColorModeToggle.checked ? "color" : "greyscale";
  return page;
}

function createShotOrderPrintPage() {
  const page = createPrintPageState();
  page.pageType = "shotOrder";
  page.holes = diagramState.holes.map(cloneHole).sort(compareHoleTableRows);
  syncPrintPageHolesById(page);
  page.selection = new Set();
  page.relationships = { originHoleId: null, edges: [], nextId: 1 };
  page.timingResults = [];
  page.ui.workspaceMode = "diagram";
  page.ui.activeTimingPreviewIndex = -1;
  page.ui.showGrid = false;
  page.ui.showRelationships = false;
  page.ui.showOverlayText = false;
  page.ui.showAngleLabels = false;
  page.ui.showBearingLabels = false;
  page.ui.showBearingArrows = false;
  page.ui.bearingArrowWeight = 1;
  page.ui.bearingArrowLength = 16;
  page.ui.labelAngleDeg = 315;
  page.ui.labelDistancePx = PRINT_LABEL_DISTANCE_MIN + PRINT_LABEL_DISTANCE_DEFAULT_TICK;
  page.ui.showDepthLabels = false;
  page.ui.showCornerCoordinates = false;
  page.ui.labelEditMode = false;
  page.ui.hoverLabelHoleId = null;
  page.ui.textScale = Number(els.printTextScaleInput.value) || 1;
  page.ui.orientation = "landscape";
  page.labelLayoutByHoleId = new Map();
  page.cornerLabelLayoutByHoleId = new Map();
  page.metadata = cloneDiagramMetadata(diagramState.metadata);
  page.annotations = cloneDiagramAnnotations();
  page.shotCorners = cloneShotCorners(diagramState.shotCorners);
  page.colorMode = els.printColorModeToggle.checked ? "color" : "greyscale";
  return page;
}

function createHoleLoadProfilePrintPage() {
  if (!diagramState.holes.length) {
    window.alert("Import or create holes before adding a Hole Load Profile page.");
    return null;
  }
  const page = createPrintPageState();
  page.pageType = "holeLoadProfile";
  page.holes = diagramState.holes.map(cloneHole).sort(compareHoleTableRows);
  syncPrintPageHolesById(page);
  page.selection = new Set();
  page.relationships = { originHoleId: null, edges: [], nextId: 1 };
  page.timingResults = [];
  page.ui.workspaceMode = "diagram";
  page.ui.activeTimingPreviewIndex = -1;
  page.ui.showGrid = false;
  page.ui.showRelationships = false;
  page.ui.showOverlayText = false;
  page.ui.showAngleLabels = false;
  page.ui.showBearingLabels = false;
  page.ui.showBearingArrows = false;
  page.ui.bearingArrowWeight = 1;
  page.ui.bearingArrowLength = 16;
  page.ui.labelAngleDeg = 315;
  page.ui.labelDistancePx = PRINT_LABEL_DISTANCE_MIN + PRINT_LABEL_DISTANCE_DEFAULT_TICK;
  page.ui.showDepthLabels = false;
  page.ui.showCornerCoordinates = false;
  page.ui.labelEditMode = false;
  page.ui.hoverLabelHoleId = null;
  page.ui.textScale = Number(els.printTextScaleInput.value) || 1;
  page.ui.orientation = "landscape";
  page.labelLayoutByHoleId = new Map();
  page.cornerLabelLayoutByHoleId = new Map();
  page.metadata = cloneDiagramMetadata(diagramState.metadata);
  page.annotations = cloneDiagramAnnotations();
  page.shotCorners = cloneShotCorners(diagramState.shotCorners);
  page.colorMode = els.printColorModeToggle.checked ? "color" : "greyscale";
  return page;
}

function pageWorkspaceLabel(page) {
  if (page?.pageLabel) return page.pageLabel;
  if (page?.pageType === "holeTable") return "Hole Table";
  if (page?.pageType === "shotOrder") return "Shot Order";
  if (page?.pageType === "holeLoadProfile") return "Hole Load Profile";
  return page?.ui?.workspaceMode === "diagram" ? "Diagram" : "Timing";
}

function applyPrintPageChrome(page) {
  const greyscale = page?.colorMode === "greyscale";
  els.printPaperFrame.classList.toggle("greyscale", greyscale);
  els.printColorModeToggle.checked = !greyscale;
}

function setPrintRendererPage(page, options = {}) {
  const showStaticPreview = page?.pageType === "holeTable" || page?.pageType === "shotOrder" || page?.pageType === "holeLoadProfile";
  applyPrintPageChrome(page);
  els.printCanvas.classList.toggle("hidden", showStaticPreview);
  els.printHoleTablePreview.classList.toggle("hidden", !showStaticPreview);
  if (showStaticPreview) {
    renderStaticPrintPreview(page, els.printHoleTablePreview);
    printRenderer.stateRef = null;
    return;
  }
  printRenderer.stateRef = page;
  if (!page) {
    printRenderer.render();
    return;
  }
  printRenderer.applyViewState(page.viewport, { render: options.render !== false });
}

function handlePrintRendererViewChange(view) {
  const page = activePrintPage();
  if (!page) return;
  page.viewport = {
    zoom: Number(view.zoom) || 1,
    panX: Number(view.panX) || 0,
    panY: Number(view.panY) || 0,
    rotationDeg: Number(view.rotationDeg) || 0,
  };
}

function renderPrintPageTabs() {
  const activeIndex = printSession.activePageIndex;
  els.printPageTabs.innerHTML = printSession.pages.map((page, index) => {
    const activeClass = index === activeIndex ? " active" : "";
    const remove = printSession.pages.length > 1
      ? `<button class="print-page-remove-btn" type="button" data-print-remove="${index}" aria-label="Remove Page ${index + 1}">x</button>`
      : "";
    return `
      <div class="print-page-tab${activeClass}">
        <button class="print-page-tab-main" type="button" data-print-page="${index}" aria-pressed="${index === activeIndex}">
          <span class="print-page-tab-label">Page ${index + 1}</span>
          <span class="print-page-tab-meta">${pageWorkspaceLabel(page)}</span>
        </button>
        ${remove}
      </div>
    `;
  }).join("");
}

function syncPrintControls() {
  const page = activePrintPage();
  if (!page) return;
  const diagramMode = page.pageType === "diagram";
  const draftMode = page.pageBreakDraft === true;
  const staticSheetMode = page.pageType === "holeTable" || page.pageType === "shotOrder" || page.pageType === "holeLoadProfile";
  const labelModeEnabled = page.ui.labelEditMode === true;
  const hasTimingPageOption = projectState.timing.timingResults.length > 0;
  const showAdditionalPages = diagramMode || staticSheetMode;
  els.printTextScaleInput.value = String(page.ui.textScale || 1);
  els.printFitBtn.classList.toggle("hidden", staticSheetMode);
  els.printPageBreakBtn.classList.toggle("hidden", !draftMode);
  els.printCancelPageBreakBtn.classList.toggle("hidden", !draftMode);
  els.printAdditionalPagesBtn.classList.toggle("hidden", !showAdditionalPages);
  els.printAddPageBreakBtn.classList.toggle("hidden", !diagramMode || draftMode);
  els.printAddTimingPageBtn.classList.toggle("hidden", !hasTimingPageOption);
  els.printAddHoleTablePageBtn.classList.toggle("hidden", !showAdditionalPages);
  els.printAddShotOrderPageBtn.classList.toggle("hidden", !showAdditionalPages);
  els.printAddHoleLoadProfilePageBtn.classList.toggle("hidden", !showAdditionalPages);
  els.printRelationshipToggleWrap.classList.toggle("hidden", diagramMode || staticSheetMode);
  els.printTimingToggleWrap.classList.toggle("hidden", diagramMode || staticSheetMode);
  els.printAngleToggleWrap.classList.toggle("hidden", !diagramMode);
  els.printBearingToggleWrap.classList.toggle("hidden", !diagramMode);
  els.printBearingArrowWeightWrap.classList.toggle("hidden", !diagramMode);
  els.printBearingArrowLengthWrap.classList.toggle("hidden", !diagramMode);
  els.printLabelAngleWrap.classList.toggle("hidden", !diagramMode);
  els.printDepthToggleWrap.classList.toggle("hidden", !diagramMode);
  els.printCornerCoordsToggleWrap.classList.toggle("hidden", !diagramMode);
  els.printEditLabelsBtn.classList.toggle("hidden", !diagramMode);
  els.printResetLabelsBtn.classList.toggle("hidden", !diagramMode || !labelModeEnabled);
  els.printEditLabelsBtn.classList.toggle("active", diagramMode && labelModeEnabled);
  els.printRelationshipToggle.checked = page.ui.showRelationships !== false;
  els.printTimingToggle.checked = page.ui.showOverlayText !== false;
  els.printAngleToggle.checked = page.ui.showAngleLabels !== false;
  els.printBearingToggle.checked = page.ui.showBearingLabels !== false;
  els.printBearingArrowWeightInput.value = String(page.ui.bearingArrowWeight || 1);
  els.printBearingArrowLengthInput.value = String(page.ui.bearingArrowLength || 16);
  updatePrintLabelAngleDial(page.ui.labelAngleDeg);
  updatePrintLabelDistanceControls(page.ui.labelDistancePx);
  els.printDepthToggle.checked = page.ui.showDepthLabels !== false;
  els.printCornerCoordsToggle.checked = page.ui.showCornerCoordinates === true;
  applyPrintPageChrome(page);
}

function activatePrintPage(index, options = {}) {
  if (!Number.isInteger(index) || index < 0 || index >= printSession.pages.length) return;
  printSession.activePageIndex = index;
  const page = activePrintPage();
  renderPrintPageTabs();
  syncPrintControls();
  setPrintRendererPage(page, { render: options.render !== false });
}

function addPrintPage() {
  const page = activePrintPage();
  if (!page) return;
  printSession.pages.push(clonePrintPage(page));
  activatePrintPage(printSession.pages.length - 1);
}

function addTimingPrintPage() {
  const page = createSolverPrintPageFromProject();
  if (!page) {
    window.alert("Run timing combinations and select a timing result first.");
    return;
  }
  printSession.pages.push(page);
  activatePrintPage(printSession.pages.length - 1);
  requestAnimationFrame(() => {
    if (activePrintPage() !== page) return;
    printRenderer.resize();
    setPrintRendererPage(page, { render: false });
    printRenderer.fitToData(PRINT_FIT_MARGINS);
    syncPrintControls();
  });
}

function addHoleTablePrintPage() {
  if (!isDiagramWorkspaceActive() && activePrintPage()?.pageType !== "diagram" && activePrintPage()?.pageType !== "holeTable" && activePrintPage()?.pageType !== "shotOrder") return;
  const page = createHoleTablePrintPage();
  printSession.pages.push(page);
  activatePrintPage(printSession.pages.length - 1);
}

function addShotOrderPrintPage() {
  if (!isDiagramWorkspaceActive() && activePrintPage()?.pageType !== "diagram" && activePrintPage()?.pageType !== "holeTable" && activePrintPage()?.pageType !== "shotOrder") return;
  const page = createShotOrderPrintPage();
  printSession.pages.push(page);
  activatePrintPage(printSession.pages.length - 1);
}

function addHoleLoadProfilePrintPage() {
  if (!isDiagramWorkspaceActive() && activePrintPage()?.pageType !== "diagram" && activePrintPage()?.pageType !== "holeTable" && activePrintPage()?.pageType !== "shotOrder" && activePrintPage()?.pageType !== "holeLoadProfile") return;
  const page = createHoleLoadProfilePrintPage();
  if (!page) return;
  printSession.pages.push(page);
  activatePrintPage(printSession.pages.length - 1);
}

function removePrintPage(index) {
  if (printSession.pages.length <= 1) return;
  if (!Number.isInteger(index) || index < 0 || index >= printSession.pages.length) return;
  printSession.pages.splice(index, 1);
  const nextIndex = Math.min(index, printSession.pages.length - 1);
  activatePrintPage(nextIndex);
}

function openPrintWorkspace() {
  if (isDiagramWorkspaceActive() && diagramState.ui.pendingFaceDesignation) {
    diagramState.ui.pendingFaceDesignation = false;
    diagramState.ui.selectionPolygonDraft = null;
  }
  syncCurrentWorkspaceToProject();
  let initialPage = null;
  if (isSolverWorkspaceActive()) {
    const selectedTiming = selectedTimingResult();
    if (!selectedTiming) {
      window.alert("Select a timing result first, then open print preview.");
      return;
    }
    initialPage = createSolverPrintPage(selectedTiming);
  } else if (isDiagramWorkspaceActive()) {
    initialPage = createDiagramPrintPage();
  } else {
    return;
  }

  printSession.pages = [initialPage];
  printSession.activePageIndex = 0;
  els.printPagesOutput.innerHTML = "";
  closeHelpWorkspace();
  document.body.classList.add("print-preview-active");
  els.printWorkspace.classList.remove("hidden");
  closeAllMenus();
  renderPrintPageTabs();
  syncPrintControls();

  requestAnimationFrame(() => {
    const page = activePrintPage();
    if (!page) return;
    printRenderer.resize();
    page.viewport.rotationDeg = activeRenderer().rotationDeg;
    setPrintRendererPage(page, { render: false });
    printRenderer.fitToData(PRINT_FIT_MARGINS);
    syncPrintControls();
  });
}

function closePrintWorkspace() {
  printSession.pages = [];
  printSession.activePageIndex = -1;
  printRenderer.stateRef = null;
  els.printPagesOutput.innerHTML = "";
  els.printPageTabs.innerHTML = "";
  els.printPaperFrame.classList.remove("greyscale");
  document.body.classList.remove("print-preview-active");
  els.printWorkspace.classList.add("hidden");
  requestAnimationFrame(() => {
    const renderer = activeRenderer();
    if (!renderer) return;
    renderer.resize();
    requestAnimationFrame(() => renderer.resize());
  });
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
  const page = activePrintPage();
  if (!page) return;
  page.ui.textScale = Number(els.printTextScaleInput.value) || 1;
  page.ui.showRelationships = els.printRelationshipToggle.checked;
  page.ui.showOverlayText = els.printTimingToggle.checked;
  page.ui.showAngleLabels = els.printAngleToggle.checked;
  page.ui.showBearingLabels = els.printBearingToggle.checked;
  page.ui.bearingArrowWeight = Number(els.printBearingArrowWeightInput.value) || 1;
  page.ui.bearingArrowLength = Number(els.printBearingArrowLengthInput.value) || 16;
  page.ui.showDepthLabels = els.printDepthToggle.checked;
  page.ui.showCornerCoordinates = els.printCornerCoordsToggle.checked;
  page.ui.orientation = "landscape";
  page.colorMode = els.printColorModeToggle.checked ? "color" : "greyscale";
  applyPrintPageChrome(page);
  if (page.pageType === "holeTable" || page.pageType === "shotOrder" || page.pageType === "holeLoadProfile") {
    renderStaticPrintPreview(page, els.printHoleTablePreview);
  } else {
    printRenderer.render();
  }
  renderPrintPageTabs();
}

function isDiagramPrintEditing() {
  const page = activePrintPage();
  return page?.ui?.workspaceMode === "diagram" && page.ui.labelEditMode === true;
}

function setPrintEditMode(enabled) {
  const page = activePrintPage();
  if (!page) return;
  page.ui.labelEditMode = enabled === true;
  page.ui.hoverLabelHoleId = null;
  page.dragLabelHoleId = null;
  page.dragLabelKind = null;
  page.dragPointerDelta = null;
  syncPrintControls();
  printRenderer.render();
}

function resetPrintLabelLayouts() {
  const page = activePrintPage();
  if (!page) return;
  page.labelLayoutByHoleId = new Map();
  page.cornerLabelLayoutByHoleId = new Map();
  page.dragLabelHoleId = null;
  page.dragLabelKind = null;
  page.dragPointerDelta = null;
  page.ui.hoverLabelHoleId = null;
  printRenderer.render();
}

function holeTableHoleLabel(hole) {
  return hole?.holeNumber || hole?.id || "";
}

function formatHoleTableFeet(value) {
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value))} ft` : "";
}

function formatHoleTableCompactNumber(value, maximumFractionDigits = 1) {
  if (!Number.isFinite(Number(value))) return "";
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
}

function formatHoleTableInches(value) {
  if (!Number.isFinite(Number(value))) return "";
  const numeric = Number(value);
  const whole = Math.trunc(numeric);
  if (Math.abs(numeric - whole) >= 0.49 && Math.abs(numeric - whole) <= 0.51) return `${whole} 1/2"`;
  return `${formatHoleTableCompactNumber(numeric, 2)}"`;
}

function formatHoleTableDegrees(value) {
  if (!Number.isFinite(Number(value))) return "";
  const rounded = Math.round(Number(value));
  if (rounded === 0) return "";
  return `${rounded}${String.fromCharCode(176)}`;
}

function formatHoleTableAzimuth(value, angle) {
  if (!Number.isFinite(Number(angle)) || Math.round(Number(angle)) === 0) return "";
  return formatHoleTableDegrees(value);
}

function holeTableRowsPerPage(page) {
  const scale = Math.max(0.4, Math.min(1.8, Number(page?.ui?.textScale) || 1));
  return Math.max(8, Math.floor(23 / scale));
}

function chunkHoleTableRows(page) {
  const rowsPerPage = holeTableRowsPerPage(page);
  const holes = Array.isArray(page?.holes) ? page.holes : [];
  if (!holes.length) return [[]];
  const chunks = [];
  for (let index = 0; index < holes.length; index += rowsPerPage) {
    chunks.push(holes.slice(index, index + rowsPerPage));
  }
  return chunks;
}

function buildHoleTableMarkup(page, holes, options = {}) {
  const scale = Math.max(0.4, Math.min(1.8, Number(page?.ui?.textScale) || 1));
  const pageNumber = Number(options.pageNumber) || 1;
  const pageCount = Number(options.pageCount) || 1;
  const showSummary = options.showSummary === true;
  const totalHoles = Array.isArray(page?.holes) ? page.holes.length : 0;
  const loadingSummary = summarizeShotLoading(page?.holes || [], page?.metadata?.loadingDensityGcc);
  const totalDrillFootage = (page?.holes || []).reduce((sum, hole) => {
    const depth = Number(hole?.depth);
    return Number.isFinite(depth) ? sum + depth : sum;
  }, 0);
  const rows = (holes || []).map((hole) => `
    <tr>
      <td>${escapeHtml(holeTableHoleLabel(hole))}</td>
      <td>${escapeHtml(formatHoleTableCompactNumber(hole?.burden, 1))}</td>
      <td>${escapeHtml(formatHoleTableCompactNumber(hole?.spacing, 1))}</td>
      <td>${escapeHtml(formatHoleTableInches(hole?.diameter))}</td>
      <td>${escapeHtml(formatHoleTableFeet(hole?.depth))}</td>
      <td>${escapeHtml(formatHoleTableFeet(hole?.subdrill))}</td>
      <td>${escapeHtml(formatHoleTableFeet(hole?.stemHeight))}</td>
      <td>${escapeHtml(formatHoleTableDegrees(hole?.angle))}</td>
      <td>${escapeHtml(formatHoleTableAzimuth(hole?.bearing, hole?.angle))}</td>
      <td>${escapeHtml(`${formatLoadingWeight(hole?.explosiveWeightLb)} lb`)}</td>
    </tr>
  `).join("");
  const detonatorSummary = [...loadingSummary.detonatorCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([type, quantity]) => `${quantity} x ${type}`)
    .join(" | ");
  const boosterSummary = [...loadingSummary.boosterCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([type, quantity]) => `${quantity} x ${type}`)
    .join(" | ");
  const summaryMarkup = showSummary
    ? `
      <footer class="print-hole-table-summary">
        <span>${escapeHtml(`Total Holes: ${totalHoles}`)}</span>
        <span>${escapeHtml(`Total Drill Footage: ${Math.round(totalDrillFootage)} ft`)}</span>
        <span>${escapeHtml(`Total Emulsion: ${formatLoadingWeight(loadingSummary.totalExplosiveWeightLb)} lb`)}</span>
      </footer>
      <div class="print-hole-table-loading-summary">
        <div>${escapeHtml(`Detonators: ${detonatorSummary || "None"}`)}</div>
        <div>${escapeHtml(`Boosters: ${boosterSummary || "None"}`)}</div>
      </div>
    `
    : "";
  return `
    <section class="print-hole-table-sheet" style="--hole-table-scale:${scale};">
      <header class="print-hole-table-header">
        <h1>Hole Table</h1>
        <span>${escapeHtml(`Page ${pageNumber} of ${pageCount}`)}</span>
      </header>
      <table class="print-hole-table">
        <colgroup>
          <col class="print-hole-table-col-hole">
          <col class="print-hole-table-col-short">
          <col class="print-hole-table-col-short">
          <col class="print-hole-table-col-short">
          <col class="print-hole-table-col-med">
          <col class="print-hole-table-col-med">
          <col class="print-hole-table-col-med">
          <col class="print-hole-table-col-short">
          <col class="print-hole-table-col-long">
          <col class="print-hole-table-col-med">
        </colgroup>
        <thead>
          <tr>
            <th>Hole ID</th>
            <th>Burden</th>
            <th>Spacing</th>
            <th>Dia</th>
            <th>Depth</th>
            <th>Subdrill</th>
            <th>Stem</th>
            <th>Angle</th>
            <th>Azimuth</th>
            <th>Emulsion</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${summaryMarkup}
    </section>
  `;
}

function buildShotOrderMarkup(page) {
  const loadingSummary = summarizeShotLoading(page?.holes || [], page?.metadata?.loadingDensityGcc);
  const detonatorLines = materialSummaryLines(loadingSummary.detonatorCounts, "No detonators assigned");
  const boosterLines = materialSummaryLines(loadingSummary.boosterCounts, "No boosters assigned");
  return `
    <section class="print-shot-order-sheet">
      <header class="print-shot-order-header">
        <h1>Shot Order Sheet</h1>
        <div class="print-shot-order-meta">
          <div>${escapeHtml(`Shot Number: ${page?.metadata?.shotNumber || "-"}`)}</div>
          <div>${escapeHtml(`Location: ${page?.metadata?.location || "-"}`)}</div>
          <div>${escapeHtml(`Bench: ${page?.metadata?.bench || "-"}`)}</div>
        </div>
      </header>
      <div class="print-shot-order-block">
        <h2>Loading Usage</h2>
        <div class="print-shot-order-row"><span>Total Holes</span><strong>${escapeHtml(String(loadingSummary.totalHoleCount || 0))}</strong></div>
        <div class="print-shot-order-row"><span>Total Emulsion</span><strong>${escapeHtml(`${formatLoadingWeight(loadingSummary.totalExplosiveWeightLb)} lb`)}</strong></div>
      </div>
      <div class="print-shot-order-grid">
        <section class="print-shot-order-block">
          <h2>Detonators</h2>
          ${detonatorLines.map((line) => `<div class="print-shot-order-line">${escapeHtml(line)}</div>`).join("")}
        </section>
        <section class="print-shot-order-block">
          <h2>Boosters</h2>
          ${boosterLines.map((line) => `<div class="print-shot-order-line">${escapeHtml(line)}</div>`).join("")}
        </section>
      </div>
    </section>
  `;
}

function flatMaterialUnits(entries = []) {
  const units = [];
  (entries || []).forEach((entry) => {
    const quantity = Math.max(0, Math.round(Number(entry.quantity) || 0));
    for (let index = 0; index < quantity; index += 1) {
      units.push({ type: entry.type || "" });
    }
  });
  return units;
}

function holeLoadProfileBoosterColor(type) {
  return type === "Spartan 350 Shield" || type === "Spartan 450 Shield" ? "#f6d54a" : "#69b86e";
}

function clampPercent(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildHoleLoadProfileBoreSvg({ stemmingPercent, emulsionPercent, capItems, boosterPositions, deckSegments = [], totalDepthFt = 1 }) {
  const outerX = 52;
  const outerY = 16;
  const outerWidth = 78;
  const outerHeight = 372;
  const innerInsetX = 3;
  const innerInsetTop = 3;
  const innerInsetBottom = 3;
  const innerX = outerX + innerInsetX;
  const innerY = outerY + innerInsetTop;
  const innerWidth = outerWidth - (innerInsetX * 2);
  const innerHeight = outerHeight - innerInsetTop - innerInsetBottom;
  const topLabelX = 118;
  const topLabelY = 26;
  const bottomLabelX = 136;
  const bottomLabelY = 390;
  const fillInset = 0;
  const fillClipId = `hole-load-shell-${Math.random().toString(36).slice(2, 10)}`;
  const stemmingHeightPx = Math.max(0, (innerHeight * stemmingPercent) / 100);
  const emulsionHeightPx = Math.max(0, (innerHeight * emulsionPercent) / 100);
  const segmentRects = deckSegments.length
    ? buildHoleLoadProfileDeckRects(deckSegments, innerX + fillInset, innerY + fillInset, innerWidth - (fillInset * 2), innerHeight - (fillInset * 2), Math.max(1, totalDepthFt))
    : "";
  const stemmingRect = !deckSegments.length && stemmingPercent > 0
    ? `<rect x="${innerX + fillInset}" y="${innerY + fillInset}" width="${innerWidth - (fillInset * 2)}" height="${Math.max(0, stemmingHeightPx - fillInset)}" fill="#d7dee7"></rect>`
    : "";
  const emulsionRect = !deckSegments.length && emulsionPercent > 0
    ? `<rect x="${innerX + fillInset}" y="${innerY + stemmingHeightPx}" width="${innerWidth - (fillInset * 2)}" height="${Math.max(0, emulsionHeightPx - fillInset)}" fill="#f2b5ca"></rect>`
    : "";
  const dividerLine = stemmingPercent > 0 && emulsionPercent > 0
    ? `<line x1="${innerX}" y1="${innerY + stemmingHeightPx}" x2="${innerX + innerWidth}" y2="${innerY + stemmingHeightPx}" stroke="rgba(142,72,103,0.55)" stroke-width="3"></line>`
    : "";

  const wireOffsetPattern = [0, -7, 7, -12, 12, -16, 16];
  const boosterMarkerData = boosterPositions.map((item, index) => {
    const boosterWidth = 10;
    const boosterHeight = 18;
    const offsetX = wireOffsetPattern[index] || 0;
    const x = innerX + ((innerWidth - boosterWidth) / 2) + offsetX;
    const y = innerY + ((innerHeight * item.topPercent) / 100) + 4;
    const fill = holeLoadProfileBoosterColor(item.type);
    return {
      index,
      x,
      y,
      centerX: x + (boosterWidth / 2),
      fill,
      boosterWidth,
      boosterHeight,
    };
  });

  const capsSvg = capItems.map((item, index) => {
    const offsetX = wireOffsetPattern[index] || 0;
    const fallbackX = innerX + ((innerWidth * item.leftPercent) / 100) + offsetX;
    const attachedBooster = boosterMarkerData[index] || null;
    const x = attachedBooster ? attachedBooster.centerX : fallbackX;
    const lineEndY = attachedBooster
      ? attachedBooster.y
      : innerY + ((innerHeight * Math.max(4, Number(item.dropPercent) || 0)) / 100);
    return `<line x1="${x}" y1="${outerY + 4}" x2="${x}" y2="${lineEndY}" stroke="#49596b" stroke-width="3" stroke-linecap="round"></line>`;
  }).join("");

  const boostersSvg = boosterMarkerData.map((item) => `
      <rect x="${item.x}" y="${item.y}" width="${item.boosterWidth}" height="${item.boosterHeight}" rx="5" fill="${item.fill}" stroke="rgba(86,96,54,0.6)" stroke-width="1"></rect>
      <line x1="${item.x + 2.2}" y1="${item.y + 3}" x2="${item.x + 2.2}" y2="${item.y + item.boosterHeight - 3}" stroke="rgba(255,255,255,0.45)" stroke-width="1.2" stroke-linecap="round"></line>
    `).join("");

  return `
    <svg class="print-hole-load-profile-svg" viewBox="0 0 220 404" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <defs>
        <clipPath id="${fillClipId}">
          <rect x="${innerX}" y="${innerY}" width="${innerWidth}" height="${innerHeight}" rx="20"></rect>
        </clipPath>
      </defs>
      <rect x="${outerX}" y="${outerY}" width="${outerWidth}" height="${outerHeight}" rx="20" fill="#f8fbfe" stroke="rgba(71,85,105,0.72)" stroke-width="2"></rect>
      <g clip-path="url(#${fillClipId})">
        <rect x="${innerX}" y="${innerY}" width="${innerWidth}" height="${innerHeight}" fill="#eef4f9"></rect>
        ${segmentRects}
        ${stemmingRect}
        ${emulsionRect}
      </g>
      ${dividerLine}
      ${boostersSvg}
      ${capsSvg}
      <text x="${topLabelX}" y="${topLabelY}" class="print-hole-load-profile-svg-label">Top / Collar</text>
      <text x="${bottomLabelX}" y="${bottomLabelY}" class="print-hole-load-profile-svg-label">Bottom</text>
    </svg>
  `;
}

function holeLoadProfileGroupKey(hole) {
  const decks = (hole.decks || []).map((deck) => [
    Number(deck.stemmingAbove) || 0,
    Number(deck.columnLength) || 0,
    (deck.detonators || []).map((entry) => `${entry.type}:${entry.quantity}`).join("|"),
    (deck.boosters || []).map((entry) => `${entry.type}:${entry.quantity}`).join("|"),
  ].join(":")).join("~");
  const detonators = (hole.detonators || []).map((entry) => `${entry.type}:${entry.quantity}`).join("|");
  const boosters = (hole.boosters || []).map((entry) => `${entry.type}:${entry.quantity}`).join("|");
  return [
    Number(hole.depth) || 0,
    Number(hole.stemHeight) || 0,
    Number(hole.columnDepth) || 0,
    Number(hole.diameter) || 0,
    decks,
    detonators,
    boosters,
  ].join("~");
}

function holeLoadProfileSegments(hole) {
  const depth = Math.max(0, Number(hole?.depth) || 0);
  if (!(depth > 0)) return [];
  const decks = Array.isArray(hole?.decks) && hole.decks.length ? hole.decks : [];
  if (!decks.length) {
    const stemming = Math.max(0, Number(hole?.stemHeight) || 0);
    const column = Math.max(0, Number(hole?.columnDepth) || 0);
    return [
      { kind: "stemming", startFt: 0, lengthFt: stemming },
      { kind: "emulsion", startFt: stemming, lengthFt: column },
    ].filter((segment) => segment.lengthFt > 0);
  }
  const segments = [];
  let cursor = 0;
  decks.forEach((deck, deckIndex) => {
    const stemmingAbove = Math.max(0, Number(deck?.stemmingAbove) || 0);
    const columnLength = Math.max(0, Number(deck?.columnLength) || 0);
    if (stemmingAbove > 0) segments.push({ kind: "stemming", deckIndex, startFt: cursor, lengthFt: stemmingAbove });
    cursor += stemmingAbove;
    if (columnLength > 0) segments.push({ kind: "emulsion", deckIndex, startFt: cursor, lengthFt: columnLength });
    cursor += columnLength;
  });
  return segments.filter((segment) => segment.lengthFt > 0);
}

function buildHoleLoadProfileDeckRects(segments, innerX, innerY, innerWidth, innerHeight, totalDepth) {
  return segments.map((segment, index) => {
    const topPx = innerY + ((innerHeight * segment.startFt) / totalDepth);
    const heightPx = Math.max(0, (innerHeight * segment.lengthFt) / totalDepth);
    const fill = segment.kind === "emulsion" ? "#f2b5ca" : "#d7dee7";
    const stroke = segment.kind === "emulsion" ? "rgba(142,72,103,0.42)" : "rgba(96,118,143,0.32)";
    const divider = index > 0
      ? `<line x1="${innerX}" y1="${topPx}" x2="${innerX + innerWidth}" y2="${topPx}" stroke="rgba(51,65,85,0.55)" stroke-width="1.4"></line>`
      : "";
    const deckLabel = segment.kind === "emulsion" && heightPx >= 18
      ? `<text x="${innerX + (innerWidth / 2)}" y="${topPx + Math.max(14, Math.min(heightPx - 6, 18))}" text-anchor="middle" font-size="11" font-weight="700" fill="rgba(91,33,60,0.76)">D${Number(segment.deckIndex) + 1}</text>`
      : "";
    return `<rect x="${innerX}" y="${topPx}" width="${innerWidth}" height="${heightPx}" fill="${fill}" stroke="${stroke}" stroke-width="${index > 0 ? 1 : 0}"></rect>${divider}${deckLabel}`;
  }).join("");
}

function groupedHoleLoadProfiles(page) {
  const groups = new Map();
  (page?.holes || []).forEach((hole) => {
    const key = holeLoadProfileGroupKey(hole);
    if (!groups.has(key)) groups.set(key, { hole: cloneHole(hole), holeLabels: [] });
    groups.get(key).holeLabels.push(hole.holeNumber || hole.id || "");
  });
  return [...groups.values()].map((group) => ({
    ...group,
    holeLabels: [...group.holeLabels].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" })),
  }));
}

function chunkHoleLoadProfileGroups(groups, groupsPerPage = 4) {
  if (!groups.length) return [[]];
  const chunks = [];
  for (let index = 0; index < groups.length; index += groupsPerPage) {
    chunks.push(groups.slice(index, index + groupsPerPage));
  }
  return chunks;
}

function buildHoleLoadProfileCard(group) {
  const hole = group.hole;
  const depth = Number(hole.depth);
  const totalDepth = Number.isFinite(depth) && depth > 0 ? depth : 1;
  const stemmingHeight = Math.max(0, Number(hole.stemHeight) || 0);
  const columnDepth = Math.max(0, Number(hole.columnDepth) || 0);
  const deckSegments = holeLoadProfileSegments(hole);
  const stemmingPercent = clampPercent((stemmingHeight / totalDepth) * 100, 0, 100);
  const emulsionPercent = clampPercent((columnDepth / totalDepth) * 100, 0, 100);
  const detonatorUnits = flatMaterialUnits(hole.detonators);
  const boosterUnits = flatMaterialUnits(hole.boosters);
  const emulsionTopPercent = stemmingPercent;
  const emulsionBottomPercent = clampPercent(stemmingPercent + emulsionPercent, 0, 100);
  const boosterMarkerHeight = 4.2;
  const boosterTopLimit = emulsionTopPercent + 2.5;
  const boosterBottomLimit = Math.max(boosterTopLimit, emulsionBottomPercent - boosterMarkerHeight - 1.5);
  const topStackSpacing = 8;
  const bottomBoosterTop = boosterBottomLimit;
  const topBoosterTop = boosterTopLimit;
  const topStackCount = Math.max(0, boosterUnits.length - 1);
  const topStackStep = topStackCount > 1
    ? Math.min(topStackSpacing, Math.max(0, (boosterBottomLimit - topBoosterTop) / (topStackCount - 1)))
    : 0;

  const boosterPositions = boosterUnits.map((unit, index) => {
    let topPercent = boosterTopLimit;
    if (index === 0) topPercent = bottomBoosterTop;
    else if (index === 1) topPercent = topBoosterTop;
    else topPercent = Math.min(boosterBottomLimit, topBoosterTop + ((index - 1) * topStackStep));
    return {
      ...unit,
      topPercent: clampPercent(topPercent, boosterTopLimit, boosterBottomLimit),
    };
  });

  const capDropStart = 0;
  const capDropEnd = emulsionPercent > 0
    ? clampPercent(emulsionTopPercent + Math.min(10, Math.max(6, emulsionPercent * 0.24)), 7, emulsionBottomPercent)
    : clampPercent(stemmingPercent * 0.6, 7, 88);
  const capSpacing = detonatorUnits.length > 1 ? 36 / Math.max(1, detonatorUnits.length - 1) : 0;
  const capLeftStart = 32;
  const capItems = detonatorUnits.map((unit, index) => ({
    ...unit,
    leftPercent: clampPercent(capLeftStart + (index * capSpacing), 32, 68),
    dropPercent: Math.max(4, capDropEnd),
  }));
  const detonatorLines = materialSummaryLines(
    hole.detonators.reduce((map, entry) => map.set(entry.type, (map.get(entry.type) || 0) + (Number(entry.quantity) || 0)), new Map()),
    "No detonators assigned",
  );
  const boosterLines = materialSummaryLines(
    hole.boosters.reduce((map, entry) => map.set(entry.type, (map.get(entry.type) || 0) + (Number(entry.quantity) || 0)), new Map()),
    "No boosters assigned",
  );
  const holeList = escapeHtml(group.holeLabels.join(", "));
  const deckSummary = Array.isArray(hole.decks) && hole.decks.length > 1
    ? hole.decks.map((deck, index) => `Deck ${index + 1}: stem ${formatLoadingWeight(deck.stemmingAbove || 0)} ft | column ${formatLoadingWeight(deck.columnLength || 0)} ft`).join(" | ")
    : "Single deck";

  return `
    <section class="print-hole-load-profile-card-shell">
      <div class="print-hole-load-profile-layout">
        <section class="print-hole-load-profile-card">
          <div class="print-hole-load-profile-diagram">
            <div class="print-hole-load-profile-bore-wrap">
              ${buildHoleLoadProfileBoreSvg({
                stemmingPercent,
                emulsionPercent,
                capItems,
                boosterPositions,
                deckSegments,
                totalDepthFt: totalDepth,
              })}
            </div>
          </div>
        </section>
        <section class="print-hole-load-profile-data">
          <h2>Profile Data</h2>
          <div class="print-hole-load-profile-holes"><span>Holes</span><strong>${holeList}</strong></div>
          <div class="print-hole-load-profile-rows">
            <div class="print-hole-load-profile-row"><span>Depth</span><strong>${escapeHtml(Number.isFinite(Number(hole.depth)) ? `${formatLoadingWeight(hole.depth)} ft` : "-")}</strong></div>
            <div class="print-hole-load-profile-row"><span>Stemming</span><strong>${escapeHtml(`${formatLoadingWeight(stemmingHeight)} ft`)}</strong></div>
            <div class="print-hole-load-profile-row"><span>Explosive Column</span><strong>${escapeHtml(`${formatLoadingWeight(columnDepth)} ft`)}</strong></div>
            <div class="print-hole-load-profile-row"><span>Emulsion</span><strong>${escapeHtml(`${formatLoadingWeight(hole.explosiveWeightLb)} lb`)}</strong></div>
          </div>
          <div class="print-hole-load-profile-material-line">${escapeHtml(deckSummary)}</div>
          <div class="print-hole-load-profile-materials">
            <section class="print-hole-load-profile-material-block">
              <h3>Detonators</h3>
              ${detonatorLines.map((line) => `<div class="print-hole-load-profile-material-line">${escapeHtml(line)}</div>`).join("")}
            </section>
            <section class="print-hole-load-profile-material-block">
              <h3>Boosters</h3>
              ${boosterLines.map((line) => `<div class="print-hole-load-profile-material-line">${escapeHtml(line)}</div>`).join("")}
            </section>
          </div>
        </section>
      </div>
    </section>
  `;
}

function buildHoleLoadProfileMarkup(page, groups, options = {}) {
  const pageNumber = Number(options.pageNumber) || 1;
  const pageCount = Number(options.pageCount) || 1;
  return `
    <section class="print-hole-load-profile-sheet">
      <header class="print-shot-order-header">
        <h1>Hole Load Profiles</h1>
        <div class="print-shot-order-meta">
          <div>${escapeHtml(`Shot Number: ${page?.metadata?.shotNumber || "-"}`)}</div>
          <div>${escapeHtml(`Location: ${page?.metadata?.location || "-"}`)}</div>
          <div>${escapeHtml(`Bench: ${page?.metadata?.bench || "-"}`)}</div>
          <div>${escapeHtml(`Page ${pageNumber} of ${pageCount}`)}</div>
        </div>
      </header>
      <div class="print-hole-load-profile-stack">
        ${groups.map((group) => buildHoleLoadProfileCard(group)).join("")}
      </div>
    </section>
  `;
}

function renderStaticPrintPreview(page, container) {
  if (!container) return;
  if (page?.pageType === "shotOrder") {
    container.innerHTML = buildShotOrderMarkup(page);
    return;
  }
  if (page?.pageType === "holeLoadProfile") {
    const groups = groupedHoleLoadProfiles(page);
    const chunks = chunkHoleLoadProfileGroups(groups);
    container.innerHTML = chunks
      .map((groupChunk, index) => buildHoleLoadProfileMarkup(page, groupChunk, { pageNumber: index + 1, pageCount: chunks.length }))
      .join("");
    return;
  }
  const chunks = chunkHoleTableRows(page);
  container.innerHTML = chunks
    .map((holes, index) => buildHoleTableMarkup(page, holes, { pageNumber: index + 1, pageCount: chunks.length, showSummary: index === chunks.length - 1 }))
    .join("");
}

function renderPrintPageToCanvas(page, canvas) {
  if (!page || !canvas) return;
  const context = canvas.getContext("2d");
  canvas.width = printRenderer.canvas.width;
  canvas.height = printRenderer.canvas.height;
  printRenderer.stateRef = page;
  printRenderer.applyViewState(page.viewport, { render: false });
  printRenderer.render();
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(printRenderer.canvas, 0, 0);
}

function preparePrintablePages() {
  const currentPage = activePrintPage();
  if (!currentPage) return;
  els.printPagesOutput.innerHTML = "";
  printSession.pages.forEach((page, index) => {
    if (page.pageType === "holeTable") {
      const chunks = chunkHoleTableRows(page);
      chunks.forEach((holes, chunkIndex) => {
        const wrapper = document.createElement("section");
        wrapper.className = "print-output-page";
        const frame = document.createElement("div");
        frame.className = "print-paper-frame";
        if (page.colorMode === "greyscale") frame.classList.add("greyscale");
        frame.innerHTML = buildHoleTableMarkup(page, holes, { pageNumber: chunkIndex + 1, pageCount: chunks.length, showSummary: chunkIndex === chunks.length - 1 });
        wrapper.appendChild(frame);
        els.printPagesOutput.appendChild(wrapper);
      });
    } else if (page.pageType === "shotOrder") {
      const wrapper = document.createElement("section");
      wrapper.className = "print-output-page";
      const frame = document.createElement("div");
      frame.className = "print-paper-frame";
      if (page.colorMode === "greyscale") frame.classList.add("greyscale");
      frame.innerHTML = buildShotOrderMarkup(page);
      wrapper.appendChild(frame);
      els.printPagesOutput.appendChild(wrapper);
    } else if (page.pageType === "holeLoadProfile") {
      const groups = groupedHoleLoadProfiles(page);
      const chunks = chunkHoleLoadProfileGroups(groups);
      chunks.forEach((groupChunk, chunkIndex) => {
        const wrapper = document.createElement("section");
        wrapper.className = "print-output-page";
        const frame = document.createElement("div");
        frame.className = "print-paper-frame";
        if (page.colorMode === "greyscale") frame.classList.add("greyscale");
        frame.innerHTML = buildHoleLoadProfileMarkup(page, groupChunk, { pageNumber: chunkIndex + 1, pageCount: chunks.length });
        wrapper.appendChild(frame);
        els.printPagesOutput.appendChild(wrapper);
      });
    } else {
      const wrapper = document.createElement("section");
      wrapper.className = "print-output-page";
      const frame = document.createElement("div");
      frame.className = "print-paper-frame";
      if (page.colorMode === "greyscale") frame.classList.add("greyscale");
      const canvas = document.createElement("canvas");
      canvas.width = printRenderer.canvas.width;
      canvas.height = printRenderer.canvas.height;
      canvas.setAttribute("aria-label", `Print Page ${index + 1}`);
      frame.appendChild(canvas);
      renderPrintPageToCanvas(page, canvas);
      wrapper.appendChild(frame);
      els.printPagesOutput.appendChild(wrapper);
    }
  });
  setPrintRendererPage(currentPage, { render: true });
}

function handlePrintPointerDown(payload) {
  const page = activePrintPage();
  if (!page || page.pageType !== "diagram" || page.ui.workspaceMode !== "diagram") return false;
  if (!isDiagramPrintEditing() && payload.event.shiftKey && !payload.hole) {
    page.ui.selectionBoxDraft = {
      start: { x: payload.x, y: payload.y },
      current: { x: payload.x, y: payload.y },
      addMode: true,
    };
    printRenderer.render();
    return true;
  }
  if (!isDiagramPrintEditing()) return false;
  const hit = printRenderer.findDiagramPrintLabelAtScreen(payload.x, payload.y);
  if (!hit) return false;
  page.dragLabelHoleId = hit.hole.id;
  page.dragLabelKind = hit.kind || "hole";
  page.dragPointerDelta = {
    x: payload.x - hit.rect.left,
    y: payload.y - hit.rect.top,
  };
  page.ui.hoverLabelHoleId = hit.hole.id;
  printRenderer.render();
  return true;
}

function handlePrintHoleClick(hole, event) {
  const page = activePrintPage();
  if (!page || page.pageType !== "diagram" || page.ui.workspaceMode !== "diagram" || isDiagramPrintEditing()) return;
  if (!event.shiftKey) page.selection = new Set([hole.id]);
  else if (page.selection.has(hole.id)) page.selection.delete(hole.id);
  else page.selection.add(hole.id);
  renderPrintPageTabs();
  printRenderer.render();
}

function handlePrintPointerMove(payload) {
  const page = activePrintPage();
  if (!page || page.ui.workspaceMode !== "diagram") return false;
  if (!isDiagramPrintEditing() && page.ui.selectionBoxDraft) {
    page.ui.selectionBoxDraft.current = { x: payload.x, y: payload.y };
    printRenderer.render();
    return true;
  }
  const hit = isDiagramPrintEditing() ? printRenderer.findDiagramPrintLabelAtScreen(payload.x, payload.y) : null;
  const nextHover = isDiagramPrintEditing() && hit ? hit.hole.id : null;
  if (page.ui.hoverLabelHoleId !== nextHover) {
    page.ui.hoverLabelHoleId = nextHover;
    printRenderer.render();
  }
  if (!isDiagramPrintEditing() || !page.dragLabelHoleId || !page.dragPointerDelta) return false;
  const hole = page.holesById.get(page.dragLabelHoleId);
  if (!hole) return false;
  const defaultLayout = page.dragLabelKind === "corner"
    ? printRenderer.getDiagramPrintCornerLabelLayout(hole, { ignoreOffset: true })
    : printRenderer.getDiagramPrintLabelLayout(hole, { ignoreOffset: true });
  const layoutMap = page.dragLabelKind === "corner" ? page.cornerLabelLayoutByHoleId : page.labelLayoutByHoleId;
  layoutMap.set(hole.id, {
    offsetX: payload.x - page.dragPointerDelta.x - defaultLayout.rect.left,
    offsetY: payload.y - page.dragPointerDelta.y - defaultLayout.rect.top,
  });
  printRenderer.render();
  return true;
}

function handlePrintPointerUp() {
  const page = activePrintPage();
  if (page?.pageType === "diagram" && page.ui.workspaceMode === "diagram" && page.ui.selectionBoxDraft) {
    const draft = page.ui.selectionBoxDraft;
    page.ui.selectionBoxDraft = null;
    const rect = {
      left: Math.min(draft.start.x, draft.current.x),
      right: Math.max(draft.start.x, draft.current.x),
      top: Math.min(draft.start.y, draft.current.y),
      bottom: Math.max(draft.start.y, draft.current.y),
    };
    const holeIds = page.holes
      .filter((hole) => pointInRect(printRenderer.worldToScreen(hole.x, hole.y), rect))
      .map((hole) => hole.id);
    page.selection = new Set([...page.selection, ...holeIds]);
    renderPrintPageTabs();
    printRenderer.render();
    return true;
  }
  if (page?.pageType === "diagram" && page.ui.workspaceMode === "diagram" && !isDiagramPrintEditing() && page.selection?.size) {
    const pointer = printRenderer.pointerScreen || null;
    if (!pointer) return false;
    const hole = printRenderer.findHoleAtScreen(pointer.x, pointer.y);
    if (!hole) {
      page.selection = new Set();
      renderPrintPageTabs();
      printRenderer.render();
      return true;
    }
  }
  if (!page || !page.dragLabelHoleId) return false;
  page.dragLabelHoleId = null;
  page.dragLabelKind = null;
  page.dragPointerDelta = null;
  printRenderer.render();
  return true;
}

function startPrintLabelDialInteraction(event) {
  const page = activePrintPage();
  if (!page || page.ui.workspaceMode !== "diagram") return;
  printLabelDialState.dragging = true;
  event.preventDefault();
  setActivePrintLabelAngle(pointerDialAngle(event.clientX, event.clientY));
}

function normalizeAngleValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const rounded = Math.round(numeric);
  if (rounded === 0) return 0;
  return ALLOWED_ANGLES.has(rounded) ? rounded : 0;
}

function formatDiagramDiameterLabel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  const whole = Math.trunc(numeric);
  const fraction = Math.abs(numeric - whole) >= 0.49 && Math.abs(numeric - whole) <= 0.51 ? " 1/2" : "";
  if (fraction) return `${whole}${fraction}"`;
  return `${numeric}"`;
}

function selectedDiagramDefaultDiameter() {
  const numeric = Number(els.diagramShotDefaultDiameterSelect.value);
  return Number.isFinite(numeric) ? numeric : null;
}

function selectedDiagramMetadataNumber(input) {
  const numeric = Number(input.value);
  return Number.isFinite(numeric) ? numeric : null;
}

function selectedDiagramRockDensity() {
  const numeric = Number(els.diagramRockDensityInput.value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function quarryByName(name) {
  return appUi.quarries.find((quarry) => quarry.name === name) || null;
}

function activeProjectGeo() {
  const fromProject = normalizeGeoContext(projectState.geo);
  if (fromProject) {
    return {
      quarryName: projectState.geo.quarryName || diagramState.metadata.location || "",
      statePlaneEpsg: fromProject.statePlaneEpsg,
      statePlaneUnit: fromProject.statePlaneUnit,
    };
  }
  const quarry = quarryByName(diagramState.metadata.location || projectState.diagram.metadata.location || "");
  const normalized = normalizeGeoContext({
    statePlaneEpsg: quarry?.state_plane_epsg,
    statePlaneUnit: quarry?.state_plane_unit,
  });
  if (!normalized) return cloneGeoMetadata(projectState.geo);
  return {
    quarryName: quarry?.name || diagramState.metadata.location || "",
    statePlaneEpsg: normalized.statePlaneEpsg,
    statePlaneUnit: normalized.statePlaneUnit,
  };
}

function applyProjectGeoFromLocation(locationName) {
  const quarry = quarryByName(locationName);
  const normalized = normalizeGeoContext({
    statePlaneEpsg: quarry?.state_plane_epsg,
    statePlaneUnit: quarry?.state_plane_unit || "ft",
  });
  projectState.geo = {
    quarryName: locationName || "",
    statePlaneEpsg: normalized?.statePlaneEpsg || null,
    statePlaneUnit: normalized?.statePlaneUnit || "ft",
  };
  diagramState.metadata.quarryStatePlaneEpsg = projectState.geo.statePlaneEpsg;
  diagramState.metadata.quarryStatePlaneUnit = projectState.geo.statePlaneUnit;
  projectState.diagram.metadata.quarryStatePlaneEpsg = projectState.geo.statePlaneEpsg;
  projectState.diagram.metadata.quarryStatePlaneUnit = projectState.geo.statePlaneUnit;
}

function requireProjectGeoForImport() {
  const geo = activeProjectGeo();
  if (!geo.statePlaneEpsg || !supportsStatePlaneEpsg(geo.statePlaneEpsg)) {
    window.alert("Select a Shot location with an assigned EPSG before importing coordinates.");
    openMenu("diagramShotMenu");
    return null;
  }
  return geo;
}

function sanitizeShotCorners(targetState) {
  const validIds = new Set((targetState.holes || []).map((hole) => hole.id));
  targetState.shotCorners = cloneShotCorners(targetState.shotCorners).slice(0, 4);
  while (targetState.shotCorners.length < 4) targetState.shotCorners.push(null);
  targetState.shotCorners = targetState.shotCorners.map((cornerId) => (cornerId && validIds.has(cornerId) ? cornerId : null));
}

function shotCornerLabel(index) {
  return `Corner ${index + 1}`;
}

function applyQuarryDensityDefault(locationName) {
  const quarry = quarryByName(locationName);
  if (!quarry) return;
  const density = Number(quarry.default_rock_density);
  if (!Number.isFinite(density) || density <= 0) return;
  diagramState.metadata.rockDensityTonsPerCubicYard = density;
}

function applyShotDefaultDiameterToExistingHoles(nextDefaultDiameter) {
  const previousDefaultDiameter = diagramState.metadata.defaultDiameter;
  if (!Number.isFinite(nextDefaultDiameter)) return;
  diagramState.holes.forEach((hole) => {
    if (hole.diameter === null || hole.diameter === undefined) {
      hole.diameter = nextDefaultDiameter;
      return;
    }
    if (Number.isFinite(previousDefaultDiameter) && Number(hole.diameter) === previousDefaultDiameter) {
      hole.diameter = nextDefaultDiameter;
    }
  });
}

function syncDiagramDefaultDiameterStatus() {
  const value = diagramState.metadata.defaultDiameter;
  els.diagramDefaultDiameterStatus.textContent = Number.isFinite(value)
    ? `Default Hole Diameter: ${formatDiagramDiameterLabel(value)}`
    : "Default Hole Diameter: not set";
}

function faceHoleCount() {
  return diagramState.holes.filter((hole) => hole.isFaceHole === true).length;
}

function renderDiagramShotPanel() {
  els.diagramShotNumberInput.value = diagramState.metadata.shotNumber;
  els.diagramShotLocationSelect.value = diagramState.metadata.location;
  els.diagramBenchInput.value = diagramState.metadata.bench;
  els.diagramShotDefaultDiameterSelect.value = Number.isFinite(diagramState.metadata.defaultDiameter) ? String(diagramState.metadata.defaultDiameter) : "";
  els.diagramPatternSubdrillInput.value = Number.isFinite(diagramState.metadata.patternSubdrill) ? String(diagramState.metadata.patternSubdrill) : "";
  els.diagramFaceBurdenInput.value = Number.isFinite(diagramState.metadata.faceBurden) ? String(diagramState.metadata.faceBurden) : "";
  els.diagramFaceSpacingInput.value = Number.isFinite(diagramState.metadata.faceSpacing) ? String(diagramState.metadata.faceSpacing) : "";
  els.diagramInteriorBurdenInput.value = Number.isFinite(diagramState.metadata.interiorBurden) ? String(diagramState.metadata.interiorBurden) : "";
  els.diagramInteriorSpacingInput.value = Number.isFinite(diagramState.metadata.interiorSpacing) ? String(diagramState.metadata.interiorSpacing) : "";
  const count = faceHoleCount();
  const geo = activeProjectGeo();
  els.diagramFaceStatus.textContent = diagramState.ui.pendingFaceDesignation
    ? `Face Holes: ${count} designated - draw a polygon to redefine the face`
    : `Face Holes: ${count} designated`;
  els.diagramGeoStatus.textContent = geo.statePlaneEpsg
    ? `State Plane EPSG: ${geo.statePlaneEpsg} | Unit: ${geo.statePlaneUnit}`
    : "State Plane EPSG: not assigned";
  els.diagramAssignFaceBtn.classList.toggle("active", diagramState.ui.pendingFaceDesignation);
  els.diagramClearFaceBtn.disabled = !diagramState.holes.length || count === 0;
  els.diagramApplyPatternBtn.disabled = !diagramState.holes.length;
}

function formatVolumeNumber(value) {
  if (!Number.isFinite(value)) return "0";
  return (Math.round(value * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function summarizeDiagramVolume() {
  const density = Number.isFinite(diagramState.metadata.rockDensityTonsPerCubicYard)
    ? diagramState.metadata.rockDensityTonsPerCubicYard
    : 2.3;
  let includedHoleCount = 0;
  let cubicYards = 0;
  diagramState.holes.forEach((hole) => {
    const burden = Number(hole.burden);
    const spacing = Number(hole.spacing);
    const depth = Number(hole.depth);
    const subdrill = Number(hole.subdrill);
    if (!Number.isFinite(burden) || !Number.isFinite(spacing) || !Number.isFinite(depth)) return;
    const effectiveDepth = depth - (Number.isFinite(subdrill) ? subdrill : 0);
    if (!(effectiveDepth > 0)) return;
    includedHoleCount += 1;
    cubicYards += (burden * spacing * effectiveDepth) / 27;
  });
  return {
    includedHoleCount,
    cubicYards,
    tons: cubicYards * density,
  };
}

function renderDiagramVolumePanel() {
  const density = Number.isFinite(diagramState.metadata.rockDensityTonsPerCubicYard)
    ? diagramState.metadata.rockDensityTonsPerCubicYard
    : 2.3;
  const summary = summarizeDiagramVolume();
  els.diagramRockDensityInput.value = String(density);
  els.diagramVolumeRuleStatus.textContent = "Volume uses burden x spacing x (depth - subdrill). Subdrill is excluded from tonnage.";
  if (!diagramState.holes.length) {
    els.diagramVolumeIncludedStatus.textContent = "No holes imported yet.";
    els.diagramVolumeCubicYardsStatus.textContent = "Volume will appear after import.";
    els.diagramVolumeTonsStatus.textContent = "Tonnage will appear after import.";
    return;
  }
  if (!summary.includedHoleCount) {
    els.diagramVolumeIncludedStatus.textContent = "No holes have enough burden, spacing, and depth yet.";
    els.diagramVolumeCubicYardsStatus.textContent = "Volume unavailable until required fields are filled.";
    els.diagramVolumeTonsStatus.textContent = "Tonnage unavailable until required fields are filled.";
    return;
  }
  els.diagramVolumeIncludedStatus.textContent = `Included Holes: ${summary.includedHoleCount}`;
  els.diagramVolumeCubicYardsStatus.textContent = `Total Cubic Yards: ${formatVolumeNumber(summary.cubicYards)}`;
  els.diagramVolumeTonsStatus.textContent = `Total Tons: ${formatVolumeNumber(summary.tons)}`;
}

function createBlankMaterialEntry(types) {
  return {
    type: types[0] || "",
    quantity: 1,
  };
}

function holeDeckingEnabled(hole) {
  return hole?.deckingEnabled === true && Array.isArray(hole.decks) && hole.decks.length > 1;
}

function deckCountForPreset(preset) {
  if (preset === "three-equal") return 3;
  if (preset === "two-equal") return 2;
  return 1;
}

function buildDeckingPresetFromHole(hole, deckCount) {
  const depth = Math.max(0, Math.round(Number(hole?.depth) || 0));
  const firstStemming = Number.isFinite(Number(hole?.stemHeight)) ? Math.max(0, Math.min(depth, Math.round(Number(hole.stemHeight)))) : 0;
  const targetCount = Math.max(1, Math.min(3, Math.round(Number(deckCount) || 1)));
  const explosiveDepth = Math.max(0, depth - firstStemming);
  if (targetCount > 1 && explosiveDepth < targetCount) {
    return {
      valid: false,
      reason: `Hole ${hole.holeNumber || hole.id} is too short for ${targetCount} decks with positive explosive lengths.`,
    };
  }
  const baseLength = targetCount ? Math.floor(explosiveDepth / targetCount) : explosiveDepth;
  let remainder = explosiveDepth - (baseLength * targetCount);
  const decks = [];
  for (let index = 0; index < targetCount; index += 1) {
    // When a whole-foot split leaves remainder footage, push the extra feet to lower decks first.
    const extra = remainder > 0 && index >= targetCount - remainder ? 1 : 0;
    decks.push({
      id: `deck-${index + 1}`,
      index,
      stemmingAbove: index === 0 ? firstStemming : 0,
      columnLength: baseLength + extra,
      detonators: index === 0 ? cloneMaterialEntries(hole?.detonators || []) : [],
      boosters: index === 0 ? cloneMaterialEntries(hole?.boosters || []) : [],
    });
  }
  return {
    valid: true,
    deckingEnabled: targetCount > 1,
    interdeckTimingMode: "top-first",
    decks,
  };
}

function selectedDeckPresetCount() {
  return deckCountForPreset(els.diagramDeckPresetSelect.value);
}

function cloneDeckingDraftState(draft = null) {
  const source = draft || {};
  return {
    interdeckTimingMode: source.interdeckTimingMode === "simultaneous" ? "simultaneous" : "top-first",
    stemIntervals: Array.isArray(source.stemIntervals)
      ? source.stemIntervals.map((interval) => ({
        startDepth: Math.max(0, Math.round(Number(interval.startDepth) || 0)),
        endDepth: Math.max(0, Math.round(Number(interval.endDepth) || 0)),
      }))
      : [],
    decks: Array.isArray(source.decks)
      ? source.decks.map((deck, index) => ({
        id: deck.id || `deck-${index + 1}`,
        index,
        stemmingAbove: Math.max(0, Math.round(Number(deck.stemmingAbove) || 0)),
        columnLength: Math.max(0, Math.round(Number(deck.columnLength) || 0)),
      }))
      : [],
  };
}

function referenceHoleForDeckingDraft() {
  return selectedDiagramHoles()[0] || diagramState.holes[0] || null;
}

function seedDeckingDraftForPreset(deckCount) {
  if (deckCount <= 1) {
    return {
      interdeckTimingMode: "top-first",
      stemIntervals: [],
      decks: [{
        id: "deck-1",
        index: 0,
        stemmingAbove: 0,
        columnLength: 0,
      }],
    };
  }
  const referenceHole = referenceHoleForDeckingDraft();
  const seeded = referenceHole ? buildDeckingPresetFromHole(referenceHole, deckCount) : null;
  if (seeded?.valid) {
    return {
      ...cloneDeckingDraftState(seeded),
      stemIntervals: stemIntervalsFromDecks(seeded.decks || []),
    };
  }
  return {
    interdeckTimingMode: "top-first",
    stemIntervals: Array.from({ length: Math.max(0, deckCount - 1) }, () => ({ startDepth: 0, endDepth: 0 })),
    decks: Array.from({ length: deckCount }, (_, index) => ({
      id: `deck-${index + 1}`,
      index,
      stemmingAbove: 0,
      columnLength: 0,
    })),
  };
}

function ensureDeckingDraftForPreset({ reset = false } = {}) {
  const deckCount = selectedDeckPresetCount();
  const currentCount = Array.isArray(diagramState.ui.deckingDraft?.decks) ? diagramState.ui.deckingDraft.decks.length : 0;
  if (reset || currentCount !== deckCount) {
    diagramState.ui.deckingDraft = seedDeckingDraftForPreset(deckCount);
  } else {
    diagramState.ui.deckingDraft = cloneDeckingDraftState(diagramState.ui.deckingDraft);
    if (!Array.isArray(diagramState.ui.deckingDraft.stemIntervals) || diagramState.ui.deckingDraft.stemIntervals.length !== Math.max(0, deckCount - 1)) {
      diagramState.ui.deckingDraft.stemIntervals = stemIntervalsFromDecks(diagramState.ui.deckingDraft.decks || []);
    }
  }
  return diagramState.ui.deckingDraft;
}

function deckingDraftTotalFeet(draft = diagramState.ui.deckingDraft) {
  return (draft?.decks || []).reduce((sum, deck) => sum + (Number(deck.stemmingAbove) || 0) + (Number(deck.columnLength) || 0), 0);
}

function stemIntervalsFromDecks(decks = []) {
  const intervals = [];
  let previousBottom = 0;
  decks.forEach((deck, index) => {
    const stemmingAbove = Math.max(0, Math.round(Number(deck?.stemmingAbove) || 0));
    const columnLength = Math.max(0, Math.round(Number(deck?.columnLength) || 0));
    const topDepth = previousBottom + stemmingAbove;
    const bottomDepth = topDepth + columnLength;
    if (index > 0) {
      intervals.push({
        index: index - 1,
        startDepth: topDepth,
        endDepth: previousBottom,
        gapLength: stemmingAbove,
      });
    }
    previousBottom = bottomDepth;
  });
  return intervals;
}

function stemIntervalLength(interval = {}) {
  const startDepth = Math.max(0, Math.round(Number(interval.startDepth) || 0));
  const endDepth = Math.max(0, Math.round(Number(interval.endDepth) || 0));
  return Math.abs(startDepth - endDepth);
}

function equalDeckColumnLengths(totalExplosiveLength, deckCount) {
  const safeDeckCount = Math.max(1, Math.round(Number(deckCount) || 1));
  const baseLength = Math.floor(totalExplosiveLength / safeDeckCount);
  let remainder = totalExplosiveLength - (baseLength * safeDeckCount);
  return Array.from({ length: safeDeckCount }, (_, index) => {
    const extra = remainder > 0 && index >= safeDeckCount - remainder ? 1 : 0;
    return baseLength + extra;
  });
}

function buildDecksFromStemIntervals({ topStemming = 0, intervals = [], deckCount = 1, existingDecks = [], holeDepth = 0 }) {
  const safeDeckCount = Math.max(1, Math.round(Number(deckCount) || 1));
  const safeTopStemming = Math.max(0, Math.round(Number(topStemming) || 0));
  const normalizedIntervals = Array.from({ length: Math.max(0, safeDeckCount - 1) }, (_, index) => ({
    startDepth: Math.max(0, Math.round(Number(intervals[index]?.startDepth) || 0)),
    endDepth: Math.max(0, Math.round(Number(intervals[index]?.endDepth) || 0)),
  }));
  const interdeckLengths = normalizedIntervals.map((interval) => stemIntervalLength(interval));
  const totalInertLength = safeTopStemming + interdeckLengths.reduce((sum, length) => sum + length, 0);
  if (holeDepth > 0 && totalInertLength >= holeDepth) {
    return { valid: false, reason: `Top stemming plus deck stemming totals ${totalInertLength} ft, which leaves no room for powder in a ${holeDepth} ft hole.` };
  }
  const totalExplosiveLength = Math.max(0, Math.round(Number(holeDepth) || 0) - totalInertLength);
  if (safeDeckCount > 1 && totalExplosiveLength < safeDeckCount) {
    return { valid: false, reason: `This hole does not have enough remaining footage to split into ${safeDeckCount} whole-foot powder columns.` };
  }
  const columnLengths = equalDeckColumnLengths(totalExplosiveLength, safeDeckCount);
  const invalidColumn = columnLengths.find((length) => !(length > 0));
  if (invalidColumn !== undefined) {
    return { valid: false, reason: "Each powder column needs at least 1 ft after stemming is applied." };
  }
  const decks = [];
  for (let index = 0; index < safeDeckCount; index += 1) {
    decks.push({
      id: existingDecks[index]?.id || `deck-${index + 1}`,
      index,
      stemmingAbove: index === 0 ? safeTopStemming : interdeckLengths[index - 1],
      columnLength: columnLengths[index],
      detonators: cloneMaterialEntries(existingDecks[index]?.detonators || []),
      boosters: cloneMaterialEntries(existingDecks[index]?.boosters || []),
    });
  }
  return { valid: true, decks, totalExplosiveLength, totalInertLength, interdeckLengths, columnLengths };
}

function derivedDeckingSummary({ topStemming = 0, intervals = [], deckCount = 1, holeDepth = 0 }) {
  const built = buildDecksFromStemIntervals({ topStemming, intervals, deckCount, holeDepth });
  if (!built.valid) return built.reason;
  return `Top stem ${formatLoadingWeight(topStemming)} ft | Deck stems ${built.interdeckLengths.map((length) => `${formatLoadingWeight(length)} ft`).join(" / ")} | Powder columns ${built.columnLengths.map((length) => `${formatLoadingWeight(length)} ft`).join(" / ")}`;
}

function deckingDraftEditorMarkup(draft = diagramState.ui.deckingDraft) {
  const deckCount = selectedDeckPresetCount();
  if (deckCount <= 1) {
    return `<div class="status-note">Single deck apply clears decking back to a normal hole.</div>`;
  }
  const intervals = Array.isArray(draft?.stemIntervals) && draft.stemIntervals.length
    ? draft.stemIntervals
    : stemIntervalsFromDecks(draft?.decks || []);
  return intervals.map((interval, index) => `
    <div class="decking-entry-row">
      <div class="decking-entry-head">
        <strong>Deck Stem ${index + 1}</strong>
        <span class="status-note">${escapeHtml(`Enter the inert deck-stem interval. Example: 34 to 26 = ${formatLoadingWeight(interval.gapLength || 0)} ft stem.`)}</span>
      </div>
      <div class="decking-entry-grid">
        <label>Deck Stem Start
          <input type="number" step="1" min="0" data-decking-draft-index="${index}" data-decking-draft-field="startDepth" value="${escapeHtml(String(interval.startDepth ?? 0))}">
        </label>
        <label>Deck Stem End
          <input type="number" step="1" min="0" data-decking-draft-index="${index}" data-decking-draft-field="endDepth" value="${escapeHtml(String(interval.endDepth ?? 0))}">
        </label>
      </div>
    </div>
  `).join("");
}

function syncDeckingDraftStatus() {
  const referenceHole = referenceHoleForDeckingDraft();
  const topStemming = Math.max(0, Math.round(Number(referenceHole?.stemHeight) || 0));
  const holeDepth = Math.max(0, Math.round(Number(referenceHole?.depth) || 0));
  const summary = derivedDeckingSummary({
    topStemming,
    intervals: Array.isArray(diagramState.ui.deckingDraft?.stemIntervals) ? diagramState.ui.deckingDraft.stemIntervals : [],
    deckCount: selectedDeckPresetCount(),
    holeDepth,
  });
  els.diagramDeckingDraftStatus.textContent = selectedDeckPresetCount() <= 1
    ? "Single deck apply clears decking back to a normal hole."
    : `Top stem comes from each hole. Enter deck-stem intervals here. ${summary}`;
}

function buildDeckingDraftForHole(hole) {
  const deckCount = selectedDeckPresetCount();
  if (deckCount <= 1) {
    return { valid: true, clearToSingle: true };
  }
  const draft = ensureDeckingDraftForPreset();
  const depth = Math.max(0, Math.round(Number(hole?.depth) || 0));
  if (!(depth > 0)) {
    return { valid: false, reason: `Hole ${hole?.holeNumber || hole?.id || ""} needs a valid depth before applying decking.` };
  }
  const topStemming = Math.max(0, Math.round(Number(hole?.stemHeight) || 0));
  const intervals = Array.isArray(draft.stemIntervals) && draft.stemIntervals.length
    ? draft.stemIntervals.slice(0, Math.max(0, deckCount - 1))
    : stemIntervalsFromDecks((draft.decks || []).slice(0, deckCount));
  const built = buildDecksFromStemIntervals({
    topStemming,
    intervals,
    deckCount,
    existingDecks: draft.decks || [],
    holeDepth: depth,
  });
  if (!built.valid) {
    return { valid: false, reason: `Hole ${hole.holeNumber || hole.id}: ${built.reason}` };
  }
  const decks = built.decks.map((deck, index) => ({
    ...deck,
    detonators: index === 0 ? cloneMaterialEntries(hole?.detonators || []) : [],
    boosters: index === 0 ? cloneMaterialEntries(hole?.boosters || []) : [],
  }));
  return {
    valid: true,
    deckingEnabled: true,
    interdeckTimingMode: draft.interdeckTimingMode === "simultaneous" ? "simultaneous" : "top-first",
    decks,
  };
}

function applyDeckPresetToHole(hole, preset = els.diagramDeckPresetSelect.value) {
  const deckCount = deckCountForPreset(preset);
  const next = buildDeckingPresetFromHole(hole, deckCount);
  if (!next.valid) return next;
  hole.deckingEnabled = next.deckingEnabled;
  hole.interdeckTimingMode = next.interdeckTimingMode;
  hole.decks = next.decks;
  hole.deckStemIntervals = stemIntervalsFromDecks(next.decks || []);
  recalculateHoleLoading(hole, diagramState.metadata.loadingDensityGcc);
  return { valid: true };
}

function clearDeckingForHole(hole) {
  const totalInertLength = Math.max(0, Math.round(Number(hole.totalInertLength) || Number(hole.stemHeight) || 0));
  const fullDepth = Math.max(0, Math.round(Number(hole.depth) || 0));
  hole.deckingEnabled = false;
  hole.interdeckTimingMode = "top-first";
  hole.decks = [{
    id: "deck-1",
    index: 0,
    stemmingAbove: Math.min(fullDepth, totalInertLength),
    columnLength: Math.max(0, fullDepth - Math.min(fullDepth, totalInertLength)),
    detonators: cloneMaterialEntries(hole.detonators || []),
    boosters: cloneMaterialEntries(hole.boosters || []),
  }];
  hole.deckStemIntervals = [];
  recalculateHoleLoading(hole, diagramState.metadata.loadingDensityGcc);
}

function deckDelaySummary(hole) {
  const result = selectedTimingResult();
  const values = result?.displayTimesByHoleId instanceof Map ? result.displayTimesByHoleId.get(hole.id) : null;
  if (!values?.length) return "Deck delays: no timing selected";
  return `Deck delays: ${values.map((value) => `${Math.round(value)} ms`).join(" / ")}`;
}

function deckEditorMarkup(hole) {
  const decks = hole?.decks || [];
  const intervals = stemIntervalsFromDecks(decks);
  return intervals.map((interval, index) => `
    <div class="decking-entry-row">
      <div class="decking-entry-head">
        <strong>Deck Stem ${index + 1}</strong>
        <span class="status-note" data-deck-summary="${index}">${escapeHtml(`Stem interval ${formatLoadingWeight(interval.startDepth || 0)}-${formatLoadingWeight(interval.endDepth || 0)} ft | Powder ${formatLoadingWeight(decks[index]?.columnLength || 0)} ft above / ${formatLoadingWeight(decks[index + 1]?.columnLength || 0)} ft below`)}</span>
      </div>
      <div class="decking-entry-grid">
        <label>Deck Stem Start
          <input type="number" step="1" min="0" data-deck-index="${index}" data-deck-field="startDepth" value="${escapeHtml(String(interval.startDepth ?? 0))}">
        </label>
        <label>Deck Stem End
          <input type="number" step="1" min="0" data-deck-index="${index}" data-deck-field="endDepth" value="${escapeHtml(String(interval.endDepth ?? 0))}">
        </label>
      </div>
    </div>
  `).join("");
}

function singleHoleDeckingStatusText(hole) {
  return hole.deckingError
    ? hole.deckingError
    : hole.loadingWarning
      ? hole.loadingWarning
      : holeDeckingEnabled(hole)
        ? `Deck total: ${formatLoadingWeight(hole.totalDeckedLength || hole.depth || 0)} / ${formatLoadingWeight(hole.depth || 0)} ft`
        : "Single-deck hole. Enable decking to split this hole.";
}

function syncSingleHoleDeckingEditorSummaries(hole) {
  const rows = [...els.diagramHoleDeckingEditor.querySelectorAll("[data-deck-summary]")];
  const decks = hole?.decks || [];
  const intervals = stemIntervalsFromDecks(decks);
  if (!rows.length || rows.length !== intervals.length) {
    els.diagramHoleDeckingEditor.innerHTML = deckEditorMarkup(hole);
    return;
  }
  rows.forEach((node, index) => {
    const interval = intervals[index] || {};
    node.textContent = `Stem interval ${formatLoadingWeight(interval.startDepth || 0)}-${formatLoadingWeight(interval.endDepth || 0)} ft | Powder ${formatLoadingWeight(decks[index]?.columnLength || 0)} ft above / ${formatLoadingWeight(decks[index + 1]?.columnLength || 0)} ft below`;
  });
}

function singleHoleDeckIntervals(hole) {
  if (Array.isArray(hole?.deckStemIntervals) && hole.deckStemIntervals.length) {
    return hole.deckStemIntervals.map((interval) => ({
      startDepth: Math.max(0, Math.round(Number(interval.startDepth) || 0)),
      endDepth: Math.max(0, Math.round(Number(interval.endDepth) || 0)),
    }));
  }
  return stemIntervalsFromDecks(hole?.decks || []);
}

function refreshSingleHoleDeckingUi(hole, { preserveDeckEditor = false } = {}) {
  if (!hole) return;
  els.diagramHoleLoadingDepthInput.value = Number.isFinite(Number(hole.depth)) ? String(hole.depth) : "";
  els.diagramHoleLoadingStemHeightInput.value = Number.isFinite(Number(hole.stemHeight)) ? String(hole.stemHeight) : "";
  els.diagramHoleLoadingColumnDepthStatus.textContent = `Explosive Column: ${formatLoadingWeight(hole.columnDepth)} ft`;
  els.diagramHoleLoadingWeightStatus.textContent = `Emulsion Weight: ${formatLoadingWeight(hole.explosiveWeightLb)} lb`;
  els.diagramHoleLoadingWarning.textContent = hole.loadingWarning || "";
  els.diagramDeckingEnabledInput.checked = holeDeckingEnabled(hole);
  els.diagramDeckCountSelect.value = String(Math.max(1, Math.min(3, hole?.decks?.length || 1)));
  els.diagramInterdeckTimingModeSelect.value = hole.interdeckTimingMode === "simultaneous" ? "simultaneous" : "top-first";
  els.diagramHoleDeckingStatus.textContent = singleHoleDeckingStatusText(hole);
  els.diagramHoleDeckingDelaySummary.textContent = holeDeckingEnabled(hole) ? deckDelaySummary(hole) : "Deck delays: single deck";
  if (preserveDeckEditor) syncSingleHoleDeckingEditorSummaries(hole);
  else els.diagramHoleDeckingEditor.innerHTML = deckEditorMarkup(hole);
  els.diagramInterdeckTimingModeSelect.disabled = !holeDeckingEnabled(hole);
}

function applyDeckingPresetToTargets(targets) {
  const deckCount = selectedDeckPresetCount();
  if (deckCount <= 1) {
    clearDeckingForTargets(targets);
    return true;
  }
  const validationResults = targets.map((hole) => buildDeckingDraftForHole(hole));
  const invalidResult = validationResults.find((result) => !result.valid);
  if (invalidResult) {
    window.alert(invalidResult.reason || "Could not apply decking preset.");
    return false;
  }
  targets.forEach((hole, index) => {
    const result = validationResults[index];
    if (result.clearToSingle) {
      clearDeckingForHole(hole);
      return;
    }
    hole.deckingEnabled = result.deckingEnabled;
    hole.interdeckTimingMode = result.interdeckTimingMode;
    hole.decks = result.decks;
    hole.deckStemIntervals = Array.isArray(diagramState.ui.deckingDraft?.stemIntervals)
      ? diagramState.ui.deckingDraft.stemIntervals.map((interval) => ({ ...interval }))
      : [];
    recalculateHoleLoading(hole, diagramState.metadata.loadingDensityGcc);
  });
  diagramState.ui.pendingDeckingApplyMode = null;
  fullDiagramRefresh();
  return true;
}

function applyDeckingToHoleIds(holeIds) {
  const targets = holeIds.map((id) => diagramState.holesById.get(id)).filter(Boolean);
  if (!targets.length) return;
  applyDeckingPresetToTargets(targets);
}

function clearDeckingForTargets(targets) {
  targets.forEach((hole) => clearDeckingForHole(hole));
  diagramState.ui.pendingDeckingApplyMode = null;
  fullDiagramRefresh();
}

function refreshDiagramLoadingDerivedState() {
  const density = normalizeLoadingDensity(diagramState.metadata.loadingDensityGcc);
  diagramState.metadata.loadingDensityGcc = density;
  diagramState.holes.forEach((hole) => recalculateHoleLoading(hole, density));
}

function formatLoadingWeight(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return numeric.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

function summarizeDiagramLoading() {
  refreshDiagramLoadingDerivedState();
  return summarizeShotLoading(diagramState.holes, diagramState.metadata.loadingDensityGcc);
}

function materialCountsMarkup(countsMap, emptyLabel) {
  const rows = [...countsMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([type, quantity]) => `<div>${escapeHtml(`${quantity} x ${type}`)}</div>`)
    .join("");
  return rows || `<div>${escapeHtml(emptyLabel)}</div>`;
}

function materialSummaryLines(countsMap, emptyLabel) {
  const rows = [...countsMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([type, quantity]) => `${quantity} x ${type}`);
  return rows.length ? rows : [emptyLabel];
}

function materialEntryEditorMarkup(entries, types, { scope }) {
  const rows = entries.map((entry, index) => `
    <div class="loading-entry-row">
      <select data-loading-scope="${scope}" data-loading-field="type" data-loading-index="${index}">
        ${types.map((type) => `<option value="${escapeHtml(type)}"${entry.type === type ? " selected" : ""}>${escapeHtml(type)}</option>`).join("")}
      </select>
      <div class="loading-qty-stepper">
        <button type="button" data-loading-scope="${scope}" data-loading-step="-1" data-loading-index="${index}" aria-label="Decrease quantity">-</button>
        <input type="text" value="${escapeHtml(String(entry.quantity || 1))}" readonly aria-label="Quantity">
        <button type="button" data-loading-scope="${scope}" data-loading-step="1" data-loading-index="${index}" aria-label="Increase quantity">+</button>
      </div>
      <button type="button" data-loading-scope="${scope}" data-loading-remove="${index}">Remove</button>
    </div>
  `).join("");
  return rows || `<div class="status-note">No entries assigned.</div>`;
}

function renderDiagramLoadingPanel() {
  ensureDeckingDraftForPreset();
  const density = normalizeLoadingDensity(diagramState.metadata.loadingDensityGcc);
  diagramState.metadata.loadingDensityGcc = density;
  const summary = summarizeDiagramLoading();
  const selectedCount = diagramState.selection.size;
  const warningText = summary.warningHoleCount
    ? ` | ${summary.warningHoleCount} hole${summary.warningHoleCount === 1 ? "" : "s"} flagged`
    : "";

  els.diagramLoadingDensityInput.value = String(density);
  els.diagramLoadingTotalWeightStatus.textContent = summary.includedHoleCount
    ? `Total Emulsion: ${formatLoadingWeight(summary.totalExplosiveWeightLb)} lb`
    : "No loading assigned yet.";
  els.diagramLoadingIncludedCountStatus.textContent = summary.totalHoleCount
    ? (summary.includedHoleCount
      ? `Holes Included: ${summary.includedHoleCount} of ${summary.totalHoleCount}${warningText}`
      : "No holes currently contribute to loading totals.")
    : "Import holes to start building loading totals.";
  els.diagramLoadingAverageStatus.textContent = summary.includedHoleCount
    ? `Average: ${formatLoadingWeight(summary.averageExplosiveWeightLb)} lb/hole`
    : "Average will appear after loading is assigned.";
  els.diagramLoadingSelectionStatus.textContent = selectedCount
    ? `${selectedCount} selected hole${selectedCount === 1 ? "" : "s"} ready for assignment`
    : "Select one or more holes to assign detonators and boosters.";
  syncDeckingDraftStatus();
  els.diagramDeckingDraftEditor.innerHTML = deckingDraftEditorMarkup();
  els.diagramDeckingApplyStatus.textContent = diagramState.ui.pendingDeckingApplyMode === "box"
    ? "Decking apply armed for box selection."
    : diagramState.ui.pendingDeckingApplyMode === "polygon"
      ? "Decking apply armed for polygon selection."
      : "Choose a preset, then apply it to the current selection or arm box/polygon apply.";
  els.diagramLoadingDetonatorEditor.innerHTML = materialEntryEditorMarkup(diagramState.ui.loadingDraft.detonators, DETONATOR_TYPES, { scope: "draft-detonator" });
  els.diagramLoadingBoosterEditor.innerHTML = materialEntryEditorMarkup(diagramState.ui.loadingDraft.boosters, BOOSTER_TYPES, { scope: "draft-booster" });
  els.diagramLoadingApplyBtn.disabled = !diagramState.selection.size;
  els.diagramLoadingSummary.innerHTML = `
    <div><strong>${escapeHtml(summary.includedHoleCount ? `Total Emulsion: ${formatLoadingWeight(summary.totalExplosiveWeightLb)} lb` : "No loading assigned yet.")}</strong></div>
    <div>${escapeHtml(summary.totalHoleCount ? `${summary.totalHoleCount} holes in shot` : "Import holes to begin loading.")}</div>
    <div class="loading-summary-block">
      <div><strong>Detonators</strong></div>
      ${materialCountsMarkup(summary.detonatorCounts, "No detonators assigned")}
    </div>
    <div class="loading-summary-block">
      <div><strong>Boosters</strong></div>
      ${materialCountsMarkup(summary.boosterCounts, "No boosters assigned")}
    </div>
  `;
}

function updateDraftMaterialEntry(kind, index, field, rawValue) {
  const key = kind === "booster" ? "boosters" : "detonators";
  const types = kind === "booster" ? BOOSTER_TYPES : DETONATOR_TYPES;
  const entries = diagramState.ui.loadingDraft[key];
  const entry = entries[index];
  if (!entry) return;
  if (field === "type") entry.type = types.includes(rawValue) ? rawValue : types[0];
  if (field === "quantity") entry.quantity = Math.max(1, Math.round(Number(rawValue) || 1));
  renderDiagramLoadingPanel();
}

function stepDraftMaterialEntry(kind, index, delta) {
  const key = kind === "booster" ? "boosters" : "detonators";
  const entry = diagramState.ui.loadingDraft[key]?.[index];
  if (!entry) return;
  entry.quantity = Math.max(1, Math.round(Number(entry.quantity) || 1) + delta);
  renderDiagramLoadingPanel();
}

function addDraftMaterialEntry(kind) {
  const key = kind === "booster" ? "boosters" : "detonators";
  const types = kind === "booster" ? BOOSTER_TYPES : DETONATOR_TYPES;
  diagramState.ui.loadingDraft[key].push(createBlankMaterialEntry(types));
  renderDiagramLoadingPanel();
}

function removeDraftMaterialEntry(kind, index) {
  const key = kind === "booster" ? "boosters" : "detonators";
  diagramState.ui.loadingDraft[key].splice(index, 1);
  renderDiagramLoadingPanel();
}

function applyLoadingDraftToSelection() {
  const selected = selectedDiagramHoles();
  if (!selected.length) {
    window.alert("Select one or more holes before applying loading assignments.");
    return;
  }
  const detonators = normalizeMaterialEntries(diagramState.ui.loadingDraft.detonators, DETONATOR_TYPES);
  const boosters = normalizeMaterialEntries(diagramState.ui.loadingDraft.boosters, BOOSTER_TYPES);
  selected.forEach((hole) => {
    if (holeDeckingEnabled(hole) && hole.decks?.length) {
      hole.decks[0].detonators = cloneMaterialEntries(detonators);
      hole.decks[0].boosters = cloneMaterialEntries(boosters);
      for (let index = 1; index < hole.decks.length; index += 1) {
        hole.decks[index].detonators = [];
        hole.decks[index].boosters = [];
      }
    } else {
      hole.detonators = cloneMaterialEntries(detonators);
      hole.boosters = cloneMaterialEntries(boosters);
    }
    recalculateHoleLoading(hole, diagramState.metadata.loadingDensityGcc);
  });
  fullDiagramRefresh();
}

function renderSingleHoleLoadingEditor(hole) {
  if (!hole) {
    els.diagramHoleLoadingSection.classList.add("hidden");
    els.diagramHoleDeckingSection.classList.add("hidden");
    els.diagramHoleLoadingDepthInput.value = "";
    els.diagramHoleLoadingStemHeightInput.value = "";
    els.diagramHoleLoadingDetonatorEditor.innerHTML = "";
    els.diagramHoleLoadingBoosterEditor.innerHTML = "";
    els.diagramHoleLoadingColumnDepthStatus.textContent = "Explosive Column: -";
    els.diagramHoleLoadingWeightStatus.textContent = "Emulsion Weight: -";
    els.diagramHoleLoadingWarning.textContent = "";
    els.diagramHoleDeckingStatus.textContent = "Select a single hole to edit decking.";
    els.diagramHoleDeckingDelaySummary.textContent = "Deck delays: -";
    els.diagramHoleDeckingEditor.innerHTML = "";
    return;
  }
  recalculateHoleLoading(hole, diagramState.metadata.loadingDensityGcc);
  els.diagramHoleLoadingSection.classList.remove("hidden");
  els.diagramHoleDeckingSection.classList.remove("hidden");
  const materialSource = holeDeckingEnabled(hole) && hole.decks?.length ? hole.decks[0] : hole;
  els.diagramHoleLoadingDetonatorEditor.innerHTML = materialEntryEditorMarkup(materialSource.detonators || [], DETONATOR_TYPES, { scope: "hole-detonator" });
  els.diagramHoleLoadingBoosterEditor.innerHTML = materialEntryEditorMarkup(materialSource.boosters || [], BOOSTER_TYPES, { scope: "hole-booster" });
  refreshSingleHoleDeckingUi(hole);
}

function updateHoleMaterialEntry(kind, index, field, rawValue) {
  const hole = selectedDiagramHoles()[0];
  if (!hole) return;
  const key = kind === "booster" ? "boosters" : "detonators";
  const types = kind === "booster" ? BOOSTER_TYPES : DETONATOR_TYPES;
  const source = holeDeckingEnabled(hole) && hole.decks?.length ? hole.decks[0] : hole;
  const entry = source[key]?.[index];
  if (!entry) return;
  if (field === "type") entry.type = types.includes(rawValue) ? rawValue : types[0];
  if (field === "quantity") entry.quantity = Math.max(1, Math.round(Number(rawValue) || 1));
  recalculateHoleLoading(hole, diagramState.metadata.loadingDensityGcc);
  fullDiagramRefresh();
}

function stepHoleMaterialEntry(kind, index, delta) {
  const hole = selectedDiagramHoles()[0];
  if (!hole) return;
  const key = kind === "booster" ? "boosters" : "detonators";
  const source = holeDeckingEnabled(hole) && hole.decks?.length ? hole.decks[0] : hole;
  const entry = source[key]?.[index];
  if (!entry) return;
  entry.quantity = Math.max(1, Math.round(Number(entry.quantity) || 1) + delta);
  recalculateHoleLoading(hole, diagramState.metadata.loadingDensityGcc);
  fullDiagramRefresh();
}

function addHoleMaterialEntry(kind) {
  const hole = selectedDiagramHoles()[0];
  if (!hole) return;
  const key = kind === "booster" ? "boosters" : "detonators";
  const types = kind === "booster" ? BOOSTER_TYPES : DETONATOR_TYPES;
  const source = holeDeckingEnabled(hole) && hole.decks?.length ? hole.decks[0] : hole;
  source[key].push(createBlankMaterialEntry(types));
  recalculateHoleLoading(hole, diagramState.metadata.loadingDensityGcc);
  fullDiagramRefresh();
}

function removeHoleMaterialEntry(kind, index) {
  const hole = selectedDiagramHoles()[0];
  if (!hole) return;
  const key = kind === "booster" ? "boosters" : "detonators";
  const source = holeDeckingEnabled(hole) && hole.decks?.length ? hole.decks[0] : hole;
  source[key].splice(index, 1);
  recalculateHoleLoading(hole, diagramState.metadata.loadingDensityGcc);
  fullDiagramRefresh();
}

function updateSelectedHoleLoadingNumericField(field, rawValue) {
  const hole = selectedDiagramHoles()[0];
  if (!hole) return;
  const trimmed = String(rawValue ?? "").trim();
  hole[field] = trimmed === "" ? null : Number(trimmed);
  normalizeDiagramHoleFields(hole);
  fullDiagramRefresh();
}

function annotationSizeConfig(size) {
  return DIAGRAM_ANNOTATION_SIZE_MAP[size] || DIAGRAM_ANNOTATION_SIZE_MAP.medium;
}

function generateDiagramTextId() {
  return `text-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeAnnotationTool(tool) {
  return DIAGRAM_TOOL_MODES.has(tool) ? tool : "single";
}

function parseEditableAngleValue(raw) {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric);
  if (rounded === 0) return 0;
  return ALLOWED_ANGLES.has(rounded) ? rounded : null;
}

function pointToWorld(renderer, point) {
  return renderer.screenToWorld(point.x, point.y);
}

function normalizeDiagramHoleFields(hole, options = {}) {
  ensureDiagramHoleFields(hole);
  hole.angle = normalizeAngleValue(hole.angle);
  hole.isFaceHole = hole.isFaceHole === true;
  if (hole.bearing !== null && hole.bearing !== undefined) {
    const numericBearing = Number(hole.bearing);
    hole.bearing = Number.isFinite(numericBearing)
      ? (options.roundBearingAndDepth === true ? Math.round(numericBearing) : numericBearing)
      : null;
  }
  if (hole.depth !== null && hole.depth !== undefined) {
    const numericDepth = Number(hole.depth);
    hole.depth = Number.isFinite(numericDepth)
      ? (options.roundBearingAndDepth === true ? Math.round(numericDepth) : numericDepth)
      : null;
  }
  if (hole.subdrill !== null && hole.subdrill !== undefined) {
    const numericSubdrill = Number(hole.subdrill);
    hole.subdrill = Number.isFinite(numericSubdrill) ? numericSubdrill : null;
  }
  if (hole.stemHeight !== null && hole.stemHeight !== undefined) {
    const numericStemHeight = Number(hole.stemHeight);
    hole.stemHeight = Number.isFinite(numericStemHeight) ? numericStemHeight : null;
  }
  hole.deckingEnabled = hole.deckingEnabled === true;
  hole.interdeckTimingMode = hole.interdeckTimingMode === "simultaneous" ? "simultaneous" : "top-first";
  if (!Array.isArray(hole.decks) || !hole.decks.length) hole.decks = null;
  hole.detonators = normalizeMaterialEntries(hole.detonators, DETONATOR_TYPES);
  hole.boosters = normalizeMaterialEntries(hole.boosters, BOOSTER_TYPES);
  recalculateHoleLoading(hole, diagramState.metadata.loadingDensityGcc);
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function exportSelectedTimingCsv() {
  const selectedTiming = selectedTimingResult();
  if (!selectedTiming) {
    window.alert("Select a timing result first, then export CSV.");
    return;
  }

  const rows = solverState.holes.map((hole) => {
    const originalX = hole.collar?.original?.x ?? hole.original?.x ?? "";
    const originalY = hole.collar?.original?.y ?? hole.original?.y ?? "";
    const delayTime = selectedTiming.holeTimes instanceof Map ? selectedTiming.holeTimes.get(hole.id) : undefined;
    const deckTimes = selectedTiming.displayTimesByHoleId instanceof Map ? selectedTiming.displayTimesByHoleId.get(hole.id) : null;
    return [
      hole.holeNumber || hole.id,
      originalX,
      originalY,
      Number.isFinite(delayTime) ? delayTime : "",
      Array.isArray(deckTimes) ? deckTimes.map((value) => Math.round(value)).join(" / ") : "",
    ];
  });

  const csvText = [["hole_number", "x", "y", "delay_time_ms", "deck_delay_times_ms"], ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
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
  if (solverState.ui.isSolving) cancelTimingSolve({ keepMessage: true });
  resetTimingVisualization();
  resetTimingOverlapAnalysis();
  solverState.timingResults = [];
  solverState.ui.activeTimingPreviewIndex = -1;
  solverState.ui.readinessDismissed = false;
  solverState.solverMessage = message;
  updateTimingSolveProgress(0, 0);
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
  [
    els.xColumnSelect,
    els.yColumnSelect,
    els.toeXColumnSelect,
    els.toeYColumnSelect,
    els.idColumnSelect,
    els.solverAngleColumnSelect,
    els.solverBearingColumnSelect,
    els.solverDepthColumnSelect,
  ].forEach((select) => {
    const emptyLabel = select === els.idColumnSelect
      ? "(Auto)"
      : (
        select === els.toeXColumnSelect
        || select === els.toeYColumnSelect
        || select === els.solverAngleColumnSelect
        || select === els.solverBearingColumnSelect
        || select === els.solverDepthColumnSelect
      ) ? "(None)" : null;
    appendOptions(select, headers, emptyLabel);
  });

  const xGuess = inferHeaderByPriority(headers, [["start", "point", "easting"], ["start", "easting"], ["easting"], ["longitude"], ["x"]]);
  const yGuess = inferHeaderByPriority(headers, [["start", "point", "northing"], ["start", "northing"], ["northing"], ["latitude"], ["y"]]);
  const toeXGuess = inferHeaderByPriority(headers, [["toe", "easting"], ["end", "point", "easting"], ["toe", "longitude"], ["end", "point", "longitude"], ["toe", "x"]]);
  const toeYGuess = inferHeaderByPriority(headers, [["toe", "northing"], ["end", "point", "northing"], ["toe", "latitude"], ["end", "point", "latitude"], ["toe", "y"]]);
  const idGuess = inferHeaderByPriority(headers, [["hole"], ["id"]]);
  const angleGuess = inferHeaderByPriority(headers, [["angle"], ["inclination"], ["dip"]]);
  const bearingGuess = inferHeaderByPriority(headers, [["bearing"], ["azimuth"], ["azi"]]);
  const depthGuess = inferHeaderByPriority(headers, [["depth"], ["length"]]);

  if (xGuess) els.xColumnSelect.value = xGuess;
  if (yGuess) els.yColumnSelect.value = yGuess;
  if (toeXGuess) els.toeXColumnSelect.value = toeXGuess;
  if (toeYGuess) els.toeYColumnSelect.value = toeYGuess;
  if (idGuess) els.idColumnSelect.value = idGuess;
  if (angleGuess) els.solverAngleColumnSelect.value = angleGuess;
  if (bearingGuess) els.solverBearingColumnSelect.value = bearingGuess;
  if (depthGuess) els.solverDepthColumnSelect.value = depthGuess;

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
  const angleGuess = inferHeaderByPriority(headers, [["angle"], ["inclination"], ["dip"]]);
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
  const collarLocal = hole.collar?.coordinates?.local || hole.coordinates?.local || null;
  if (!hole.collar || !Number.isFinite(hole.collar.x) || !Number.isFinite(hole.collar.y)) {
    hole.collar = {
      x: Number.isFinite(collarLocal?.x) ? collarLocal.x : (Number.isFinite(hole.x) ? hole.x : 0),
      y: Number.isFinite(collarLocal?.y) ? collarLocal.y : (Number.isFinite(hole.y) ? hole.y : 0),
      original: hole.original || null,
      coordinates: cloneCoordinateBundle(hole.coordinates),
    };
  }
  if (hole.collar?.coordinates?.local) {
    hole.collar.x = hole.collar.coordinates.local.x;
    hole.collar.y = hole.collar.coordinates.local.y;
  }
  if (hole.toe?.coordinates?.local) {
    hole.toe.x = hole.toe.coordinates.local.x;
    hole.toe.y = hole.toe.coordinates.local.y;
  }
  if (hole.toe && (!Number.isFinite(hole.toe.x) || !Number.isFinite(hole.toe.y))) hole.toe = null;
  if (!hole.coordinates && hole.collar?.coordinates) hole.coordinates = cloneCoordinateBundle(hole.collar.coordinates);
}

function ensureDiagramHoleFields(hole) {
  DIAGRAM_FIELDS.forEach((field) => {
    if (!Object.hasOwn(hole, field) || hole[field] === undefined) hole[field] = null;
  });
  if (!Array.isArray(hole.detonators)) hole.detonators = [];
  if (!Array.isArray(hole.boosters)) hole.boosters = [];
  if (!Object.hasOwn(hole, "deckingEnabled")) hole.deckingEnabled = false;
  if (!Object.hasOwn(hole, "interdeckTimingMode")) hole.interdeckTimingMode = "top-first";
  if (!Array.isArray(hole.decks) || !hole.decks.length) hole.decks = null;
  if (!Object.hasOwn(hole, "columnDepth")) hole.columnDepth = calculateColumnDepthFeet(hole);
  if (!Object.hasOwn(hole, "explosiveWeightLb")) hole.explosiveWeightLb = 0;
  if (!Object.hasOwn(hole, "loadingWarning")) hole.loadingWarning = null;
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
    const description = escapeHtml(describeRelationship(edge, solverState.holesById));
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
    els.timingResults.innerHTML = `<div>${escapeHtml(solverState.solverMessage || defaultTimingMessage())}</div>`;
    resetTimingOverlapAnalysis();
    renderTimingOverlapAnalysis();
    renderTimingVisualizationControls();
    return;
  }
  els.timingResults.innerHTML = solverState.timingResults.map((result, index) => {
    const active = index === solverState.ui.activeTimingPreviewIndex ? "active" : "";
    const counts = result.mode === "manual" ? manualDelayCountsMarkup(result) : "";
    return `<button class="timing-item ${active}" data-timing-index="${index}"><span>${escapeHtml(formatTimingResult(result, index))}</span>${counts}</button>`;
  }).join("");
  renderTimingOverlapAnalysis();
  renderTimingVisualizationControls();
}

function fullSolverRefresh({ fit = false } = {}) {
  persistTimingStateToProject();
  renderOriginStatus();
  renderRelationshipList();
  syncTimingSolveFloating();
  renderTimingResults();
  renderPlannerStatusIndicator();
  refreshPlannerCardSummaries();
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
  holes.forEach((hole) => normalizeDiagramHoleFields(hole));
  solverState.holes = holes;
  solverState.selection = new Set();
  solverState.ui.coordView = "collar";
  solverState.ui.relationshipDraft = null;
  rebuildHolesById(solverState);
  resetGraphState();
  resetTimingResults(defaultTimingMessage());
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
  const pendingEdges = [];
  for (let index = 0; index < uniquePath.length - 1; index += 1) {
    const fromHoleId = uniquePath[index];
    const toHoleId = uniquePath[index + 1];
    if (fromHoleId === toHoleId) continue;
    const pendingState = {
      relationships: {
        ...solverState.relationships,
        edges: [...solverState.relationships.edges, ...pendingEdges],
      },
    };
    const conflict = findRelationshipLimitConflict(pendingState, { type: relationshipType, fromHoleId, toHoleId });
    if (conflict) {
      const hole = solverState.holesById.get(conflict.holeId);
      const directionLabel = conflict.direction === "incoming" ? "incoming" : "outgoing";
      window.alert(`${hole?.holeNumber || hole?.id || conflict.holeId} already has an ${directionLabel} ${relationshipLabel(relationshipType)} assignment.`);
      return false;
    }
    pendingEdges.push({ type: relationshipType, fromHoleId, toHoleId, sign });
  }
  pendingEdges.forEach((edge) => addRelationship(solverState, edge));
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

function validateRelationshipAssignmentLimit(input, excludeRelationshipId = null) {
  const conflict = findRelationshipLimitConflict(solverState, input, excludeRelationshipId);
  if (!conflict) return true;
  const hole = solverState.holesById.get(conflict.holeId);
  const directionLabel = conflict.direction === "incoming" ? "incoming" : "outgoing";
  window.alert(`${hole?.holeNumber || hole?.id || conflict.holeId} already has an ${directionLabel} ${relationshipLabel(input.type)} assignment.`);
  return false;
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
  if (!draft?.holeIds?.length) {
    clearSolverSelectionFromBlankClick(payload);
    return;
  }
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

function clearSolverSelectionFromBlankClick(payload) {
  const relationshipType = TOOL_TO_RELATIONSHIP_TYPE[solverState.ui.toolMode];
  if (payload?.didDrag || payload?.hole || relationshipType || solverState.ui.toolMode === "origin") return false;
  if (!solverState.selection.size) return false;
  solverState.selection = new Set();
  solverRenderer.render();
  return true;
}

function editRelationship(edge) {
  if (edge.type === "offset") return;
  const config = promptRelationshipConfig(edge);
  if (!config) return;
  if (!validateRelationshipAssignmentLimit({ ...edge, ...config }, edge.id)) return;
  updateRelationship(solverState, edge.id, config);
  resetTimingResults();
  fullSolverRefresh();
}

function selectedDiagramHoles() {
  return [...diagramState.selection].map((id) => diagramState.holesById.get(id)).filter(Boolean);
}

function diagramPropertyInputMap() {
  return {
    burden: els.diagramBurdenInput,
    spacing: els.diagramSpacingInput,
    diameter: els.diagramDiameterInput,
    angle: els.diagramAngleInput,
    bearing: els.diagramBearingInput,
    depth: els.diagramDepthInput,
    subdrill: els.diagramSubdrillInput,
    stemHeight: els.diagramStemHeightInput,
  };
}

function diagramHolePopupInputMap() {
  return {
    burden: els.diagramHolePopupBurdenInput,
    spacing: els.diagramHolePopupSpacingInput,
    diameter: els.diagramHolePopupDiameterInput,
    angle: els.diagramHolePopupAngleInput,
    bearing: els.diagramHolePopupBearingInput,
    depth: els.diagramHolePopupDepthInput,
    subdrill: els.diagramHolePopupSubdrillInput,
    stemHeight: els.diagramHolePopupStemHeightInput,
  };
}

function setDiagramPropertyInputsFromHole(inputs, hole) {
  Object.entries(inputs).forEach(([field, input]) => {
    const value = hole?.[field];
    input.value = Number.isFinite(value) ? String(value) : "";
  });
}

function collectDiagramPropertyPatchFromInputs(fieldToInput) {
  const patch = {};
  let invalidAngle = false;
  Object.entries(fieldToInput).forEach(([field, input]) => {
    const raw = input.value.trim();
    if (!raw) return;
    if (field === "angle") {
      const angle = parseEditableAngleValue(raw);
      if (angle === null) {
        invalidAngle = true;
        return;
      }
      patch[field] = angle;
      return;
    }
    const value = Number(raw);
    if (Number.isFinite(value)) patch[field] = value;
  });
  return { patch, invalidAngle };
}

function closeDiagramHolePopup() {
  if (els.diagramHolePopupBackdrop.classList.contains("hidden")) return;
  els.diagramHolePopupBackdrop.classList.add("hidden");
  els.diagramHolePopupBackdrop.setAttribute("aria-hidden", "true");
  diagramState.ui.holePopupHoleId = null;
}

function renderDiagramHolePopupCornerControls(hole) {
  const assignedIndex = diagramState.shotCorners.findIndex((cornerId) => cornerId === hole.id);
  els.diagramHolePopupCornerStatus.textContent = assignedIndex >= 0
    ? `This hole is assigned to ${shotCornerLabel(assignedIndex)}.`
    : "This hole is not assigned to a shot corner.";
  els.diagramHolePopupSetCornerBtns.forEach((button) => {
    const index = Number(button.getAttribute("data-hole-popup-corner-set"));
    button.classList.toggle("active", index === assignedIndex);
    const cornerHoleId = diagramState.shotCorners[index] || null;
    const cornerHole = cornerHoleId ? diagramState.holesById.get(cornerHoleId) : null;
    button.textContent = cornerHole
      ? `${shotCornerLabel(index)}: ${cornerHole.holeNumber || cornerHole.id}`
      : `Set ${shotCornerLabel(index)}`;
  });
  els.diagramHolePopupClearCornerBtn.disabled = assignedIndex < 0;
}

function openDiagramHolePopup(hole) {
  if (!hole) return;
  diagramState.ui.holePopupHoleId = hole.id;
  els.diagramHolePopupTitle.textContent = `Hole ${hole.holeNumber || hole.id}`;
  els.diagramHolePopupStatus.textContent = `Editing ${hole.holeNumber || hole.id}`;
  setDiagramPropertyInputsFromHole(diagramHolePopupInputMap(), hole);
  els.diagramHolePopupAngleInput.placeholder = "0, 5, 10, 15, 20, 25, or 30";
  renderDiagramHolePopupCornerControls(hole);
  els.diagramHolePopupBackdrop.classList.remove("hidden");
  els.diagramHolePopupBackdrop.setAttribute("aria-hidden", "false");
  els.diagramHolePopupBurdenInput.focus();
}

function applyDiagramHolePopupChanges() {
  const holeId = diagramState.ui.holePopupHoleId;
  const hole = diagramState.holesById.get(holeId);
  if (!hole) {
    closeDiagramHolePopup();
    return;
  }
  const result = collectDiagramPropertyPatchFromInputs(diagramHolePopupInputMap());
  if (result.invalidAngle) {
    window.alert("Angle must be 0 or one of: 5, 10, 15, 20, 25, 30.");
    return;
  }
  if (!Object.keys(result.patch).length) {
    window.alert("Enter at least one property value to apply.");
    return;
  }
  Object.assign(hole, result.patch);
  normalizeDiagramHoleFields(hole);
  closeDiagramHolePopup();
  fullDiagramRefresh();
}

function setShotCornerFromPopup(index) {
  const holeId = diagramState.ui.holePopupHoleId;
  const hole = holeId ? diagramState.holesById.get(holeId) : null;
  if (!hole) return;
  diagramState.shotCorners = diagramState.shotCorners.map((cornerId, cornerIndex) => {
    if (cornerIndex === index) return hole.id;
    return cornerId === hole.id ? null : cornerId;
  });
  fullDiagramRefresh();
  renderDiagramHolePopupCornerControls(hole);
}

function clearShotCornerFromPopup() {
  const holeId = diagramState.ui.holePopupHoleId;
  const hole = holeId ? diagramState.holesById.get(holeId) : null;
  if (!hole) return;
  diagramState.shotCorners = diagramState.shotCorners.map((cornerId) => (cornerId === hole.id ? null : cornerId));
  fullDiagramRefresh();
  renderDiagramHolePopupCornerControls(hole);
}

function setDiagramToolMode(mode) {
  const nextMode = normalizeAnnotationTool(mode);
  if (!["box", "polygon"].includes(nextMode) && diagramState.ui.pendingDeckingApplyMode) {
    diagramState.ui.pendingDeckingApplyMode = null;
    renderDiagramLoadingPanel();
  }
  diagramState.ui.activeTool = nextMode;
  diagramState.ui.selectionBoxDraft = null;
  diagramState.ui.selectionPolygonDraft = null;
  if (nextMode !== "markup") diagramState.ui.currentStrokeDraft = null;
  if (nextMode !== "text") {
    diagramState.ui.selectedTextId = null;
    diagramState.ui.dragTextId = null;
    diagramState.ui.dragTextPointerDelta = null;
  }
  els.diagramSingleSelectToolBtn.classList.toggle("active", nextMode === "single");
  els.diagramBoxSelectToolBtn.classList.toggle("active", nextMode === "box");
  els.diagramPolygonSelectToolBtn.classList.toggle("active", nextMode === "polygon");
  els.diagramMarkupToolBtn.classList.toggle("active", nextMode === "markup");
  els.diagramTextToolBtn.classList.toggle("active", nextMode === "text");
  diagramRenderer.render();
}

function diagramScreenPoint(hole) {
  return diagramRenderer.worldToScreen(hole.x, hole.y);
}

function pointInRect(point, rect) {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function applyDiagramSelection(holeIds, { add = false } = {}) {
  if (!add) {
    diagramState.selection = new Set(holeIds);
  } else {
    const next = new Set(diagramState.selection);
    holeIds.forEach((id) => next.add(id));
    diagramState.selection = next;
  }
  renderDiagramPropertiesPanel();
  diagramRenderer.render();
}

function finalizeDiagramBoxSelection(draft) {
  if (!draft) return;
  const rect = {
    left: Math.min(draft.start.x, draft.current.x),
    right: Math.max(draft.start.x, draft.current.x),
    top: Math.min(draft.start.y, draft.current.y),
    bottom: Math.max(draft.start.y, draft.current.y),
  };
  const holeIds = diagramState.holes
    .filter((hole) => pointInRect(diagramScreenPoint(hole), rect))
    .map((hole) => hole.id);
  if (diagramState.ui.pendingDeckingApplyMode === "box") {
    applyDeckingToHoleIds(holeIds);
    setDiagramToolMode("single");
    return;
  }
  applyDiagramSelection(holeIds, { add: draft.addMode });
}

function finalizeDiagramPolygonSelection() {
  const draft = diagramState.ui.selectionPolygonDraft;
  if (!draft?.points?.length || draft.points.length < 3) return;
  const holeIds = diagramState.holes
    .filter((hole) => pointInPolygon({ x: hole.x, y: hole.y }, draft.points))
    .map((hole) => hole.id);
  if (diagramState.ui.pendingFaceDesignation) {
    const faceIdSet = new Set(holeIds);
    diagramState.holes.forEach((hole) => {
      hole.isFaceHole = faceIdSet.has(hole.id);
    });
    diagramState.ui.pendingFaceDesignation = false;
    applyDiagramSelection(holeIds, { add: false });
    setDiagramToolMode(diagramState.ui.faceDesignationReturnTool || "single");
    renderDiagramShotPanel();
  } else if (diagramState.ui.pendingDeckingApplyMode === "polygon") {
    applyDeckingToHoleIds(holeIds);
    setDiagramToolMode("single");
  } else {
    applyDiagramSelection(holeIds, { add: draft.addMode });
  }
  diagramState.ui.selectionPolygonDraft = null;
  diagramRenderer.render();
}

function handleDiagramPointerDown(payload) {
  const mode = diagramState.ui.pendingFaceDesignation ? "polygon" : diagramState.ui.activeTool;
  if (mode === "box") {
    diagramState.ui.selectionBoxDraft = {
      start: { x: payload.x, y: payload.y },
      current: { x: payload.x, y: payload.y },
      addMode: payload.event.shiftKey,
    };
    diagramRenderer.render();
    return true;
  }
  if (mode === "polygon") {
    const worldPoint = pointToWorld(diagramRenderer, payload);
    const existing = diagramState.ui.selectionPolygonDraft;
    if (!existing) {
      diagramState.ui.selectionPolygonDraft = {
        points: [{ x: worldPoint.x, y: worldPoint.y }],
        hoverPoint: { x: worldPoint.x, y: worldPoint.y },
        addMode: payload.event.shiftKey,
      };
    } else {
      existing.points.push({ x: worldPoint.x, y: worldPoint.y });
      existing.hoverPoint = { x: worldPoint.x, y: worldPoint.y };
    }
    diagramRenderer.render();
    return true;
  }
  if (mode === "markup") {
    const worldPoint = pointToWorld(diagramRenderer, payload);
    diagramState.ui.currentStrokeDraft = {
      color: diagramState.ui.annotationColor,
      size: diagramState.ui.annotationSize,
      points: [worldPoint],
    };
    diagramRenderer.render();
    return true;
  }
  if (mode === "text") {
    const hit = diagramRenderer.findDiagramTextAtScreen(payload.x, payload.y);
    if (hit?.item) {
      const worldPoint = pointToWorld(diagramRenderer, payload);
      diagramState.ui.selectedTextId = hit.item.id;
      diagramState.ui.dragTextId = hit.item.id;
      diagramState.ui.dragTextPointerDelta = {
        x: worldPoint.x - hit.item.anchor.x,
        y: worldPoint.y - hit.item.anchor.y,
      };
      diagramRenderer.render();
      return true;
    }
    const text = window.prompt("Enter text for the diagram.");
    if (text === null || !text.trim()) {
      diagramRenderer.render();
      return true;
    }
    const id = generateDiagramTextId();
    diagramState.annotations.texts.push({
      id,
      text: text.trim(),
      color: diagramState.ui.annotationColor,
      size: diagramState.ui.annotationSize,
      anchor: pointToWorld(diagramRenderer, payload),
    });
    diagramState.ui.selectedTextId = id;
    fullDiagramRefresh();
    return true;
  }
  return false;
}

function handleDiagramPointerMove(payload) {
  if (diagramState.ui.activeTool === "box" && diagramState.ui.selectionBoxDraft) {
    diagramState.ui.selectionBoxDraft.current = { x: payload.x, y: payload.y };
    diagramRenderer.render();
    return true;
  }
  if (diagramState.ui.pendingFaceDesignation || diagramState.ui.activeTool === "polygon") {
    if (diagramState.ui.selectionPolygonDraft) {
      const worldPoint = pointToWorld(diagramRenderer, payload);
      diagramState.ui.selectionPolygonDraft.hoverPoint = { x: worldPoint.x, y: worldPoint.y };
      diagramRenderer.render();
    }
    return true;
  }
  if (diagramState.ui.activeTool === "markup" && diagramState.ui.currentStrokeDraft) {
    diagramState.ui.currentStrokeDraft.points.push(pointToWorld(diagramRenderer, payload));
    diagramRenderer.render();
    return true;
  }
  if (diagramState.ui.activeTool === "text" && diagramState.ui.dragTextId) {
    const item = diagramState.annotations.texts.find((text) => text.id === diagramState.ui.dragTextId);
    if (!item) return true;
    const worldPoint = pointToWorld(diagramRenderer, payload);
    item.anchor = {
      x: worldPoint.x - (diagramState.ui.dragTextPointerDelta?.x || 0),
      y: worldPoint.y - (diagramState.ui.dragTextPointerDelta?.y || 0),
    };
    diagramRenderer.render();
    return true;
  }
  return false;
}

function handleDiagramPointerUp(payload) {
  if (diagramState.ui.activeTool === "box" && diagramState.ui.selectionBoxDraft) {
    const draft = diagramState.ui.selectionBoxDraft;
    diagramState.ui.selectionBoxDraft = null;
    finalizeDiagramBoxSelection(draft);
    return true;
  }
  if (diagramState.ui.activeTool === "markup" && diagramState.ui.currentStrokeDraft) {
    const draft = diagramState.ui.currentStrokeDraft;
    diagramState.ui.currentStrokeDraft = null;
    if (draft.points.length > 1) diagramState.annotations.strokes.push(draft);
    diagramRenderer.render();
    return true;
  }
  if (diagramState.ui.activeTool === "text" && diagramState.ui.dragTextId) {
    diagramState.ui.dragTextId = null;
    diagramState.ui.dragTextPointerDelta = null;
    fullDiagramRefresh();
    return true;
  }
  if (diagramState.ui.activeTool === "single" && !payload?.didDrag && !payload?.hole && diagramState.selection.size) {
    diagramState.selection = new Set();
    fullDiagramRefresh();
    return true;
  }
  return false;
}

function handleDiagramCanvasContextMenu() {
  if ((diagramState.ui.pendingFaceDesignation || diagramState.ui.activeTool === "polygon") && diagramState.ui.selectionPolygonDraft?.points?.length >= 3) {
    finalizeDiagramPolygonSelection();
    return true;
  }
  return false;
}

function handleDiagramHoleContextMenu(hole) {
  if ((diagramState.ui.pendingFaceDesignation || diagramState.ui.activeTool === "polygon") && diagramState.ui.selectionPolygonDraft?.points?.length >= 3) {
    finalizeDiagramPolygonSelection();
    return true;
  }
  if (diagramState.ui.currentStrokeDraft) return true;
  closeAllMenus();
  openDiagramHolePopup(hole);
  return true;
}

function renderDiagramPropertiesPanel() {
  const selected = selectedDiagramHoles();
  const fieldToInput = diagramPropertyInputMap();
  const inputs = Object.values(fieldToInput);
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
    renderSingleHoleLoadingEditor(null);
    syncDiagramDefaultDiameterStatus();
    return;
  }

  els.diagramSelectionStatus.textContent = selected.length === 1
    ? `Selection: ${selected[0].holeNumber || selected[0].id}`
    : `Selection: ${selected.length} holes selected`;
  els.diagramSelectionList.innerHTML = selected.slice(0, 8).map((hole) => `<div>${escapeHtml(hole.holeNumber || hole.id)}</div>`).join("")
    + (selected.length > 8 ? `<div>+${selected.length - 8} more</div>` : "");

  Object.entries(fieldToInput).forEach(([field, input]) => {
    const firstValue = selected[0][field];
    const allSame = selected.every((hole) => hole[field] === firstValue);
    input.value = allSame && firstValue !== null ? String(firstValue) : "";
    input.placeholder = !allSame && selected.length > 1 ? "Mixed values" : "";
    input.disabled = false;
  });
  els.diagramAngleInput.placeholder = selected.length > 1 && !selected.every((hole) => hole.angle === selected[0].angle) ? "Mixed values (0,5,10,15,20,25,30)" : "0, 5, 10, 15, 20, 25, or 30";

  els.diagramApplyPropertiesBtn.disabled = false;
  els.diagramClearSelectionBtn.disabled = false;
  els.diagramApplyDefaultDiameterBtn.disabled = !diagramState.holes.length;
  renderSingleHoleLoadingEditor(selected.length === 1 ? selected[0] : null);
  syncDiagramDefaultDiameterStatus();
}

function fullDiagramRefresh({ fit = false } = {}) {
  refreshDiagramLoadingDerivedState();
  persistDiagramStateToProject();
  renderDiagramShotPanel();
  renderDiagramLoadingPanel();
  renderDiagramVolumePanel();
  renderDiagramPropertiesPanel();
  renderPlannerStatusIndicator();
  refreshPlannerCardSummaries();
  diagramRenderer.render();
  if (fit) diagramRenderer.fitToData();
}

function handleDiagramHoleClick(hole, event) {
  if (diagramState.ui.activeTool !== "single") return;
  if (!event.shiftKey) diagramState.selection = new Set([hole.id]);
  else if (diagramState.selection.has(hole.id)) diagramState.selection.delete(hole.id);
  else diagramState.selection.add(hole.id);
  fullDiagramRefresh();
}

function applyDiagramImportedHoles(holes) {
  const defaultDiameter = diagramState.metadata.defaultDiameter;
  holes.forEach((hole) => {
    normalizeHoleCoordinateSets(hole);
    normalizeDiagramHoleFields(hole);
    if (Number.isFinite(defaultDiameter) && hole.diameter === null) hole.diameter = defaultDiameter;
  });
  diagramState.holes = holes;
  diagramState.selection = new Set();
  diagramState.ui.coordView = "collar";
  diagramState.ui.pendingFaceDesignation = false;
  diagramState.ui.faceDesignationReturnTool = "single";
  diagramState.shotCorners = [null, null, null, null];
  rebuildHolesById(diagramState);
  applyCoordinateView(diagramState, els.diagramCoordViewSelect, diagramRenderer, "collar");
  fullDiagramRefresh({ fit: true });
}

function collectDiagramPropertyPatch() {
  return collectDiagramPropertyPatchFromInputs(diagramPropertyInputMap());
}

function applyDiagramPropertyPatchToSelection(result) {
  const { patch, invalidAngle } = result;
  if (invalidAngle) {
    window.alert("Angle must be 0 or one of: 5, 10, 15, 20, 25, 30.");
    return;
  }
  const selected = selectedDiagramHoles();
  if (!selected.length) {
    window.alert("Select one or more holes first.");
    return;
  }
  if (!Object.keys(patch).length) {
    window.alert("Enter at least one property value to apply.");
    return;
  }
  selected.forEach((hole) => {
    Object.assign(hole, patch);
    normalizeDiagramHoleFields(hole);
  });
  fullDiagramRefresh();
}

function applyPatternAssignment() {
  if (!diagramState.holes.length) {
    window.alert("Import holes first.");
    return;
  }
  const faceBurden = diagramState.metadata.faceBurden;
  const faceSpacing = diagramState.metadata.faceSpacing;
  const interiorBurden = diagramState.metadata.interiorBurden;
  const interiorSpacing = diagramState.metadata.interiorSpacing;
  if (![faceBurden, faceSpacing, interiorBurden, interiorSpacing].every((value) => Number.isFinite(value))) {
    window.alert("Enter all face and interior burden/spacing values in the Pattern menu first.");
    return;
  }
  if (!diagramState.holes.some((hole) => hole.isFaceHole === true)) {
    window.alert("Assign face holes first.");
    return;
  }
  const patternSubdrill = diagramState.metadata.patternSubdrill;
  diagramState.holes.forEach((hole) => {
    if (hole.isFaceHole === true) {
      hole.burden = faceBurden;
      hole.spacing = faceSpacing;
    } else {
      hole.burden = interiorBurden;
      hole.spacing = interiorSpacing;
    }
    if (Number.isFinite(patternSubdrill)) hole.subdrill = patternSubdrill;
  });
  fullDiagramRefresh();
}

function startFaceDesignation() {
  if (!diagramState.holes.length) {
    window.alert("Import holes first.");
    return;
  }
  diagramState.ui.pendingFaceDesignation = true;
  diagramState.ui.faceDesignationReturnTool = diagramState.ui.activeTool || "single";
  openMenu("diagramPatternMenu");
  setDiagramToolMode("single");
  renderDiagramShotPanel();
}

function clearFaceDesignation() {
  diagramState.holes.forEach((hole) => {
    hole.isFaceHole = false;
  });
  diagramState.ui.pendingFaceDesignation = false;
  diagramState.ui.selectionPolygonDraft = null;
  renderDiagramShotPanel();
  fullDiagramRefresh();
}

function applyDefaultDiameterToDiagramSelection() {
  const defaultDiameter = diagramState.metadata.defaultDiameter;
  if (!Number.isFinite(defaultDiameter)) {
    window.alert("Select a default hole diameter in the Shot menu first.");
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
  fullDiagramRefresh();
}

function applyDiagramMetadataPatch(field, value) {
  if (!Object.hasOwn(diagramState.metadata, field)) return;
  if (field === "defaultDiameter") {
    const normalizedValue = value !== null && Number.isFinite(Number(value)) ? Number(value) : null;
    if (Number.isFinite(normalizedValue)) applyShotDefaultDiameterToExistingHoles(normalizedValue);
    diagramState.metadata[field] = normalizedValue;
    syncDiagramDefaultDiameterStatus();
  } else if (field === "loadingDensityGcc") {
    diagramState.metadata[field] = normalizeLoadingDensity(value);
  } else if (field === "rockDensityTonsPerCubicYard") {
    diagramState.metadata[field] = Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 2.3;
  } else {
    diagramState.metadata[field] = value;
  }
  if (field === "location") {
    applyProjectGeoFromLocation(diagramState.metadata.location);
  }
  syncDiagramDefaultDiameterStatus();
  renderDiagramShotPanel();
  renderDiagramLoadingPanel();
  renderDiagramVolumePanel();
  renderDiagramPropertiesPanel();
  diagramRenderer.render();
  persistDiagramStateToProject();
}

function deriveLocalizedHoleCoordinates(holes) {
  const statePlanePoints = [];
  holes.forEach((hole) => {
    const collarPoint = hole.collar?.coordinates?.statePlane || hole.coordinates?.statePlane || null;
    const toePoint = hole.toe?.coordinates?.statePlane || null;
    if (Number.isFinite(collarPoint?.x) && Number.isFinite(collarPoint?.y)) statePlanePoints.push(collarPoint);
    if (Number.isFinite(toePoint?.x) && Number.isFinite(toePoint?.y)) statePlanePoints.push(toePoint);
  });
  if (!statePlanePoints.length) return holes;
  const minX = Math.min(...statePlanePoints.map((point) => point.x));
  const minY = Math.min(...statePlanePoints.map((point) => point.y));
  holes.forEach((hole) => {
    [hole.collar, hole.toe].forEach((point) => {
      if (!point?.coordinates?.statePlane) return;
      point.coordinates.local = {
        x: point.coordinates.statePlane.x - minX,
        y: point.coordinates.statePlane.y - minY,
      };
      point.x = point.coordinates.local.x;
      point.y = point.coordinates.local.y;
    });
    if (hole.collar?.coordinates) hole.coordinates = cloneCoordinateBundle(hole.collar.coordinates);
    hole.x = hole.collar?.x ?? hole.x;
    hole.y = hole.collar?.y ?? hole.y;
  });
  return holes;
}

function reprojectPointForGeo(point, geo) {
  if (!point?.coordinates?.latLon) return point;
  const statePlane = latLonToStatePlane(point.coordinates.latLon, geo);
  if (!statePlane) return point;
  point.coordinates.statePlane = {
    x: statePlane.x,
    y: statePlane.y,
    unit: geo.statePlaneUnit,
    epsg: geo.statePlaneEpsg,
  };
  return point;
}

function refreshPointLatLonFromStatePlane(point, geo) {
  if (!point?.coordinates?.statePlane) return point;
  const latLon = statePlaneToLatLon(point.coordinates.statePlane, geo);
  if (!latLon) return point;
  point.coordinates.latLon = {
    lat: latLon.lat,
    lon: latLon.lon,
  };
  return point;
}

function refreshHoleDerivedCoordinatesForGeo(hole, geo) {
  refreshPointLatLonFromStatePlane(hole.collar, geo);
  refreshPointLatLonFromStatePlane(hole.toe, geo);
  if (hole.collar?.coordinates) hole.coordinates = cloneCoordinateBundle(hole.collar.coordinates);
}

function reprojectDiagramHolesForGeo(geo) {
  if (!geo?.statePlaneEpsg) return;
  diagramState.holes.forEach((hole) => {
    reprojectPointForGeo(hole.collar, geo);
    reprojectPointForGeo(hole.toe, geo);
    refreshHoleDerivedCoordinatesForGeo(hole, geo);
  });
  deriveLocalizedHoleCoordinates(diagramState.holes);
  applyCoordinateView(diagramState, els.diagramCoordViewSelect, diagramRenderer, diagramState.ui.coordView, { fit: false });
  refreshProjectHoles(diagramState.holes);
  hydrateSolverFromProject();
}

function buildToeMap(records, coordType, xColumn, yColumn, idColumn, geoContext) {
  if (!xColumn || !yColumn) return new Map();
  const toeHoles = buildHolesFromMapping({ records, coordType, xColumn, yColumn, idColumn, geoContext });
  return new Map(toeHoles.map((hole) => [hole.sourceIndex, {
    original: hole.original,
    coordinates: {
      local: null,
      statePlane: cloneCoordinateValue(hole.statePlane),
      latLon: cloneCoordinateValue(hole.latLon),
    },
  }]));
}

els.csvInput.addEventListener("change", async () => {
  const file = els.csvInput.files[0];
  if (!file) return;
  const parsed = parseCsvText(await file.text());
  solverState.csvCache = parsed;
  setSolverColumnOptions(parsed.headers);
  syncImportPanelUi("solver");
  openMappingOverlay("solver");
});

els.importMappedBtn.addEventListener("click", () => {
  if (!solverState.csvCache) return;
  const geoContext = requireProjectGeoForImport();
  if (!geoContext) return;
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
    geoContext,
    fieldColumns: {
      angle: els.solverAngleColumnSelect.value || null,
      bearing: els.solverBearingColumnSelect.value || null,
      depth: els.solverDepthColumnSelect.value || null,
    },
  });
  if (!holes.length) {
    window.alert("No valid collar coordinates found for selected columns and quarry EPSG.");
    return;
  }
  const toeBySource = buildToeMap(records, els.coordTypeSelect.value, toeXColumn, toeYColumn, idColumn, geoContext);
  holes.forEach((hole) => {
    hole.collar = {
      x: hole.x,
      y: hole.y,
      original: hole.original,
      coordinates: {
        local: null,
        statePlane: cloneCoordinateValue(hole.statePlane),
        latLon: cloneCoordinateValue(hole.latLon),
      },
    };
    hole.toe = toeBySource.get(hole.sourceIndex) || null;
    hole.coordinates = cloneCoordinateBundle(hole.collar.coordinates);
    normalizeDiagramHoleFields(hole, { roundBearingAndDepth: true });
  });
  deriveLocalizedHoleCoordinates(holes);
  uniqueHoleIds(holes, records, idColumn);
  initializeProjectFromHoles(holes, solverState.csvCache);
  applyImportedHoles(holes);
  closeMappingOverlay();
  hydrateDiagramFromProject();
  fullSolverRefresh({ fit: true });
});

els.diagramCsvInput.addEventListener("change", async () => {
  const file = els.diagramCsvInput.files[0];
  if (!file) return;
  const parsed = parseCsvText(await file.text());
  diagramState.csvCache = parsed;
  setDiagramColumnOptions(parsed.headers);
  syncImportPanelUi("diagram");
  openMappingOverlay("diagram");
});

els.diagramImportMappedBtn.addEventListener("click", () => {
  if (!diagramState.csvCache) return;
  const geoContext = requireProjectGeoForImport();
  if (!geoContext) return;
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
    geoContext,
    fieldColumns: {
      angle: els.diagramAngleColumnSelect.value || null,
      bearing: els.diagramBearingColumnSelect.value || null,
      depth: els.diagramDepthColumnSelect.value || null,
    },
  });
  if (!holes.length) {
    window.alert("No valid collar coordinates found for selected columns and quarry EPSG.");
    return;
  }
  const toeBySource = buildToeMap(records, els.diagramCoordTypeSelect.value, toeXColumn, toeYColumn, idColumn, geoContext);
  holes.forEach((hole) => {
    hole.collar = {
      x: hole.x,
      y: hole.y,
      original: hole.original,
      coordinates: {
        local: null,
        statePlane: cloneCoordinateValue(hole.statePlane),
        latLon: cloneCoordinateValue(hole.latLon),
      },
    };
    hole.toe = toeBySource.get(hole.sourceIndex) || null;
    hole.coordinates = cloneCoordinateBundle(hole.collar.coordinates);
    normalizeDiagramHoleFields(hole, { roundBearingAndDepth: true });
  });
  deriveLocalizedHoleCoordinates(holes);
  uniqueHoleIds(holes, records, idColumn);
  initializeProjectFromHoles(holes, diagramState.csvCache);
  applyDiagramImportedHoles(holes);
  closeMappingOverlay();
  hydrateSolverFromProject();
});

els.diagramShotNumberInput.addEventListener("input", () => applyDiagramMetadataPatch("shotNumber", els.diagramShotNumberInput.value.trim()));
els.diagramShotLocationSelect.addEventListener("change", () => {
  const location = els.diagramShotLocationSelect.value;
  const previousGeo = activeProjectGeo();
  applyDiagramMetadataPatch("location", location);
  applyQuarryDensityDefault(location);
  applyProjectGeoFromLocation(location);
  if (
    diagramState.holes.length
    && previousGeo.statePlaneEpsg
    && previousGeo.statePlaneEpsg !== projectState.geo.statePlaneEpsg
  ) {
    reprojectDiagramHolesForGeo(projectState.geo);
  }
  renderDiagramShotPanel();
  renderDiagramVolumePanel();
  renderDiagramPropertiesPanel();
  diagramRenderer.render();
  persistDiagramStateToProject();
});
els.diagramBenchInput.addEventListener("input", () => applyDiagramMetadataPatch("bench", els.diagramBenchInput.value.trim()));
els.diagramShotDefaultDiameterSelect.addEventListener("change", () => applyDiagramMetadataPatch("defaultDiameter", selectedDiagramDefaultDiameter()));
els.diagramPatternSubdrillInput.addEventListener("change", () => applyDiagramMetadataPatch("patternSubdrill", selectedDiagramMetadataNumber(els.diagramPatternSubdrillInput)));
els.diagramFaceBurdenInput.addEventListener("change", () => applyDiagramMetadataPatch("faceBurden", selectedDiagramMetadataNumber(els.diagramFaceBurdenInput)));
els.diagramFaceSpacingInput.addEventListener("change", () => applyDiagramMetadataPatch("faceSpacing", selectedDiagramMetadataNumber(els.diagramFaceSpacingInput)));
els.diagramInteriorBurdenInput.addEventListener("change", () => applyDiagramMetadataPatch("interiorBurden", selectedDiagramMetadataNumber(els.diagramInteriorBurdenInput)));
els.diagramInteriorSpacingInput.addEventListener("change", () => applyDiagramMetadataPatch("interiorSpacing", selectedDiagramMetadataNumber(els.diagramInteriorSpacingInput)));
els.diagramRockDensityInput.addEventListener("change", () => applyDiagramMetadataPatch("rockDensityTonsPerCubicYard", selectedDiagramRockDensity()));
els.diagramAssignFaceBtn.addEventListener("click", () => startFaceDesignation());
els.diagramClearFaceBtn.addEventListener("click", () => clearFaceDesignation());
els.diagramApplyPatternBtn.addEventListener("click", () => applyPatternAssignment());

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
els.diagramBearingLabelToggle.addEventListener("change", () => {
  diagramState.ui.showBearingLabels = els.diagramBearingLabelToggle.checked;
  diagramRenderer.render();
});
els.diagramBearingArrowToggle.addEventListener("change", () => {
  diagramState.ui.showBearingArrows = els.diagramBearingArrowToggle.checked;
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
els.diagramSingleSelectToolBtn.addEventListener("click", () => setDiagramToolMode("single"));
els.diagramBoxSelectToolBtn.addEventListener("click", () => setDiagramToolMode("box"));
els.diagramPolygonSelectToolBtn.addEventListener("click", () => setDiagramToolMode("polygon"));
els.diagramMarkupToolBtn.addEventListener("click", () => setDiagramToolMode("markup"));
els.diagramTextToolBtn.addEventListener("click", () => setDiagramToolMode("text"));
els.diagramAnnotationColorInput.addEventListener("input", () => {
  diagramState.ui.annotationColor = els.diagramAnnotationColorInput.value || "#000000";
  diagramRenderer.render();
});
els.diagramAnnotationSizeSelect.addEventListener("change", () => {
  diagramState.ui.annotationSize = els.diagramAnnotationSizeSelect.value || "medium";
  diagramRenderer.render();
});
els.diagramClearMarkupBtn.addEventListener("click", () => {
  diagramState.annotations.strokes = [];
  diagramState.ui.currentStrokeDraft = null;
  diagramRenderer.render();
});
els.diagramClearTextBtn.addEventListener("click", () => {
  diagramState.annotations.texts = [];
  diagramState.ui.selectedTextId = null;
  diagramState.ui.dragTextId = null;
  diagramState.ui.dragTextPointerDelta = null;
  fullDiagramRefresh();
});
els.diagramLoadingDensityInput.addEventListener("input", () => applyDiagramMetadataPatch("loadingDensityGcc", els.diagramLoadingDensityInput.value));
els.diagramDeckPresetSelect.addEventListener("change", () => {
  ensureDeckingDraftForPreset({ reset: true });
  renderDiagramLoadingPanel();
});
els.diagramDeckingDraftEditor.addEventListener("input", (event) => {
  const target = event.target.closest("[data-decking-draft-index]");
  if (!target) return;
  const draft = ensureDeckingDraftForPreset();
  const intervals = stemIntervalsFromDecks(draft.decks || []);
  const interval = intervals[Number(target.getAttribute("data-decking-draft-index"))];
  if (!interval) return;
  const field = target.getAttribute("data-decking-draft-field");
  interval[field] = Math.max(0, Math.round(Number(target.value) || 0));
  const referenceHole = referenceHoleForDeckingDraft();
  const built = buildDecksFromStemIntervals({
    topStemming: Math.max(0, Math.round(Number(referenceHole?.stemHeight) || 0)),
    intervals,
    deckCount: selectedDeckPresetCount(),
    existingDecks: draft.decks || [],
    holeDepth: Math.max(0, Math.round(Number(referenceHole?.depth) || 0)),
  });
  if (built.valid) {
    draft.decks = built.decks;
    draft.stemIntervals = intervals.map((item) => ({ ...item }));
  }
  syncDeckingDraftStatus();
});
els.diagramDeckingDraftEditor.addEventListener("change", (event) => {
  const target = event.target.closest("[data-decking-draft-index]");
  if (!target) return;
  const draft = ensureDeckingDraftForPreset();
  const intervals = stemIntervalsFromDecks(draft.decks || []);
  const interval = intervals[Number(target.getAttribute("data-decking-draft-index"))];
  if (!interval) return;
  const field = target.getAttribute("data-decking-draft-field");
  interval[field] = Math.max(0, Math.round(Number(target.value) || 0));
  const referenceHole = referenceHoleForDeckingDraft();
  const built = buildDecksFromStemIntervals({
    topStemming: Math.max(0, Math.round(Number(referenceHole?.stemHeight) || 0)),
    intervals,
    deckCount: selectedDeckPresetCount(),
    existingDecks: draft.decks || [],
    holeDepth: Math.max(0, Math.round(Number(referenceHole?.depth) || 0)),
  });
  if (!built.valid) {
    window.alert(built.reason || "Invalid deck stem interval.");
    renderDiagramLoadingPanel();
    return;
  }
  draft.decks = built.decks;
  draft.stemIntervals = intervals.map((item) => ({ ...item }));
  renderDiagramLoadingPanel();
});
els.diagramLoadingAddDetonatorBtn.addEventListener("click", () => addDraftMaterialEntry("detonator"));
els.diagramLoadingAddBoosterBtn.addEventListener("click", () => addDraftMaterialEntry("booster"));
els.diagramLoadingApplyBtn.addEventListener("click", () => applyLoadingDraftToSelection());
els.diagramApplyDeckingToSelectionBtn.addEventListener("click", () => {
  const selected = selectedDiagramHoles();
  if (!selected.length) {
    window.alert("Select one or more holes before applying decking.");
    return;
  }
  applyDeckingPresetToTargets(selected);
});
els.diagramApplyDeckingToBoxBtn.addEventListener("click", () => {
  diagramState.ui.pendingDeckingApplyMode = "box";
  setDiagramToolMode("box");
  renderDiagramLoadingPanel();
});
els.diagramApplyDeckingToPolygonBtn.addEventListener("click", () => {
  diagramState.ui.pendingDeckingApplyMode = "polygon";
  setDiagramToolMode("polygon");
  renderDiagramLoadingPanel();
});
els.diagramClearDeckingBtn.addEventListener("click", () => {
  const selected = selectedDiagramHoles();
  const targets = selected.length ? selected : diagramState.holes;
  if (!targets.length) {
    window.alert("Import holes first.");
    return;
  }
  clearDeckingForTargets(targets);
});
els.diagramLoadingDetonatorEditor.addEventListener("change", (event) => {
  const target = event.target.closest("[data-loading-scope='draft-detonator']");
  if (!target) return;
  updateDraftMaterialEntry("detonator", Number(target.getAttribute("data-loading-index")), target.getAttribute("data-loading-field"), target.value);
});
els.diagramLoadingDetonatorEditor.addEventListener("click", (event) => {
  const button = event.target.closest("[data-loading-scope='draft-detonator']");
  if (!button) return;
  if (button.hasAttribute("data-loading-remove")) {
    removeDraftMaterialEntry("detonator", Number(button.getAttribute("data-loading-remove")));
    return;
  }
  if (button.hasAttribute("data-loading-step")) stepDraftMaterialEntry("detonator", Number(button.getAttribute("data-loading-index")), Number(button.getAttribute("data-loading-step")) || 0);
});
els.diagramLoadingBoosterEditor.addEventListener("change", (event) => {
  const target = event.target.closest("[data-loading-scope='draft-booster']");
  if (!target) return;
  updateDraftMaterialEntry("booster", Number(target.getAttribute("data-loading-index")), target.getAttribute("data-loading-field"), target.value);
});
els.diagramLoadingBoosterEditor.addEventListener("click", (event) => {
  const button = event.target.closest("[data-loading-scope='draft-booster']");
  if (!button) return;
  if (button.hasAttribute("data-loading-remove")) {
    removeDraftMaterialEntry("booster", Number(button.getAttribute("data-loading-remove")));
    return;
  }
  if (button.hasAttribute("data-loading-step")) stepDraftMaterialEntry("booster", Number(button.getAttribute("data-loading-index")), Number(button.getAttribute("data-loading-step")) || 0);
});
els.diagramApplyPropertiesBtn.addEventListener("click", () => applyDiagramPropertyPatchToSelection(collectDiagramPropertyPatch()));
els.diagramHolePopupSaveBtn.addEventListener("click", () => applyDiagramHolePopupChanges());
els.diagramHolePopupCancelBtn.addEventListener("click", () => closeDiagramHolePopup());
els.diagramHolePopupSetCornerBtns.forEach((button) => {
  button.addEventListener("click", () => {
    const index = Number(button.getAttribute("data-hole-popup-corner-set"));
    if (Number.isInteger(index) && index >= 0 && index < 4) setShotCornerFromPopup(index);
  });
});
els.diagramHolePopupClearCornerBtn.addEventListener("click", () => clearShotCornerFromPopup());
els.diagramApplyDefaultDiameterBtn.addEventListener("click", () => applyDefaultDiameterToDiagramSelection());
els.diagramClearSelectionBtn.addEventListener("click", () => {
  diagramState.selection = new Set();
  renderDiagramPropertiesPanel();
  diagramRenderer.render();
});
els.diagramHoleLoadingDepthInput.addEventListener("input", () => updateSelectedHoleLoadingNumericField("depth", els.diagramHoleLoadingDepthInput.value));
els.diagramHoleLoadingStemHeightInput.addEventListener("input", () => updateSelectedHoleLoadingNumericField("stemHeight", els.diagramHoleLoadingStemHeightInput.value));
els.diagramHoleLoadingAddDetonatorBtn.addEventListener("click", () => addHoleMaterialEntry("detonator"));
els.diagramHoleLoadingAddBoosterBtn.addEventListener("click", () => addHoleMaterialEntry("booster"));
els.diagramHoleLoadingDetonatorEditor.addEventListener("change", (event) => {
  const target = event.target.closest("[data-loading-scope='hole-detonator']");
  if (!target) return;
  updateHoleMaterialEntry("detonator", Number(target.getAttribute("data-loading-index")), target.getAttribute("data-loading-field"), target.value);
});
els.diagramHoleLoadingDetonatorEditor.addEventListener("click", (event) => {
  const button = event.target.closest("[data-loading-scope='hole-detonator']");
  if (!button) return;
  if (button.hasAttribute("data-loading-remove")) {
    removeHoleMaterialEntry("detonator", Number(button.getAttribute("data-loading-remove")));
    return;
  }
  if (button.hasAttribute("data-loading-step")) stepHoleMaterialEntry("detonator", Number(button.getAttribute("data-loading-index")), Number(button.getAttribute("data-loading-step")) || 0);
});
els.diagramHoleLoadingBoosterEditor.addEventListener("change", (event) => {
  const target = event.target.closest("[data-loading-scope='hole-booster']");
  if (!target) return;
  updateHoleMaterialEntry("booster", Number(target.getAttribute("data-loading-index")), target.getAttribute("data-loading-field"), target.value);
});
els.diagramHoleLoadingBoosterEditor.addEventListener("click", (event) => {
  const button = event.target.closest("[data-loading-scope='hole-booster']");
  if (!button) return;
  if (button.hasAttribute("data-loading-remove")) {
    removeHoleMaterialEntry("booster", Number(button.getAttribute("data-loading-remove")));
    return;
  }
  if (button.hasAttribute("data-loading-step")) stepHoleMaterialEntry("booster", Number(button.getAttribute("data-loading-index")), Number(button.getAttribute("data-loading-step")) || 0);
});
els.diagramDeckingEnabledInput.addEventListener("change", () => {
  const hole = selectedDiagramHoles()[0];
  if (!hole) return;
  if (els.diagramDeckingEnabledInput.checked) {
    const result = applyDeckPresetToHole(hole, Number(els.diagramDeckCountSelect.value) >= 3 ? "three-equal" : Number(els.diagramDeckCountSelect.value) === 2 ? "two-equal" : "single");
    if (!result?.valid) {
      els.diagramDeckingEnabledInput.checked = false;
      window.alert(result?.reason || "Could not enable decking.");
      return;
    }
  } else {
    clearDeckingForHole(hole);
  }
  fullDiagramRefresh();
});
els.diagramDeckCountSelect.addEventListener("change", () => {
  const hole = selectedDiagramHoles()[0];
  if (!hole) return;
  const result = applyDeckPresetToHole(hole, Number(els.diagramDeckCountSelect.value) >= 3 ? "three-equal" : Number(els.diagramDeckCountSelect.value) === 2 ? "two-equal" : "single");
  if (!result?.valid) {
    els.diagramDeckCountSelect.value = String(Math.max(1, Math.min(3, hole?.decks?.length || 1)));
    window.alert(result?.reason || "Could not change deck count.");
    return;
  }
  fullDiagramRefresh();
});
els.diagramInterdeckTimingModeSelect.addEventListener("change", () => {
  const hole = selectedDiagramHoles()[0];
  if (!hole) return;
  hole.interdeckTimingMode = els.diagramInterdeckTimingModeSelect.value === "simultaneous" ? "simultaneous" : "top-first";
  fullDiagramRefresh();
});
els.diagramHoleDeckingEditor.addEventListener("input", (event) => {
  const target = event.target.closest("[data-deck-index]");
  const hole = selectedDiagramHoles()[0];
  if (!target || !hole) return;
  const intervals = singleHoleDeckIntervals(hole);
  const interval = intervals[Number(target.getAttribute("data-deck-index"))];
  if (!interval) return;
  const field = target.getAttribute("data-deck-field");
  interval[field] = Math.max(0, Math.round(Number(target.value) || 0));
  const built = buildDecksFromStemIntervals({
    topStemming: Math.max(0, Math.round(Number(hole?.stemHeight) || 0)),
    intervals,
    deckCount: hole.decks?.length || 1,
    existingDecks: hole.decks || [],
    holeDepth: Math.max(0, Math.round(Number(hole?.depth) || 0)),
  });
  if (built.valid) {
    hole.decks = built.decks;
    hole.deckStemIntervals = intervals.map((item) => ({ ...item }));
    hole.deckingEnabled = hole.decks.length > 1;
    recalculateHoleLoading(hole, diagramState.metadata.loadingDensityGcc);
  } else {
    hole.deckingError = built.reason;
  }
  refreshDiagramLoadingDerivedState();
  persistDiagramStateToProject();
  renderDiagramShotPanel();
  renderDiagramLoadingPanel();
  refreshSingleHoleDeckingUi(hole, { preserveDeckEditor: true });
  diagramRenderer.render();
});
els.diagramHoleDeckingEditor.addEventListener("change", (event) => {
  const target = event.target.closest("[data-deck-index]");
  const hole = selectedDiagramHoles()[0];
  if (!target || !hole) return;
  const intervals = singleHoleDeckIntervals(hole);
  const interval = intervals[Number(target.getAttribute("data-deck-index"))];
  if (!interval) return;
  const field = target.getAttribute("data-deck-field");
  interval[field] = Math.max(0, Math.round(Number(target.value) || 0));
  const built = buildDecksFromStemIntervals({
    topStemming: Math.max(0, Math.round(Number(hole?.stemHeight) || 0)),
    intervals,
    deckCount: hole.decks?.length || 1,
    existingDecks: hole.decks || [],
    holeDepth: Math.max(0, Math.round(Number(hole.depth) || 0)),
  });
  if (!built.valid) {
    window.alert(built.reason || "Invalid deck stem interval.");
    fullDiagramRefresh();
    return;
  }
  hole.decks = built.decks;
  hole.deckStemIntervals = intervals.map((item) => ({ ...item }));
  hole.deckingEnabled = hole.decks.length > 1;
  recalculateHoleLoading(hole, diagramState.metadata.loadingDensityGcc);
  fullDiagramRefresh();
});

els.authSignInBtn.addEventListener("click", async () => {
  if (!requireConfiguredSupabase()) return;
  const email = els.authEmailInput.value.trim();
  const password = els.authPasswordInput.value;
  if (!email || !password) {
    window.alert("Enter both email and password.");
    return;
  }
  try {
    await signInWithPassword(email, password);
    els.accountStatus.textContent = `Signed in as ${email}.`;
    els.authPasswordInput.value = "";
    closeAllMenus();
  } catch (error) {
    console.error(error);
    window.alert(error.message || "Could not sign in.");
  }
});

els.authSignUpBtn.addEventListener("click", async () => {
  if (!requireConfiguredSupabase()) return;
  const email = els.authEmailInput.value.trim();
  const password = els.authPasswordInput.value;
  if (!email || !password) {
    window.alert("Enter both email and password.");
    return;
  }
  if (password.length < 6) {
    window.alert("Use a password with at least 6 characters.");
    return;
  }
  try {
    await signUpWithPassword(email, password);
    els.accountStatus.textContent = `Account created for ${email}. If email confirmation is enabled in Supabase, confirm it before signing in.`;
    els.authPasswordInput.value = "";
  } catch (error) {
    console.error(error);
    window.alert(error.message || "Could not create account.");
  }
});

els.authSignOutBtn.addEventListener("click", async () => {
  if (!requireConfiguredSupabase()) return;
  try {
    await signOutSession();
    els.authPasswordInput.value = "";
    closeAllMenus();
  } catch (error) {
    console.error(error);
    window.alert(error.message || "Could not sign out.");
  }
});

els.cloudSaveBtn.addEventListener("click", async () => {
  try {
    await saveProjectToCloud();
  } catch (error) {
    console.error(error);
    window.alert(error.message || "Cloud save failed.");
  }
});

els.cloudSaveAsBtn.addEventListener("click", async () => {
  try {
    await saveProjectToCloud({ forcePrompt: true });
  } catch (error) {
    console.error(error);
    window.alert(error.message || "Cloud save failed.");
  }
});

els.cloudRefreshProjectsBtn.addEventListener("click", async () => {
  try {
    await refreshCloudProjects();
  } catch (error) {
    console.error(error);
    window.alert(error.message || "Could not refresh cloud projects.");
  }
});

els.localProjectExportBtn.addEventListener("click", () => exportProjectFile());

els.projectFileInput.addEventListener("change", async () => {
  const [file] = els.projectFileInput.files || [];
  if (!file) return;
  try {
    await importProjectFile(file);
    closeAllMenus();
  } catch (error) {
    console.error(error);
    window.alert(error.message || "Could not import project file.");
  } finally {
    els.projectFileInput.value = "";
  }
});

els.cloudProjectsList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-cloud-action]");
  if (!button) return;
  const projectId = button.getAttribute("data-cloud-id");
  const action = button.getAttribute("data-cloud-action");
  if (!projectId || !action) return;
  try {
    if (action === "load") await loadProjectFromCloud(projectId);
    if (action === "rename") await renameProjectInCloud(projectId);
    if (action === "delete") await deleteProjectFromCloud(projectId);
  } catch (error) {
    console.error(error);
    window.alert(error.message || "Cloud project action failed.");
  }
});

els.homeNavBtn.addEventListener("click", () => {
  syncCurrentWorkspaceToProject();
  setActiveWorkspace("home");
});
els.openDelaySolverBtn.addEventListener("click", () => {
  appUi.plannerMode = "diagram";
  if (projectState.holes.length) hydrateDiagramFromProject();
  else persistDiagramStateToProject();
  setActiveWorkspace("diagramMaker");
  requestAnimationFrame(() => {
    applyProjectViewToMode(diagramState, els.diagramCoordViewSelect, diagramRenderer, projectState.view.coordView, projectState.view);
    fullDiagramRefresh({ fit: projectState.holes.length === 0 });
  });
});
if (els.openDiagramMakerBtn) {
  els.openDiagramMakerBtn.addEventListener("click", () => {
    appUi.plannerMode = "diagram";
    if (projectState.holes.length) hydrateDiagramFromProject();
    setActiveWorkspace("diagramMaker");
    requestAnimationFrame(() => {
      applyProjectViewToMode(diagramState, els.diagramCoordViewSelect, diagramRenderer, projectState.view.coordView, projectState.view);
      fullDiagramRefresh();
    });
  });
}
els.plannerDiagramModeBtn.addEventListener("click", () => switchPlannerMode("diagram"));
els.plannerTimingModeBtn.addEventListener("click", () => switchPlannerMode("timing"));
if (els.plannerLoadingModeBtn) els.plannerLoadingModeBtn.addEventListener("click", () => switchPlannerMode("loading"));
els.timingSolverModeBtn.addEventListener("click", () => setTimingMode("solver"));
els.timingManualModeBtn.addEventListener("click", () => setTimingMode("manual"));
[
  els.manualHoleDelayInput,
  els.manualRowDelayInput,
  els.manualOffsetDelayInput,
  els.manualInterdeckDelayInput,
].forEach((input) => {
  input.addEventListener("input", () => syncManualTimingFromInputs());
});

els.originToolBtn.addEventListener("click", () => setToolMode("origin"));
els.holeRelationPositiveToolBtn.addEventListener("click", () => setToolMode("holeRelationshipPositive"));
els.holeRelationNegativeToolBtn.addEventListener("click", () => setToolMode("holeRelationshipNegative"));
els.rowRelationPositiveToolBtn.addEventListener("click", () => setToolMode("rowRelationshipPositive"));
els.rowRelationNegativeToolBtn.addEventListener("click", () => setToolMode("rowRelationshipNegative"));
els.offsetRelationToolBtn.addEventListener("click", () => setToolMode("offsetRelationship"));
els.clearRelationshipsBtn.addEventListener("click", () => {
  solverState.relationships.edges = [];
  solverState.ui.relationshipDraft = null;
  resetTimingResults(defaultTimingMessage());
  fullSolverRefresh();
});
els.clearOriginBtn.addEventListener("click", () => {
  setOriginHole(solverState, null);
  resetTimingResults(defaultTimingMessage());
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
    resetTimingResults(defaultTimingMessage());
    fullSolverRefresh();
  }
});

els.solveTimingBtn.addEventListener("click", () => {
  resetTimingVisualization();
  if (activeTimingMode() === "manual") {
    const manual = buildManualTimingResult(solverState, solverState.manualTiming);
    if (!manual.valid) {
      resetTimingResults(manual.reason || "Manual timing could not be applied.");
      solverRenderer.render();
      return;
    }
    solverState.timingResults = [manual.result];
    solverState.ui.activeTimingPreviewIndex = 0;
    solverState.solverMessage = "";
  } else {
    startWorkerTimingSolve();
    return;
  }
  renderTimingResults();
  if (solverState.timingResults.length) openMenu("timingResultsMenu");
  solverRenderer.render();
});

els.cancelTimingSolveBtn.addEventListener("click", () => {
  cancelTimingSolve();
});

els.timingSolveFloatingHandle.addEventListener("mousedown", (event) => {
  startTimingSolveFloatingDrag(event);
});

els.timingResults.addEventListener("click", (event) => {
  const target = event.target.closest("[data-timing-index]");
  if (!target) return;
  const index = Number(target.getAttribute("data-timing-index"));
  if (!Number.isFinite(index)) return;
  resetTimingVisualization();
  resetTimingOverlapAnalysis({ preservePanel: true });
  solverState.ui.activeTimingPreviewIndex = index;
  renderTimingResults();
  solverRenderer.render();
});

els.timingOverlapAnalysisBtn.addEventListener("click", () => {
  if (!selectedTimingResult()) return;
  solverState.ui.showOverlapAnalysis = !solverState.ui.showOverlapAnalysis;
  if (!solverState.ui.showOverlapAnalysis) solverState.ui.activeOverlapBinKey = null;
  renderTimingOverlapAnalysis();
  solverRenderer.render();
});

els.timingOverlapClearBtn.addEventListener("click", () => {
  if (!solverState.ui.activeOverlapBinKey) return;
  solverState.ui.activeOverlapBinKey = null;
  renderTimingOverlapAnalysis();
  solverRenderer.render();
});

els.timingOverlapChart.addEventListener("click", (event) => {
  const button = event.target.closest("[data-overlap-bin]");
  if (!button) return;
  const key = button.getAttribute("data-overlap-bin");
  solverState.ui.activeOverlapBinKey = solverState.ui.activeOverlapBinKey === key ? null : key;
  renderTimingOverlapAnalysis();
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
els.plannerMappingCloseBtn?.addEventListener("click", () => closeMappingOverlay());
els.printBackBtn.addEventListener("click", () => closePrintWorkspace());
els.printAddPageBreakBtn.addEventListener("click", () => {
  startPrintPageBreakDraft();
  closeAllMenus();
});
els.printAddTimingPageBtn.addEventListener("click", () => {
  addTimingPrintPage();
  closeAllMenus();
});
els.printAddHoleTablePageBtn.addEventListener("click", () => {
  addHoleTablePrintPage();
  closeAllMenus();
});
els.printAddShotOrderPageBtn.addEventListener("click", () => {
  addShotOrderPrintPage();
  closeAllMenus();
});
els.printAddHoleLoadProfilePageBtn.addEventListener("click", () => {
  addHoleLoadProfilePrintPage();
  closeAllMenus();
});
els.printAddPageBtn.addEventListener("click", () => addPrintPage());
els.printPageBreakBtn.addEventListener("click", () => confirmPrintPageBreakDraft());
els.printCancelPageBreakBtn.addEventListener("click", () => cancelPrintPageBreakDraft());
els.printPageTabs.addEventListener("click", (event) => {
  const removeBtn = event.target.closest("[data-print-remove]");
  if (removeBtn) {
    event.stopPropagation();
    removePrintPage(Number(removeBtn.getAttribute("data-print-remove")));
    return;
  }
  const tab = event.target.closest("[data-print-page]");
  if (!tab) return;
  activatePrintPage(Number(tab.getAttribute("data-print-page")));
});
els.printFitBtn.addEventListener("click", () => printRenderer.fitToData(PRINT_FIT_MARGINS));
els.printEditLabelsBtn.addEventListener("click", () => {
  const page = activePrintPage();
  if (!page) return;
  setPrintEditMode(!page.ui.labelEditMode);
});
els.printResetLabelsBtn.addEventListener("click", () => resetPrintLabelLayouts());
els.printTextScaleInput.addEventListener("input", () => applyPrintSettings());
els.printColorModeToggle.addEventListener("change", () => applyPrintSettings());
els.printRelationshipToggle.addEventListener("change", () => applyPrintSettings());
els.printTimingToggle.addEventListener("change", () => applyPrintSettings());
els.printAngleToggle.addEventListener("change", () => applyPrintSettings());
els.printBearingToggle.addEventListener("change", () => applyPrintSettings());
els.printBearingArrowWeightInput.addEventListener("input", () => applyPrintSettings());
els.printBearingArrowLengthInput.addEventListener("input", () => applyPrintSettings());
els.printDepthToggle.addEventListener("change", () => applyPrintSettings());
els.printCornerCoordsToggle.addEventListener("change", () => applyPrintSettings());
els.printLabelDistanceDownBtn.addEventListener("click", () => {
  setActivePrintLabelDistance(printLabelTickToDistance(clampPrintLabelDistanceTick(printLabelDistanceToTick(activePrintLabelDistance()) - 1)));
});
els.printLabelDistanceUpBtn.addEventListener("click", () => {
  setActivePrintLabelDistance(printLabelTickToDistance(clampPrintLabelDistanceTick(printLabelDistanceToTick(activePrintLabelDistance()) + 1)));
});
els.printLabelAngleDial.addEventListener("mousedown", (event) => startPrintLabelDialInteraction(event));
els.printLabelAngleDial.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
    event.preventDefault();
    setActivePrintLabelAngle(activePrintLabelAngle() + 5);
  } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
    event.preventDefault();
    setActivePrintLabelAngle(activePrintLabelAngle() - 5);
  } else if (event.key === "Home") {
    event.preventDefault();
    setActivePrintLabelAngle(270);
  }
});
window.addEventListener("mousemove", (event) => {
  if (timingSolveFloatingState.dragging) {
    timingSolveFloatingState.hasMoved = true;
    setTimingSolveFloatingPosition(
      event.clientX - timingSolveFloatingState.pointerOffsetX,
      event.clientY - timingSolveFloatingState.pointerOffsetY,
    );
  }
  if (!printLabelDialState.dragging) return;
  setActivePrintLabelAngle(pointerDialAngle(event.clientX, event.clientY));
});
window.addEventListener("mouseup", () => {
  timingSolveFloatingState.dragging = false;
  printLabelDialState.dragging = false;
});
els.printActionBtn.addEventListener("click", () => {
  preparePrintablePages();
  window.print();
});
window.addEventListener("beforeprint", () => {
  if (!els.printWorkspace.classList.contains("hidden")) preparePrintablePages();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.plannerMappingOverlay.classList.contains("hidden")) {
    closeMappingOverlay();
    return;
  }
  if (event.key === "Escape" && !els.diagramHolePopupBackdrop.classList.contains("hidden")) {
    closeDiagramHolePopup();
    return;
  }
  if (isDiagramWorkspaceActive() && (diagramState.ui.pendingFaceDesignation || diagramState.ui.activeTool === "polygon") && event.key === "Enter") {
    finalizeDiagramPolygonSelection();
    return;
  }
  if (isDiagramWorkspaceActive() && event.key === "Escape") {
    if (diagramState.ui.selectionPolygonDraft || diagramState.ui.selectionBoxDraft || diagramState.ui.currentStrokeDraft) {
      diagramState.ui.selectionPolygonDraft = null;
      diagramState.ui.selectionBoxDraft = null;
      diagramState.ui.currentStrokeDraft = null;
      if (diagramState.ui.pendingFaceDesignation) {
        diagramState.ui.pendingFaceDesignation = false;
        setDiagramToolMode(diagramState.ui.faceDesignationReturnTool || "single");
        renderDiagramShotPanel();
      } else {
        diagramRenderer.render();
      }
      return;
    }
    if (diagramState.ui.pendingFaceDesignation) {
      diagramState.ui.pendingFaceDesignation = false;
      setDiagramToolMode(diagramState.ui.faceDesignationReturnTool || "single");
      renderDiagramShotPanel();
      return;
    }
  }
  if (event.key === "Escape" && !els.helpWorkspace.classList.contains("hidden")) closeHelpWorkspace();
});

ensureRelationshipState(solverState);
setToolMode(solverState.ui.toolMode);
els.coordViewSelect.value = solverState.ui.coordView;
els.coordViewSelect.disabled = true;
els.diagramCoordViewSelect.value = diagramState.ui.coordView;
els.diagramCoordViewSelect.disabled = true;
renderDiagramShotPanel();
renderDiagramLoadingPanel();
renderDiagramVolumePanel();
els.diagramAnnotationColorInput.value = diagramState.ui.annotationColor;
els.diagramAnnotationSizeSelect.value = diagramState.ui.annotationSize;
setDiagramToolMode(diagramState.ui.activeTool);
els.diagramBearingLabelToggle.checked = diagramState.ui.showBearingLabels;
els.diagramBearingArrowToggle.checked = diagramState.ui.showBearingArrows;
syncManualTimingInputs();
renderTimingModeControls();
syncRelationshipVisibilityUi();
renderOriginStatus();
renderRelationshipList();
renderTimingResults();
syncDiagramDefaultDiameterStatus();
renderDiagramPropertiesPanel();
persistDiagramStateToProject();
persistTimingStateToProject();
initPlannerLayouts();
initPlannerCards();
initMenuToggles();
setPlannerCardExpanded("relationshipMenu", true, { exclusive: true });
setPlannerCardExpanded("timingResultsMenu", true, { exclusive: true });
setPlannerCardExpanded("diagramShotMenu", true, { exclusive: true });
setPlannerCardExpanded("diagramPropertiesMenu", true, { exclusive: true });
renderWorkspaceChrome();
renderAuthUi();
renderCloudProjectUi();
renderQuarryOptions();
solverRenderer.render();
diagramRenderer.render();
appUi.suspendDirtyTracking = false;
initializeCloudIntegration().catch((error) => {
  console.error(error);
  window.alert(error.message || "Supabase initialization failed.");
});






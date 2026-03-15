function cloneHole(hole = {}) {
  return {
    ...hole,
    collar: hole.collar ? { ...hole.collar, original: hole.collar.original ? { ...hole.collar.original } : hole.collar.original } : hole.collar,
    toe: hole.toe ? { ...hole.toe, original: hole.toe.original ? { ...hole.toe.original } : hole.toe.original } : hole.toe,
    original: hole.original ? { ...hole.original } : hole.original,
  };
}

function cloneCsvCache(csvCache = null) {
  if (!csvCache || typeof csvCache !== "object") return null;
  return {
    headers: Array.isArray(csvCache.headers) ? [...csvCache.headers] : [],
    records: Array.isArray(csvCache.records) ? csvCache.records.map((record) => ({ ...record })) : [],
  };
}

function cloneAnnotations(annotations = {}) {
  return {
    strokes: (annotations.strokes || []).map((stroke) => ({
      color: stroke.color || "#000000",
      size: stroke.size || "medium",
      points: (stroke.points || []).map((point) => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 })),
    })),
    texts: (annotations.texts || []).map((item) => ({
      text: item.text || "",
      color: item.color || "#000000",
      size: item.size || "medium",
      anchor: item.anchor ? { x: Number(item.anchor.x) || 0, y: Number(item.anchor.y) || 0 } : { x: 0, y: 0 },
    })),
  };
}

function cloneTimingResults(results = []) {
  return results.map((result) => ({
    ...result,
    holeTimes: Array.isArray(result.holeTimes) ? result.holeTimes.map((entry) => [...entry]) : Array.from(result.holeTimes || []),
    offsetAssignments: Array.isArray(result.offsetAssignments)
      ? result.offsetAssignments.map((entry) => [...entry])
      : Array.from(result.offsetAssignments || []),
    delayCounts: Array.isArray(result.delayCounts) ? result.delayCounts.map((entry) => ({ ...entry })) : [],
  }));
}

export function serializeProjectDocument(projectState) {
  return {
    version: 1,
    holes: (projectState.holes || []).map(cloneHole),
    csvCache: cloneCsvCache(projectState.csvCache),
    view: {
      coordView: projectState.view?.coordView || "collar",
      zoom: Number(projectState.view?.zoom) || 1,
      panX: Number(projectState.view?.panX) || 0,
      panY: Number(projectState.view?.panY) || 0,
      rotationDeg: Number(projectState.view?.rotationDeg) || 0,
    },
    diagram: {
      ui: { ...(projectState.diagram?.ui || {}) },
      metadata: { ...(projectState.diagram?.metadata || {}) },
      annotations: cloneAnnotations(projectState.diagram?.annotations || {}),
    },
    timing: {
      ui: { ...(projectState.timing?.ui || {}) },
      timing: {
        holeToHole: { ...(projectState.timing?.timing?.holeToHole || {}) },
        rowToRow: { ...(projectState.timing?.timing?.rowToRow || {}) },
        offset: { ...(projectState.timing?.timing?.offset || {}) },
      },
      manualTiming: { ...(projectState.timing?.manualTiming || {}) },
      relationships: {
        originHoleId: projectState.timing?.relationships?.originHoleId || null,
        edges: (projectState.timing?.relationships?.edges || []).map((edge) => ({ ...edge })),
        nextId: projectState.timing?.relationships?.nextId || 1,
      },
      timingResults: cloneTimingResults(projectState.timing?.timingResults || []),
      solverMessage: projectState.timing?.solverMessage || "",
      timingVisualization: { ...(projectState.timing?.timingVisualization || {}) },
    },
  };
}

export function parseProjectDocument(document) {
  if (!document || typeof document !== "object") {
    throw new Error("Invalid project document.");
  }

  return {
    version: Number(document.version) || 1,
    holes: Array.isArray(document.holes) ? document.holes.map(cloneHole) : [],
    csvCache: cloneCsvCache(document.csvCache),
    view: {
      coordView: document.view?.coordView || "collar",
      zoom: Number(document.view?.zoom) || 1,
      panX: Number(document.view?.panX) || 0,
      panY: Number(document.view?.panY) || 0,
      rotationDeg: Number(document.view?.rotationDeg) || 0,
    },
    diagram: {
      ui: { ...(document.diagram?.ui || {}) },
      metadata: { ...(document.diagram?.metadata || {}) },
      annotations: cloneAnnotations(document.diagram?.annotations || {}),
    },
    timing: {
      ui: { ...(document.timing?.ui || {}) },
      timing: {
        holeToHole: { ...(document.timing?.timing?.holeToHole || {}) },
        rowToRow: { ...(document.timing?.timing?.rowToRow || {}) },
        offset: { ...(document.timing?.timing?.offset || {}) },
      },
      manualTiming: { ...(document.timing?.manualTiming || {}) },
      relationships: {
        originHoleId: document.timing?.relationships?.originHoleId || null,
        edges: (document.timing?.relationships?.edges || []).map((edge) => ({ ...edge })),
        nextId: document.timing?.relationships?.nextId || 1,
      },
      timingResults: cloneTimingResults(document.timing?.timingResults || []),
      solverMessage: document.timing?.solverMessage || "",
      timingVisualization: { ...(document.timing?.timingVisualization || {}) },
    },
  };
}

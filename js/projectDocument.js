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

function clonePointReference(point = null) {
  if (!point || typeof point !== "object") return point;
  return {
    ...point,
    original: point.original ? { ...point.original } : point.original,
    coordinates: cloneCoordinateBundle(point.coordinates),
  };
}

function cloneHole(hole = {}) {
  return {
    ...hole,
    collar: clonePointReference(hole.collar),
    toe: clonePointReference(hole.toe),
    original: hole.original ? { ...hole.original } : hole.original,
    coordinates: cloneCoordinateBundle(hole.coordinates),
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
    overlapBins: Array.isArray(result.overlapBins)
      ? result.overlapBins.map((bin) => ({ ...bin, holeIds: Array.isArray(bin.holeIds) ? [...bin.holeIds] : [] }))
      : [],
  }));
}

function cloneGeo(geo = {}) {
  return {
    quarryName: geo.quarryName || "",
    statePlaneEpsg: Number.isFinite(Number(geo.statePlaneEpsg)) ? Number(geo.statePlaneEpsg) : null,
    statePlaneUnit: geo.statePlaneUnit || "ft",
  };
}

function cloneShotCorners(corners = []) {
  return Array.isArray(corners) ? corners.map((corner) => (corner ? String(corner) : null)) : [null, null, null, null];
}

export function serializeProjectDocument(projectState) {
  return {
    version: 2,
    holes: (projectState.holes || []).map(cloneHole),
    csvCache: cloneCsvCache(projectState.csvCache),
    geo: cloneGeo(projectState.geo),
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
      shotCorners: cloneShotCorners(projectState.diagram?.shotCorners || []),
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
    geo: cloneGeo(document.geo),
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
      shotCorners: cloneShotCorners(document.diagram?.shotCorners || []),
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

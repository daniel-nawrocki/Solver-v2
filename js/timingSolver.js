function generateValues(min, max, maxSamples = 15) {
  const absMin = Math.abs(Math.floor(Number(min) || 0));
  const absMax = Math.abs(Math.floor(Number(max) || 0));
  const a = Math.max(0, Math.min(absMin, absMax));
  const b = Math.max(a, Math.max(absMin, absMax));
  if (a === b) return [a];
  const span = b - a;
  const step = Math.max(1, Math.ceil(span / (maxSamples - 1)));
  const values = [];
  for (let value = a; value <= b; value += step) values.push(value);
  if (values[values.length - 1] !== b) values.push(b);
  return values;
}

function formatBinNumber(value) {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function binLabel(startMs, endMs) {
  return `${formatBinNumber(startMs)}-${formatBinNumber(endMs)}ms`;
}

function summarizeDelayCounts(holeTimes) {
  const counts = new Map();
  for (const value of holeTimes.values()) {
    if (!Number.isFinite(value)) continue;
    const rounded = Math.round(value * 1000) / 1000;
    counts.set(rounded, (counts.get(rounded) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, count]) => ({ time, count }));
}

function buildOverlapBins(holeTimes, windowMs = 8) {
  if (!holeTimes?.size) return [];
  const bins = new Map();
  for (const [holeId, value] of holeTimes.entries()) {
    if (!Number.isFinite(value)) continue;
    const startMs = Math.floor(value / windowMs) * windowMs;
    const existing = bins.get(startMs) || {
      key: String(startMs),
      startMs,
      endMs: startMs + windowMs,
      label: binLabel(startMs, startMs + windowMs),
      holeIds: [],
      count: 0,
      isOverlapGroup: false,
    };
    existing.holeIds.push(holeId);
    existing.count += 1;
    bins.set(startMs, existing);
  }
  return [...bins.values()]
    .sort((a, b) => a.startMs - b.startMs)
    .map((bin) => ({
      ...bin,
      holeIds: [...bin.holeIds],
      isOverlapGroup: bin.count > 1,
    }));
}

export function deriveTimingAnalysis(holeTimes, windowMs = 8) {
  const overlapBins = buildOverlapBins(holeTimes, windowMs);
  const peakBinCount = overlapBins.reduce((max, bin) => Math.max(max, bin.count), 0);
  const overlapGroupCount = overlapBins.filter((bin) => bin.isOverlapGroup).length;
  return {
    overlapBins,
    peakBinCount,
    overlapGroupCount,
  };
}

function edgeDelay(edge, holeDelay, rowDelay, offsetAssignments) {
  if (edge.type === "offset") return offsetAssignments.get(edge.id) ?? 17;
  if (edge.type === "rowToRow") return (edge.sign === -1 ? -1 : 1) * rowDelay;
  return (edge.sign === -1 ? -1 : 1) * holeDelay;
}

function offsetRangeValues(state) {
  const min = Number.isFinite(Number(state.timing?.offset?.min)) ? Number(state.timing.offset.min) : 17;
  const max = Number.isFinite(Number(state.timing?.offset?.max)) ? Number(state.timing.offset.max) : 42;
  return generateValues(Math.min(min, max), Math.max(min, max), 26);
}

function buildGraphState(state) {
  const edges = state.relationships?.edges || [];
  const originHoleId = state.relationships?.originHoleId || null;
  if (!originHoleId) return { valid: false, reason: "Select an origin hole before solving." };
  if (!state.holesById.has(originHoleId)) return { valid: false, reason: "The selected origin hole no longer exists." };
  if (!edges.length) return { valid: false, reason: "Create at least one timing relationship before solving." };

  const adjacency = new Map();
  edges.forEach((edge) => {
    if (!state.holesById.has(edge.fromHoleId) || !state.holesById.has(edge.toHoleId)) return;
    if (!adjacency.has(edge.fromHoleId)) adjacency.set(edge.fromHoleId, []);
    adjacency.get(edge.fromHoleId).push(edge);
  });

  return { valid: true, originHoleId, edges, adjacency };
}

export function validateTimingGraph(state) {
  const graph = buildGraphState(state);
  if (!graph.valid) return graph;

  const visited = new Set();
  const queue = [graph.originHoleId];
  while (queue.length) {
    const holeId = queue.shift();
    if (visited.has(holeId)) continue;
    visited.add(holeId);
    for (const edge of graph.adjacency.get(holeId) || []) {
      queue.push(edge.toHoleId);
    }
  }

  const unreachable = state.holes.filter((hole) => !visited.has(hole.id));
  if (unreachable.length) {
    const sample = unreachable.slice(0, 3).map((hole) => hole.holeNumber || hole.id).join(", ");
    return {
      valid: false,
      reason: `Every hole must be reachable from the origin through directed relationships. Unreachable: ${sample}${unreachable.length > 3 ? "..." : ""}`,
    };
  }

  return graph;
}

function buildSchedule(state, graph, holeDelay, rowDelay, offsetAssignments = new Map()) {
  const holeTimes = new Map([[graph.originHoleId, 0]]);
  const queue = [graph.originHoleId];
  const epsilon = 0.0001;

  while (queue.length) {
    const holeId = queue.shift();
    const baseTime = holeTimes.get(holeId);
    for (const edge of graph.adjacency.get(holeId) || []) {
      const nextTime = baseTime + edgeDelay(edge, holeDelay, rowDelay, offsetAssignments);
      const existing = holeTimes.get(edge.toHoleId);
      if (existing === undefined) {
        holeTimes.set(edge.toHoleId, nextTime);
        queue.push(edge.toHoleId);
        continue;
      }
      if (Math.abs(existing - nextTime) > epsilon) {
        return {
          valid: false,
          reason: `Conflicting timing paths detected at hole ${edge.toHoleId}.`,
        };
      }
    }
  }

  if (holeTimes.size !== state.holes.length) {
    return { valid: false, reason: "Some holes could not be assigned a derived firing time." };
  }

  const times = [...holeTimes.values()];
  const minTime = times.length ? Math.min(...times) : 0;
  const maxTime = times.length ? Math.max(...times) : 0;
  const endTime = maxTime - minTime;
  const { overlapBins, peakBinCount, overlapGroupCount } = deriveTimingAnalysis(holeTimes, 8);

  return {
    valid: true,
    holeDelay,
    rowDelay,
    offsetAssignments: new Map(offsetAssignments),
    holeTimes,
    times,
    endTime,
    density8ms: peakBinCount,
    peakBinCount,
    overlapGroupCount,
    overlapBins,
    delayCounts: summarizeDelayCounts(holeTimes),
  };
}

export function buildManualTimingResult(state, manualTiming = {}) {
  const graph = validateTimingGraph(state);
  if (!graph.valid) return graph;

  const holeDelay = Number.isFinite(Number(manualTiming.holeDelay)) ? Number(manualTiming.holeDelay) : 0;
  const rowDelay = Number.isFinite(Number(manualTiming.rowDelay)) ? Number(manualTiming.rowDelay) : 0;
  const offsetDelay = Number.isFinite(Number(manualTiming.offsetDelay)) ? Number(manualTiming.offsetDelay) : 0;
  const offsetAssignments = new Map(
    graph.edges
      .filter((edge) => edge.type === "offset")
      .map((edge) => [edge.id, offsetDelay])
  );

  const schedule = buildSchedule(state, graph, holeDelay, rowDelay, offsetAssignments);
  if (!schedule.valid) return schedule;
  return {
    valid: true,
    result: {
      ...schedule,
      mode: "manual",
      manualOffsetDelay: offsetDelay,
    },
  };
}

export function solveTimingCombinations(state) {
  const graph = validateTimingGraph(state);
  if (!graph.valid) return [];

  const holeValues = generateValues(state.timing.holeToHole.min, state.timing.holeToHole.max);
  const rowValues = generateValues(state.timing.rowToRow.min, state.timing.rowToRow.max);
  const offsetEdges = graph.edges.filter((edge) => edge.type === "offset");
  const candidates = [];

  function exploreOffsets(index, offsetAssignments, holeDelay, rowDelay) {
    if (index >= offsetEdges.length) {
      const schedule = buildSchedule(state, graph, holeDelay, rowDelay, offsetAssignments);
      if (schedule.valid) candidates.push(schedule);
      return;
    }

    const edge = offsetEdges[index];
    const values = offsetRangeValues(state);
    values.forEach((value) => {
      const nextAssignments = new Map(offsetAssignments);
      nextAssignments.set(edge.id, value);
      exploreOffsets(index + 1, nextAssignments, holeDelay, rowDelay);
    });
  }

  holeValues.forEach((holeDelay) => {
    rowValues.forEach((rowDelay) => {
      exploreOffsets(0, new Map(), holeDelay, rowDelay);
    });
  });

  candidates.sort((a, b) => {
    if (a.peakBinCount !== b.peakBinCount) return a.peakBinCount - b.peakBinCount;
    if (a.overlapGroupCount !== b.overlapGroupCount) return a.overlapGroupCount - b.overlapGroupCount;
    if (a.endTime !== b.endTime) return a.endTime - b.endTime;
    return (a.holeDelay + a.rowDelay) - (b.holeDelay + b.rowDelay);
  });

  return candidates.slice(0, 12);
}

export function formatTimingResult(result, index) {
  if (result.mode === "manual") {
    const offsetSummary = result.offsetAssignments?.size ? ` | offset ${result.manualOffsetDelay}ms` : "";
    return `${index + 1}. Manual | H2H ${result.holeDelay}ms | R2R ${result.rowDelay}ms${offsetSummary} | peak 8ms bin: ${result.peakBinCount} holes | overlap groups: ${result.overlapGroupCount} | total duration: ${result.endTime.toFixed(1)}ms`;
  }
  const offsetSummary = result.offsetAssignments?.size
    ? ` | offsets: ${[...result.offsetAssignments.values()].join(",")}ms`
    : "";
  return `${index + 1}. H2H ${result.holeDelay}ms | R2R ${result.rowDelay}ms${offsetSummary} | peak 8ms bin: ${result.peakBinCount} holes | overlap groups: ${result.overlapGroupCount} | total duration: ${result.endTime.toFixed(1)}ms`;
}

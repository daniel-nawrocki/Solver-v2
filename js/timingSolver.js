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

function sortedTimingEntries(holeTimes) {
  return [...holeTimes.entries()]
    .filter(([, value]) => Number.isFinite(value))
    .map(([holeId, time]) => ({ holeId, time }))
    .sort((a, b) => a.time - b.time || String(a.holeId).localeCompare(String(b.holeId)));
}

function buildOverlapBins(holeTimes, windowMs = 8) {
  const entries = sortedTimingEntries(holeTimes);
  if (!entries.length) return [];
  const bins = new Map();
  let minValue = Infinity;
  let maxValue = -Infinity;
  for (const { holeId, time: value } of entries) {
    minValue = Math.min(minValue, value);
    maxValue = Math.max(maxValue, value);
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
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) return [];
  const minStart = Math.floor(minValue / windowMs) * windowMs;
  const maxStart = Math.floor(maxValue / windowMs) * windowMs;
  const normalized = [];
  for (let startMs = minStart; startMs <= maxStart; startMs += windowMs) {
    const existing = bins.get(startMs) || {
      key: String(startMs),
      startMs,
      endMs: startMs + windowMs,
      label: binLabel(startMs, startMs + windowMs),
      holeIds: [],
      count: 0,
      isOverlapGroup: false,
    };
    normalized.push({
      ...existing,
      holeIds: [...existing.holeIds],
      isOverlapGroup: existing.count > 1,
    });
  }
  return normalized;
}

function peakSlidingWindowCount(holeTimes, windowMs = 8) {
  const entries = sortedTimingEntries(holeTimes);
  if (!entries.length) return 0;
  let maxCount = 0;
  let startIndex = 0;
  const epsilon = 0.0001;
  for (let endIndex = 0; endIndex < entries.length; endIndex += 1) {
    while (entries[endIndex].time - entries[startIndex].time > windowMs + epsilon) startIndex += 1;
    maxCount = Math.max(maxCount, endIndex - startIndex + 1);
  }
  return maxCount;
}

function buildOverlapGroups(holeTimes, windowMs = 8) {
  const entries = sortedTimingEntries(holeTimes);
  if (!entries.length) return [];
  const groups = [];
  let currentGroup = {
    key: "0",
    startMs: entries[0].time,
    endMs: entries[0].time,
    holeIds: [entries[0].holeId],
    count: 1,
    isOverlapGroup: false,
  };
  const epsilon = 0.0001;

  for (let index = 1; index < entries.length; index += 1) {
    const entry = entries[index];
    const previous = entries[index - 1];
    if (entry.time - previous.time <= windowMs + epsilon) {
      currentGroup.endMs = entry.time;
      currentGroup.holeIds.push(entry.holeId);
      currentGroup.count += 1;
      continue;
    }
    currentGroup.isOverlapGroup = currentGroup.count > 1;
    groups.push(currentGroup);
    currentGroup = {
      key: String(groups.length),
      startMs: entry.time,
      endMs: entry.time,
      holeIds: [entry.holeId],
      count: 1,
      isOverlapGroup: false,
    };
  }

  currentGroup.isOverlapGroup = currentGroup.count > 1;
  groups.push(currentGroup);
  return groups;
}

export function deriveTimingAnalysis(holeTimes, windowMs = 8) {
  const overlapBins = buildOverlapBins(holeTimes, windowMs);
  const overlapGroups = buildOverlapGroups(holeTimes, windowMs);
  const fixedPeakBinCount = overlapBins.reduce((max, bin) => Math.max(max, bin.count), 0);
  const fixedOverlapGroupCount = overlapBins.filter((bin) => bin.isOverlapGroup).length;
  const peakBinCount = peakSlidingWindowCount(holeTimes, windowMs);
  const overlapGroupCount = overlapGroups.filter((group) => group.isOverlapGroup).length;
  return {
    overlapBins,
    overlapGroups,
    peakBinCount,
    overlapGroupCount,
    fixedPeakBinCount,
    fixedOverlapGroupCount,
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
  const {
    overlapBins,
    overlapGroups,
    peakBinCount,
    overlapGroupCount,
    fixedPeakBinCount,
    fixedOverlapGroupCount,
  } = deriveTimingAnalysis(holeTimes, 8);

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
    fixedPeakBinCount,
    fixedOverlapGroupCount,
    overlapBins,
    overlapGroups,
    delayCounts: summarizeDelayCounts(holeTimes),
  };
}

function allowedExperimentalBinStarts(time, maxAdjustmentMs = 8, windowMs = 8) {
  if (!Number.isFinite(time)) return [];
  const minTime = time - maxAdjustmentMs;
  const maxTime = time + maxAdjustmentMs;
  const minStart = Math.floor(minTime / windowMs) * windowMs;
  const maxStart = Math.floor(maxTime / windowMs) * windowMs;
  const starts = [];
  const epsilon = 0.001;
  for (let startMs = minStart; startMs <= maxStart; startMs += windowMs) {
    const low = Math.max(startMs, minTime);
    const high = Math.min((startMs + windowMs) - epsilon, maxTime);
    if (low <= high) starts.push(startMs);
  }
  return starts;
}

function nearestExperimentalTimeInBin(time, startMs, maxAdjustmentMs = 8, windowMs = 8) {
  const epsilon = 0.001;
  const minTime = time - maxAdjustmentMs;
  const maxTime = time + maxAdjustmentMs;
  const low = Math.max(startMs, minTime);
  const high = Math.min((startMs + windowMs) - epsilon, maxTime);
  if (low > high) return null;
  if (time < low) return low;
  if (time > high) return high;
  return time;
}

function buildExperimentalAdjustment(schedule, state, maxAdjustmentMs = 8, windowMs = 8) {
  const entries = sortedTimingEntries(schedule.holeTimes).map(({ holeId, time }) => {
    const allowedBins = allowedExperimentalBinStarts(time, maxAdjustmentMs, windowMs)
      .map((startMs) => ({
        startMs,
        targetTime: nearestExperimentalTimeInBin(time, startMs, maxAdjustmentMs, windowMs),
      }))
      .filter((entry) => Number.isFinite(entry.targetTime))
      .sort((a, b) => {
        const deltaA = Math.abs(a.targetTime - time);
        const deltaB = Math.abs(b.targetTime - time);
        if (deltaA !== deltaB) return deltaA - deltaB;
        return a.startMs - b.startMs;
      });
    return {
      holeId,
      time,
      allowedBins,
    };
  });

  const orderedEntries = [...entries].sort((a, b) => {
    if (a.allowedBins.length !== b.allowedBins.length) return a.allowedBins.length - b.allowedBins.length;
    return a.time - b.time;
  });

  const assignments = new Map();
  const binOwners = new Map();

  function tryAssign(entry, visited = new Set()) {
    for (const option of entry.allowedBins) {
      if (visited.has(option.startMs)) continue;
      visited.add(option.startMs);
      const owner = binOwners.get(option.startMs);
      if (!owner || tryAssign(owner, visited)) {
        binOwners.set(option.startMs, entry);
        assignments.set(entry.holeId, option);
        if (owner) assignments.delete(owner.holeId);
        return true;
      }
    }
    return false;
  }

  for (const entry of orderedEntries) {
    if (!tryAssign(entry)) return null;
  }

  const adjustedHoleTimes = new Map();
  const timingAdjustments = [];
  for (const { holeId, time } of entries) {
    const option = assignments.get(holeId);
    if (!option) return null;
    const adjustedTime = option.targetTime;
    const deltaMs = adjustedTime - time;
    adjustedHoleTimes.set(holeId, adjustedTime);
    const hole = state.holesById.get(holeId);
    timingAdjustments.push({
      holeId,
      holeLabel: hole?.holeNumber || hole?.id || holeId,
      originalTime: time,
      adjustedTime,
      deltaMs,
      targetBinStartMs: option.startMs,
    });
  }

  const adjustedTimes = [...adjustedHoleTimes.values()];
  const minTime = adjustedTimes.length ? Math.min(...adjustedTimes) : 0;
  const maxTime = adjustedTimes.length ? Math.max(...adjustedTimes) : 0;
  const analysis = deriveTimingAnalysis(adjustedHoleTimes, windowMs);
  return {
    adjustedHoleTimes,
    timingAdjustments,
    affectedHoleCount: timingAdjustments.filter((entry) => Math.abs(entry.deltaMs) > 0.0001).length,
    maxAbsoluteAdjustmentMs: timingAdjustments.reduce((max, entry) => Math.max(max, Math.abs(entry.deltaMs)), 0),
    totalAbsoluteAdjustmentMs: timingAdjustments.reduce((sum, entry) => sum + Math.abs(entry.deltaMs), 0),
    adjustedEndTime: maxTime - minTime,
    analysis,
  };
}

function toExperimentalResult(schedule, state, maxAdjustmentMs = 8, windowMs = 8) {
  const adjustment = buildExperimentalAdjustment(schedule, state, maxAdjustmentMs, windowMs);
  if (!adjustment) return null;
  if (adjustment.analysis.fixedPeakBinCount > 1) return null;
  return {
    ...schedule,
    mode: "experimental",
    originalHoleTimes: new Map(schedule.holeTimes),
    holeTimes: adjustment.adjustedHoleTimes,
    adjustedHoleTimes: new Map(adjustment.adjustedHoleTimes),
    timingAdjustments: adjustment.timingAdjustments,
    affectedHoleCount: adjustment.affectedHoleCount,
    maxAbsoluteAdjustmentMs: adjustment.maxAbsoluteAdjustmentMs,
    totalAbsoluteAdjustmentMs: adjustment.totalAbsoluteAdjustmentMs,
    endTime: adjustment.adjustedEndTime,
    times: [...adjustment.adjustedHoleTimes.values()],
    peakBinCount: adjustment.analysis.peakBinCount,
    overlapGroupCount: adjustment.analysis.overlapGroupCount,
    fixedPeakBinCount: adjustment.analysis.fixedPeakBinCount,
    fixedOverlapGroupCount: adjustment.analysis.fixedOverlapGroupCount,
    overlapBins: adjustment.analysis.overlapBins,
    overlapGroups: adjustment.analysis.overlapGroups,
    delayCounts: summarizeDelayCounts(adjustment.adjustedHoleTimes),
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

export function buildExperimentalManualTimingResult(state, manualTiming = {}) {
  const manual = buildManualTimingResult(state, manualTiming);
  if (!manual.valid) return manual;
  const result = toExperimentalResult(manual.result, state);
  if (!result) {
    return {
      valid: false,
      reason: "No valid one-hole-per-8ms experimental schedule was found within the ±8 ms per-hole limit.",
    };
  }
  return {
    valid: true,
    result,
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

export function solveExperimentalTimingCombinations(state) {
  const graph = validateTimingGraph(state);
  if (!graph.valid) return [];

  const holeValues = generateValues(state.timing.holeToHole.min, state.timing.holeToHole.max);
  const rowValues = generateValues(state.timing.rowToRow.min, state.timing.rowToRow.max);
  const offsetEdges = graph.edges.filter((edge) => edge.type === "offset");
  const candidates = [];

  function exploreOffsets(index, offsetAssignments, holeDelay, rowDelay) {
    if (index >= offsetEdges.length) {
      const schedule = buildSchedule(state, graph, holeDelay, rowDelay, offsetAssignments);
      if (!schedule.valid) return;
      const result = toExperimentalResult(schedule, state);
      if (result) candidates.push(result);
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
    if (a.maxAbsoluteAdjustmentMs !== b.maxAbsoluteAdjustmentMs) return a.maxAbsoluteAdjustmentMs - b.maxAbsoluteAdjustmentMs;
    if (a.totalAbsoluteAdjustmentMs !== b.totalAbsoluteAdjustmentMs) return a.totalAbsoluteAdjustmentMs - b.totalAbsoluteAdjustmentMs;
    if (a.endTime !== b.endTime) return a.endTime - b.endTime;
    if (a.holeDelay !== b.holeDelay) return a.holeDelay - b.holeDelay;
    return a.rowDelay - b.rowDelay;
  });

  return candidates.slice(0, 12);
}

export function formatTimingResult(result, index) {
  if (result.mode === "manual") {
    const offsetSummary = result.offsetAssignments?.size ? ` | offset ${result.manualOffsetDelay}ms` : "";
    return `${index + 1}. Manual | H2H ${result.holeDelay}ms | R2R ${result.rowDelay}ms${offsetSummary} | peak 8ms window: ${result.peakBinCount} holes | overlap groups: ${result.overlapGroupCount} | total duration: ${result.endTime.toFixed(1)}ms`;
  }
  const offsetSummary = result.offsetAssignments?.size
    ? ` | offsets: ${[...result.offsetAssignments.values()].join(",")}ms`
    : "";
  return `${index + 1}. H2H ${result.holeDelay}ms | R2R ${result.rowDelay}ms${offsetSummary} | peak 8ms window: ${result.peakBinCount} holes | overlap groups: ${result.overlapGroupCount} | total duration: ${result.endTime.toFixed(1)}ms`;
}

export function formatExperimentalTimingResult(result, index) {
  const offsetSummary = result.offsetAssignments?.size
    ? ` | offsets: ${[...result.offsetAssignments.values()].join(",")}ms`
    : "";
  return `${index + 1}. Experimental | H2H ${result.holeDelay}ms | R2R ${result.rowDelay}ms${offsetSummary} | max shift ${result.maxAbsoluteAdjustmentMs.toFixed(1)}ms | total shift ${result.totalAbsoluteAdjustmentMs.toFixed(1)}ms | adjusted holes ${result.affectedHoleCount} | total duration: ${result.endTime.toFixed(1)}ms`;
}

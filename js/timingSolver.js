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

function formatWindowNumber(value) {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function overlapWindowLabel(startMs, endMs) {
  return `${formatWindowNumber(startMs)}-${formatWindowNumber(endMs)}ms`;
}

function normalizeDeckingMode(hole = {}) {
  return hole?.interdeckTimingMode === "simultaneous" ? "simultaneous" : "top-first";
}

function normalizedHoleDecks(hole = {}) {
  const decks = Array.isArray(hole.decks) && hole.decks.length ? hole.decks : [{
    id: `${hole.id}-deck-1`,
    index: 0,
    columnLength: Number(hole.columnDepth) || 0,
    explosiveWeightLb: Number(hole.explosiveWeightLb) || 0,
  }];
  return decks.map((deck, index) => ({
    id: deck.id || `${hole.id}-deck-${index + 1}`,
    index,
    columnLength: Math.max(0, Number(deck.columnLength) || 0),
    explosiveWeightLb: Math.max(0, Number(deck.explosiveWeightLb) || 0),
  }));
}

function expandedHoleTimingInfo(hole = {}) {
  const decks = normalizedHoleDecks(hole);
  const decked = hole?.deckingEnabled === true && decks.length > 1;
  return {
    holeId: hole.id,
    decks,
    decked,
    timingMode: normalizeDeckingMode(hole),
  };
}

function sortedTimingEntries(timeMap, options = {}) {
  const holeIdByNodeId = options.holeIdByNodeId || new Map();
  const labelByNodeId = options.labelByNodeId || new Map();
  const weightByNodeId = options.weightByNodeId || new Map();
  return [...timeMap.entries()]
    .filter(([, value]) => Number.isFinite(value))
    .map(([nodeId, time]) => ({
      nodeId,
      holeId: holeIdByNodeId.get(nodeId) || nodeId,
      label: labelByNodeId.get(nodeId) || nodeId,
      weightLb: Number(weightByNodeId.get(nodeId)) || 0,
      time,
    }))
    .sort((a, b) => a.time - b.time || String(a.nodeId).localeCompare(String(b.nodeId)));
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

function buildOverlapGroups(nodeTimes, windowMs = 8, options = {}) {
  const entries = sortedTimingEntries(nodeTimes, options);
  if (!entries.length) return [];
  const groups = [];
  let currentGroup = {
    key: "0",
    startMs: entries[0].time,
    endMs: entries[0].time,
    label: overlapWindowLabel(entries[0].time, entries[0].time),
    holeIds: [entries[0].holeId],
    deckIds: [entries[0].nodeId],
    count: 1,
    deckCount: 1,
    totalExplosiveWeightLb: entries[0].weightLb,
    isOverlapGroup: false,
  };
  const epsilon = 0.0001;

  for (let index = 1; index < entries.length; index += 1) {
    const entry = entries[index];
    const previous = entries[index - 1];
    if (entry.time - previous.time < windowMs - epsilon) {
      currentGroup.endMs = entry.time;
      currentGroup.holeIds.push(entry.holeId);
      currentGroup.deckIds.push(entry.nodeId);
      currentGroup.count += 1;
      currentGroup.deckCount += 1;
      currentGroup.totalExplosiveWeightLb += entry.weightLb;
      continue;
    }
    currentGroup.isOverlapGroup = currentGroup.deckCount > 1;
    currentGroup.holeIds = [...new Set(currentGroup.holeIds)];
    currentGroup.label = overlapWindowLabel(currentGroup.startMs, currentGroup.endMs);
    groups.push(currentGroup);
    currentGroup = {
      key: String(groups.length),
      startMs: entry.time,
      endMs: entry.time,
      label: overlapWindowLabel(entry.time, entry.time),
      holeIds: [entry.holeId],
      deckIds: [entry.nodeId],
      count: 1,
      deckCount: 1,
      totalExplosiveWeightLb: entry.weightLb,
      isOverlapGroup: false,
    };
  }

  currentGroup.isOverlapGroup = currentGroup.deckCount > 1;
  currentGroup.holeIds = [...new Set(currentGroup.holeIds)];
  currentGroup.label = overlapWindowLabel(currentGroup.startMs, currentGroup.endMs);
  groups.push(currentGroup);
  return groups;
}

function peakSlidingWindowCount(nodeTimes, windowMs = 8, options = {}) {
  const entries = sortedTimingEntries(nodeTimes, options);
  if (!entries.length) return 0;
  let maxCount = 0;
  let startIndex = 0;
  const epsilon = 0.0001;
  for (let endIndex = 0; endIndex < entries.length; endIndex += 1) {
    while (entries[endIndex].time - entries[startIndex].time >= windowMs - epsilon) startIndex += 1;
    maxCount = Math.max(maxCount, endIndex - startIndex + 1);
  }
  return maxCount;
}

function peakSlidingWindowWeight(nodeTimes, windowMs = 8, options = {}) {
  const entries = sortedTimingEntries(nodeTimes, options);
  if (!entries.length) return 0;
  let maxWeight = 0;
  let startIndex = 0;
  let currentWeight = 0;
  const epsilon = 0.0001;
  for (let endIndex = 0; endIndex < entries.length; endIndex += 1) {
    currentWeight += entries[endIndex].weightLb;
    while (entries[endIndex].time - entries[startIndex].time >= windowMs - epsilon) {
      currentWeight -= entries[startIndex].weightLb;
      startIndex += 1;
    }
    maxWeight = Math.max(maxWeight, currentWeight);
  }
  return maxWeight;
}

export function deriveTimingAnalysis(nodeTimes, windowMs = 8, options = {}) {
  const overlapGroups = buildOverlapGroups(nodeTimes, windowMs, options);
  const peakBinCount = peakSlidingWindowCount(nodeTimes, windowMs, options);
  const peakBinWeightLb = peakSlidingWindowWeight(nodeTimes, windowMs, options);
  const overlapGroupCount = overlapGroups.filter((group) => group.isOverlapGroup).length;
  return {
    overlapGroups,
    peakBinCount,
    peakBinWeightLb,
    overlapGroupCount,
  };
}

function edgeDelay(edge, holeDelay, rowDelay, offsetAssignments) {
  if (edge.type === "offset") return offsetAssignments.get(edge.id) ?? 17;
  if (edge.type === "rowToRow") return (edge.sign === -1 ? -1 : 1) * rowDelay;
  return (edge.sign === -1 ? -1 : 1) * holeDelay;
}

function interdeckRangeValues(state) {
  const min = Number.isFinite(Number(state.timing?.interdeck?.min)) ? Number(state.timing.interdeck.min) : 0;
  const max = Number.isFinite(Number(state.timing?.interdeck?.max)) ? Number(state.timing.interdeck.max) : 0;
  return generateValues(Math.min(min, max), Math.max(min, max), 20);
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

function validateHoleDeckTimingState(hole = {}) {
  if (!hole?.deckingEnabled) return { valid: true };
  if (!Array.isArray(hole.decks) || hole.decks.length < 2) {
    return { valid: false, reason: `Hole ${hole.holeNumber || hole.id} is marked decked but has no valid decks.` };
  }
  if (!(hole.interdeckTimingMode === "top-first" || hole.interdeckTimingMode === "simultaneous")) {
    return { valid: false, reason: `Hole ${hole.holeNumber || hole.id} has an invalid interdeck timing mode.` };
  }
  const depth = Number(hole.depth);
  if (!(Number.isFinite(depth) && depth > 0)) {
    return { valid: false, reason: `Hole ${hole.holeNumber || hole.id} needs a valid depth before timing can be solved.` };
  }
  let runningDepth = 0;
  for (const deck of hole.decks) {
    const stemmingAbove = Number(deck?.stemmingAbove);
    const columnLength = Number(deck?.columnLength);
    if (!(Number.isFinite(stemmingAbove) && stemmingAbove >= 0 && Number.isFinite(columnLength) && columnLength > 0)) {
      return { valid: false, reason: `Hole ${hole.holeNumber || hole.id} has an invalid deck length or stemming value.` };
    }
    runningDepth += stemmingAbove + columnLength;
  }
  if (Math.abs(runningDepth - depth) > 0.0001) {
    return { valid: false, reason: `Hole ${hole.holeNumber || hole.id} deck totals must exactly match hole depth before solving.` };
  }
  return { valid: true };
}

export function validateTimingGraph(state) {
  const graph = buildGraphState(state);
  if (!graph.valid) return graph;
  const deckIssue = state.holes.map((hole) => validateHoleDeckTimingState(hole)).find((result) => !result.valid);
  if (deckIssue) return deckIssue;

  const visited = new Set();
  const queue = [graph.originHoleId];
  while (queue.length) {
    const holeId = queue.shift();
    if (visited.has(holeId)) continue;
    visited.add(holeId);
    for (const edge of graph.adjacency.get(holeId) || []) queue.push(edge.toHoleId);
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

function buildDeckTimingMaps(state, holeTimes, interdeckDelay) {
  const deckTimes = new Map();
  const displayTimesByHoleId = new Map();
  const nodeWeightById = new Map();
  const nodeHoleIdById = new Map();
  const nodeLabelById = new Map();
  const hasDecking = state.holes.some((hole) => hole.deckingEnabled && hole.decks?.length > 1);

  state.holes.forEach((hole) => {
    const baseTime = holeTimes.get(hole.id);
    if (!Number.isFinite(baseTime)) return;
    const holeInfo = expandedHoleTimingInfo(hole);
    const displayTimes = [];
    holeInfo.decks.forEach((deck, index) => {
      const nodeId = `${hole.id}::${deck.id || `deck-${index + 1}`}`;
      const nodeTime = holeInfo.decked && holeInfo.timingMode === "top-first"
        ? baseTime + (index * interdeckDelay)
        : baseTime;
      deckTimes.set(nodeId, nodeTime);
      nodeWeightById.set(nodeId, Number(deck.explosiveWeightLb) || 0);
      nodeHoleIdById.set(nodeId, hole.id);
      nodeLabelById.set(nodeId, hole.holeNumber || hole.id);
      displayTimes.push(nodeTime);
    });
    displayTimesByHoleId.set(hole.id, displayTimes);
  });

  return {
    deckTimes,
    displayTimesByHoleId,
    nodeWeightById,
    nodeHoleIdById,
    nodeLabelById,
    hasDecking,
  };
}

function buildSchedule(state, graph, holeDelay, rowDelay, offsetAssignments = new Map(), interdeckDelay = 0) {
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

  const deckTiming = buildDeckTimingMaps(state, holeTimes, interdeckDelay);
  const analysis = deriveTimingAnalysis(deckTiming.deckTimes, 8, {
    weightByNodeId: deckTiming.nodeWeightById,
    holeIdByNodeId: deckTiming.nodeHoleIdById,
    labelByNodeId: deckTiming.nodeLabelById,
  });
  const times = [...holeTimes.values()];
  const minTime = times.length ? Math.min(...times) : 0;
  const deckTimeValues = [...deckTiming.deckTimes.values()];
  const maxTime = deckTimeValues.length ? Math.max(...deckTimeValues) : 0;

  return {
    valid: true,
    holeDelay,
    rowDelay,
    interdeckDelay,
    offsetAssignments: new Map(offsetAssignments),
    holeTimes,
    deckTimes: new Map(deckTiming.deckTimes),
    displayTimesByHoleId: new Map(deckTiming.displayTimesByHoleId),
    times,
    endTime: maxTime - minTime,
    density8ms: analysis.peakBinCount,
    peakBinCount: analysis.peakBinCount,
    peakBinWeightLb: analysis.peakBinWeightLb,
    overlapGroupCount: analysis.overlapGroupCount,
    overlapGroups: analysis.overlapGroups,
    delayCounts: summarizeDelayCounts(holeTimes),
    hasDecking: deckTiming.hasDecking,
  };
}

export function buildManualTimingResult(state, manualTiming = {}) {
  const graph = validateTimingGraph(state);
  if (!graph.valid) return graph;

  const holeDelay = Number.isFinite(Number(manualTiming.holeDelay)) ? Number(manualTiming.holeDelay) : 0;
  const rowDelay = Number.isFinite(Number(manualTiming.rowDelay)) ? Number(manualTiming.rowDelay) : 0;
  const offsetDelay = Number.isFinite(Number(manualTiming.offsetDelay)) ? Number(manualTiming.offsetDelay) : 0;
  const interdeckDelay = Number.isFinite(Number(manualTiming.interdeckDelay)) ? Number(manualTiming.interdeckDelay) : 0;
  const offsetAssignments = new Map(
    graph.edges
      .filter((edge) => edge.type === "offset")
      .map((edge) => [edge.id, offsetDelay])
  );

  const schedule = buildSchedule(state, graph, holeDelay, rowDelay, offsetAssignments, interdeckDelay);
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
  const interdeckValues = interdeckRangeValues(state);
  const offsetEdges = graph.edges.filter((edge) => edge.type === "offset");
  const candidates = [];

  function compareCandidates(a, b) {
    if ((a.hasDecking || b.hasDecking) && a.peakBinWeightLb !== b.peakBinWeightLb) return a.peakBinWeightLb - b.peakBinWeightLb;
    if (a.peakBinCount !== b.peakBinCount) return a.peakBinCount - b.peakBinCount;
    if (a.overlapGroupCount !== b.overlapGroupCount) return a.overlapGroupCount - b.overlapGroupCount;
    if (a.endTime !== b.endTime) return a.endTime - b.endTime;
    return (a.holeDelay + a.rowDelay) - (b.holeDelay + b.rowDelay);
  }

  function exploreOffsets(index, offsetAssignments, holeDelay, rowDelay, interdeckDelay) {
    if (index >= offsetEdges.length) {
      const schedule = buildSchedule(state, graph, holeDelay, rowDelay, offsetAssignments, interdeckDelay);
      if (schedule.valid) candidates.push(schedule);
      return;
    }

    const edge = offsetEdges[index];
    const values = offsetRangeValues(state);
    values.forEach((value) => {
      const nextAssignments = new Map(offsetAssignments);
      nextAssignments.set(edge.id, value);
      exploreOffsets(index + 1, nextAssignments, holeDelay, rowDelay, interdeckDelay);
    });
  }

  holeValues.forEach((holeDelay) => {
    rowValues.forEach((rowDelay) => {
      interdeckValues.forEach((interdeckDelay) => {
        exploreOffsets(0, new Map(), holeDelay, rowDelay, interdeckDelay);
      });
    });
  });

  candidates.sort(compareCandidates);
  return candidates.slice(0, 12);
}

function formatWeightLb(value) {
  if (!Number.isFinite(Number(value))) return "0";
  return (Math.round(Number(value) * 10) / 10).toFixed(1).replace(/\.0$/, "");
}

export function formatTimingResult(result, index) {
  const peakSummary = result.hasDecking
    ? `peak 8ms: ${result.peakBinWeightLb ? `${formatWeightLb(result.peakBinWeightLb)} lb` : "0 lb"} / ${result.peakBinCount} deck${result.peakBinCount === 1 ? "" : "s"}`
    : `peak 8ms window: ${result.peakBinCount} hole${result.peakBinCount === 1 ? "" : "s"}`;
  const interdeckSummary = result.hasDecking ? ` | interdeck ${result.interdeckDelay}ms` : "";
  if (result.mode === "manual") {
    const offsetSummary = result.offsetAssignments?.size ? ` | offset ${result.manualOffsetDelay}ms` : "";
    return `${index + 1}. Manual | H2H ${result.holeDelay}ms | R2R ${result.rowDelay}ms${offsetSummary}${interdeckSummary} | ${peakSummary} | overlap groups: ${result.overlapGroupCount} | total duration: ${result.endTime.toFixed(1)}ms`;
  }
  const offsetSummary = result.offsetAssignments?.size
    ? ` | offsets: ${[...result.offsetAssignments.values()].join(",")}ms`
    : "";
  return `${index + 1}. H2H ${result.holeDelay}ms | R2R ${result.rowDelay}ms${offsetSummary}${interdeckSummary} | ${peakSummary} | overlap groups: ${result.overlapGroupCount} | total duration: ${result.endTime.toFixed(1)}ms`;
}

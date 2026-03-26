function enumerateIntegerRange(min, max) {
  const a = Math.max(0, Math.min(Math.floor(Number(min) || 0), Math.floor(Number(max) || 0)));
  const b = Math.max(a, Math.max(Math.floor(Number(min) || 0), Math.floor(Number(max) || 0)));
  const values = new Array(b - a + 1);
  for (let index = 0; index < values.length; index += 1) values[index] = a + index;
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

function summarizeDelayCounts(holeTimes) {
  const counts = new Map();
  for (let index = 0; index < holeTimes.length; index += 1) {
    const value = holeTimes[index];
    if (!Number.isFinite(value)) continue;
    const rounded = Math.round(value * 1000) / 1000;
    counts.set(rounded, (counts.get(rounded) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, count]) => ({ time, count }));
}

function sortedTimingEntries(holeTimes, holes) {
  const entries = [];
  for (let index = 0; index < holeTimes.length; index += 1) {
    const time = holeTimes[index];
    if (!Number.isFinite(time)) continue;
    entries.push({ holeId: holes[index].id, time });
  }
  entries.sort((a, b) => a.time - b.time || String(a.holeId).localeCompare(String(b.holeId)));
  return entries;
}

function peakSlidingWindowCountFromArray(holeTimes, holes, windowMs = 8) {
  const entries = sortedTimingEntries(holeTimes, holes);
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

function buildOverlapGroupsFromArray(holeTimes, holes, windowMs = 8) {
  const entries = sortedTimingEntries(holeTimes, holes);
  if (!entries.length) return [];
  const groups = [];
  let currentGroup = {
    key: "0",
    startMs: entries[0].time,
    endMs: entries[0].time,
    label: overlapWindowLabel(entries[0].time, entries[0].time),
    holeIds: [entries[0].holeId],
    count: 1,
    isOverlapGroup: false,
  };
  const epsilon = 0.0001;

  for (let index = 1; index < entries.length; index += 1) {
    const entry = entries[index];
    const previous = entries[index - 1];
    if (entry.time - previous.time < windowMs - epsilon) {
      currentGroup.endMs = entry.time;
      currentGroup.holeIds.push(entry.holeId);
      currentGroup.count += 1;
      continue;
    }
    currentGroup.isOverlapGroup = currentGroup.count > 1;
    currentGroup.label = overlapWindowLabel(currentGroup.startMs, currentGroup.endMs);
    groups.push(currentGroup);
    currentGroup = {
      key: String(groups.length),
      startMs: entry.time,
      endMs: entry.time,
      label: overlapWindowLabel(entry.time, entry.time),
      holeIds: [entry.holeId],
      count: 1,
      isOverlapGroup: false,
    };
  }

  currentGroup.isOverlapGroup = currentGroup.count > 1;
  currentGroup.label = overlapWindowLabel(currentGroup.startMs, currentGroup.endMs);
  groups.push(currentGroup);
  return groups;
}

function deriveTimingAnalysisFromArray(holeTimes, holes, windowMs = 8) {
  const overlapGroups = buildOverlapGroupsFromArray(holeTimes, holes, windowMs);
  const peakBinCount = peakSlidingWindowCountFromArray(holeTimes, holes, windowMs);
  const overlapGroupCount = overlapGroups.filter((group) => group.isOverlapGroup).length;
  return {
    overlapGroups,
    peakBinCount,
    overlapGroupCount,
  };
}

function compareResults(a, b) {
  if (a.peakBinCount !== b.peakBinCount) return a.peakBinCount - b.peakBinCount;
  if (a.overlapGroupCount !== b.overlapGroupCount) return a.overlapGroupCount - b.overlapGroupCount;
  if (a.endTime !== b.endTime) return a.endTime - b.endTime;
  return (a.holeDelay + a.rowDelay) - (b.holeDelay + b.rowDelay);
}

function rangeCount(min, max) {
  const floorMin = Math.floor(Number(min) || 0);
  const floorMax = Math.floor(Number(max) || 0);
  return Math.max(0, Math.abs(floorMax - floorMin)) + 1;
}

function clampRangeBounds(min, max) {
  const floorMin = Math.floor(Number(min) || 0);
  const floorMax = Math.floor(Number(max) || 0);
  return {
    min: Math.max(0, Math.min(floorMin, floorMax)),
    max: Math.max(0, Math.max(floorMin, floorMax)),
  };
}

function computeAdvancedTotal(ranges, offsetCount) {
  const h2hCount = rangeCount(ranges.holeToHole.min, ranges.holeToHole.max);
  const r2rCount = rangeCount(ranges.rowToRow.min, ranges.rowToRow.max);
  const offsetCountPerEdge = rangeCount(ranges.offset.min, ranges.offset.max);
  return h2hCount * r2rCount * (offsetCountPerEdge ** offsetCount);
}

function buildNormalizedInput(rawInputs = {}, rawRanges = {}) {
  const holes = Array.isArray(rawInputs.holes) ? rawInputs.holes.map((hole) => ({ id: hole.id, holeNumber: hole.holeNumber || hole.id })) : [];
  const holeIndexById = new Map();
  for (let index = 0; index < holes.length; index += 1) holeIndexById.set(holes[index].id, index);

  const relationships = rawInputs.relationships || {};
  const edges = Array.isArray(relationships.edges) ? relationships.edges.filter((edge) => holeIndexById.has(edge.fromHoleId) && holeIndexById.has(edge.toHoleId)) : [];
  const originHoleId = relationships.originHoleId || null;

  const ranges = {
    holeToHole: clampRangeBounds(rawRanges.holeToHole?.min, rawRanges.holeToHole?.max),
    rowToRow: clampRangeBounds(rawRanges.rowToRow?.min, rawRanges.rowToRow?.max),
    offset: clampRangeBounds(rawRanges.offset?.min, rawRanges.offset?.max),
  };

  const adjacency = new Array(holes.length);
  for (let index = 0; index < adjacency.length; index += 1) adjacency[index] = [];
  const offsetEdges = [];
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    const fromIndex = holeIndexById.get(edge.fromHoleId);
    const toIndex = holeIndexById.get(edge.toHoleId);
    const normalizedEdge = {
      id: edge.id,
      type: edge.type,
      sign: edge.sign === -1 ? -1 : 1,
      fromHoleId: edge.fromHoleId,
      toHoleId: edge.toHoleId,
      fromIndex,
      toIndex,
      offsetIndex: -1,
    };
    if (normalizedEdge.type === "offset") {
      normalizedEdge.offsetIndex = offsetEdges.length;
      offsetEdges.push(normalizedEdge);
    }
    adjacency[fromIndex].push(normalizedEdge);
    edges[index] = normalizedEdge;
  }

  return {
    holes,
    holeIndexById,
    relationships: {
      originHoleId,
      edges,
    },
    adjacency,
    offsetEdges,
    ranges,
  };
}

function validateGraph(context) {
  const { holes, holeIndexById, relationships, adjacency } = context;
  if (!relationships.originHoleId) return { valid: false, reason: "Select an origin hole before solving." };
  if (!holeIndexById.has(relationships.originHoleId)) return { valid: false, reason: "The selected origin hole no longer exists." };
  if (!relationships.edges.length) return { valid: false, reason: "Create at least one timing relationship before solving." };

  const visited = new Uint8Array(holes.length);
  const queue = new Int32Array(holes.length);
  let queueStart = 0;
  let queueEnd = 0;
  queue[queueEnd] = holeIndexById.get(relationships.originHoleId);
  queueEnd += 1;

  while (queueStart < queueEnd) {
    const holeIndex = queue[queueStart];
    queueStart += 1;
    if (visited[holeIndex]) continue;
    visited[holeIndex] = 1;
    const nextEdges = adjacency[holeIndex];
    for (let edgeIndex = 0; edgeIndex < nextEdges.length; edgeIndex += 1) {
      queue[queueEnd] = nextEdges[edgeIndex].toIndex;
      queueEnd += 1;
    }
  }

  const unreachable = [];
  for (let index = 0; index < holes.length; index += 1) {
    if (visited[index]) continue;
    unreachable.push(holes[index].holeNumber || holes[index].id);
    if (unreachable.length >= 3) break;
  }
  if (unreachable.length) {
    return {
      valid: false,
      reason: `Every hole must be reachable from the origin through directed relationships. Unreachable: ${unreachable.join(", ")}${holes.length - visited.reduce((sum, value) => sum + value, 0) > 3 ? "..." : ""}`,
    };
  }

  return { valid: true, originIndex: holeIndexById.get(relationships.originHoleId) };
}

function evaluateSchedule(context, graph, holeDelay, rowDelay, offsetValues, scratchTimes, queue) {
  const { holes, adjacency, offsetEdges } = context;
  const holeCount = holes.length;
  const epsilon = 0.0001;

  for (let index = 0; index < holeCount; index += 1) scratchTimes[index] = Number.NaN;

  let queueStart = 0;
  let queueEnd = 0;
  scratchTimes[graph.originIndex] = 0;
  queue[queueEnd] = graph.originIndex;
  queueEnd += 1;

  while (queueStart < queueEnd) {
    const holeIndex = queue[queueStart];
    queueStart += 1;
    const baseTime = scratchTimes[holeIndex];
    const nextEdges = adjacency[holeIndex];
    for (let edgeIndex = 0; edgeIndex < nextEdges.length; edgeIndex += 1) {
      const edge = nextEdges[edgeIndex];
      let delay = 0;
      if (edge.type === "offset") {
        delay = offsetValues[edge.offsetIndex];
      } else if (edge.type === "rowToRow") {
        delay = edge.sign * rowDelay;
      } else {
        delay = edge.sign * holeDelay;
      }
      const nextTime = baseTime + delay;
      const existing = scratchTimes[edge.toIndex];
      if (!Number.isFinite(existing)) {
        scratchTimes[edge.toIndex] = nextTime;
        queue[queueEnd] = edge.toIndex;
        queueEnd += 1;
        continue;
      }
      if (Math.abs(existing - nextTime) > epsilon) return null;
    }
  }

  for (let index = 0; index < holeCount; index += 1) {
    if (!Number.isFinite(scratchTimes[index])) return null;
  }

  let minTime = Infinity;
  let maxTime = -Infinity;
  for (let index = 0; index < holeCount; index += 1) {
    const value = scratchTimes[index];
    if (value < minTime) minTime = value;
    if (value > maxTime) maxTime = value;
  }

  const analysis = deriveTimingAnalysisFromArray(scratchTimes, holes, 8);
  return {
    valid: true,
    holeDelay,
    rowDelay,
    offsetAssignments: offsetEdges.map((edge) => [edge.id, offsetValues[edge.offsetIndex]]),
    holeTimes: holes.map((hole, index) => [hole.id, scratchTimes[index]]),
    endTime: maxTime - minTime,
    density8ms: analysis.peakBinCount,
    peakBinCount: analysis.peakBinCount,
    overlapGroupCount: analysis.overlapGroupCount,
    overlapGroups: analysis.overlapGroups,
    delayCounts: summarizeDelayCounts(scratchTimes),
  };
}

function pushCandidate(best, candidate, limit = 12) {
  best.push(candidate);
  best.sort(compareResults);
  if (best.length > limit) best.length = limit;
}

function postProgress(current, total) {
  self.postMessage({
    type: "progress",
    current,
    total,
  });
}

function solveEnumerated(context, graph, holeValues, rowValues, offsetValueSets, totalIterations, progressState, best) {
  const holeCount = context.holes.length;
  const offsetCount = context.offsetEdges.length;
  const scratchTimes = new Float64Array(holeCount);
  const queue = new Int32Array(holeCount);
  const offsetLengths = offsetValueSets.map((values) => values.length);
  const odometer = new Int32Array(offsetCount);
  const offsetValues = new Int32Array(offsetCount);
  const progressEvery = Math.max(1, Math.min(5000, Math.floor(totalIterations / 250) || 1));

  for (let holeIndex = 0; holeIndex < holeValues.length; holeIndex += 1) {
    const holeDelay = holeValues[holeIndex];
    for (let rowIndex = 0; rowIndex < rowValues.length; rowIndex += 1) {
      const rowDelay = rowValues[rowIndex];
      if (!offsetCount) {
        const candidate = evaluateSchedule(context, graph, holeDelay, rowDelay, [], scratchTimes, queue);
        progressState.current += 1;
        if (candidate?.valid) pushCandidate(best, candidate);
        if (progressState.current % progressEvery === 0 || progressState.current === totalIterations) {
          postProgress(progressState.current, totalIterations);
        }
        continue;
      }

      for (let index = 0; index < offsetCount; index += 1) odometer[index] = 0;
      let hasNext = true;
      while (hasNext) {
        for (let index = 0; index < offsetCount; index += 1) {
          offsetValues[index] = offsetValueSets[index][odometer[index]];
        }
        const candidate = evaluateSchedule(context, graph, holeDelay, rowDelay, offsetValues, scratchTimes, queue);
        progressState.current += 1;
        if (candidate?.valid) pushCandidate(best, candidate);
        if (progressState.current % progressEvery === 0 || progressState.current === totalIterations) {
          postProgress(progressState.current, totalIterations);
        }

        for (let index = offsetCount - 1; index >= 0; index -= 1) {
          odometer[index] += 1;
          if (odometer[index] < offsetLengths[index]) break;
          odometer[index] = 0;
          if (index === 0) hasNext = false;
        }
      }
    }
  }
}


function runAdvancedSolve(context, graph) {
  const holeValues = enumerateIntegerRange(context.ranges.holeToHole.min, context.ranges.holeToHole.max);
  const rowValues = enumerateIntegerRange(context.ranges.rowToRow.min, context.ranges.rowToRow.max);
  const offsetValues = context.offsetEdges.map(() => enumerateIntegerRange(context.ranges.offset.min, context.ranges.offset.max));
  const totalIterations = computeAdvancedTotal(context.ranges, context.offsetEdges.length);
  const progressState = { current: 0 };
  const best = [];

  solveEnumerated(context, graph, holeValues, rowValues, offsetValues, totalIterations, progressState, best);
  best.sort(compareResults);
  return {
    totalIterations,
    results: best.slice(0, 12),
  };
}

self.onmessage = function onMessage(event) {
  const { type, inputs, ranges } = event.data || {};
  if (type !== "start") return;

  try {
    const context = buildNormalizedInput(inputs, ranges);
    const graph = validateGraph(context);
    if (!graph.valid) {
      self.postMessage({ type: "result", results: [], message: graph.reason || "Solver validation failed." });
      self.postMessage({ type: "done" });
      return;
    }

    const output = runAdvancedSolve(context, graph);

    postProgress(output.totalIterations, output.totalIterations);
    self.postMessage({
      type: "result",
      results: output.results,
      mode: "advanced",
      total: output.totalIterations,
    });
    self.postMessage({ type: "done" });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Solver worker failed.",
    });
    self.postMessage({ type: "done" });
  }
};

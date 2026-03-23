export const DEFAULT_LOADING_DENSITY_GCC = 1.17;

export const DETONATOR_TYPES = [
  "Digishot 30â€™",
  "Digishot 50â€™",
  "Digishot 60â€™",
  "Digishot 80â€™",
  "Digishot 100â€™",
];

for (let index = 0; index < DETONATOR_TYPES.length; index += 1) {
  DETONATOR_TYPES[index] = DETONATOR_TYPES[index].replace("Ã¢â‚¬â„¢", "'");
}

export const BOOSTER_TYPES = [
  "Spartan 200",
  "Spartan 350",
  "Spartan 350 Shield",
  "Spartan 450",
  "Spartan 450 Shield",
  "Spartan 900",
];

for (let index = 0; index < DETONATOR_TYPES.length; index += 1) {
  const label = String(DETONATOR_TYPES[index] || "");
  DETONATOR_TYPES[index] = label
    .replace(/â€™/g, "'")
    .replace(/’/g, "'")
    .replace(/Ã.+¢/g, "'");
}

const INCH_TO_CM = 2.54;
const FOOT_TO_CM = 30.48;
const GRAMS_PER_POUND = 453.59237;

function normalizeQuantity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.round(numeric));
}

export function normalizeMaterialEntries(entries = [], allowedTypes = []) {
  const allowed = new Set(allowedTypes);
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => {
      const type = typeof entry?.type === "string" ? entry.type.trim() : "";
      if (!allowed.has(type)) return null;
      return {
        type,
        quantity: normalizeQuantity(entry.quantity),
      };
    })
    .filter(Boolean);
}

export function cloneMaterialEntries(entries = []) {
  return (entries || []).map((entry) => ({
    type: entry.type,
    quantity: normalizeQuantity(entry.quantity),
  }));
}

function flattenMaterialEntries(entries = []) {
  const counts = new Map();
  (entries || []).forEach((entry) => {
    const type = typeof entry?.type === "string" ? entry.type.trim() : "";
    if (!type) return;
    counts.set(type, (counts.get(type) || 0) + normalizeQuantity(entry.quantity));
  });
  return [...counts.entries()].map(([type, quantity]) => ({ type, quantity }));
}

function cloneDeck(deck = {}) {
  return {
    ...deck,
    detonators: cloneMaterialEntries(deck.detonators),
    boosters: cloneMaterialEntries(deck.boosters),
  };
}

function hasValidTimingMode(value) {
  return value === "top-first" || value === "simultaneous";
}

export function normalizeLoadingDensity(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : DEFAULT_LOADING_DENSITY_GCC;
}

export function calculateExplosiveWeightLb({ diameterIn, columnDepthFt, densityGcc }) {
  const diameter = Number(diameterIn);
  const columnDepth = Number(columnDepthFt);
  const density = normalizeLoadingDensity(densityGcc);
  if (!(Number.isFinite(diameter) && diameter > 0 && Number.isFinite(columnDepth) && columnDepth > 0)) return 0;
  const radiusCm = (diameter * INCH_TO_CM) / 2;
  const heightCm = columnDepth * FOOT_TO_CM;
  const volumeCc = Math.PI * radiusCm * radiusCm * heightCm;
  const grams = volumeCc * density;
  return grams / GRAMS_PER_POUND;
}

export function defaultDeckForHole(hole = {}) {
  const depth = Number(hole.depth);
  const stemming = Number(hole.stemHeight);
  const topStemming = Number.isFinite(stemming) ? Math.max(0, Math.min(Number.isFinite(depth) ? depth : stemming, stemming)) : 0;
  const columnLength = Number.isFinite(depth) ? Math.max(0, depth - topStemming) : 0;
  return {
    id: "deck-1",
    index: 0,
    stemmingAbove: topStemming,
    columnLength,
    topDepth: topStemming,
    bottomDepth: topStemming + columnLength,
    detonators: normalizeMaterialEntries(hole.detonators, DETONATOR_TYPES),
    boosters: normalizeMaterialEntries(hole.boosters, BOOSTER_TYPES),
    explosiveWeightLb: 0,
  };
}

export function calculateColumnDepthFeet(hole = {}) {
  if (hole?.deckingEnabled && Array.isArray(hole.decks) && hole.decks.length) {
    return hole.decks.reduce((sum, deck) => {
      const length = Number(deck?.columnLength);
      return sum + (Number.isFinite(length) && length > 0 ? length : 0);
    }, 0);
  }
  const depth = Number(hole.depth);
  const stemmingHeight = Number(hole.stemHeight);
  if (!Number.isFinite(depth)) return 0;
  const stemming = Number.isFinite(stemmingHeight) ? stemmingHeight : 0;
  const columnDepth = depth - stemming;
  return columnDepth > 0 ? columnDepth : 0;
}

export function isDeckingEnabled(hole = {}) {
  return hole?.deckingEnabled === true && Array.isArray(hole.decks) && hole.decks.length > 1;
}

export function validateDeckingState(hole = {}) {
  if (!hole?.deckingEnabled) return { valid: true, blockingMessage: "" };
  const depth = Number(hole.depth);
  if (!(Number.isFinite(depth) && depth > 0)) {
    return { valid: false, blockingMessage: "Hole depth is required before enabling decking." };
  }
  if (!Array.isArray(hole.decks) || hole.decks.length < 2) {
    return { valid: false, blockingMessage: "Decked holes require at least 2 decks." };
  }
  if (!hasValidTimingMode(hole.interdeckTimingMode)) {
    return { valid: false, blockingMessage: "Interdeck timing mode must be Top First or Simultaneous." };
  }
  for (const deck of hole.decks) {
    const stemmingAbove = Number(deck?.stemmingAbove);
    const columnLength = Number(deck?.columnLength);
    if (!Number.isFinite(stemmingAbove) || stemmingAbove < 0 || !Number.isFinite(columnLength) || columnLength < 0) {
      return { valid: false, blockingMessage: "Deck stemming and column values must be zero or greater." };
    }
    if (!(columnLength > 0)) {
      return { valid: false, blockingMessage: "Each deck needs a positive explosive column length." };
    }
  }
  return { valid: true, blockingMessage: "" };
}

export function normalizeHoleDecks(hole = {}, densityGcc = DEFAULT_LOADING_DENSITY_GCC) {
  const depth = Number(hole.depth);
  const hasDepth = Number.isFinite(depth);
  const enabled = isDeckingEnabled(hole);
  const rawDecks = enabled ? hole.decks.map(cloneDeck) : [defaultDeckForHole(hole)];
  let runningDepth = 0;
  let columnDepth = 0;
  let explosiveWeightLb = 0;
  let totalInertLength = 0;
  let loadingWarning = null;
  let deckingError = null;

  const decks = rawDecks.map((deck, index) => {
    const stemmingAbove = Math.max(0, Number(deck.stemmingAbove) || 0);
    const columnLength = Math.max(0, Number(deck.columnLength) || 0);
    runningDepth += stemmingAbove;
    const topDepth = runningDepth;
    runningDepth += columnLength;
    const bottomDepth = runningDepth;
    columnDepth += columnLength;
    totalInertLength += stemmingAbove;
    const normalizedDeck = {
      id: deck.id || `deck-${index + 1}`,
      index,
      stemmingAbove,
      columnLength,
      topDepth,
      bottomDepth,
      detonators: normalizeMaterialEntries(deck.detonators, DETONATOR_TYPES),
      boosters: normalizeMaterialEntries(deck.boosters, BOOSTER_TYPES),
      explosiveWeightLb: calculateExplosiveWeightLb({
        diameterIn: hole.diameter,
        columnDepthFt: columnLength,
        densityGcc,
      }),
    };
    explosiveWeightLb += normalizedDeck.explosiveWeightLb;
    return normalizedDeck;
  });

  const difference = hasDepth ? Math.round((runningDepth - depth) * 1000) / 1000 : 0;
  const validation = validateDeckingState(hole);
  if (!validation.valid) {
    deckingError = validation.blockingMessage;
  } else if (enabled && hasDepth && Math.abs(difference) > 0.0001) {
    deckingError = `Deck lengths must exactly match hole depth (${depth} ft).`;
  } else if (hasDepth && runningDepth <= 0 && depth > 0) {
    loadingWarning = "Explosive column is zero or negative.";
  } else if ((enabled || columnDepth > 0) && !Number.isFinite(Number(hole.diameter))) {
    loadingWarning = "Hole diameter is required for explosive weight.";
  }

  return {
    decks,
    columnDepth,
    explosiveWeightLb,
    totalInertLength,
    loadingWarning,
    deckingError,
    totalEnteredDepth: runningDepth,
    depthDifference: difference,
  };
}

export function recalculateHoleLoading(hole = {}, densityGcc = DEFAULT_LOADING_DENSITY_GCC) {
  const normalized = normalizeHoleDecks(hole, densityGcc);
  hole.deckingEnabled = isDeckingEnabled(hole);
  hole.interdeckTimingMode = hole.interdeckTimingMode === "simultaneous" ? "simultaneous" : "top-first";
  hole.decks = normalized.decks;
  hole.columnDepth = normalized.columnDepth;
  hole.explosiveWeightLb = normalized.explosiveWeightLb;
  hole.loadingWarning = normalized.loadingWarning;
  hole.deckingError = normalized.deckingError;
  hole.totalDeckedLength = normalized.totalEnteredDepth;
  hole.deckingDepthDifference = normalized.depthDifference;
  hole.totalInertLength = normalized.totalInertLength;
  hole.stemHeight = hole.deckingEnabled
    ? (Number.isFinite(Number(normalized.decks[0]?.stemmingAbove)) ? Number(normalized.decks[0].stemmingAbove) : 0)
    : normalized.totalInertLength;
  if (hole.deckingEnabled) {
    hole.detonators = flattenMaterialEntries(hole.decks.flatMap((deck) => deck.detonators));
    hole.boosters = flattenMaterialEntries(hole.decks.flatMap((deck) => deck.boosters));
  } else {
    hole.detonators = normalizeMaterialEntries(hole.detonators, DETONATOR_TYPES);
    hole.boosters = normalizeMaterialEntries(hole.boosters, BOOSTER_TYPES);
    if (!hole.decks[0]) hole.decks = [defaultDeckForHole(hole)];
    hole.decks[0].detonators = cloneMaterialEntries(hole.detonators);
    hole.decks[0].boosters = cloneMaterialEntries(hole.boosters);
  }
  return hole;
}

export function summarizeShotLoading(holes = [], densityGcc = DEFAULT_LOADING_DENSITY_GCC) {
  const detonatorCounts = new Map();
  const boosterCounts = new Map();
  let totalExplosiveWeightLb = 0;
  let totalDeckExplosiveWeightLb = 0;
  let includedHoleCount = 0;
  let warningHoleCount = 0;
  let includedDeckCount = 0;

  holes.forEach((hole) => {
    recalculateHoleLoading(hole, densityGcc);
    const weight = Number(hole.explosiveWeightLb);
    if (weight > 0) {
      totalExplosiveWeightLb += weight;
      includedHoleCount += 1;
    }
    if (hole.loadingWarning) warningHoleCount += 1;
    (hole.decks || []).forEach((deck) => {
      const deckWeight = Number(deck.explosiveWeightLb);
      if (deckWeight > 0) {
        totalDeckExplosiveWeightLb += deckWeight;
        includedDeckCount += 1;
      }
      (deck.detonators || []).forEach((entry) => {
        detonatorCounts.set(entry.type, (detonatorCounts.get(entry.type) || 0) + normalizeQuantity(entry.quantity));
      });
      (deck.boosters || []).forEach((entry) => {
        boosterCounts.set(entry.type, (boosterCounts.get(entry.type) || 0) + normalizeQuantity(entry.quantity));
      });
    });
  });

  return {
    totalExplosiveWeightLb,
    totalDeckExplosiveWeightLb,
    totalHoleCount: Array.isArray(holes) ? holes.length : 0,
    includedHoleCount,
    includedDeckCount,
    averageExplosiveWeightLb: includedHoleCount ? totalExplosiveWeightLb / includedHoleCount : 0,
    warningHoleCount,
    detonatorCounts,
    boosterCounts,
  };
}

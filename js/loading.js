export const DEFAULT_LOADING_DENSITY_GCC = 1.17;

export const DETONATOR_TYPES = [
  "Digishot 30’",
  "Digishot 50’",
  "Digishot 60’",
  "Digishot 80’",
  "Digishot 100’",
];

export const BOOSTER_TYPES = [
  "Spartan 200",
  "Spartan 350",
  "Spartan 350 Shield",
  "Spartan 450",
  "Spartan 450 Shield",
  "Spartan 900",
];

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

export function normalizeLoadingDensity(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : DEFAULT_LOADING_DENSITY_GCC;
}

export function calculateColumnDepthFeet(hole = {}) {
  const depth = Number(hole.depth);
  const stemmingHeight = Number(hole.stemHeight);
  if (!Number.isFinite(depth)) return 0;
  const stemming = Number.isFinite(stemmingHeight) ? stemmingHeight : 0;
  const columnDepth = depth - stemming;
  return columnDepth > 0 ? columnDepth : 0;
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

export function recalculateHoleLoading(hole = {}, densityGcc = DEFAULT_LOADING_DENSITY_GCC) {
  const rawDepth = Number(hole.depth);
  const rawStemming = Number(hole.stemHeight);
  const hasDepth = Number.isFinite(rawDepth);
  const stemming = Number.isFinite(rawStemming) ? rawStemming : 0;
  const rawColumnDepth = hasDepth ? rawDepth - stemming : 0;
  const columnDepth = rawColumnDepth > 0 ? rawColumnDepth : 0;
  const explosiveWeightLb = calculateExplosiveWeightLb({
    diameterIn: hole.diameter,
    columnDepthFt: columnDepth,
    densityGcc,
  });
  let loadingWarning = null;
  if (hasDepth && rawColumnDepth <= 0) loadingWarning = "Explosive column is zero or negative.";
  else if (hasDepth && !Number.isFinite(Number(hole.diameter))) loadingWarning = "Hole diameter is required for explosive weight.";

  hole.columnDepth = columnDepth;
  hole.explosiveWeightLb = explosiveWeightLb;
  hole.loadingWarning = loadingWarning;
  hole.detonators = normalizeMaterialEntries(hole.detonators, DETONATOR_TYPES);
  hole.boosters = normalizeMaterialEntries(hole.boosters, BOOSTER_TYPES);
  return hole;
}

export function summarizeShotLoading(holes = [], densityGcc = DEFAULT_LOADING_DENSITY_GCC) {
  const detonatorCounts = new Map();
  const boosterCounts = new Map();
  let totalExplosiveWeightLb = 0;
  let includedHoleCount = 0;
  let warningHoleCount = 0;

  holes.forEach((hole) => {
    recalculateHoleLoading(hole, densityGcc);
    const weight = Number(hole.explosiveWeightLb);
    if (weight > 0) {
      totalExplosiveWeightLb += weight;
      includedHoleCount += 1;
    }
    if (hole.loadingWarning) warningHoleCount += 1;
    (hole.detonators || []).forEach((entry) => {
      detonatorCounts.set(entry.type, (detonatorCounts.get(entry.type) || 0) + normalizeQuantity(entry.quantity));
    });
    (hole.boosters || []).forEach((entry) => {
      boosterCounts.set(entry.type, (boosterCounts.get(entry.type) || 0) + normalizeQuantity(entry.quantity));
    });
  });

  return {
    totalExplosiveWeightLb,
    totalHoleCount: Array.isArray(holes) ? holes.length : 0,
    includedHoleCount,
    averageExplosiveWeightLb: includedHoleCount ? totalExplosiveWeightLb / includedHoleCount : 0,
    warningHoleCount,
    detonatorCounts,
    boosterCounts,
  };
}

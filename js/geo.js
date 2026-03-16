import proj4 from "https://cdn.jsdelivr.net/npm/proj4@2.15.0/+esm";

const FEET_TO_METERS = 0.3048;
const METERS_TO_FEET = 1 / FEET_TO_METERS;

const PROJECTION_DEFINITIONS = {
  6487: "+proj=lcc +lat_0=37.6666666666667 +lon_0=-77 +lat_1=39.45 +lat_2=38.3 +x_0=400000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
  6592: "+proj=lcc +lat_0=36.3333333333333 +lon_0=-78.5 +lat_1=36.7666666666667 +lat_2=37.9666666666667 +x_0=3500000 +y_0=2000000 +datum=NAD83 +units=m +no_defs +type=crs",
  6600: "+proj=lcc +lat_0=38.5 +lon_0=-79.5 +lat_1=40.25 +lat_2=39 +x_0=600000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
};

function normalizeEpsg(epsg) {
  const numeric = Number(epsg);
  return Number.isInteger(numeric) ? numeric : null;
}

export function normalizeStatePlaneUnit(unit) {
  const normalized = String(unit || "").trim().toLowerCase();
  if (normalized === "ft" || normalized === "foot" || normalized === "feet" || normalized === "international_feet") return "ft";
  if (normalized === "m" || normalized === "meter" || normalized === "meters") return "m";
  return "ft";
}

function registerDefinition(epsg) {
  const normalized = normalizeEpsg(epsg);
  if (!normalized || !PROJECTION_DEFINITIONS[normalized]) return false;
  const key = `EPSG:${normalized}`;
  if (!proj4.defs(key)) proj4.defs(key, PROJECTION_DEFINITIONS[normalized]);
  return true;
}

export function supportsStatePlaneEpsg(epsg) {
  return registerDefinition(epsg);
}

function statePlaneToMeters(value, unit) {
  return normalizeStatePlaneUnit(unit) === "m" ? value : value * FEET_TO_METERS;
}

function metersToStatePlane(value, unit) {
  return normalizeStatePlaneUnit(unit) === "m" ? value : value * METERS_TO_FEET;
}

export function normalizeGeoContext(geo = {}) {
  const statePlaneEpsg = normalizeEpsg(geo.statePlaneEpsg ?? geo.epsg);
  const statePlaneUnit = normalizeStatePlaneUnit(geo.statePlaneUnit ?? geo.unit);
  if (!statePlaneEpsg || !supportsStatePlaneEpsg(statePlaneEpsg)) return null;
  return {
    statePlaneEpsg,
    statePlaneUnit,
  };
}

export function statePlaneToLatLon(point, geo) {
  const context = normalizeGeoContext(geo);
  if (!context) return null;
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const source = `EPSG:${context.statePlaneEpsg}`;
  const [lon, lat] = proj4(source, "WGS84", [
    statePlaneToMeters(x, context.statePlaneUnit),
    statePlaneToMeters(y, context.statePlaneUnit),
  ]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

export function latLonToStatePlane(point, geo) {
  const context = normalizeGeoContext(geo);
  if (!context) return null;
  const lat = Number(point?.lat);
  const lon = Number(point?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const target = `EPSG:${context.statePlaneEpsg}`;
  const [xMeters, yMeters] = proj4("WGS84", target, [lon, lat]);
  if (!Number.isFinite(xMeters) || !Number.isFinite(yMeters)) return null;
  return {
    x: metersToStatePlane(xMeters, context.statePlaneUnit),
    y: metersToStatePlane(yMeters, context.statePlaneUnit),
    unit: context.statePlaneUnit,
    epsg: context.statePlaneEpsg,
  };
}

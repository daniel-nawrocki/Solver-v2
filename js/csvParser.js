import { latLonToStatePlane, normalizeGeoContext, statePlaneToLatLon } from "./geo.js";

export function parseCsvText(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      row.push(current.trim());
      current = "";
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(current.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      current = "";
    } else {
      current += ch;
    }
  }

  if (current.length || row.length) {
    row.push(current.trim());
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }

  if (!rows.length) return { headers: [], records: [] };

  const headers = rows[0];
  const records = rows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((h, index) => {
      obj[h] = cells[index] ?? "";
    });
    return obj;
  });

  return { headers, records };
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function inferId(record, idColumn, fallbackIndex) {
  if (idColumn && record[idColumn]) return String(record[idColumn]);
  return `H-${fallbackIndex + 1}`;
}

function mapExtraFields(record, fieldColumns) {
  if (!fieldColumns || typeof fieldColumns !== "object") return {};
  return Object.entries(fieldColumns).reduce((acc, [fieldName, columnName]) => {
    if (!columnName) {
      acc[fieldName] = null;
      return acc;
    }
    acc[fieldName] = toNumber(record[columnName]);
    return acc;
  }, {});
}

function buildImportedCoordinates(records, xColumn, yColumn, idColumn, fieldColumns = null, coordType = "stateplane", geoContext = null) {
  const normalizedGeo = normalizeGeoContext(geoContext);
  return records.map((record, idx) => {
    const rawX = toNumber(record[xColumn]);
    const rawY = toNumber(record[yColumn]);
    if (rawX === null || rawY === null) return null;
    let statePlane = null;
    let latLon = null;
    if (coordType === "latlon") {
      latLon = { lon: rawX, lat: rawY };
      statePlane = latLonToStatePlane(latLon, normalizedGeo);
      if (!statePlane) return null;
    } else {
      statePlane = {
        x: rawX,
        y: rawY,
        unit: normalizedGeo?.statePlaneUnit || "ft",
        epsg: normalizedGeo?.statePlaneEpsg || null,
      };
      latLon = statePlaneToLatLon(statePlane, normalizedGeo);
      if (!latLon) return null;
    }
    return {
      id: inferId(record, idColumn, idx),
      holeNumber: String(inferId(record, idColumn, idx)),
      original: { x: rawX, y: rawY },
      statePlane,
      latLon,
      x: statePlane.x,
      y: statePlane.y,
      rowId: null,
      orderInRow: null,
      sourceIndex: idx,
      ...mapExtraFields(record, fieldColumns),
    };
  }).filter(Boolean);
}

export function buildHolesFromMapping({ records, coordType, xColumn, yColumn, idColumn, fieldColumns = null, geoContext = null }) {
  if (!records?.length) return [];
  if (!xColumn || !yColumn) return [];
  return buildImportedCoordinates(records, xColumn, yColumn, idColumn, fieldColumns, coordType, geoContext);
}

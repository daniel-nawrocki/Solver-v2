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

function latLonToLocal(records, xColumn, yColumn, idColumn, fieldColumns = null) {
  const points = records.map((record, idx) => {
    const lon = toNumber(record[xColumn]);
    const lat = toNumber(record[yColumn]);
    return {
      id: inferId(record, idColumn, idx),
      original: { x: lon, y: lat },
      lat,
      lon,
      sourceIndex: idx,
      extraFields: mapExtraFields(record, fieldColumns),
    };
  }).filter((p) => p.lat !== null && p.lon !== null);

  if (!points.length) return [];

  const lat0 = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const lon0 = points.reduce((sum, p) => sum + p.lon, 0) / points.length;
  const R = 6371000;
  const cosLat = Math.cos((lat0 * Math.PI) / 180);

  return points.map((p) => {
    const dx = ((p.lon - lon0) * Math.PI / 180) * R * cosLat;
    const dy = ((p.lat - lat0) * Math.PI / 180) * R;
    return {
      id: p.id,
      holeNumber: String(p.id),
      original: { x: p.original.x, y: p.original.y },
      x: dx,
      y: dy,
      rowId: null,
      orderInRow: null,
      sourceIndex: p.sourceIndex,
      ...p.extraFields,
    };
  });
}

function statePlaneToLocal(records, xColumn, yColumn, idColumn, fieldColumns = null) {
  const points = records.map((record, idx) => {
    const x = toNumber(record[xColumn]);
    const y = toNumber(record[yColumn]);
    return {
      id: inferId(record, idColumn, idx),
      original: { x, y },
      x,
      y,
      sourceIndex: idx,
      extraFields: mapExtraFields(record, fieldColumns),
    };
  }).filter((p) => p.x !== null && p.y !== null);

  if (!points.length) return [];

  const minX = Math.min(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));

  return points.map((p) => ({
    id: p.id,
    holeNumber: String(p.id),
    original: { x: p.original.x, y: p.original.y },
    x: p.x - minX,
    y: p.y - minY,
    rowId: null,
    orderInRow: null,
    sourceIndex: p.sourceIndex,
    ...p.extraFields,
  }));
}

export function buildHolesFromMapping({ records, coordType, xColumn, yColumn, idColumn, fieldColumns = null }) {
  if (!records?.length) return [];
  if (!xColumn || !yColumn) return [];

  if (coordType === "latlon") {
    return latLonToLocal(records, xColumn, yColumn, idColumn, fieldColumns);
  }
  return statePlaneToLocal(records, xColumn, yColumn, idColumn, fieldColumns);
}

function toPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sanitizeProject(project) {
  const safeProject = toPlainObject(project);
  const timing = toPlainObject(safeProject.timing);
  const offset = toPlainObject(timing.offset);
  return {
    holes: Array.isArray(safeProject.holes) ? safeProject.holes : [],
    rows: toPlainObject(safeProject.rows),
    timing: {
      ...timing,
      offset,
    },
    centerPull: safeProject.centerPull,
  };
}

export function saveProject(state) {
  const snapshot = {
    holes: state.holes,
    rows: state.rows,
    timing: state.timing,
    centerPull: state.centerPull,
  };

  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "blast-project.json";
  a.click();
  URL.revokeObjectURL(url);
}

export async function loadProjectFile(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid project file.");
  }
  return sanitizeProject(parsed);
}

export function hydrateStateFromProject(state, project) {
  const safeProject = sanitizeProject(project);
  state.holes = safeProject.holes;
  state.holesById = new Map(state.holes.map((h) => [h.id, h]));
  state.rows = safeProject.rows;
  state.timing = {
    ...state.timing,
    ...safeProject.timing,
    offset: {
      ...state.timing.offset,
      ...(safeProject.timing.offset || {}),
    },
  };
  state.centerPull = safeProject.centerPull || state.centerPull;
  state.selection = new Set();
}

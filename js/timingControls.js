export function initTimingControls(state, els, onChange) {
  if (!state.timing.offset) state.timing.offset = { min: 17, max: 42 };
  if (!state.timing.interdeck) state.timing.interdeck = { min: 0, max: 0 };

  const syncFromState = () => {
    els.holeDelayMin.value = state.timing.holeToHole.min;
    els.holeDelayMax.value = state.timing.holeToHole.max;
    els.rowDelayMin.value = state.timing.rowToRow.min;
    els.rowDelayMax.value = state.timing.rowToRow.max;
    els.offsetDelayMin.value = state.timing.offset.min;
    els.offsetDelayMax.value = state.timing.offset.max;
    els.interdeckDelayMin.value = state.timing.interdeck.min;
    els.interdeckDelayMax.value = state.timing.interdeck.max;
  };

  const syncToState = () => {
    state.timing.holeToHole.min = Number(els.holeDelayMin.value) || 0;
    state.timing.holeToHole.max = Number(els.holeDelayMax.value) || 0;
    state.timing.rowToRow.min = Number(els.rowDelayMin.value) || 0;
    state.timing.rowToRow.max = Number(els.rowDelayMax.value) || 0;
    state.timing.offset.min = Number(els.offsetDelayMin.value) || 0;
    state.timing.offset.max = Number(els.offsetDelayMax.value) || 0;
    state.timing.interdeck.min = Number(els.interdeckDelayMin.value) || 0;
    state.timing.interdeck.max = Number(els.interdeckDelayMax.value) || 0;
    onChange();
  };

  [els.holeDelayMin, els.holeDelayMax, els.rowDelayMin, els.rowDelayMax, els.offsetDelayMin, els.offsetDelayMax, els.interdeckDelayMin, els.interdeckDelayMax].forEach((input) => {
    input.addEventListener("input", syncToState);
  });

  syncFromState();
  return { syncFromState, syncToState };
}

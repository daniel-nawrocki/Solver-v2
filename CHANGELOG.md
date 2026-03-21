# Changelog

All notable project changes are tracked here.

## Unreleased

### Added
- Diagram `Loading` menu with a global explosive density input, whole-shot explosive totals, average lb/hole, selected-hole assignment tools, and a live material summary.
- Per-hole loading editor inside Diagram `Properties` for hole depth, stemming height, derived column depth, derived explosive pounds, and multi-row detonator / booster editing.
- Loading calculation utilities in [js/loading.js](/c:/Users/danie/Desktop/Solver-supa-int/Solver-v2/js/loading.js) for:
  - cylindrical explosive-weight calculation in pounds from diameter, column depth, and density
  - per-hole loading warnings when calculated column depth is zero or negative
  - whole-shot aggregation of explosive totals and loading materials
- Shot print/export integration for loading data in the printable hole table:
  - per-hole explosive pounds
  - shot explosive total
  - detonator summary
  - booster summary
- Hole Load Profile print pages now render a visual side-view borehole graphic to scale with:
  - light grey stemming
  - light pink explosive column
  - hanging cap lines from the collar
  - booster cylinders placed through the explosive column without overlap
  - yellow `350 Shield` / `450 Shield` boosters and green non-shield boosters
  - grouped-hole profile cards based on matching load definitions

### Changed
- Hole objects now persist loading-related fields including detonators, boosters, derived column depth, derived explosive weight, and warning state.
- Project document serialization version increased to `3` so loading data is carried through save/load flows.
- Diagram state refresh now recalculates loading-derived values whenever density, depth, stemming, or loading materials change.
- User-facing loading copy now labels derived column depth as `Explosive Column` in the Diagram loading UI, warning text, and hole load profile output.
- Shot Order Sheet loading usage now removes the redundant `Number of Holes` row and keeps `Total Holes` plus `Total Emulsion` as the summary totals.
- Hole Load Profile print pages now use a wider inner charge tube with a hard grey-to-pink split, clearer hanging cap markers, and more legible booster placement inside the explosive column.
- Hole Load Profile bore graphics now remove the oval cap/booster bodies and expand the grey/pink fill to occupy more of the white borehole interior.
- Hole Load Profile booster markers now render as small cylinder-style booster shapes, and the extra cream rounded rectangle at the collar was removed from the bore graphic.
- Hole Load Profile detonator lines now terminate at the booster markers so the boosters sit on the ends of the lines instead of floating separately.
- Hole Load Profile booster cylinders now render vertically, and cap wires are staggered left/right so multiple lines remain individually visible.
- Hole Load Profile grey and pink load fills now expand to fill the outer bore shell interior instead of leaving a narrow inset column.
- Hole Load Profile load fills now clip directly to the rounded bore interior so the grey/pink areas follow the shell shape without a visible inner rectangular boundary or white gap.

## Earlier Delivered Changes

### Unified Planner Foundation
- Converted the app from a timing-only tool into a shared `Daniel Fire` planner with `Diagram` and `Timing` modes.
- Added a shared project spine so imported holes, viewport state, diagram data, and timing data persist across mode switches.
- Kept Diagram UI aligned with Delay Solver styling and menu patterns.

### Diagram Workspace
- Added a real Diagram workspace with import, selection, per-hole property editing, and shot metadata controls.
- Added bottom diagram tools for select, box select, polygon select, markup, and text annotations.
- Added face-hole designation and pattern application for face/interior burden and spacing workflows.
- Added subdrill support at both pattern level and per-hole level.
- Added whole-shot volume calculations with editable rock density.
- Added shot-corner assignment and diagram print corner-coordinate labeling.

### Print Preview
- Added shared multi-page print preview across timing and diagram workflows.
- Added printable diagram headers with shot metadata.
- Added label edit mode for repositioning diagram print labels.
- Added a label-position dial and per-page independent print settings.
- Added hole-table print pages and improved browser print layout behavior.

### Timing Workflow
- Added overlap analysis for timing results with fixed `8 ms` windows and click-to-highlight behavior.
- Updated timing ranking to prioritize lower overlap density and shorter duration.
- Added manual timing mode alongside solver mode.

### Data / Import / Geo
- Added dual-coordinate import support for local, State Plane, and lat/long coordinates.
- Added quarry EPSG/unit metadata handling and quarry-based project geo defaults.
- Added shared persistence for diagram/timing data and cloud project integration.

### Documentation
- Added and maintained [roadmap.md](/c:/Users/danie/Desktop/Solver-supa-int/Solver-v2/roadmap.md) as project memory.
- Added the repository user guide source in [HOW_TO_USE.md](/c:/Users/danie/Desktop/Solver-supa-int/Solver-v2/HOW_TO_USE.md) and generated PDF guide.

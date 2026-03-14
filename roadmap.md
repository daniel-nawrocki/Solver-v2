# Solver v2 Roadmap

## Purpose
This file is the project brain for future chat sessions.
When work is completed, this file should be updated with:
- what changed
- what is working now
- what is still missing
- what should be built next

## Product Direction
The app is no longer intended to be just a timing tool.
It is being expanded into a multi-tool blast planning program with a shared UI/UX style.

Current top-level tool goals:
- `Delay Solver`: existing timing workflow
- `Diagram Maker`: layout and hole-property workflow

Future possible directions discussed:
- richer diagram drafting
- better project persistence
- login/profile support later, likely requiring backend/auth/storage

## Current Architecture
- Single-page app built from:
  - [index.html](/c:/Users/danie/Desktop/Solver-v2/Solver-v2/index.html)
  - [styles.css](/c:/Users/danie/Desktop/Solver-v2/Solver-v2/styles.css)
  - [js/app.js](/c:/Users/danie/Desktop/Solver-v2/Solver-v2/js/app.js)
- Shared renderer:
  - [js/diagramRenderer.js](/c:/Users/danie/Desktop/Solver-v2/Solver-v2/js/diagramRenderer.js)
- Shared CSV parsing:
  - [js/csvParser.js](/c:/Users/danie/Desktop/Solver-v2/Solver-v2/js/csvParser.js)
- Delay Solver still uses timing/relationship logic from existing modules.
- Home / Delay Solver / Diagram Maker all live inside one HTML app and switch via workspace state.

## Current Snapshot
This is the current repo memory as of the latest update in this chat.

Code-level status:
- `js/app.js` was rebuilt to support both workspaces after a failed large-file replacement attempt.
- `Diagram Maker` now exists in the DOM as a real workspace, not a placeholder.
- `Diagram Maker` has its own state, renderer instance, import flow, selection flow, and property editor.
- `Print Preview` is shared, but branches behavior based on whether the active workspace is `Delay Solver` or `Diagram Maker`.
- `js/csvParser.js`, `js/diagramRenderer.js`, and `js/app.js` were syntax-parsed successfully in local checks.
- `js/app.js` DOM lookups were checked against `index.html`, and all referenced IDs were found.

What has not been fully verified yet:
- full browser interaction flow
- visual polish under real imported datasets
- whether any runtime behavior regressions remain in Delay Solver
- whether Diagram Maker labels feel crowded with dense hole layouts

## Completed Work

### 1. Home Screen Skeleton
Done.

What was added:
- app launches to `Home`
- `Home` has entries for:
  - `Delay Solver`
  - `Diagram Maker`
- shared top bar now reflects active workspace
- navigation works without page reload

Intent:
- preserve the existing visual style
- avoid introducing routing or multiple pages

### 2. Diagram Maker v1 Shell
Done at a structural level.

What exists now:
- Diagram Maker is a full workspace, not a placeholder card
- it mirrors the Delay Solver layout style
- it has its own:
  - `Import` menu
  - `View` menu
  - `Properties` menu
  - canvas
- it uses separate workspace data from Delay Solver
- it uses its own canvas: `diagramMakerCanvas`
- it reuses the shared top bar and workspace-switching model introduced for Home

### 3. Diagram Maker CSV Import
Implemented.

Diagram Maker import supports:
- collar coordinates
- optional toe coordinates
- hole id
- optional:
  - `angle`
  - `bearing`
  - `depth`

Important note:
- Strayos-style `length` can be mapped into the `Depth / Length` selector because the importer treats this as a user-mapped numeric field rather than hardcoding one vendor format.
- shared CSV parsing now supports optional extra numeric fields so Diagram Maker can import metadata without changing Delay Solver import behavior

### 4. Diagram Maker Property Editing
Implemented.

Editable per-hole properties:
- `burden`
- `spacing`
- `diameter`
- `angle`
- `bearing`
- `depth`
- `stemHeight`

Current editing behavior:
- click one hole to edit a single hole
- `Shift+click` to multi-select
- bulk edits only apply fields that were actually entered
- blank fields do not overwrite selected holes
- default hole diameter can be applied to:
  - current selection
  - all imported diagram holes if nothing is selected
- property editing lives in the `Properties` top-menu panel, not a side panel or modal

### 5. Diagram Maker Rendering
Implemented for metadata/label mode.

Current behavior:
- Diagram Maker remains point/collar-based visually
- no projected drill traces are drawn yet
- labels can show:
  - angle + bearing
  - depth
- view toggles control metadata visibility

### 6. Print Preview
Implemented as a shared print workspace with workspace-specific controls.

Delay Solver print:
- keeps relationship toggle
- behaves close to original print preview

Diagram Maker print:
- hides relationship controls
- adds separate toggles for:
  - `Angle + Bearing`
  - `Depth`
- keeps rotation, fit, text size, and color controls

### 8. Diagram Maker QoL Pass
Implemented in code.

What was added:
- print `Fit Page` now uses reserved top-space margins so content can center vertically within the printable region instead of only centering horizontally
- Diagram Maker now has separate canvas toggles for:
  - `Angle`
  - `Bearing`
  - `Bearing Arrows`
  - `Depth`
- Diagram Maker print now has separate toggles for:
  - `Angle`
  - `Bearing`
  - `Depth`
- bearing arrows are intentionally low-profile and canvas-only
- angle labels are color-coded by the supplied Word chart:
  - `5` orange
  - `10` green
  - `15` yellow
  - `20` red
  - `25` blue
  - `30` pink
- `inclination` is now treated as an import alias for `angle`
- diagram metadata labels no longer use `A`, `B`, or `D` prefixes
- displayed `bearing` and `depth` values are rounded to whole numbers

Current rule:
- accepted angle values are only `5`, `10`, `15`, `20`, `25`, `30`
- imported or edited angles outside that set normalize to `null` / unclassified

### 7. Recovery / Stability Note
Important recent context:
- a previous large replacement of `js/app.js` failed mid-edit and temporarily removed the file
- the file was then rebuilt in smaller patches and brought back to a consistent parsed state
- because of that recovery path, manual browser validation is especially important before assuming everything is stable

## Current Known Limitations
- Diagram Maker has no save/load project persistence yet.
- There is no project file format that includes Diagram Maker-specific properties yet.
- There is no profile/login system.
- Diagram Maker does not yet draw directional hole traces from angle/bearing/depth.
- No dedicated export format exists yet for Diagram Maker metadata.
- Help content is still Delay Solver-focused and has not been expanded for Diagram Maker.
- Full browser interaction testing still needs to be done manually after changes.
- Delay Solver and Diagram Maker now share more app-level wiring than before, so regressions are possible until manually exercised.
- Print preview behavior for both workspaces has been refactored and should be manually checked in both modes.
- The new print-fit behavior is syntax-validated but still needs visual confirmation with real print preview usage.
- Diagram Maker bearing arrows and color-coded labels are implemented but still need manual clutter/readability review on dense layouts.

## High-Priority Next Steps
- verify end-to-end behavior in browser:
  - Home navigation
  - Delay Solver still works
  - Diagram Maker import
  - single-select and multi-select property edits
  - print preview toggles
  - rotation and fit view in both tools
  - toe/collar switching in Diagram Maker
  - new print-fit vertical centering under reserved header space
  - separate Angle/Bearing toggles on canvas and print
  - low-profile bearing arrows on dense diagrams
  - angle color mapping and invalid-angle handling
- add Diagram Maker save/load support
- add Diagram Maker-specific CSV/export options if needed
- improve Diagram Maker labels and visual hierarchy if metadata gets crowded
- update Help content to include Diagram Maker

## Medium-Priority Future Work
- project persistence across sessions
- unified project model that can store both Delay Solver and Diagram Maker data
- dedicated Diagram Maker print layout polish
- hole trace / projected path visualization mode
- annotation tools
- additional diagram fields and validation rules

## Long-Term Ideas
- real login/auth with unique profiles
- cloud sync / multi-device storage
- more tools beyond Delay Solver and Diagram Maker

## Update Rule
Whenever meaningful work is completed, append or revise:
- `Completed Work`
- `Current Known Limitations`
- `High-Priority Next Steps`

This file should stay short, practical, and current enough that a new chat can read it and continue work without reconstructing the whole project from memory.

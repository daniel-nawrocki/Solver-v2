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

Design consistency rule:
- Diagram Maker should stay visually aligned with Delay Solver unless a future request explicitly changes that direction.
- Reuse the same top bar, floating controls, panel style, spacing, glassy menu panels, and overall interaction tone wherever possible.

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
- Print preview now uses a shared print session model with multiple independent print pages per session.

## Current Snapshot
This is the current repo memory as of the latest update in this chat.

Code-level status:
- `js/app.js` was rebuilt to support both workspaces after a failed large-file replacement attempt.
- `Diagram Maker` now exists in the DOM as a real workspace, not a placeholder.
- `Diagram Maker` has its own state, renderer instance, import flow, selection flow, and property editor.
- `Print Preview` is shared, but branches behavior based on whether the active workspace is `Delay Solver` or `Diagram Maker`.
- Diagram Maker now has a bottom selection toolkit styled to match the Delay Solver bottom controls.
- Diagram Maker now also has a bottom annotation toolkit with `Markup` and `Text` tools, plus shared color/size controls.
- Diagram Maker now has a dedicated `Shot` menu between `Import` and `View` for shot metadata.
- Diagram Maker print now includes shot metadata in the reserved top header area, with `Shot Number` as the large top-left title.
- Diagram Maker annotations now render in both the main canvas and print preview.
- Diagram Maker print now has a label-edit mode for manually repositioning per-hole print label boxes during the current print session.
- Print preview now supports multiple independently configurable pages per session for both Delay Solver and Diagram Maker.
- Adding a print page duplicates the active print page state so toggles, zoom/pan/rotation, label layouts, and color mode can diverge page by page.
- `js/app.js` and `js/diagramRenderer.js` parse successfully in local inline JS checks, but browser interaction still needs manual verification
- `js/app.js` DOM lookups were checked against `index.html`, and all referenced IDs were found.

What has not been fully verified yet:
- full browser interaction flow
- visual polish under real imported datasets
- whether any runtime behavior regressions remain in Delay Solver
- whether Diagram Maker labels feel crowded with dense hole layouts
- whether annotation readability and printed header spacing still feel balanced on dense real-world diagrams
- whether print-label drag UX and leader thresholds feel right on dense layouts in real use
- whether multi-page print switching and full browser print output behave cleanly across repeated page adds/removes

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
  - angle
  - bearing
  - depth
- view toggles control metadata visibility
- bearing arrows exist as a low-profile overlay

### 6. Print Preview
Implemented as a shared print workspace with workspace-specific controls.

Delay Solver print:
- keeps relationship toggle
- behaves close to original print preview

Diagram Maker print:
- hides relationship controls
- adds separate toggles for:
  - `Angle`
  - `Bearing`
  - `Depth`
- keeps rotation, fit, text size, and color controls
- print/export now inherits the current Diagram Maker bearing-arrow visibility setting

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

### 9. Diagram Maker Selection Toolkit
Implemented in code.

What was added:
- Diagram Maker now has a bottom toolkit matching the Delay Solver control style
- toolkit modes:
  - `Select`
  - `Box`
  - `Polygon`
- `Select` keeps existing click / `Shift+click` behavior
- `Box` drag-selects holes in screen space
- `Polygon` click-places vertices and completes with double-click or `Enter`
- `Polygon` click-places vertices and completes with right-click or `Enter`
- shape selection replaces current selection by default
- holding `Shift` while completing box/polygon selection adds to the existing selection
- temporary selection drafts can be cancelled with `Escape`

Important behavior:
- selection operates in rendered screen space, so it respects rotation and current collar/toe view
- box and polygon tools suppress canvas pan while active
- selection drafts are cleared when switching selection tools

### 10. Zero-Angle Bearing Arrow Rule
Implemented in code.

Current rule:
- holes with angle `0` do not draw bearing arrows
- holes with missing or invalid angle also do not draw bearing arrows
- holes with missing or invalid bearing do not draw bearing arrows

### 11. Diagram Maker Shot Metadata
Implemented in code.

What was added:
- new `Shot` menu between `Import` and `View`
- metadata fields:
  - `Shot Number`
  - `Location`
  - `Bench`
  - `Hole Diameter`
  - `Face Pattern`
  - `Interior Pattern`
- `Hole Diameter` now acts as the default shot-level diameter source for Diagram Maker imports and default-diameter application
- diameter display uses fraction-style labels in UI/print for the supported half-inch values

Print behavior:
- Diagram Maker print now draws a structured header in the reserved top area
- `Shot Number` is the large top-left print header
- the remaining shot metadata prints as smaller supporting lines

### 12. Diagram Maker Markup + Text Tools
Implemented in code.

What was added:
- bottom toolbar now includes:
  - `Markup`
  - `Text`
  - color picker
  - size selector
  - `Clear Markup`
  - `Clear Text`
- `Markup` supports freehand drawing directly on the diagram
- `Text` supports click-to-place text annotations
- annotations are stored in diagram world coordinates so they follow pan/zoom/rotation and print layout
- annotations render in both the main Diagram Maker canvas and print preview

Current v1 limits:
- no per-annotation selection/edit/move/resize behavior yet
- editing is intentionally limited to placing new annotations and clearing markup/text layers

### 13. Diagram Maker Print Label Edit Mode
Implemented in code.

What was added:
- Diagram Maker print preview now has:
  - `Labels`
  - `Reset Labels`
- hole print labels now render as compact draggable boxes in Diagram Maker print preview instead of fixed inline text
- label boxes include:
  - hole number
  - whichever print metadata toggles are currently enabled for:
    - angle
    - bearing
    - depth
- labels can be dragged to reduce clutter during the active print session
- leader lines appear once a label box moves far enough away from its hole
- `Reset Labels` returns all print labels to their default auto positions

Current rule:
- label edits are print-session only
- closing and reopening print preview resets the custom label layout
- label boxes are only visible while the `Labels` toggle is on, and dragging is enabled immediately when visible

### 14. Multi-Page Print Preview
Implemented in code.

What was added:
- print preview now opens as a print session with page tabs above the toolbar
- `Add Page` duplicates the active print page and activates the new copy
- each print page now keeps its own:
  - zoom / pan / rotation
  - text scale
  - color / greyscale mode
  - workspace-specific print toggles
  - Diagram Maker label-edit state and label positions
- pages can be removed from the strip as long as at least one page remains
- browser print now prepares all print pages and outputs them as separate sheets in the current page order
- print CSS now targets the generated print-page output so the hidden live preview stage should not produce extra blank sheets

Current rule:
- main workspace edits do not overwrite existing print pages after print preview is opened
- print-page names are fixed `Page 1`, `Page 2`, etc. for now

### 15. Diagram Maker Import Rounding for Bearing + Depth
Implemented in code.

Current rule:
- Diagram Maker CSV import now rounds `bearing` to a whole number when imported
- Diagram Maker CSV import now rounds `depth` to a whole number when imported
- manual property edits still accept non-rounded numeric values outside the import flow

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
- Diagram Maker shot metadata and annotations are in-memory only and are not persisted yet.
- Diagram Maker print label edits are session-only and are not persisted yet.
- Multi-page print sessions are in-memory only and are not persisted yet.
- Help content is still Delay Solver-focused and has not been expanded for Diagram Maker.
- Full browser interaction testing still needs to be done manually after changes.
- Delay Solver and Diagram Maker now share more app-level wiring than before, so regressions are possible until manually exercised.
- Print preview behavior for both workspaces has been refactored and should be manually checked in both modes.
- The new print-fit behavior is syntax-validated but still needs visual confirmation with real print preview usage.
- Diagram Maker bearing arrows and color-coded labels are implemented but still need manual clutter/readability review on dense layouts.
- Diagram Maker box/polygon selection is implemented in code but still needs manual interaction testing with real layouts.
- Polygon selection UX may still need polish, but completion now uses right-click instead of double-click.
- Diagram Maker annotation tools still need manual testing for drag feel, clutter, and print readability with real datasets.
- Multi-page print add/remove/switch behavior and browser print sheet ordering still need manual testing.
- Real browser print dialogs still need confirmation that blank interstitial pages are gone.

## High-Priority Next Steps
- verify end-to-end behavior in browser:
  - Home navigation
  - Delay Solver still works
  - Diagram Maker import
  - Diagram Maker shot metadata entry
  - default shot diameter behavior during import and `Apply Default Diameter`
  - single-select and multi-select property edits
  - markup drawing tool
  - text placement tool
  - color and size controls for annotations
  - `Clear Markup` and `Clear Text`
  - print preview toggles
  - printed shot metadata header
  - printed markup/text visibility
  - print label edit mode
  - drag behavior for label boxes
  - leader line behavior when labels move away from holes
  - `Reset Labels`
  - label layout persistence only within the active print session
  - single `Labels` toggle behavior:
    - hidden when off
    - visible and draggable when on
    - `Reset Labels` only shown when on
  - multi-page print flow:
    - `Add Page`
    - page switching
    - per-page independent toggles
    - per-page independent zoom / pan / rotation
    - per-page independent color mode
    - page removal
    - browser print output order across multiple pages
    - no blank pages between printed sheets
  - rotation and fit view in both tools
  - toe/collar switching in Diagram Maker
  - new print-fit vertical centering under reserved header space
  - separate Angle/Bearing toggles on canvas and print
  - low-profile bearing arrows on dense diagrams
  - angle color mapping and invalid-angle handling
  - selection toolkit behavior:
    - select mode
    - box mode
    - polygon mode
    - `Shift` add behavior
    - `Escape` cancel behavior
    - right-click polygon completion
    - `Enter` polygon completion
    - no unwanted panning while selection tools are active
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
- `Current Snapshot` if the architecture or workflow meaningfully changes

## Resume Notes
If a new chat starts, it should read this file first.

Most important current repo facts to preserve:
- This is a single-page multi-workspace app.
- Delay Solver is the established reference for UI style.
- Diagram Maker should continue matching that style unless explicitly changed.
- Shared renderer logic lives in `js/diagramRenderer.js`.
- Shared app/workspace wiring lives in `js/app.js`.
- Shared CSV parsing lives in `js/csvParser.js`.
- Shared print preview now uses a multi-page print session managed in `js/app.js`.
- Diagram Maker currently supports:
  - import with collar/toe/id/angle/bearing/depth
  - `inclination` alias for angle import guessing
  - shot metadata entry for print/header context
  - per-hole and multi-hole property editing
  - discrete angle colors
  - separate angle/bearing/depth visibility toggles
  - low-profile bearing arrows
  - bottom selection toolkit with select/box/polygon tools
  - bottom annotation toolkit with markup/text plus color/size controls
  - shared print preview with Diagram Maker-specific toggles
  - print header with shot metadata
  - markup/text annotations that also print
  - print-preview label edit mode with draggable label boxes and leaders
  - multi-page print preview with per-page independent print state

This file should stay short, practical, and current enough that a new chat can read it and continue work without reconstructing the whole project from memory.

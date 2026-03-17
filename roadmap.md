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
- `Daniel Fire`: unified workspace with:
  - `Diagram` mode for layout / metadata / annotation workflow
  - `Timing` mode for pathing / timing-range / firing-time workflow

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
- A shared project spine now mirrors imported holes, diagram data, and timing data across modes so Diagram and Timing can switch without separate imports.

## Current Snapshot
This is the current repo memory as of the latest update in this chat.

Code-level status:
- `js/app.js` was rebuilt to support both workspaces after a failed large-file replacement attempt.
- `Diagram Maker` now exists in the DOM as a real workspace, not a placeholder.
- `Diagram Maker` has its own state, renderer instance, import flow, selection flow, and property editor.
- the app now has a centered top-bar mode toggle that switches between `Diagram` and `Timing` while syncing through a shared project state
- Home now presents a single `Daniel Fire` entry point instead of two separate tool cards
- `Print Preview` is shared, but branches behavior based on whether the active workspace is `Delay Solver` or `Diagram Maker`.
- Diagram Maker now has a bottom selection toolkit styled to match the Delay Solver bottom controls.
- Diagram Maker now also has a bottom annotation toolkit with `Markup` and `Text` tools, plus shared color/size controls.
- Diagram Maker now has a dedicated `Shot` menu between `Import` and `View` for shot metadata.
- Diagram Maker print now includes shot metadata in the reserved top header area, with `Shot Number` as the large top-left title.
- Diagram Maker annotations now render in both the main canvas and print preview.
- Diagram Maker print now has a label-edit mode for manually repositioning per-hole print label boxes during the current print session.
- Print preview now supports multiple independently configurable pages per session for both Delay Solver and Diagram Maker.
- Adding a print page duplicates the active print page state so toggles, zoom/pan/rotation, label layouts, and color mode can diverge page by page.
- main-canvas viewport state now persists across `Diagram` / `Timing` mode switches so the layout should stay in the same screen position while switching modes
- Diagram Maker `Shot` menu pattern entry now uses numeric `Face` / `Interior` burden x spacing pairs instead of free-text pattern labels.
- Diagram Maker now supports `Assign Face` via polygon designation plus `Apply Pattern` to overwrite burden/spacing from the stored face/interior pattern pairs.
- per-hole face designation now persists in the shared project so pattern assignment survives mode switches until cleared or redefined.
- Diagram Maker now defaults missing angles to `0` while still suppressing angle labels and bearing arrows for zero-angle holes.
- Diagram Maker `Assign Face` now keeps the `Shot` menu open while polygon designation is active.
- Diagram Maker now includes a `Volume` menu with whole-shot cubic-yard and tonnage totals using editable rock density.
- Diagram Maker `View` menu checkbox rows were cleaned up so the checkbox and label text sit on the same line.
- Diagram Maker now supports `Subdrill` as a pattern-level input plus a per-hole editable field in both Hole Properties and the hole popup editor.
- Diagram Maker volume totals now exclude subdrill by using burden x spacing x (depth - subdrill) for cubic yards and tonnage.
- print CSS was simplified so print preview now outputs one sheet per page tab without the extra blank/overflow pages seen in browser PDF export.
- repo documentation now includes a tracked end-user guide source at `HOW_TO_USE.md` plus a generated `Daniel Fire - How to Use.pdf`
- Timing Results now includes an `Overlap Analysis` view with fixed `8 ms` firing-bin bars and click-to-highlight timing holes for the selected bin.
- timing-result ranking now prioritizes lower peak fixed-`8 ms` bin density, then lower overlap-group count, then shorter total duration.
- Timing overlap analysis rows were restyled into a cleaner horizontal bar-chart presentation while keeping the current bin-click highlight workflow.
- Diagram print preview now includes a circular `Label Position` dial that rotates the default label anchor direction for all labels on the active print page.
- Diagram polygon-selection drafts now store vertices in world coordinates so placed points stay fixed relative to holes during pan/zoom/scroll/rotation.
- the planner now carries quarry geospatial metadata with assigned State Plane EPSG + unit defaults for the supported quarry list
- hole import now builds a dual-coordinate foundation so each imported hole can retain local render coordinates, State Plane coordinates, and lat/long coordinates together
- State Plane import is now treated as international feet (`ft`) and converted through the quarry EPSG definition internally
- Diagram `Shot` metadata now shows the active quarry EPSG/unit and supports saving four ordered shot-corner hole assignments
- Diagram print preview now has a separate `Show Corner Coords` toggle that renders saved shot-corner lat/long boxes independently from normal hole labels
- shot-corner print coordinate boxes are draggable in print label-edit mode and keep their own independent layout offsets
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
- whether the new face designation / pattern assignment flow feels clear enough without additional face highlighting on dense diagrams
- whether the new `Volume` menu totals and density workflow feel clear enough in real use
- whether the new subdrill pattern/default workflow feels clear enough when mixing pattern-applied values with per-hole overrides
- whether the new shared-project mode switching feels seamless enough even though the legacy workspace sections still exist behind the scenes
- whether the centered top-bar mode toggle remains visually stable across all desktop/mobile header states in real browser use
- whether Timing overlap-bin chart counts, labels, and click-to-highlight behavior feel clear enough on real solved timing graphs
- whether the new print label-position dial feels intuitive enough while preserving drag-based fine tuning on dense diagrams
- whether world-space polygon drafting now feels stable enough during aggressive pan/zoom/rotation in real use
- whether all three supported quarry EPSG definitions convert accurately for real shot datasets in browser use
- whether changing the selected quarry after import reprojects existing dual-coordinate hole data cleanly enough for real projects
- whether shot-corner assignment UX should stay as four fixed slots or needs a more visual designation flow before print labeling is added
- whether corner-coordinate print boxes need their own placement defaults or additional styling on dense diagrams

## Completed Work

### 1. Home Screen Skeleton
Done.

What was added:
- app launches to `Home`
- `Home` now has one unified entry:
  - `Daniel Fire`
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
- accepted drawable angle values are `5`, `10`, `15`, `20`, `25`, `30`
- `0` is also accepted as the default no-angle value
- imported or edited angles outside that set normalize to `0`

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
  - face burden
  - face spacing
  - interior burden
  - interior spacing
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
  - `Edit Labels`
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
- label boxes are only visible while the `Edit Labels` toggle is on, and dragging is enabled immediately when visible

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
  - Diagram Maker bearing-arrow weight and length
  - Diagram Maker label-edit state and label positions
- pages can be removed from the strip as long as at least one page remains
- browser print now prepares all print pages and outputs them as separate sheets in the current page order
- print CSS now targets the generated print-page output so the hidden live preview stage should not produce extra blank sheets
- Diagram Maker print preview now includes a separate bearing-arrow length slider alongside arrow weight

Current rule:
- main workspace edits do not overwrite existing print pages after print preview is opened
- print-page names are fixed `Page 1`, `Page 2`, etc. for now

### 15. Diagram Maker Import Rounding for Bearing + Depth
Implemented in code.

Current rule:
- Diagram Maker CSV import now rounds `bearing` to a whole number when imported
- Diagram Maker CSV import now rounds `depth` to a whole number when imported
- manual property edits still accept non-rounded numeric values outside the import flow

### 16. Shared Planner Mode Toggle + Shared Project Spine
Implemented as an incremental merge path.

What was added:
- Home now opens a single `Daniel Fire` entry
- top bar now includes centered `Diagram` / `Timing` mode buttons
- imports in either mode now initialize one shared project hole set
- switching modes now hydrates the target mode from the shared project instead of requiring a second import
- timing origin / relationships / ranges / results persist across mode switches
- diagram metadata / properties / annotations persist across mode switches
- optional `angle` / `bearing` / `depth` mapping now exists in the Timing-mode import panel too so either mode can seed the same shared project data
- shared main-canvas viewport state now persists across mode switches

Current rule:
- the underlying DOM still uses the legacy Delay Solver and Diagram Maker workspace sections for safety
- the user-facing workflow is now intended to be one planner with two modes, not two unrelated tools

### 17. Diagram Print Can Add Timing Page
Implemented in code.

What was added:
- Diagram print preview now exposes `Add Timing Page` when timing results exist in the shared project
- timing print pages are generated from the shared timing result selection without leaving Diagram mode

### 18. Diagram Pattern Assignment via Burden x Spacing
Implemented in code.

What was added:
- `Shot` menu pattern entry now uses four numeric inputs:
  - face burden
  - face spacing
  - interior burden
  - interior spacing
- `Assign Face` puts Diagram Maker into a polygon face-designation flow
- completing the polygon stores a persisted face-hole set on the current project holes
- `Clear Face` removes the stored face designation
- `Apply Pattern` overwrites per-hole burden/spacing using:
  - face pattern for designated face holes
  - interior pattern for all other holes
- print header pattern text is now derived from the numeric burden x spacing pairs instead of free-text metadata

Current rule:
- face designation persists across Diagram / Timing mode switches until cleared, redefined, or replaced by a new import
- applying patterns is explicit and does not auto-run when pattern values change
- applying patterns requires all four pattern numbers plus at least one designated face hole

### 19. Print Preview Blank-Page Fix
Implemented in code.

What changed:
- print CSS no longer relies on the previous global visibility-hiding approach
- print preview now prints the generated page-tab output in normal flow while hiding only non-print UI

Intent:
- ensure one printed sheet per print page tab
- avoid the extra mostly blank overflow pages seen in browser PDF export

### 20. Diagram Angle Default + Volume Menu
Implemented in code.

What was added:
- missing or invalid Diagram hole angles now normalize to `0`
- zero-angle holes still suppress angle label output and bearing arrows
- `Assign Face` now keeps the `Shot` menu open while polygon designation is active
- new `Volume` menu to the right of `Properties`
- whole-shot totals now show:
  - included hole count
  - cubic yards
  - tons
- rock density now defaults to `2.3` tons / cubic yard and is editable in the `Volume` menu
- Diagram `View` checkbox rows now render inline with their labels instead of stacking awkwardly

Current rule:
- only holes with valid burden, spacing, and depth contribute to the shot volume totals
- tons are calculated from total cubic yards multiplied by the current rock density
- density persists in Diagram shot metadata across mode switches
- zero angle is treated as the default no-angle state, not as a drawable classified angle

### 21. Repository User Guide PDF
Implemented in repo documentation.

What was added:
- a tracked end-user guide source at [HOW_TO_USE.md](/c:/Users/danie/Desktop/Solver-v2/Solver-v2/HOW_TO_USE.md)
- a local PDF generator script at [tools/generate_how_to_use_pdf.py](/c:/Users/danie/Desktop/Solver-v2/Solver-v2/tools/generate_how_to_use_pdf.py)
- a generated repository guide PDF at [Daniel Fire - How to Use.pdf](/c:/Users/danie/Desktop/Solver-v2/Solver-v2/Daniel%20Fire%20-%20How%20to%20Use.pdf)

Current rule:
- the PDF is intended as the current full-site how-to reference for the repo
- regenerate it by running `python tools\generate_how_to_use_pdf.py`
- the in-app Help page is still older content and does not yet match the PDF guide

### 22. Timing Overlap Analysis + Overlap-Based Result Ranking
Implemented in code.

What was added:
- Timing Results now includes an `Overlap Analysis` toggle below the result list
- the analysis view builds fixed `8 ms` firing bins from the active timing result
- each bin shows:
  - period label
  - hole count
  - scaled count bar
- clicking a bin highlights only the holes firing in that selected `8 ms` period on the timing canvas
- `Clear Highlight` removes the active overlap-bin highlight without clearing the selected timing result
- switching timing results clears the active overlap highlight while keeping the analysis panel available
- timing-result ranking now sorts by:
  - lowest peak fixed `8 ms` bin count
  - lowest overlap-group count
  - shortest total duration
  - smallest combined base delays as fallback

Current rule:
- overlap groups are counted by fixed `8 ms` bins with more than one firing hole
- overlap highlighting is analysis-only UI state and is not persisted across sessions/mode hydration
- the previous sliding-window `peak in 8ms` ordering is no longer the primary ranking model

### 23. Timing Chart Refresh + Print Label Dial + Stable Polygon Drafts
Implemented in code.

What was added:
- Timing overlap analysis now renders as a cleaner horizontal bar-chart style list while keeping the existing bin-click highlight interaction
- Diagram print preview now includes a circular `Label Position` dial in the print controls
- the dial now drives a true circular orbit instead of the earlier angle-dependent in/out drift
- the dial applies to all labels on the active Diagram print page and uses continuous `360°` placement
- label drag offsets are still preserved and now apply on top of the dial-based default label direction
- `Reset Labels` still clears custom drag offsets while respecting the current dial angle
- Diagram polygon-selection and face-designation drafts now store vertices/hover points in world coordinates instead of screen coordinates

Current rule:
- changing the print label dial does not clear existing manual label drag offsets
- duplicated print pages preserve the current label dial angle because it is part of per-page print state
- label distance is now controlled separately from dial rotation
- polygon draft points should now remain fixed relative to holes during pan/zoom/rotation until the draft is completed or cancelled

### 24. Diagram Print Distance Stepper + Corner Coordinate Labeling
Implemented in code.

What was added:
- Diagram print preview label distance is now adjustable from the same `Label Position` tool as the dial
- the distance control now uses a compact `- / tick / +` stepper instead of a raw slider
- the distance scale now maps:
  - tick `0` to `-15 px`
  - tick `35` to `20 px`
  - default new Diagram print pages to tick `3`
- corner coordinate print panels now include their source hole label above `Lat` / `Lon`
- corner coordinate print panels no longer draw leader lines when dragged away from their source hole
- normal hole print labels still draw leader lines once moved far enough away
- the print header / toolbar sizing was tightened for better browser viewing at normal zoom
- a malformed print-stepper CSS block that temporarily broke the Diagram Maker bottom toolbar was fixed

Current rule:
- duplicated print pages preserve the current label-distance state because it remains part of per-page print state
- existing print pages keep their current distance value unless a new Diagram print page is created
- the distance stepper updates the same underlying label spacing state used by print label layout and manual drag offsets

### 25. Pattern Menu Move + Subdrill Support
Implemented in code.

What was added:
- face/interior pattern controls now live in a dedicated `Pattern` menu between `Import` and `View`
- Diagram Maker now has a pattern-level `Subdrill` field in feet
- `Apply Pattern` now applies the stored subdrill value to holes along with burden/spacing
- per-hole `Subdrill` is editable from both the `Properties` menu and the hole popup editor
- Diagram print header now includes subdrill when set
- shot volume and tonnage now exclude subdrill by using only the effective charged rock height above floor

Current rule:
- volume uses burden x spacing x (depth - subdrill)
- holes only contribute to volume when burden, spacing, and depth are valid and the effective depth remains greater than zero
- subdrill remains editable per hole after pattern assignment, so hole-specific overrides are allowed

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
- the in-app Help page is still Delay Solver-focused and has not been expanded to match the current planner, even though a repository PDF guide now exists.
- Diagram Maker face designation currently has no dedicated visual highlighting beyond selection/status, so dense layouts may need a later clarity pass.
- Volume totals currently show whole-shot output only; there is no per-hole tonnage UI yet.
- Full browser interaction testing still needs to be done manually after changes.
- Delay Solver and Diagram Maker now share more app-level wiring than before, so regressions are possible until manually exercised.
- the unified planner still relies on the legacy separate workspace DOM internally, so cleanup remains to be done later
- Print preview behavior for both workspaces has been refactored and should be manually checked in both modes.
- The new print-fit behavior is syntax-validated but still needs visual confirmation with real print preview usage.
- Diagram Maker bearing arrows and color-coded labels are implemented but still need manual clutter/readability review on dense layouts.
- Diagram Maker box/polygon selection is implemented in code but still needs manual interaction testing with real layouts.
- Polygon selection UX may still need polish, but completion now uses right-click instead of double-click.
- Diagram Maker annotation tools still need manual testing for drag feel, clutter, and print readability with real datasets.
- Multi-page print add/remove/switch behavior and browser print sheet ordering still need manual testing.
- Real browser print dialogs still need confirmation that blank interstitial pages are gone.
- shared-project mode switching, import parity, and print timing-page behavior all need manual browser verification
- centered mode-toggle layout still needs manual responsive/browser verification
- Timing overlap chart interactions and overlap-based result ordering still need manual browser verification with real timing graphs
- print label dial interaction, true circular orbit behavior, distance stepper behavior, and dial-plus-distance-plus-drag placement still need manual browser verification
- world-space polygon drafting still needs manual browser verification across zoom/pan/rotation

## High-Priority Next Steps
- verify end-to-end behavior in browser:
  - single `Daniel Fire` home entry flow
  - top-bar `Diagram` / `Timing` mode switch
  - centered top-bar mode-toggle layout stability
  - persistence of diagram edits across mode switches
  - persistence of timing graph/results across mode switches
  - persistence of canvas zoom/pan position across mode switches
  - Home navigation
  - Delay Solver still works
  - Diagram Maker import
  - Diagram Maker shot metadata entry
  - default shot diameter behavior during import and `Apply Default Diameter`
  - face/interior burden x spacing entry in the `Shot` menu
  - `Assign Face` polygon workflow
  - `Clear Face`
  - `Apply Pattern`
  - persistence of the designated face set across mode switches
  - overwrite behavior for burden/spacing after repeated pattern applies
  - zero-angle default behavior for imports and manual angle edits
  - `Shot` menu staying open during `Assign Face`
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
  - print bearing-arrow controls:
    - weight slider
    - length slider
    - independent per print page
  - multi-page print flow:
    - `Add Page`
    - page switching
    - per-page independent toggles
    - per-page independent zoom / pan / rotation
    - per-page independent color mode
    - page removal
    - browser print output order across multiple pages
    - no blank pages between printed sheets
    - `Add Timing Page` from Diagram print when timing results exist
  - rotation and fit view in both tools
  - toe/collar switching in Diagram Maker
  - new print-fit vertical centering under reserved header space
  - separate Angle/Bearing toggles on canvas and print
  - low-profile bearing arrows on dense diagrams
  - angle color mapping and invalid-angle handling
  - `View` menu checkbox alignment
  - `Volume` menu totals and density edits
  - pattern-level `Subdrill` entry, `Apply Pattern` subdrill assignment, and per-hole subdrill edits
  - volume exclusion of subdrill from cubic yards / tonnage
  - selection toolkit behavior:
    - select mode
    - box mode
    - polygon mode
    - `Shift` add behavior
    - `Escape` cancel behavior
    - right-click polygon completion
    - `Enter` polygon completion
    - no unwanted panning while selection tools are active
  - Timing Results overlap analysis:
    - analysis toggle visibility after timing solve
    - fixed `8 ms` bin chart labels and counts
    - active-bin hole highlighting
    - `Clear Highlight` behavior
    - highlight reset on timing-result switch
    - overlap-group counts in result summaries
    - overlap-based timing-result ordering against expected field preferences
  - Diagram print label-position dial:
    - dial visibility on Diagram print pages only
    - continuous `360°` label repositioning
    - drag offsets preserved after dial changes
    - `Reset Labels` honoring the current dial angle
    - per-page independent dial angle across duplicated/switched print pages
  - polygon drafting stability:
    - placed polygon vertices remain fixed relative to holes during pan/zoom/rotation
    - hover segment stability during navigation
    - selection and face-designation completion still target the intended holes
- add Diagram Maker save/load support
- add Diagram Maker-specific CSV/export options if needed
- improve Diagram Maker labels and visual hierarchy if metadata gets crowded
- update the in-app Help content to match the current unified planner workflow and the repository PDF guide

## Medium-Priority Future Work
- project persistence across sessions
- unified project model that can store both Delay Solver and Diagram Maker data
- dedicated Diagram Maker print layout polish
- hole trace / projected path visualization mode
- annotation tools
- additional diagram fields and validation rules
- expanded in-app Help menu / content for the unified planner
- manual timing tool
- better presentation / layout for the pattern and diameter box area
- tonnage calculator

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
- Delay Solver remains the established reference for UI style, but the user-facing workflow is now one unified `Daniel Fire` planner.
- Diagram mode should continue matching the established solver style unless explicitly changed.
- Shared renderer logic lives in `js/diagramRenderer.js`.
- Shared app/workspace wiring lives in `js/app.js`.
- Shared CSV parsing lives in `js/csvParser.js`.
- Shared print preview now uses a multi-page print session managed in `js/app.js`.
- The planner now uses a shared project spine so imports, diagram data, timing data, and viewport state persist across `Diagram` / `Timing` mode switches.
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

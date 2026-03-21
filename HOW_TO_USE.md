# Daniel Fire User Guide

## Overview

Daniel Fire is a blast-planning workspace with two main modes:

- `Diagram` for layout, metadata, burden/spacing assignment, annotations, and print preparation
- `Timing` for relationship pathing, timing ranges, solving, previewing, and timing print pages

The app uses a shared project spine, so imported holes, diagram edits, timing data, and view state can carry across mode switches.

## Start Here

1. Open the home screen.
2. Enter the planner through `Diagram` if you need to import or edit the shot layout.
3. Enter `Timing` when you are ready to define relationships and generate timing results.
4. Use `Print` when you want page-tab output for diagram pages, timing pages, or a mixed print session.

## Diagram Mode

Diagram mode is where the shot is imported and prepared.

### Import

Use the `Import` menu to bring in a CSV.

- Supported core columns are collar coordinates, toe coordinates, and hole id.
- Optional columns include `angle`, `bearing`, and `depth`.
- If angle is missing or invalid, Daniel Fire defaults it to `0`.
- `0` angle is treated as no real angle for display purposes, so it will not draw angle labels or bearing arrows.

After import:

- the hole set becomes the shared project hole set
- the view can be switched between `Collar` and `Toe`
- a fresh import resets diagram-specific project metadata and face designation

### Shot Menu

Use `Shot` to manage shot-level metadata and pattern assignment.

Fields:

- `Shot Number`
- `Location`
- `Bench`
- `Hole Diameter`

Pattern assignment uses two numeric burden x spacing pairs:

- `Face Pattern`
- `Interior Pattern`

Buttons:

- `Assign Face`
- `Clear Face`
- `Apply Pattern`

Typical pattern workflow:

1. Enter all four numeric pattern values.
2. Click `Assign Face`.
3. Draw a polygon around the face holes on the diagram.
4. Click `Apply Pattern`.

What happens on apply:

- face-designated holes receive the face burden and spacing
- all other holes receive the interior burden and spacing
- existing burden and spacing values are overwritten

The face designation persists until you redefine it, clear it, or import a new project.

### View Menu

Use `View` to control how the shot is displayed.

Options include:

- `Show Grid`
- `Show Angle`
- `Show Bearing`
- `Show Bearing Arrows`
- `Show Depth`
- `Fit View`
- `Coordinate View`
- rotation controls for coarse and fine rotation
- `Reset Rotation`

### Properties Menu

Use `Properties` to edit the currently selected holes.

Editable fields:

- `Burden`
- `Spacing`
- `Diameter`
- `Angle`
- `Bearing`
- `Depth`
- `Stem Height`

When exactly one hole is selected, the same menu also shows a `Selected Hole Loading` section where you can:

- edit `Hole Depth`
- edit `Stemming Height`
- review calculated `Column Depth`
- review calculated `Explosive Weight`
- add or remove detonator rows
- add or remove booster rows

Selection behavior:

- click a hole to select it
- `Shift` + click to add or remove holes from the selection
- use `Apply to Selection` to write changes
- use `Clear Selection` to clear the current selection

Default diameter behavior:

- choose a shot-level `Hole Diameter` in the `Shot` menu
- use `Apply Default Diameter` in `Properties` to push that diameter to the selected holes or, if nothing is selected, to the full shot

### Loading Menu

Use `Loading` for shot-level explosive calculations and broad loading assignment.

Inputs and behavior:

- `Density (g/cc)` is one global value for the active shot
- each hole uses its own `Diameter`, `Depth`, and `Stem Height`
- `Column Depth` is calculated as `depth - stemming height`
- explosive weight is calculated as a cylinder and converted to pounds

The menu shows:

- `Total Explosive Weight`
- `Holes Included`
- `Average lb/hole`
- a selected-hole assignment area for detonators
- a selected-hole assignment area for boosters
- a live material summary for the full shot

Broad assignment workflow:

- select one or more holes on the diagram
- add one or more detonator rows and booster rows in `Loading`
- click `Apply to Selected Holes`
- edit any individual hole later in `Properties`

If a hole has zero or negative column depth, its explosive weight is set to `0 lb` and the hole is flagged in the single-hole loading section.

### Volume Menu

Use `Volume` for whole-shot volume and tonnage totals.

The app calculates per-hole cubic yards as:

`(burden * spacing * depth) / 27`

Then it sums all valid holes to show:

- `Included Holes`
- `Total Cubic Yards`
- `Total Tons`

Tons are calculated as:

`total cubic yards * rock density`

Current default density is:

`2.3 tons / cubic yard`

Notes:

- Volume totals are whole-shot totals, not per-hole output.
- Holes with missing burden, spacing, or depth are excluded from the total.
- Changing properties or applying a pattern updates the volume summary.
- Changing loading density, hole depth, stemming height, detonators, or boosters updates the loading summary immediately.

### Diagram Tools

The floating toolkit supports:

- `Select`
- `Box`
- `Polygon`
- `Markup`
- `Text`

Additional annotation controls let you choose:

- annotation color
- annotation size
- `Clear Markup`
- `Clear Text`

Tool behavior:

- `Select` is for single and shift multi-select
- `Box` selects holes inside a dragged rectangle
- `Polygon` selects holes inside a drawn polygon
- `Markup` draws freehand lines in diagram world coordinates
- `Text` places text annotations on the diagram

Annotations follow pan, zoom, rotation, and print layout.

## Timing Mode

Timing mode uses the shared project hole set and focuses on relationship pathing and timing output.

Typical workflow:

1. Switch to `Timing`.
2. Select an origin hole.
3. Draw timing relationships.
4. Enter H2H, R2R, and offset timing ranges.
5. Run the solver.
6. Review timing results and preview a selection.
7. Simulate the active timing if needed.

Timing data persists across mode switches inside the current session.

## Print Preview

Print preview is shared across the planner and uses page tabs.

Main controls:

- `Back`
- `Print`
- `Fit Page`
- `Edit Labels`
- `Reset Labels`
- `Add Page`
- `Add Timing Page` when timing results exist

Print controls can include:

- text size
- color mode
- relationship visibility
- angle visibility
- bearing visibility
- bearing arrow weight
- bearing arrow length
- depth visibility

Important behavior:

- each print tab is an independent page
- adding a page duplicates the active page state
- page-specific zoom, pan, rotation, toggles, and label edits can diverge per page
- print label edits are session-only and reset when print preview closes

Diagram print pages include:

- shot metadata header
- diagram labels
- markup and text annotations
- optional angle, bearing, and depth labels

Timing print pages can be added from Diagram print when timing results already exist in the shared project.

## Recommended Workflow

For a normal blast layout:

1. Import the CSV in `Diagram`.
2. Set shot metadata in `Shot`.
3. Set the default hole diameter.
4. Designate face holes and apply the face/interior pattern.
5. Review and adjust burden, spacing, depth, angle, or bearing in `Properties`.
6. Check whole-shot totals in `Volume`.
7. Add markup or text annotations if needed.
8. Switch to `Timing` and build relationships.
9. Solve and review timing results.
10. Open `Print` and assemble the required page tabs.

## Tips

- If angle labels or bearing arrows are missing, check whether the hole angle is `0`.
- If volume looks low, confirm burden, spacing, and depth are present on the holes you expect to count.
- If `Apply Pattern` does nothing, make sure all four pattern inputs are filled and at least one face hole is designated.
- If you want a clean page variant, duplicate a print page and adjust only that tab.

## Current Limits

As of this guide:

- project persistence to disk is still limited
- print label edits are only stored for the current print session
- multi-page print sessions are in-memory only
- volume is shown as whole-shot totals only
- the built-in Help page is still older timing-focused content and does not fully reflect the current planner

## Quick Reference

- `Diagram`: import, edit, annotate, pattern, print prep
- `Timing`: relationships, timing ranges, solve, preview
- `Shot`: metadata, default diameter, face/interior pattern
- `View`: display toggles and rotation
- `Properties`: selected-hole edits
- `Volume`: whole-shot cubic yards and tons
- `Print`: multi-page print session with per-tab settings

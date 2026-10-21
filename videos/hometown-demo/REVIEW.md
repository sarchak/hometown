# Review note, hometown-demo

## Creative calls
- One continuous Playwright take of the live site (record.mjs writes rec/markers.json) rather than one clip per scene: the agent run cannot be replayed on demand, so scenes are cut from the single take by marker, and the waiting stretches (the agent working) play sped up, capped at 4x, so each reveal lands on its narration cue at 1x.
- Paper-and-ink look taken from the product itself: paper #EEF0EA, ink #14213D, route red #D7263D, Barlow Condensed. The one motif is the product's own dashed red route through numbered stops, wiped on with a clip-path (the dash pattern survives, which a dash-offset draw-on would not).
- Lower-third cards sit top right over the map (the Atlantic) for the city, crowd, memo and follow-up scenes, where the run sheet and tour book carry the content; bottom right for the two scenes whose book area is still empty.
- Storylines not built: a "two acts side by side" comparison (Khruangbin vs Nikki Glaser) and a map-only flyover. Both would have hidden the run sheet, which is the Qloo provenance the judges score.

## Measured vs looked at
- `check` passes with 0 errors; the 11 warnings are all `nested_structure_needs_subcomposition` / `timeline_track_too_dense` (single root composition, as in the paypal demo); kept for the build-script approach, at the cost of Studio editability.
- Contact sheets reviewed at every beat and seam; frames 0.3, 4.2, 5.6, 26, 32, 40, 58.5, 73, 93, 95, 96 s looked at individually.
- Sound: narration only (no HeyGen sign-in and no local music model on this machine, so no music bed). Measured, not heard.

## Weakest shot
- The markets scene plays its 5.9 s of source at 0.5x to fill the 13 s narration; the dots and grid appear slowly rather than "in seconds". A second take with a longer hold after the markets grid would let it play at 1x.

## Warnings kept on purpose
- Single-file composition warnings, see above.

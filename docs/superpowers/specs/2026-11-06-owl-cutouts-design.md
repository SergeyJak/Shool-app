# Clean transparent mascot assets

The user confirmed that the problem is unwanted background around characters/images, not the illustrated map scenes. Auditing the owl pack on coloured backgrounds found that 24 named 512px PNGs retained brown/grey rectangles and fragments of neighbouring sprites despite having alpha channels.

Restore all 24 named poses using image editing with genuine transparency, preserve the mascot identity/poses/accessories, repair cropped outlines, and export one complete owl per existing 512px asset path. The source atlas is only an editing/export intermediate outside the repository. Keep the existing map mascot cutout and full-scene backgrounds intact. No CSS masking or blending that would conceal the defect on only one background colour.

Check every cutout on light and dark backgrounds and inspect feather/accessory edges. Verify transparency in browser canvas and the actual helper/celebration UI, missing-image/console health, mobile/desktop layout, and existing game/progress behavior. Cache-bust the changed live assets so merged changes replace cached images.

Verification: the alpha browser regression failed against the original images and passed after restoration. All 24 served assets pass dimension, transparent-padding and visible-content checks. Mobile/desktop helper, mobile celebration and the full light/dark gallery were visually inspected. `npm test` passed 339 tests; `test:adventure-levels` passed all 470 rounds. Independent visual/code review approved the cutouts and reran the alpha browser check successfully. Existing dashboard character cutouts were also inspected and were already clean; full-scene illustrations are intentionally opaque.

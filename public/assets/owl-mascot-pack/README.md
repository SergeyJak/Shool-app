# Owl mascot cutouts

The 24 named `owl-*.png` poses are 512×512 transparent PNGs. They are complete, isolated characters with safe transparent padding; brown/grey backgrounds and neighbouring sprite fragments were removed by restoring the supplied artwork with image editing. Poses and accessories retain their original purpose.

The restored atlases were exported into individual sprites, framed consistently, and stripped of intermediate metadata. Editing references and intermediate atlases are not runtime assets and are not included here. The larger `file_0000000067bc821099b46abef82451ed.png` remains the existing map mascot.

Use normal alpha compositing, without blend modes or coloured background masks. When replacing a live pose, update its URL version and the referring script version to invalidate browser caches.

Run `npm run test:owl-assets` to check the served images' dimensions, transparent padding, alpha coverage, and live helper/celebration rendering. It also produces a light/dark gallery outside the repository for visual inspection.

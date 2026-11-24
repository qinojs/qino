# cms.cont.gallery.masonry

Add images and videos to the block's files; they are shown in file-list order. A video plays
like a moving photo — muted, in a loop, its first frame as poster when ffmpeg is there. `u2-masonry` keeps
proportions; a click opens the original in a `u2-lightbox` (with `u2-carousel`).

`cms-image` handles responsive loading and previews. Adjust the layout with u2's
`--u2-Items-width` and `gap`, or the optional `col-width` setting (e.g. `11em`, `33vw`). No
module-specific JavaScript.

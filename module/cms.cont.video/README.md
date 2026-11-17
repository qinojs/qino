# cms.cont.video

Drop a video file on the block: the first video in its files plays in a native `<video>`, the
first image is the poster — without one, the video's first frame (if ffmpeg is installed). The file is served as is, with byte ranges — no transcoding, so keep
clips short and web-ready (MP4/H.264 or WebM).

Settings: `controls` (on by default), `autoplay` (always muted, browsers allow nothing else),
`muted`, `loop`. Only the metadata is preloaded — autoplay loads the rest anyway.

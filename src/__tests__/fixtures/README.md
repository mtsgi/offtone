The three tagged audio files are generated synthetic 440 Hz sine waves (0.15 s) with FFmpeg,
with the text tags “Fixture Title”, “Fixture Artist”, and “Fixture Album”, track 7 of 13,
and disc 2 of 3. The MP3
also contains a solid red 32 × 32 JPEG generated with FFmpeg. `untagged.mp3` is a 0.1 s sine wave with no title. They contain no
third-party recordings or artwork and may be redistributed under CC0-1.0.

`japanese.m4a` and `japanese.flac` use the same audio streams with UTF-8 tags
“夜の音楽”, “青い空”, “春の歌”, and “日本合唱団”, also written with FFmpeg.
The metadata tests construct ID3 variants over the untagged MP3 audio stream.

# Bundled video fonts

The renderer draws frames with Skia inside a slim Node container that ships no
system fonts, and a font that silently falls back changes every measurement in
the layout. These faces are therefore **bundled with the app** and registered
from disk before the first frame is drawn, so a preview frame and an exported
4K frame are laid out with exactly the same glyphs.

| File | Family | Weight | Used for |
| --- | --- | --- | --- |
| `space-grotesk-600.ttf` | Space Grotesk | 600 | titles, section labels |
| `space-grotesk-700.ttf` | Space Grotesk | 700 | opening hook, key results |
| `inter-400.ttf` | Inter | 400 | body copy |
| `inter-500.ttf` | Inter | 500 | explanations, captions |
| `inter-600.ttf` | Inter | 600 | secondary labels, emphasis |
| `jetbrains-mono-400.ttf` | JetBrains Mono | 400 | code, indices |
| `jetbrains-mono-600.ttf` | JetBrains Mono | 600 | algorithm state, counters |

The browser UI loads the same files through `@font-face` in `src/styles.css`, so
the editor preview and the exported video share one typographic system.

All three families are licensed under the SIL Open Font License 1.1; the licence
texts sit next to the fonts (`OFL-*.txt`). The files are the Latin subsets served
by Google Fonts and are unmodified.

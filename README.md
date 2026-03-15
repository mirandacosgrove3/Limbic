# Limbic Pocket

Mobile-first songwriting workspace for fast idea capture:

- chord progression editing with diatonic, borrowed, and custom chord picks
- melody piano roll with scale snap, drag/resize editing, and chord-tone coloring
- lyrics tied to bars with syllable counts
- section-based arrangement editing
- song idea generation by genre, mood, complexity, key, and tempo
- WebAudio playback with pads, bass, drums, looping, and live edit refresh
- export to JSON, MIDI, and WAV

## Run

This app is fully static and has no install step.

1. Start a local server from the project root:

```bash
python3 -m http.server 4173
```

2. Open [http://127.0.0.1:4173](http://127.0.0.1:4173) in a browser.

You can also use:

```bash
npm run serve
```

## Verify

```bash
npm run check
```

## File Layout

- `index.html`: app shell and sheets
- `styles.css`: mobile UI and editor styling
- `src/dataModel.js`: song, section, chord, note, and lyric factories
- `src/musicTheoryEngine.js`: scale/chord logic, suggestions, transposition, syllables
- `src/songGenerator.js`: structure, progression, melody, and regeneration logic
- `src/playbackEngine.js`: arrangement flattening, accompaniment generation, and transport
- `src/exportSystem.js`: JSON, MIDI, and WAV export
- `src/uiEditor.js`: interaction layer and state orchestration

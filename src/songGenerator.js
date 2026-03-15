import {
  createChord,
  createLyricsLine,
  createNote,
  createSection,
  createSong,
  getBeatsPerBar,
} from "./dataModel.js";
import {
  autoSuggestChords,
  getDiatonicChords,
  getNoteIndex,
  getScaleNotes,
  snapPitchToScale,
} from "./musicTheoryEngine.js";

const STRUCTURES = {
  simple: ["Verse", "Chorus", "Verse", "Chorus", "Outro"],
  balanced: ["Intro", "Verse", "PreChorus", "Chorus", "Verse", "Chorus", "Bridge", "Chorus", "Outro"],
  adventurous: [
    "Intro",
    "Verse",
    "PreChorus",
    "Chorus",
    "Verse",
    "PreChorus",
    "Chorus",
    "Bridge",
    "Chorus",
    "Outro",
  ],
};

const TEMPLATES = {
  pop: ["I V vi IV", "vi IV I V", "I vi IV V", "I IV V"],
  rock: ["I V IV I", "vi IV I V", "I IV V", "I bVII IV I"],
  hiphop: ["vi IV I V", "ii V I", "i VI III VII", "i iv VII"],
  electronic: ["i VI III VII", "vi IV I V", "I V vi IV", "ii V I"],
};

const MOOD_SCALE = {
  bright: "major",
  moody: "minor",
  anthemic: "mixolydian",
  dreamy: "dorian",
};

const SECTION_LENGTHS = {
  Intro: 4,
  Verse: 8,
  PreChorus: 4,
  Chorus: 8,
  Bridge: 4,
  Outro: 4,
};

const STYLE_PRESETS = {
  pop: { chordStyle: "block", bassPattern: "octave", drumPreset: "pop" },
  rock: { chordStyle: "strum", bassPattern: "root", drumPreset: "rock" },
  hiphop: { chordStyle: "block", bassPattern: "walking", drumPreset: "hiphop" },
  electronic: { chordStyle: "arpeggio", bassPattern: "octave", drumPreset: "electronic" },
};

function clampTempo(value, min = 50, max = 200) {
  return Math.min(max, Math.max(min, value));
}

function parseTempoRange(tempoRange = "95-124") {
  const [minimum, maximum] = String(tempoRange)
    .split("-")
    .map((piece) => Number.parseInt(piece.trim(), 10))
    .filter((value) => Number.isFinite(value));

  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    return [95, 124];
  }

  return [Math.min(minimum, maximum), Math.max(minimum, maximum)];
}

function chooseTemplate(genre, sectionName, scaleType) {
  const bank = TEMPLATES[genre] || TEMPLATES.pop;
  if (sectionName === "Chorus") {
    return bank[0];
  }
  if (sectionName === "Bridge") {
    return scaleType === "major" ? bank[bank.length - 1] : bank[Math.max(1, bank.length - 2)];
  }
  if (sectionName === "PreChorus") {
    return bank[Math.min(1, bank.length - 1)];
  }
  return bank[(sectionName.length + bank.length) % bank.length];
}

function romanDegreeToChord(token, key, scaleType) {
  const diatonic = getDiatonicChords(key, scaleType);
  const direct = diatonic.find((candidate) => candidate.roman === token);
  if (direct) {
    return direct;
  }

  if (token === "bVII") {
    const tonicIndex = getNoteIndex(key);
    return { root: ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"][(tonicIndex + 10) % 12], quality: "major", extension: "" };
  }

  if (token === "i") {
    return { root: key, quality: "minor", extension: "" };
  }

  return diatonic[0];
}

function buildProgressionFromTemplate(template, song, lengthInBars) {
  const beatsPerBar = getBeatsPerBar(song);
  const tokens = template.split(/\s+/).filter(Boolean);
  const totalBeats = lengthInBars * beatsPerBar;
  const baseDuration = Math.max(1, Math.floor(totalBeats / tokens.length));
  const remainder = totalBeats - baseDuration * tokens.length;

  return tokens.map((token, index) => {
    const chordDef = romanDegreeToChord(token, song.key, song.scaleType);
    return createChord({
      root: chordDef.root,
      quality: chordDef.quality,
      extension: chordDef.extension || "",
      durationInBeats: baseDuration + (index < remainder ? 1 : 0),
      inversion: 0,
    });
  });
}

function generateMelodyForSection(section, song) {
  const beatsPerBar = getBeatsPerBar(song);
  const scaleNotes = getScaleNotes(song.key, song.scaleType).map((note) => getNoteIndex(note));
  const notes = [];
  let beatCursor = 0;

  section.chordProgression.forEach((chord, chordIndex) => {
    const steps = Math.max(1, Math.round(chord.durationInBeats / 2));
    const rootIndex = getNoteIndex(chord.root);
    const pitchBase = 60 + rootIndex;
    for (let step = 0; step < steps; step += 1) {
      const melodicOffset = (chordIndex + step) % 3 === 0 ? 7 : step % 2 === 0 ? 4 : 0;
      const unsnappedPitch = pitchBase + melodicOffset + (step % 2 === 0 ? 0 : 12);
      const pitch = snapPitchToScale(unsnappedPitch, song.key, song.scaleType);
      notes.push(
        createNote({
          pitch,
          startBeat: beatCursor + step * 2,
          duration: Math.min(1.5, chord.durationInBeats / steps),
          velocity: 0.75,
        }),
      );
    }
    beatCursor += chord.durationInBeats;
  });

  if (notes.length === 0) {
    notes.push(
      createNote({
        pitch: snapPitchToScale(60 + scaleNotes[0], song.key, song.scaleType),
        duration: beatsPerBar,
      }),
    );
  }

  return notes;
}

function defaultLyrics(sectionName, lengthInBars) {
  return [
    createLyricsLine({ text: `${sectionName} image`, barIndex: 0 }),
    createLyricsLine({ text: "Hook the phrase to the groove", barIndex: Math.max(0, lengthInBars / 2 - 1) }),
    createLyricsLine({ text: "Land the title on the downbeat", barIndex: Math.max(0, lengthInBars - 1) }),
  ];
}

function buildSection(sectionName, song, genre) {
  const lengthInBars = SECTION_LENGTHS[sectionName] || 4;
  const template = chooseTemplate(genre, sectionName, song.scaleType);
  const chordProgression = buildProgressionFromTemplate(template, song, lengthInBars);
  const section = createSection({
    name: sectionName,
    lengthInBars,
    chordProgression,
    accompanimentStyle: { ...STYLE_PRESETS[genre] },
    lyricsLines: defaultLyrics(sectionName, lengthInBars),
  });

  section.melodyNotes = generateMelodyForSection(section, song);
  return section;
}

export function generateSongIdea({
  genre = "pop",
  mood = "bright",
  complexity = "balanced",
  key = "C",
  tempoRange = "95-124",
}) {
  const scaleType = MOOD_SCALE[mood] || "major";
  const [tempoMin, tempoMax] = parseTempoRange(tempoRange);
  const seed = genre.length * 13 + mood.length * 7 + complexity.length * 11 + key.length;
  const tempo = clampTempo(Math.round((tempoMin + tempoMax) / 2 + (seed % 9) - 4));

  const song = createSong({
    title: `${capitalize(mood)} ${capitalize(genre)} Sketch`,
    key,
    scaleType,
    tempo,
    sections: [],
  });

  song.sections = (STRUCTURES[complexity] || STRUCTURES.balanced).map((sectionName) =>
    buildSection(sectionName, song, genre),
  );

  return song;
}

export function regenerateProgressions(song, options = {}) {
  const genre = options.genre || "pop";
  song.sections = song.sections.map((section) => {
    const template = chooseTemplate(genre, section.name, song.scaleType);
    return {
      ...section,
      chordProgression: buildProgressionFromTemplate(template, song, section.lengthInBars),
    };
  });
  return song;
}

export function regenerateMelodies(song) {
  song.sections = song.sections.map((section) => ({
    ...section,
    melodyNotes: generateMelodyForSection(section, song),
  }));
  return song;
}

export function regenerateEntireSong(song, options = {}) {
  const rebuilt = generateSongIdea({
    genre: options.genre || "pop",
    mood: options.mood || "bright",
    complexity: options.complexity || "balanced",
    key: options.key || song.key,
    tempoRange: options.tempoRange || `${song.tempo - 8}-${song.tempo + 12}`,
  });
  rebuilt.id = song.id;
  return rebuilt;
}

export function regenerateSectionFromMelody(section, song) {
  return {
    ...section,
    chordProgression: autoSuggestChords(section.melodyNotes, song, section.lengthInBars),
  };
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

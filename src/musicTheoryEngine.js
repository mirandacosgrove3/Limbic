import { createChord, getBeatsPerBar } from "./dataModel.js";

export const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

const NOTE_ALIASES = {
  Db: "C#",
  "D#": "Eb",
  Gb: "F#",
  "G#": "Ab",
  "A#": "Bb",
  Cb: "B",
  "B#": "C",
  Fb: "E",
  "E#": "F",
  Am: "A",
};

const SCALE_INTERVALS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

const DIATONIC_QUALITIES = {
  major: [
    ["I", "major"],
    ["ii", "minor"],
    ["iii", "minor"],
    ["IV", "major"],
    ["V", "major"],
    ["vi", "minor"],
    ["vii°", "diminished"],
  ],
  minor: [
    ["i", "minor"],
    ["ii°", "diminished"],
    ["III", "major"],
    ["iv", "minor"],
    ["v", "minor"],
    ["VI", "major"],
    ["VII", "major"],
  ],
  dorian: [
    ["i", "minor"],
    ["ii", "minor"],
    ["III", "major"],
    ["IV", "major"],
    ["v", "minor"],
    ["vi°", "diminished"],
    ["VII", "major"],
  ],
  mixolydian: [
    ["I", "major"],
    ["ii", "minor"],
    ["iii°", "diminished"],
    ["IV", "major"],
    ["v", "minor"],
    ["vi", "minor"],
    ["VII", "major"],
  ],
};

const COMMON_MOVES = {
  I: ["vi", "IV", "V", "ii"],
  i: ["VI", "iv", "VII", "ii°"],
  ii: ["V", "IV", "I", "vi"],
  "ii°": ["V", "i", "III"],
  iii: ["vi", "IV", "ii"],
  III: ["VI", "iv", "VII"],
  IV: ["I", "V", "ii", "vi"],
  iv: ["i", "VII", "VI", "v"],
  V: ["I", "vi", "IV", "ii"],
  v: ["i", "VI", "iv", "VII"],
  vi: ["IV", "I", "V", "ii"],
  VI: ["III", "VII", "iv", "i"],
  VII: ["III", "iv", "i", "VI"],
  "vii°": ["I", "iii", "vi"],
};

const CHORD_INTERVALS = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
};

const EXTENSION_INTERVALS = {
  "": [],
  "7": [10],
  maj7: [11],
  "9": [10, 14],
  add9: [14],
  dim7: [9],
};

export function normalizeNoteName(note) {
  return NOTE_ALIASES[note] || note;
}

export function formatNoteName(note, options = {}) {
  const normalized = normalizeNoteName(note);
  const accidentalPreference = options.accidentalPreference || "sharps";
  const naming = options.noteNaming || "english";
  const flatMap = {
    "C#": "Db",
    Eb: "Eb",
    "F#": "Gb",
    Ab: "Ab",
    Bb: "Bb",
  };
  const chosen =
    accidentalPreference === "flats" ? flatMap[normalized] || normalized : normalized;

  if (naming === "german") {
    const germanMap = {
      B: "H",
      Bb: "B",
    };
    return germanMap[chosen] || chosen;
  }

  if (naming === "solfege") {
    const solfegeMap = {
      C: "Do",
      "C#": "Di",
      Db: "Ra",
      D: "Re",
      Eb: "Me",
      E: "Mi",
      F: "Fa",
      "F#": "Fi",
      Gb: "Se",
      G: "Sol",
      Ab: "Le",
      A: "La",
      Bb: "Te",
      B: "Ti",
    };
    return solfegeMap[chosen] || chosen;
  }

  return chosen;
}

export function getNoteIndex(note) {
  return NOTE_NAMES.indexOf(normalizeNoteName(note));
}

export function transposeNote(note, interval) {
  const index = getNoteIndex(note);
  if (index < 0) {
    return note;
  }
  const normalized = (index + interval + 120) % 12;
  return NOTE_NAMES[normalized];
}

export function getScaleNotes(key = "C", scaleType = "major") {
  const tonicIndex = getNoteIndex(key);
  const intervals = SCALE_INTERVALS[scaleType] || SCALE_INTERVALS.major;
  return intervals.map((interval) => NOTE_NAMES[(tonicIndex + interval) % 12]);
}

export function getDiatonicChords(key = "C", scaleType = "major") {
  const notes = getScaleNotes(key, scaleType);
  const degrees = DIATONIC_QUALITIES[scaleType] || DIATONIC_QUALITIES.major;
  return notes.map((root, index) => ({
    roman: degrees[index][0],
    root,
    quality: degrees[index][1],
    extension: defaultExtensionForDegree(degrees[index][0]),
  }));
}

export function getBorrowedChords(key = "C", scaleType = "major") {
  const parallel =
    scaleType === "minor"
      ? [
          { roman: "IV", degreeOffset: 3, quality: "major" },
          { roman: "V", degreeOffset: 4, quality: "major", extension: "7" },
          { roman: "bII", degreeOffset: 1, chromatic: true, quality: "major" },
        ]
      : [
          { roman: "iv", degreeOffset: 3, quality: "minor" },
          { roman: "bIII", degreeOffset: 2, chromatic: true, quality: "major" },
          { roman: "bVI", degreeOffset: 5, chromatic: true, quality: "major" },
          { roman: "bVII", degreeOffset: 6, chromatic: true, quality: "major" },
        ];

  const scaleNotes = getScaleNotes(key, scaleType);
  const tonicIndex = getNoteIndex(key);
  return parallel.map((borrowed) => {
    const root = borrowed.chromatic
      ? NOTE_NAMES[(tonicIndex + chromaticOffsetForRoman(borrowed.roman)) % 12]
      : scaleNotes[borrowed.degreeOffset];
    return {
      roman: borrowed.roman,
      root,
      quality: borrowed.quality,
      extension: borrowed.extension || "",
    };
  });
}

function chromaticOffsetForRoman(roman) {
  switch (roman) {
    case "bII":
      return 1;
    case "bIII":
      return 3;
    case "bVI":
      return 8;
    case "bVII":
      return 10;
    default:
      return 0;
  }
}

function defaultExtensionForDegree(roman) {
  if (roman === "I") {
    return "maj7";
  }
  if (roman === "V" || roman === "v") {
    return "7";
  }
  return "";
}

export function getChordDisplayName(chord) {
  const root = normalizeNoteName(chord.root);
  const quality =
    chord.quality === "minor"
      ? "m"
      : chord.quality === "diminished"
        ? "dim"
        : chord.quality === "augmented"
          ? "aug"
          : "";

  if (chord.extension === "sus2" || chord.extension === "sus4") {
    return `${root}${chord.extension}`;
  }

  return `${root}${quality}${chord.extension || ""}`;
}

export function getChordIntervals(chord) {
  if (chord.extension === "sus2") {
    return [0, 2, 7];
  }
  if (chord.extension === "sus4") {
    return [0, 5, 7];
  }
  const triad = CHORD_INTERVALS[chord.quality] || CHORD_INTERVALS.major;
  return [...triad, ...(EXTENSION_INTERVALS[chord.extension] || [])];
}

export function getChordToneClasses(chord) {
  const rootIndex = getNoteIndex(chord.root);
  return getChordIntervals(chord).map((interval) => (rootIndex + interval) % 12);
}

export function chordToMidi(chord, baseOctave = 4) {
  const rootIndex = getNoteIndex(chord.root);
  const midiRoot = 12 * (baseOctave + 1) + rootIndex;
  const pitches = getChordIntervals(chord).map((interval) => midiRoot + interval);

  for (let inversion = 0; inversion < (chord.inversion || 0); inversion += 1) {
    if (pitches.length > 0) {
      pitches.push(pitches.shift() + 12);
    }
  }

  return pitches;
}

function romanToCandidate(roman, palette) {
  return palette.find((chord) => chord.roman === roman) || null;
}

export function matchChordToRoman(chord, key = "C", scaleType = "major") {
  const palette = [...getDiatonicChords(key, scaleType), ...getBorrowedChords(key, scaleType)];
  return (
    palette.find(
      (candidate) =>
        candidate.root === chord.root &&
        candidate.quality === chord.quality &&
        (candidate.extension === chord.extension || !candidate.extension),
    )?.roman || null
  );
}

export function describeRomanFunction(roman = "") {
  if (!roman) {
    return "Color chord";
  }
  if (/^I|^i/.test(roman)) {
    return "Tonic center";
  }
  if (/V|vii/.test(roman)) {
    return "Dominant pull";
  }
  if (/IV|ii|iv|VI/.test(roman)) {
    return "Predominant motion";
  }
  return "Color chord";
}

export function suggestNextChords({
  currentKey = "C",
  scaleType = "major",
  previousChord = null,
  progressionHistory = [],
}) {
  const palette = [...getDiatonicChords(currentKey, scaleType), ...getBorrowedChords(currentKey, scaleType)];

  if (!previousChord) {
    return palette.slice(0, 4).map((candidate) => createChord(candidate));
  }

  const roman = matchChordToRoman(previousChord, currentKey, scaleType) || "I";
  const primaryMoves = COMMON_MOVES[roman] || ["IV", "V", "vi", "ii"];

  const circleTarget = transposeNote(previousChord.root, 7);
  const circleMove = palette.find((candidate) => candidate.root === circleTarget);
  const historyRoots = new Set(progressionHistory.slice(-3).map((chord) => chord.root));

  const suggestions = primaryMoves
    .map((move) => romanToCandidate(move, palette))
    .filter(Boolean)
    .concat(circleMove ? [circleMove] : [])
    .concat(getBorrowedChords(currentKey, scaleType).slice(0, 2))
    .filter((candidate, index, array) => {
      const alreadySeen =
        array.findIndex(
          (item) =>
            item.root === candidate.root &&
            item.quality === candidate.quality &&
            item.extension === candidate.extension,
        ) !== index;
      return !alreadySeen && !historyRoots.has(candidate.root);
    });

  return suggestions.slice(0, 6).map((candidate) => createChord(candidate));
}

function nearestScalePitch(pitch, scaleClasses) {
  let bestPitch = pitch;
  let bestDistance = Infinity;
  for (let offset = -4; offset <= 4; offset += 1) {
    const candidate = pitch + offset;
    if (scaleClasses.includes(((candidate % 12) + 12) % 12)) {
      const distance = Math.abs(offset);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPitch = candidate;
      }
    }
  }
  return bestPitch;
}

export function snapPitchToScale(pitch, key = "C", scaleType = "major") {
  const scaleClasses = getScaleNotes(key, scaleType).map((note) => getNoteIndex(note));
  return nearestScalePitch(pitch, scaleClasses);
}

export function getChordAtBeat(section, beat, song) {
  const beatsPerBar = getBeatsPerBar(song);
  const sectionEndBeat = section.lengthInBars * beatsPerBar;
  const targetBeat = Math.max(0, Math.min(beat, sectionEndBeat - 0.001));

  let cursor = 0;
  for (let index = 0; index < section.chordProgression.length; index += 1) {
    const chord = section.chordProgression[index];
    const nextCursor = cursor + chord.durationInBeats;
    if (targetBeat < nextCursor || index === section.chordProgression.length - 1) {
      return {
        chord,
        index,
        startBeat: cursor,
        endBeat: Math.min(nextCursor, sectionEndBeat),
      };
    }
    cursor = nextCursor;
  }

  return {
    chord: section.chordProgression[0],
    index: 0,
    startBeat: 0,
    endBeat: section.chordProgression[0]?.durationInBeats || beatsPerBar,
  };
}

export function autoSuggestChords(melodyNotes, song, barCount = null) {
  const beatsPerBar = getBeatsPerBar(song);
  const candidatePalette = [
    ...getDiatonicChords(song.key, song.scaleType),
    ...getBorrowedChords(song.key, song.scaleType),
  ].map((candidate) => createChord({ ...candidate, durationInBeats: beatsPerBar }));

  if (!melodyNotes || melodyNotes.length === 0) {
    return candidatePalette.slice(0, 4);
  }

  const totalBars =
    barCount ||
    Math.max(1, Math.ceil(Math.max(...melodyNotes.map((note) => note.startBeat + note.duration)) / beatsPerBar));

  return Array.from({ length: totalBars }, (_, barIndex) => {
    const startBeat = barIndex * beatsPerBar;
    const endBeat = startBeat + beatsPerBar;
    const notesInBar = melodyNotes.filter(
      (note) => note.startBeat < endBeat && note.startBeat + note.duration > startBeat,
    );

    let bestCandidate = candidatePalette[0];
    let bestScore = Number.NEGATIVE_INFINITY;

    candidatePalette.forEach((candidate) => {
      const chordTones = getChordToneClasses(candidate);
      const scaleTones = getScaleNotes(song.key, song.scaleType).map((note) => getNoteIndex(note));
      const score = notesInBar.reduce((runningScore, note) => {
        const pitchClass = ((note.pitch % 12) + 12) % 12;
        if (chordTones.includes(pitchClass)) {
          return runningScore + 3;
        }
        if (scaleTones.includes(pitchClass)) {
          return runningScore + 1;
        }
        return runningScore - 2;
      }, 0);

      const rootPitchClass = getNoteIndex(candidate.root);
      const accentBonus = notesInBar.some(
        (note) => ((note.pitch % 12) + 12) % 12 === rootPitchClass && note.startBeat === startBeat,
      )
        ? 2
        : 0;

      if (score + accentBonus > bestScore) {
        bestScore = score + accentBonus;
        bestCandidate = candidate;
      }
    });

    return createChord({
      ...bestCandidate,
      durationInBeats: beatsPerBar,
    });
  });
}

export function transposeChord(chord, interval) {
  return {
    ...chord,
    root: transposeNote(chord.root, interval),
  };
}

export function transposeProgression(progression, interval) {
  return progression.map((chord) => transposeChord(chord, interval));
}

export function countSyllables(text) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return 0;
  }

  return words.reduce((count, word) => {
    if (word.length <= 3) {
      return count + 1;
    }
    const normalized = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
    const matches = normalized.match(/[aeiouy]{1,2}/g);
    return count + Math.max(1, matches ? matches.length : 1);
  }, 0);
}

export function describeBarPosition(song, beat) {
  const beatsPerBar = getBeatsPerBar(song);
  const bar = Math.floor(beat / beatsPerBar) + 1;
  const beatInBar = (beat % beatsPerBar) + 1;
  return `Bar ${bar}.${beatInBar.toFixed(0)}`;
}

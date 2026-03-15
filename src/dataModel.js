const SECTION_TYPES = ["Intro", "Verse", "PreChorus", "Chorus", "Bridge", "Outro", "Custom"];

let localCounter = 0;

function createId(prefix) {
  localCounter += 1;
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${localCounter}`;
}

export function getSectionTypes() {
  return [...SECTION_TYPES];
}

export function createDrumPercLane(overrides = {}) {
  return {
    id: createId("perc"),
    name: overrides.name ?? "Perc",
    variant: overrides.variant ?? "texture",
    steps: [...(overrides.steps ?? [])],
    ...overrides,
  };
}

export function createDrumSequence(overrides = {}) {
  return {
    kit: overrides.kit ?? overrides.preset ?? "pop",
    stepsPerBar: overrides.stepsPerBar ?? 16,
    patternBars: overrides.patternBars ?? null,
    initialized: overrides.initialized ?? false,
    mutedRows: [...(overrides.mutedRows ?? [])],
    soloRows: [...(overrides.soloRows ?? [])],
    rows: {
      kick: [...(overrides.rows?.kick ?? [])],
      snare: [...(overrides.rows?.snare ?? [])],
      hat: [...(overrides.rows?.hat ?? [])],
      openHat: [...(overrides.rows?.openHat ?? [])],
      clap: [...(overrides.rows?.clap ?? [])],
    },
    percLanes: (overrides.percLanes ?? []).map((lane) => createDrumPercLane(lane)),
    ...overrides,
  };
}

export function getDrumPatternBars(section, sequence) {
  const sectionBars = Math.max(1, Number(section?.lengthInBars) || Number(section?.bars) || 4);
  const rawPatternBars = Number(sequence?.patternBars);
  const normalizedPatternBars = Number.isFinite(rawPatternBars) && rawPatternBars > 0
    ? Math.round(rawPatternBars * 2) / 2
    : sectionBars;
  return Math.max(0.5, Math.min(sectionBars, normalizedPatternBars));
}

export function createChord(overrides = {}) {
  const duration = overrides.durationBeats ?? overrides.durationInBeats ?? 4;
  return {
    id: createId("chord"),
    root: "C",
    quality: "major",
    extension: "",
    suspension: "",
    inversion: 0,
    slashBass: "",
    durationInBeats: duration,
    durationBeats: duration,
    startBar: overrides.startBar ?? 0,
    startBeat: overrides.startBeat ?? 0,
    ...overrides,
  };
}

export function createNote(overrides = {}) {
  const duration = overrides.durationBeats ?? overrides.duration ?? 1;
  return {
    id: createId("note"),
    pitch: 60,
    startBar: overrides.startBar ?? 0,
    startBeat: overrides.startBeat ?? 0,
    duration: duration,
    durationBeats: duration,
    velocity: 0.8,
    muted: false,
    ...overrides,
  };
}

export function createLyricsLine(overrides = {}) {
  return {
    id: createId("line"),
    text: "",
    syllableCount: 0,
    syllables: overrides.syllables ?? overrides.syllableCount ?? 0,
    barIndex: 0,
    startBar: overrides.startBar ?? overrides.barIndex ?? 0,
    endBar: overrides.endBar ?? overrides.barIndex ?? 0,
    altVersions: overrides.altVersions ?? [],
    ...overrides,
  };
}

export function createAccompanimentStyle(overrides = {}) {
  return {
    chordStyle: "block",
    bassPattern: overrides.bassStyle ?? "root",
    bassStyle: overrides.bassStyle ?? overrides.bassPattern ?? "root",
    drumPreset: overrides.drumStyle ?? "pop",
    drumStyle: overrides.drumStyle ?? overrides.drumPreset ?? "pop",
    instrumentFlavor: "piano",
    density: 0.5,
    energy: 0.5,
    mutedLayers: [],
    soloLayers: [],
    layerVolumes: {
      chords: 0.9,
      bass: 0.9,
      drums: 0.9,
      melody: 1,
    },
    ...overrides,
  };
}

export function createSection(overrides = {}) {
  const bars = overrides.bars ?? overrides.lengthInBars ?? 4;
  const sectionName = overrides.label ?? overrides.name ?? "Verse";
  const type = overrides.type ?? normalizeSectionType(sectionName);
  return {
    id: createId("section"),
    name: sectionName,
    label: sectionName,
    type,
    lengthInBars: bars,
    bars,
    repeatCount: overrides.repeatCount ?? 1,
    localKey: overrides.localKey,
    localMeter: overrides.localMeter,
    variationOf: overrides.variationOf ?? null,
    intensityTag: overrides.intensityTag ?? "medium",
    chordProgression: [],
    chords: overrides.chords ?? overrides.chordProgression ?? [],
    melodyNotes: [],
    melody: overrides.melody ?? overrides.melodyNotes ?? [],
    bassNotes: [],
    bass: overrides.bass ?? overrides.bassNotes ?? [],
    bassNotesInitialized: overrides.bassNotesInitialized ?? false,
    lyricsLines: [],
    lyrics: overrides.lyrics ?? overrides.lyricsLines ?? [],
    drumSequence: createDrumSequence(),
    drums: createDrumSequence(overrides.drums ?? overrides.drumSequence),
    accompanimentStyle: createAccompanimentStyle(),
    accompaniment: createAccompanimentStyle(overrides.accompaniment ?? overrides.accompanimentStyle),
    ...overrides,
  };
}

export function createSong(overrides = {}) {
  const defaultSection = createSection({
    name: "Verse",
    lengthInBars: 4,
  });

  return {
    id: createId("song"),
    title: "",
    tempo: 108,
    key: "C",
    scaleType: "major",
    scale: overrides.scale ?? overrides.scaleType ?? "major",
    sections: [defaultSection],
    arrangementOrder: overrides.arrangementOrder ?? [defaultSection.id],
    settings: {
      noteNaming: "english",
      accidentalPreference: "sharps",
      showRomanNumerals: true,
      showChordTones: true,
      defaultSectionLength: 4,
      defaultQuantizeFeel: "straight",
      defaultAccompanimentPreset: "pop",
      densityMode: "balanced",
      ...overrides.settings,
    },
    ...overrides,
    timeSignature: "4/4",
    meter: "4/4",
  };
}

export function cloneSong(song) {
  if (typeof structuredClone === "function") {
    return structuredClone(song);
  }
  return JSON.parse(JSON.stringify(song));
}

export function ensureChordRootFormat(chord) {
  if (!chord) {
    return chord;
  }
  const normalizedRoot = chord.root.endsWith("m") && chord.quality === "minor"
    ? chord.root.slice(0, -1)
    : chord.root;

  return {
    ...chord,
    root: normalizedRoot,
  };
}

export function sanitizeSong(song) {
  const safeSong = cloneSong(song);
  const normalizedSections = (safeSong.sections || []).map((section) => ({
    ...createSection(),
    ...section,
    label: section.label ?? section.name ?? "Verse",
    name: section.name ?? section.label ?? "Verse",
    type: section.type ?? normalizeSectionType(section.name ?? section.label ?? "Verse"),
    bars: section.bars ?? section.lengthInBars ?? 4,
    lengthInBars: section.lengthInBars ?? section.bars ?? 4,
    chordProgression: (section.chordProgression || []).map((chord) =>
      createChord(ensureChordRootFormat(chord)),
    ),
    chords: (section.chords || section.chordProgression || []).map((chord) =>
      createChord(ensureChordRootFormat(chord)),
    ),
    melodyNotes: (section.melodyNotes || []).map((note) => createNote(note)),
    melody: (section.melody || section.melodyNotes || []).map((note) => createNote(note)),
    bassNotes: (section.bassNotes || section.bass || []).map((note) => createNote(note)),
    bass: (section.bass || section.bassNotes || []).map((note) => createNote(note)),
    bassNotesInitialized: section.bassNotesInitialized ?? Boolean((section.bassNotes || section.bass || []).length),
    lyricsLines: (section.lyricsLines || []).map((line) => createLyricsLine(line)),
    lyrics: (section.lyrics || section.lyricsLines || []).map((line) => createLyricsLine(line)),
    drumSequence: createDrumSequence(section.drumSequence || section.drums),
    drums: createDrumSequence(section.drums || section.drumSequence),
    accompanimentStyle: createAccompanimentStyle(section.accompanimentStyle),
    accompaniment: createAccompanimentStyle(section.accompaniment || section.accompanimentStyle),
  }));
  if (!normalizedSections.length) {
    normalizedSections.push(createSection({
      name: "Verse",
      lengthInBars: 4,
    }));
  }
  safeSong.sections = normalizedSections;
  safeSong.arrangementOrder =
    safeSong.arrangementOrder && safeSong.arrangementOrder.length
      ? safeSong.arrangementOrder.filter((sectionId) =>
          safeSong.sections.some((section) => section.id === sectionId),
        )
      : safeSong.sections.map((section) => section.id);
  return {
    ...createSong(),
    ...safeSong,
    scale: safeSong.scale ?? safeSong.scaleType ?? "major",
    scaleType: safeSong.scaleType ?? safeSong.scale ?? "major",
    meter: "4/4",
    timeSignature: "4/4",
  };
}

export function findSection(song, sectionId) {
  return song.sections.find((section) => section.id === sectionId) || song.sections[0];
}

export function moveItem(array, fromIndex, toIndex) {
  const clone = [...array];
  const [item] = clone.splice(fromIndex, 1);
  clone.splice(toIndex, 0, item);
  return clone;
}

export function getBeatsPerBar(song) {
  const [top] = String(song.timeSignature || "4/4").split("/");
  return Number.parseInt(top, 10) || 4;
}

export function sectionLengthInBeats(song, section) {
  return section.lengthInBars * getBeatsPerBar(song);
}

export function sortNotes(notes = []) {
  return [...notes].sort((left, right) => {
    if (left.startBeat === right.startBeat) {
      return left.pitch - right.pitch;
    }
    return left.startBeat - right.startBeat;
  });
}

function normalizeSectionType(label = "Verse") {
  const compact = String(label).replace(/\s+/g, "").toLowerCase();
  if (compact === "prechorus") {
    return "PreChorus";
  }
  const match = SECTION_TYPES.find((type) => type.toLowerCase() === compact);
  return match || "Custom";
}

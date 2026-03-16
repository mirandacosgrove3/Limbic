import { createDrumPercLane, createDrumSequence, getBeatsPerBar, getDrumPatternBars } from "./dataModel.js";
import { ensurePlaybackAudioMode, primeAudioContext, releasePlaybackAudioMode } from "./audioSession.js";
import { buildChordGridTimeline, chordToMidi, getChordToneClasses } from "./musicTheoryEngine.js";

const DRUM_PATTERNS = {
  minimal: {
    kick: [0, 8],
    snare: [4, 12],
    hat: [0, 4, 8, 12],
    openHat: [],
    clap: [],
  },
  pop: {
    kick: [0, 8, 12],
    snare: [4, 12],
    hat: [0, 2, 4, 6, 8, 10, 12, 14],
    openHat: [15],
    clap: [12],
  },
  rock: {
    kick: [0, 7, 8, 12],
    snare: [4, 12],
    hat: [0, 2, 4, 6, 8, 10, 12, 14],
    openHat: [11, 15],
    clap: [],
  },
  hiphop: {
    kick: [0, 5, 8, 11],
    snare: [4, 12],
    hat: [0, 3, 6, 9, 10, 14],
    openHat: [7],
    clap: [12],
  },
  electronic: {
    kick: [0, 4, 8, 12],
    snare: [4, 12],
    hat: [0, 2, 3, 6, 8, 10, 11, 14],
    openHat: [7, 15],
    clap: [4, 12],
  },
  halftime: {
    kick: [0, 8, 11],
    snare: [8],
    hat: [0, 2, 4, 6, 8, 10, 12, 14],
    openHat: [15],
    clap: [8],
  },
};

const DRUM_PITCHES = {
  kick: 36,
  snare: 38,
  hat: 42,
  openHat: 46,
  clap: 39,
};

const DRUM_SEQUENCE_ROWS = ["kick", "snare", "hat", "openHat", "clap"];
const DRUM_PERC_VARIANT_CONFIGS = {
  perc: {
    id: "perc",
    label: "Perc",
    pitch: 50,
    filterType: "bandpass",
    frequency: 1800,
    q: 3.4,
    gain: 0.12,
    durationBeats: 0.14,
    velocity: 0.32,
  },
  rim: {
    id: "rim",
    label: "Rim",
    pitch: 37,
    filterType: "bandpass",
    frequency: 2900,
    q: 8,
    gain: 0.09,
    durationBeats: 0.08,
    velocity: 0.26,
  },
  shaker: {
    id: "shaker",
    label: "Shaker",
    pitch: 82,
    filterType: "highpass",
    frequency: 5600,
    q: 0.9,
    gain: 0.1,
    durationBeats: 0.12,
    velocity: 0.24,
  },
  tambourine: {
    id: "tambourine",
    label: "Tamb",
    pitch: 54,
    filterType: "highpass",
    frequency: 7600,
    q: 1.1,
    gain: 0.13,
    durationBeats: 0.18,
    velocity: 0.24,
  },
  texture: {
    id: "texture",
    label: "Texture",
    pitch: 52,
    filterType: "lowpass",
    frequency: 900,
    q: 0.7,
    gain: 0.1,
    durationBeats: 0.28,
    velocity: 0.2,
  },
  rustle: {
    id: "rustle",
    label: "Rustle",
    pitch: 70,
    filterType: "lowpass",
    frequency: 1400,
    q: 0.5,
    gain: 0.085,
    durationBeats: 0.42,
    velocity: 0.18,
  },
};
const DRUM_PERC_VARIANTS = Object.keys(DRUM_PERC_VARIANT_CONFIGS);

function getPercLaneVariantConfig(variant) {
  return DRUM_PERC_VARIANT_CONFIGS[variant] || DRUM_PERC_VARIANT_CONFIGS.texture;
}

export function getPercLaneVariantLabel(variant) {
  return getPercLaneVariantConfig(variant).label;
}

function cloneEvent(event) {
  return { ...event };
}

function applyTrackLevel(events, level = 1) {
  const safeLevel = Math.max(0, Math.min(level ?? 1, 1));
  return events.map((event) => ({
    ...event,
    velocity: Math.max(0.04, Math.min((event.velocity ?? 0.7) * safeLevel, 1)),
  }));
}

export function midiToFrequency(midiNote) {
  return 440 * 2 ** ((midiNote - 69) / 12);
}

export function buildSectionChordTimeline(section, song, sectionStartBeat = 0) {
  const beatsPerBar = getBeatsPerBar(song);
  const sectionBeats = section.lengthInBars * beatsPerBar;
  const chords = section.chordProgression.length > 0 ? section.chordProgression : [];

  if (section.chordLayout === "grid") {
    return buildChordGridTimeline(section, song).map((event) => ({
      chord: event.chord,
      chordIndex: event.index,
      localStartBeat: event.startBeat,
      localEndBeat: event.endBeat,
      startBeat: sectionStartBeat + event.startBeat,
      endBeat: sectionStartBeat + event.endBeat,
      sectionId: section.id,
      sectionName: section.name,
    }));
  }

  const timeline = [];
  let cursor = 0;

  chords.forEach((chord, index) => {
    if (cursor >= sectionBeats) {
      return;
    }
    if (!chord) {
      cursor += beatsPerBar;
      return;
    }

    const remaining = sectionBeats - cursor;
    const isLastChord = index === chords.length - 1;
    const duration = isLastChord
      ? Math.max(1, remaining)
      : Math.max(1, Math.min(remaining, chord.durationInBeats || beatsPerBar));

    timeline.push({
      chord,
      chordIndex: index,
      localStartBeat: cursor,
      localEndBeat: cursor + duration,
      startBeat: sectionStartBeat + cursor,
      endBeat: sectionStartBeat + cursor + duration,
      sectionId: section.id,
      sectionName: section.name,
    });
    cursor += duration;
  });

  if (timeline.length === 0) {
    return [];
  }

  const finalEvent = timeline[timeline.length - 1];
  if (finalEvent.localEndBeat < sectionBeats) {
    finalEvent.localEndBeat = sectionBeats;
    finalEvent.endBeat = sectionStartBeat + sectionBeats;
  }

  return timeline;
}

function buildChordTrackEvents(chordEvent, chordStyle) {
  const chordPitches = chordToMidi(chordEvent.chord, 4);
  const durationBeats = chordEvent.localEndBeat - chordEvent.localStartBeat;
  const events = [];

  if (chordStyle === "pulse") {
    for (let beat = 0; beat < durationBeats; beat += 1) {
      chordPitches.forEach((pitch) => {
        events.push({
          track: "chords",
          pitch,
          startBeat: chordEvent.startBeat + beat,
          durationBeats: 0.65,
          velocity: 0.32,
        });
      });
    }
    return events;
  }

  if (chordStyle === "arpeggio") {
    const stepBeats = 0.5;
    for (let beat = 0; beat < durationBeats; beat += stepBeats) {
      const pitch = chordPitches[Math.floor(beat / stepBeats) % chordPitches.length];
      events.push({
        track: "chords",
        pitch,
        startBeat: chordEvent.startBeat + beat,
        durationBeats: Math.min(stepBeats * 0.9, durationBeats - beat || stepBeats),
        velocity: 0.52,
      });
    }
    return events;
  }

  if (chordStyle === "arpeggio-down") {
    const stepBeats = 0.5;
    const reversed = [...chordPitches].reverse();
    for (let beat = 0; beat < durationBeats; beat += stepBeats) {
      const pitch = reversed[Math.floor(beat / stepBeats) % reversed.length];
      events.push({
        track: "chords",
        pitch,
        startBeat: chordEvent.startBeat + beat,
        durationBeats: Math.min(stepBeats * 0.9, durationBeats - beat || stepBeats),
        velocity: 0.5,
      });
    }
    return events;
  }

  if (chordStyle === "ping-pong") {
    const stepBeats = 0.5;
    const pattern = [...chordPitches, ...[...chordPitches].reverse().slice(1, -1)];
    for (let beat = 0; beat < durationBeats; beat += stepBeats) {
      const pitch = pattern[Math.floor(beat / stepBeats) % pattern.length];
      events.push({
        track: "chords",
        pitch,
        startBeat: chordEvent.startBeat + beat,
        durationBeats: Math.min(stepBeats * 0.9, durationBeats - beat || stepBeats),
        velocity: 0.5,
      });
    }
    return events;
  }

  if (chordStyle === "strum") {
    chordPitches.forEach((pitch, index) => {
      events.push({
        track: "chords",
        pitch,
        startBeat: chordEvent.startBeat + index * 0.08,
        durationBeats: Math.max(0.5, durationBeats - index * 0.08),
        velocity: 0.48,
      });
    });
    return events;
  }

  chordPitches.forEach((pitch) => {
    events.push({
      track: "chords",
      pitch,
      startBeat: chordEvent.startBeat,
      durationBeats: durationBeats * 0.96,
      velocity: 0.4,
    });
  });

  return events;
}

function buildBassTrackEvents(chordEvent, bassPattern) {
  const rootPitch = chordToMidi(chordEvent.chord, 2)[0];
  const durationBeats = chordEvent.localEndBeat - chordEvent.localStartBeat;
  const events = [];

  if (bassPattern === "root-fifth") {
    const beatCount = Math.max(1, Math.round(durationBeats));
    for (let beat = 0; beat < beatCount; beat += 1) {
      events.push({
        track: "bass",
        pitch: beat % 2 === 0 ? rootPitch : rootPitch + 7,
        startBeat: chordEvent.startBeat + beat,
        durationBeats: 0.88,
        velocity: 0.7,
      });
    }
    return events;
  }

  if (bassPattern === "walking") {
    const pattern = [0, 4, 7, 11];
    const beatCount = Math.max(1, Math.round(durationBeats));
    for (let beat = 0; beat < beatCount; beat += 1) {
      events.push({
        track: "bass",
        pitch: rootPitch + pattern[beat % pattern.length],
        startBeat: chordEvent.startBeat + beat,
        durationBeats: 0.92,
        velocity: 0.72,
      });
    }
    return events;
  }

  if (bassPattern === "octave") {
    const beatCount = Math.max(1, Math.round(durationBeats));
    for (let beat = 0; beat < beatCount; beat += 1) {
      events.push({
        track: "bass",
        pitch: beat % 2 === 0 ? rootPitch : rootPitch + 12,
        startBeat: chordEvent.startBeat + beat,
        durationBeats: 0.9,
        velocity: 0.68,
      });
    }
    return events;
  }

  if (bassPattern === "offbeat") {
    const beatCount = Math.max(1, Math.round(durationBeats));
    for (let beat = 0; beat < beatCount; beat += 1) {
      events.push({
        track: "bass",
        pitch: rootPitch,
        startBeat: chordEvent.startBeat + beat + 0.5,
        durationBeats: 0.42,
        velocity: 0.64,
      });
    }
    return events;
  }

  const beatCount = Math.max(1, Math.round(durationBeats));
  for (let beat = 0; beat < beatCount; beat += 1) {
    events.push({
      track: "bass",
      pitch: rootPitch,
      startBeat: chordEvent.startBeat + beat,
      durationBeats: 0.9,
      velocity: 0.75,
    });
  }

  return events;
}

function getPitchClass(pitch) {
  return ((pitch % 12) + 12) % 12;
}

function findMelodyNoteAtBeat(section, beat) {
  return (section.melodyNotes || []).find(
    (note) => !note.muted && note.startBeat <= beat + 0.001 && note.startBeat + note.duration > beat - 0.001,
  ) || null;
}

function buildAdaptiveBassTrackEvents(chordEvent, bassPattern, section, sectionStartBeat = 0) {
  const baseEvents = buildBassTrackEvents(chordEvent, bassPattern);
  const rootPitchClass = getPitchClass(chordToMidi(chordEvent.chord, 2)[0]);
  const chordCandidates = chordToMidi(chordEvent.chord, 2)
    .flatMap((pitch) => [pitch - 12, pitch, pitch + 12])
    .filter((pitch, index, list) => pitch >= 24 && pitch <= 60 && list.indexOf(pitch) === index);

  return baseEvents.map((event) => {
    const localBeat = event.startBeat - sectionStartBeat;
    const melodyNote = findMelodyNoteAtBeat(section, localBeat);
    if (!melodyNote) return event;

    const melodyPitchClass = getPitchClass(melodyNote.pitch);
    const matchingCandidates = chordCandidates.filter((pitch) => getPitchClass(pitch) === melodyPitchClass);
    if (!matchingCandidates.length) return event;

    const isChordDownbeat = Math.abs(event.startBeat - chordEvent.startBeat) < 0.001;
    if (isChordDownbeat && melodyPitchClass !== rootPitchClass) {
      return event;
    }

    const nudgedPitch = matchingCandidates.reduce((closest, pitch) => (
      Math.abs(pitch - event.pitch) < Math.abs(closest - event.pitch) ? pitch : closest
    ), matchingCandidates[0]);

    if (Math.abs(nudgedPitch - event.pitch) > 7) {
      return event;
    }

    return {
      ...event,
      pitch: nudgedPitch,
      velocity: Math.min(1, (event.velocity ?? 0.7) + 0.03),
    };
  });
}

export function buildBassNotesFromSection(section, song) {
  return buildSectionChordTimeline(section, song, 0)
    .flatMap((chordEvent) =>
      buildAdaptiveBassTrackEvents(chordEvent, section.accompanimentStyle?.bassPattern || "root", section, 0),
    )
    .map((event) => ({
      pitch: event.pitch,
      startBeat: event.startBeat,
      duration: event.durationBeats,
      durationBeats: event.durationBeats,
      velocity: event.velocity,
      muted: false,
    }));
}

function hashSeed(value) {
  return String(value)
    .split("")
    .reduce((acc, char) => ((acc * 31) + char.charCodeAt(0)) >>> 0, 7);
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export function randomizePercLaneSteps(totalSteps, seed) {
  const rand = seededRandom(hashSeed(seed));
  const steps = [];
  for (let step = 0; step < totalSteps; step += 1) {
    const isStrong = step % 4 === 3;
    const threshold = isStrong ? 0.34 : 0.14;
    if (rand() < threshold) {
      steps.push(step);
      if (rand() < 0.12 && step + 1 < totalSteps) {
        steps.push(step + 1);
        step += 1;
      }
    }
  }
  return [...new Set(steps)].sort((left, right) => left - right);
}

export function randomizePercLaneVariant(seed, currentVariant = null) {
  const current = currentVariant ? getPercLaneVariantConfig(currentVariant).id : null;
  const choices = current
    ? DRUM_PERC_VARIANTS.filter((variant) => variant !== current)
    : DRUM_PERC_VARIANTS;
  if (!choices.length) return current;
  return choices[hashSeed(seed) % choices.length];
}

export function createDrumSequenceFromPreset(section, song, presetName = section.accompanimentStyle?.drumPreset || "pop") {
  const patternBars = getDrumPatternBars(section, section.drumSequence);
  const targetStepsPerBar = Math.max(1, Number(section.drumSequence?.stepsPerBar) || 16);
  const presetStepsPerBar = 16;
  const totalSteps = Math.max(targetStepsPerBar, Math.round(patternBars * targetStepsPerBar));
  const preset = DRUM_PATTERNS[presetName] || DRUM_PATTERNS.pop;
  const rows = Object.fromEntries(DRUM_SEQUENCE_ROWS.map((row) => [row, []]));
  const mapPresetStep = (step, bar) => {
    const mappedLocalStep = Math.min(
      targetStepsPerBar - 1,
      Math.max(0, Math.round((step / presetStepsPerBar) * targetStepsPerBar)),
    );
    return bar * targetStepsPerBar + mappedLocalStep;
  };

  for (let bar = 0; bar < Math.max(1, Math.ceil(patternBars)); bar += 1) {
    DRUM_SEQUENCE_ROWS.forEach((row) => {
      (preset[row] || []).forEach((step) => {
        const nextStep = mapPresetStep(step, bar);
        if (nextStep < totalSteps) {
          rows[row].push(nextStep);
        }
      });
    });
  }

  const laneSeed = `${section.id}-${presetName}-perc-0`;
  return createDrumSequence({
    kit: presetName,
    stepsPerBar: targetStepsPerBar,
    patternBars,
    initialized: true,
    rows,
    percLanes: [
      createDrumPercLane({
        name: "Perc 1",
        variant: randomizePercLaneVariant(laneSeed),
        steps: randomizePercLaneSteps(totalSteps, laneSeed),
      }),
    ],
  });
}

function hasActiveDrumSequence(sequence) {
  if (!sequence) return false;
  if (sequence.initialized) return true;
  const rowHasSteps = DRUM_SEQUENCE_ROWS.some((row) => (sequence.rows?.[row] || []).length);
  const percHasSteps = (sequence.percLanes || []).some((lane) => lane.steps?.length);
  return rowHasSteps || percHasSteps;
}

function buildDrumTrackEventsFromSequence(section, song, sequence, sectionStartBeat = 0) {
  const beatsPerBar = getBeatsPerBar(song);
  const sectionBeats = section.lengthInBars * beatsPerBar;
  const patternBars = getDrumPatternBars(section, sequence);
  const patternBeats = patternBars * beatsPerBar;
  const stepsPerBar = sequence.stepsPerBar || 16;
  const stepDuration = beatsPerBar / stepsPerBar;
  const patternSteps = Math.max(1, Math.round(patternBars * stepsPerBar));
  const repetitions = Math.max(1, Math.ceil(sectionBeats / patternBeats));
  const events = [];
  const mutedVoices = new Set(sequence.mutedRows || []);
  const soloVoices = new Set(sequence.soloRows || []);
  const canPlayVoice = (voiceId) => !mutedVoices.has(voiceId) && (!soloVoices.size || soloVoices.has(voiceId));

  DRUM_SEQUENCE_ROWS.forEach((row) => {
    if (!canPlayVoice(row)) return;
    (sequence.rows?.[row] || []).filter((step) => step < patternSteps).forEach((step) => {
      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        const startBeat = sectionStartBeat + repetition * patternBeats + step * stepDuration;
        if (startBeat >= sectionStartBeat + sectionBeats) break;
        events.push({
          track: "drums",
          drum: row,
          pitch: DRUM_PITCHES[row],
          startBeat,
          durationBeats: row === "hat" ? 0.08 : row === "openHat" ? 0.22 : 0.16,
          velocity: row === "kick" ? 0.88 : row === "snare" ? 0.65 : row === "clap" ? 0.45 : 0.35,
        });
      }
    });
  });

  (sequence.percLanes || []).forEach((lane) => {
    if (!canPlayVoice(lane.id)) return;
    const variantConfig = getPercLaneVariantConfig(lane.variant);
    (lane.steps || []).filter((step) => step < patternSteps).forEach((step) => {
      for (let repetition = 0; repetition < repetitions; repetition += 1) {
        const startBeat = sectionStartBeat + repetition * patternBeats + step * stepDuration;
        if (startBeat >= sectionStartBeat + sectionBeats) break;
        events.push({
          track: "drums",
          drum: variantConfig.id,
          pitch: variantConfig.pitch,
          startBeat,
          durationBeats: variantConfig.durationBeats,
          velocity: variantConfig.velocity,
        });
      }
    });
  });

  return events;
}

function buildDrumTrackEvents(section, song, sectionStartBeat = 0) {
  if (hasActiveDrumSequence(section.drumSequence)) {
    return buildDrumTrackEventsFromSequence(section, song, section.drumSequence, sectionStartBeat);
  }
  const beatsPerBar = getBeatsPerBar(song);
  const sectionBeats = section.lengthInBars * beatsPerBar;
  const preset = DRUM_PATTERNS[section.accompanimentStyle?.drumPreset] || DRUM_PATTERNS.pop;
  const stepDuration = beatsPerBar / 16;
  const events = [];

  for (let bar = 0; bar < section.lengthInBars; bar += 1) {
    const barStart = sectionStartBeat + bar * beatsPerBar;
    Object.entries(preset).forEach(([voice, steps]) => {
      steps.forEach((step) => {
        const startBeat = barStart + step * stepDuration;
        if (startBeat >= sectionStartBeat + sectionBeats) {
          return;
        }
        events.push({
          track: "drums",
          drum: voice,
          pitch: DRUM_PITCHES[voice],
          startBeat,
          durationBeats: voice === "hat" ? 0.08 : 0.16,
          velocity: voice === "kick" ? 0.88 : voice === "snare" ? 0.65 : 0.35,
        });
      });
    });
  }

  return events;
}

function buildMelodyTrackEvents(section, song, sectionStartBeat = 0) {
  const beatsPerBar = getBeatsPerBar(song);
  const sectionBeats = section.lengthInBars * beatsPerBar;
  return (section.melodyNotes || [])
    .filter((note) => note.startBeat < sectionBeats && !note.muted)
    .map((note) => ({
      track: "melody",
      pitch: note.pitch,
      startBeat: sectionStartBeat + note.startBeat,
      durationBeats: Math.min(note.duration, sectionBeats - note.startBeat),
      velocity: note.velocity ?? 0.82,
      noteId: note.id,
      sectionId: section.id,
    }));
}

export function buildPerformance(song) {
  const tracks = {
    chords: [],
    melody: [],
    bass: [],
    drums: [],
  };
  const sections = [];
  const chordTimeline = [];

  let beatCursor = 0;

  song.sections.forEach((section) => {
    const sectionBeats = section.lengthInBars * getBeatsPerBar(song);
    const mutedLayers = new Set(section.accompanimentStyle?.mutedLayers || []);
    const soloLayers = new Set(section.accompanimentStyle?.soloLayers || []);
    const layerVolumes = {
      chords: 0.9,
      bass: 0.9,
      drums: 0.9,
      melody: 1,
      ...(section.accompanimentStyle?.layerVolumes || {}),
    };
    const canPlayLayer = (layer) => !mutedLayers.has(layer) && (!soloLayers.size || soloLayers.has(layer));

    sections.push({
      id: section.id,
      name: section.name,
      startBeat: beatCursor,
      endBeat: beatCursor + sectionBeats,
    });

    const sectionChordTimeline = buildSectionChordTimeline(section, song, beatCursor);
    chordTimeline.push(...sectionChordTimeline.map(cloneEvent));

    sectionChordTimeline.forEach((chordEvent) => {
      if (canPlayLayer("chords")) {
        tracks.chords.push(
          ...applyTrackLevel(
            buildChordTrackEvents(chordEvent, section.accompanimentStyle?.chordStyle || "block"),
            layerVolumes.chords,
          ),
        );
      }
      if (canPlayLayer("bass") && !section.bassNotesInitialized && !section.bassNotes?.length) {
        tracks.bass.push(
          ...applyTrackLevel(
            buildAdaptiveBassTrackEvents(
              chordEvent,
              section.accompanimentStyle?.bassPattern || "root",
              section,
              beatCursor,
            ),
            layerVolumes.bass,
          ),
        );
      }
    });

    if (canPlayLayer("bass") && section.bassNotesInitialized) {
      tracks.bass.push(
        ...applyTrackLevel(
          section.bassNotes
            .filter((note) => !note.muted)
            .map((note) => ({
              track: "bass",
              pitch: note.pitch,
              startBeat: beatCursor + note.startBeat,
              durationBeats: note.duration ?? note.durationBeats ?? 1,
              velocity: note.velocity ?? 0.72,
            })),
          layerVolumes.bass,
        ),
      );
    }

    if (canPlayLayer("drums")) {
      tracks.drums.push(...applyTrackLevel(buildDrumTrackEvents(section, song, beatCursor), layerVolumes.drums));
    }
    if (canPlayLayer("melody")) {
      tracks.melody.push(...applyTrackLevel(buildMelodyTrackEvents(section, song, beatCursor), layerVolumes.melody));
    }

    beatCursor += sectionBeats;
  });

  Object.values(tracks).forEach((trackEvents) => {
    trackEvents.sort((left, right) => {
      if (left.startBeat === right.startBeat) {
        return left.pitch - right.pitch;
      }
      return left.startBeat - right.startBeat;
    });
  });

  const events = [...tracks.chords, ...tracks.melody, ...tracks.bass, ...tracks.drums].sort(
    (left, right) => {
      if (left.startBeat === right.startBeat) {
        return left.track.localeCompare(right.track);
      }
      return left.startBeat - right.startBeat;
    },
  );

  return {
    songId: song.id,
    totalBeats: beatCursor,
    beatsPerBar: getBeatsPerBar(song),
    sections,
    chordTimeline,
    tracks,
    events,
  };
}

export function findSectionAtBeat(performance, beat) {
  return (
    performance.sections.find((section) => beat >= section.startBeat && beat < section.endBeat) ||
    performance.sections[performance.sections.length - 1] ||
    null
  );
}

export function findChordAtBeat(performance, beat) {
  const activeEvent = performance.chordTimeline.find((event) => beat >= event.startBeat && beat < event.endBeat);
  if (activeEvent) {
    return activeEvent;
  }
  if (performance.chordTimeline[0] && beat < performance.chordTimeline[0].startBeat) {
    return null;
  }
  return performance.chordTimeline[performance.chordTimeline.length - 1] || null;
}

function createNoiseBuffer(context) {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < channel.length; index += 1) {
    channel[index] = Math.random() * 2 - 1;
  }
  return buffer;
}

function getAudioResources(context) {
  if (!context.__limbicResources) {
    context.__limbicResources = {
      noiseBuffer: createNoiseBuffer(context),
    };
  }
  return context.__limbicResources;
}

function scheduleMelodicVoice(context, destination, event, startTime, beatDuration, collector) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const filter = context.createBiquadFilter();
  const rawDurationSeconds = Math.max(0.04, event.durationBeats * beatDuration);
  const isChordTrack = event.track === "chords";
  const durationSeconds = isChordTrack
    ? Math.max(rawDurationSeconds + Math.min(0.26, rawDurationSeconds * 0.45), 0.92)
    : rawDurationSeconds;
  const frequency = midiToFrequency(event.pitch);
  const baseVelocity = event.velocity ?? 0.7;

  oscillator.frequency.setValueAtTime(frequency, startTime);
  oscillator.type =
    event.track === "bass" ? "square" : event.track === "melody" ? "triangle" : "sawtooth";

  filter.type = event.track === "bass" ? "lowpass" : "lowpass";
  filter.frequency.setValueAtTime(event.track === "bass" ? 900 : 1800, startTime);

  gain.gain.setValueAtTime(0.0001, startTime);
  if (isChordTrack) {
    const peakGain = baseVelocity * 0.15;
    const sustainGain = peakGain * 0.78;
    const releaseTime = Math.min(0.36, Math.max(0.18, durationSeconds * 0.24));
    const releaseStart = Math.max(startTime + 0.12, startTime + durationSeconds - releaseTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.02);
    gain.gain.linearRampToValueAtTime(sustainGain, startTime + 0.1);
    gain.gain.setValueAtTime(sustainGain, releaseStart);
    gain.gain.exponentialRampToValueAtTime(0.0001, releaseStart + releaseTime);
  } else {
    gain.gain.linearRampToValueAtTime(baseVelocity * 0.22, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSeconds + 0.04);
  }

  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(destination);

  oscillator.start(startTime);
  oscillator.stop(startTime + durationSeconds + 0.08);

  if (collector) {
    collector.push({ node: oscillator, endTime: startTime + durationSeconds + 0.08 });
  }
}

function scheduleDrumVoice(context, destination, event, startTime, beatDuration, collector) {
  const resources = getAudioResources(context);
  const durationSeconds = Math.max(0.03, event.durationBeats * beatDuration);

  if (event.drum === "kick") {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(150, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(45, startTime + durationSeconds);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(0.55, startTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSeconds);
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + durationSeconds + 0.05);
    if (collector) {
      collector.push({ node: oscillator, endTime: startTime + durationSeconds + 0.05 });
    }
    return;
  }

  const source = context.createBufferSource();
  source.buffer = resources.noiseBuffer;
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  const percVariant = DRUM_PERC_VARIANT_CONFIGS[event.drum] || null;
  const isHatFamily = event.drum === "hat" || event.drum === "openHat";
  filter.type = percVariant?.filterType || (isHatFamily ? "highpass" : event.drum === "texture" ? "lowpass" : "bandpass");
  filter.frequency.setValueAtTime(
    percVariant?.frequency ?? (
      event.drum === "hat" ? 6500
        : event.drum === "openHat" ? 5200
          : event.drum === "clap" ? 2200
            : event.drum === "texture" ? 900
              : 1800
    ),
    startTime,
  );
  filter.Q.setValueAtTime(percVariant?.q ?? 1.2, startTime);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(
    percVariant?.gain ?? (
      event.drum === "snare" ? 0.3
        : event.drum === "clap" ? 0.24
          : event.drum === "openHat" ? 0.16
            : event.drum === "texture" ? 0.1
              : 0.12
    ),
    startTime + 0.002,
  );
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSeconds);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  source.start(startTime);
  source.stop(startTime + durationSeconds + 0.03);

  if (collector) {
    collector.push({ node: source, endTime: startTime + durationSeconds + 0.03 });
  }
}

export function scheduleSynthEvent(
  context,
  destination,
  event,
  startTime,
  beatDuration,
  collector = null,
) {
  if (event.track === "drums") {
    scheduleDrumVoice(context, destination, event, startTime, beatDuration, collector);
    return;
  }

  scheduleMelodicVoice(context, destination, event, startTime, beatDuration, collector);
}

function findEventIndex(events, beat) {
  return events.findIndex((event) => event.startBeat >= beat - 0.0001);
}

export class PlaybackEngine {
  constructor({ onTick = () => {}, onStateChange = () => {} } = {}) {
    this.onTick = onTick;
    this.onStateChange = onStateChange;
    this.context = null;
    this.master = null;
    this.song = null;
    this.performance = null;
    this.lookaheadMs = 25;
    this.scheduleAheadSeconds = 0.12;
    this.startLeadSeconds = 0.03;
    this.isPlaying = false;
    this.pausedBeat = 0;
    this.startTime = 0;
    this.timer = null;
    this.nextEventIndex = 0;
    this.activeSources = [];
    this.loopSectionId = null;
    this.loopPrefetchEndBeat = null;
    this.loopPrefetchIndex = null;
  }

  clearLoopPrefetch() {
    this.loopPrefetchEndBeat = null;
    this.loopPrefetchIndex = null;
  }

  async ensureContext() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 0.88;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    primeAudioContext(this.context);
  }

  setSong(song) {
    this.song = song;
    this.performance = buildPerformance(song);
    this.clearLoopPrefetch();
    if (this.isPlaying && this.context) {
      this.refresh();
    } else {
      this.pausedBeat = Math.min(this.pausedBeat, this.performance.totalBeats);
    }
  }

  getBeatDuration() {
    return 60 / Math.max(1, this.song?.tempo || 120);
  }

  getCurrentBeat() {
    if (!this.isPlaying || !this.context) {
      return this.pausedBeat;
    }
    return Math.max(0, (this.context.currentTime - this.startTime) / this.getBeatDuration());
  }

  getLoopRange() {
    if (!this.loopSectionId || !this.performance) {
      return null;
    }
    const section = this.performance.sections.find((item) => item.id === this.loopSectionId);
    return section || null;
  }

  cleanupFinishedSources() {
    if (!this.context) {
      return;
    }
    const now = this.context.currentTime;
    this.activeSources = this.activeSources.filter((entry) => entry.endTime > now);
  }

  stopScheduledAudio() {
    this.activeSources.forEach((entry) => {
      try {
        entry.node.stop(0);
      } catch (error) {
        // Sources that already ended will throw here, which is safe to ignore.
      }
    });
    this.activeSources = [];
  }

  async play() {
    if (!this.song) {
      return;
    }
    await ensurePlaybackAudioMode("transport");
    await this.ensureContext();
    if (this.performance && this.pausedBeat >= this.performance.totalBeats) {
      this.pausedBeat = this.getLoopRange()?.startBeat || 0;
    }
    this.startTime =
      this.context.currentTime + this.startLeadSeconds - this.pausedBeat * this.getBeatDuration();
    this.nextEventIndex = Math.max(0, findEventIndex(this.performance.events, this.pausedBeat));
    this.clearLoopPrefetch();
    this.isPlaying = true;
    this.stopTimer();
    this.scheduler();
    this.timer = window.setInterval(() => this.scheduler(), this.lookaheadMs);
    this.onStateChange("playing");
  }

  pause() {
    if (!this.song) {
      return;
    }
    this.pausedBeat = this.getCurrentBeat();
    this.stopScheduledAudio();
    this.stopTimer();
    this.isPlaying = false;
    this.clearLoopPrefetch();
    releasePlaybackAudioMode("transport");
    this.onStateChange("paused");
  }

  stop() {
    this.pausedBeat = this.getLoopRange()?.startBeat || 0;
    this.stopScheduledAudio();
    this.stopTimer();
    this.isPlaying = false;
    this.clearLoopPrefetch();
    releasePlaybackAudioMode("transport");
    this.onTick({
      beat: this.pausedBeat,
      section: findSectionAtBeat(this.performance, this.pausedBeat),
      chord: findChordAtBeat(this.performance, this.pausedBeat),
    });
    this.onStateChange("stopped");
  }

  stopTimer() {
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  setLoopSection(sectionId) {
    this.loopSectionId = sectionId;
    this.clearLoopPrefetch();
    if (!this.performance) {
      return;
    }
    const loopRange = this.getLoopRange();
    if (!loopRange) {
      return;
    }
    const currentBeat = this.getCurrentBeat();
    if (currentBeat < loopRange.startBeat || currentBeat >= loopRange.endBeat) {
      this.pausedBeat = loopRange.startBeat;
      if (this.isPlaying && this.context) {
        this.startTime =
          this.context.currentTime + this.startLeadSeconds - this.pausedBeat * this.getBeatDuration();
        this.nextEventIndex = Math.max(0, findEventIndex(this.performance.events, this.pausedBeat));
      }
    }
  }

  refresh() {
    if (!this.song) {
      return;
    }
    const currentBeat = this.getCurrentBeat();
    this.performance = buildPerformance(this.song);
    this.stopScheduledAudio();
    this.clearLoopPrefetch();
    if (this.isPlaying && this.context) {
      this.startTime = this.context.currentTime - currentBeat * this.getBeatDuration();
      this.nextEventIndex = Math.max(0, findEventIndex(this.performance.events, currentBeat));
    }
    this.pausedBeat = Math.min(currentBeat, this.performance.totalBeats);
  }

  scheduler() {
    if (!this.context || !this.performance || !this.isPlaying) {
      return;
    }

    this.cleanupFinishedSources();

    const beatDuration = this.getBeatDuration();
    const loopRange = this.getLoopRange();
    let currentBeat = this.getCurrentBeat();

    if (loopRange) {
      const loopLength = loopRange.endBeat - loopRange.startBeat;
      let didWrap = false;
      while (currentBeat >= loopRange.endBeat && loopLength > 0) {
        this.startTime += loopLength * beatDuration;
        currentBeat -= loopLength;
        didWrap = true;
      }
      if (didWrap) {
        this.pausedBeat = currentBeat;
        if (this.loopPrefetchIndex !== null) {
          this.nextEventIndex = this.loopPrefetchIndex;
        } else {
          this.nextEventIndex = Math.max(0, findEventIndex(this.performance.events, loopRange.startBeat));
        }
        this.clearLoopPrefetch();
      }
    }

    const scheduleWindowEnd = currentBeat + this.scheduleAheadSeconds / beatDuration;
    const cappedWindowEnd = loopRange ? Math.min(scheduleWindowEnd, loopRange.endBeat) : scheduleWindowEnd;

    while (
      this.nextEventIndex < this.performance.events.length &&
      this.performance.events[this.nextEventIndex].startBeat < cappedWindowEnd
    ) {
      const event = this.performance.events[this.nextEventIndex];
      if (!loopRange || event.startBeat >= loopRange.startBeat) {
        if (event.startBeat >= currentBeat - 0.001) {
          const startTime = this.startTime + event.startBeat * beatDuration;
          scheduleSynthEvent(
            this.context,
            this.master,
            event,
            startTime,
            beatDuration,
            this.activeSources,
          );
        }
      }
      this.nextEventIndex += 1;
    }

    if (loopRange && scheduleWindowEnd > loopRange.endBeat) {
      const loopLength = loopRange.endBeat - loopRange.startBeat;
      const overflowEndBeat = loopRange.startBeat + (scheduleWindowEnd - loopRange.endBeat);
      const prefetchStartBeat = Math.max(
        loopRange.startBeat,
        this.loopPrefetchEndBeat ?? loopRange.startBeat,
      );
      let prefetchIndex = Math.max(0, findEventIndex(this.performance.events, prefetchStartBeat));

      while (
        prefetchIndex < this.performance.events.length &&
        this.performance.events[prefetchIndex].startBeat < overflowEndBeat
      ) {
        const event = this.performance.events[prefetchIndex];
        if (event.startBeat >= prefetchStartBeat - 0.001 && event.startBeat >= loopRange.startBeat) {
          const wrappedStartTime = this.startTime + (event.startBeat + loopLength) * beatDuration;
          scheduleSynthEvent(
            this.context,
            this.master,
            event,
            wrappedStartTime,
            beatDuration,
            this.activeSources,
          );
        }
        prefetchIndex += 1;
      }

      this.loopPrefetchEndBeat = overflowEndBeat;
      this.loopPrefetchIndex = prefetchIndex;
    }

    const activeSection = findSectionAtBeat(this.performance, currentBeat);
    const activeChord = findChordAtBeat(this.performance, currentBeat);
    this.onTick({ beat: currentBeat, section: activeSection, chord: activeChord });

    if (!loopRange && currentBeat >= this.performance.totalBeats + 0.1) {
      this.stop();
    }
  }
}

export function isChordToneForEvent(chordEvent, pitch) {
  if (!chordEvent) {
    return false;
  }
  const pitchClass = ((pitch % 12) + 12) % 12;
  return getChordToneClasses(chordEvent.chord).includes(pitchClass);
}

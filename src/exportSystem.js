import { buildPerformance, scheduleSynthEvent } from "./playbackEngine.js";
import { getChordDisplayName } from "./musicTheoryEngine.js";

const PPQ = 480;

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function encodeVariableLength(value) {
  let buffer = value & 0x7f;
  const bytes = [];
  while ((value >>= 7)) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) {
      buffer >>= 8;
    } else {
      break;
    }
  }
  return bytes;
}

function stringBytes(text) {
  return Array.from(new TextEncoder().encode(text));
}

function uint32Bytes(value) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function uint16Bytes(value) {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function createTrackChunk(bytes) {
  return [...stringBytes("MTrk"), ...uint32Bytes(bytes.length), ...bytes];
}

function createHeaderChunk(trackCount) {
  return [
    ...stringBytes("MThd"),
    ...uint32Bytes(6),
    ...uint16Bytes(1),
    ...uint16Bytes(trackCount),
    ...uint16Bytes(PPQ),
  ];
}

function buildMetaTrack(song) {
  const bytes = [];
  const tempoMicroseconds = Math.round(60000000 / Math.max(1, song.tempo));
  const [numerator, denominator] = String(song.timeSignature || "4/4")
    .split("/")
    .map((value) => Number.parseInt(value, 10));
  const denominatorPower = Math.log2(denominator || 4);
  const titleBytes = stringBytes(song.title);

  bytes.push(0x00, 0xff, 0x03, titleBytes.length, ...titleBytes);
  bytes.push(0x00, 0xff, 0x51, 0x03, (tempoMicroseconds >>> 16) & 0xff, (tempoMicroseconds >>> 8) & 0xff, tempoMicroseconds & 0xff);
  bytes.push(0x00, 0xff, 0x58, 0x04, numerator || 4, denominatorPower || 2, 24, 8);
  bytes.push(0x00, 0xff, 0x2f, 0x00);
  return createTrackChunk(bytes);
}

function buildTrackEvents(noteEvents, channel, name, program = null) {
  const entries = [];
  const nameBytes = stringBytes(name);

  if (program !== null) {
    entries.push({ tick: 0, data: [0xff, 0x03, nameBytes.length, ...nameBytes] });
    entries.push({ tick: 0, data: [0xc0 + channel, program] });
  } else {
    entries.push({ tick: 0, data: [0xff, 0x03, nameBytes.length, ...nameBytes] });
  }

  noteEvents.forEach((event) => {
    const startTick = Math.max(0, Math.round(event.startBeat * PPQ));
    const endTick = Math.max(startTick + 1, Math.round((event.startBeat + event.durationBeats) * PPQ));
    entries.push({
      tick: startTick,
      data: [0x90 + channel, event.pitch, Math.max(1, Math.round((event.velocity ?? 0.7) * 110))],
      type: "on",
    });
    entries.push({
      tick: endTick,
      data: [0x80 + channel, event.pitch, 0x40],
      type: "off",
    });
  });

  entries.sort((left, right) => {
    if (left.tick === right.tick) {
      if (left.type === right.type) {
        return 0;
      }
      return left.type === "off" ? -1 : 1;
    }
    return left.tick - right.tick;
  });

  let previousTick = 0;
  const bytes = [];
  entries.forEach((entry) => {
    const delta = entry.tick - previousTick;
    bytes.push(...encodeVariableLength(delta), ...entry.data);
    previousTick = entry.tick;
  });
  bytes.push(0x00, 0xff, 0x2f, 0x00);
  return createTrackChunk(bytes);
}

function midiBytes(song) {
  const performance = buildPerformance(song);
  const chunks = [
    buildMetaTrack(song),
    buildTrackEvents(performance.tracks.chords, 0, "Chords", 89),
    buildTrackEvents(performance.tracks.melody, 1, "Melody", 80),
    buildTrackEvents(performance.tracks.bass, 2, "Bass", 33),
    buildTrackEvents(performance.tracks.drums, 9, "Drums", null),
  ];

  return new Uint8Array([...createHeaderChunk(chunks.length), ...chunks.flat()]);
}

function audioBufferToWav(buffer) {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length * channels * 2;
  const arrayBuffer = new ArrayBuffer(44 + length);
  const view = new DataView(arrayBuffer);

  function writeString(offset, text) {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + length, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, length, true);

  const channelData = Array.from({ length: channels }, (_, index) => buffer.getChannelData(index));
  let offset = 44;
  for (let sampleIndex = 0; sampleIndex < buffer.length; sampleIndex += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][sampleIndex]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

export function exportProjectJson(song) {
  const blob = new Blob([JSON.stringify(song, null, 2)], { type: "application/json" });
  downloadBlob(`${song.title || "song"}.lcp.json`, blob);
}

export function exportMidi(song) {
  const blob = new Blob([midiBytes(song)], { type: "audio/midi" });
  downloadBlob(`${song.title || "song"}.mid`, blob);
}

export function exportTextSheet(song, format = "chords-lyrics") {
  const lines = [];
  lines.push(song.title || "Untitled Idea");
  lines.push(`${song.key} ${song.scaleType} · ${song.tempo} BPM · ${song.timeSignature}`);
  lines.push("");

  song.sections.forEach((section) => {
    lines.push(`[${section.name}] ${section.lengthInBars} bars`);
    if (format !== "lyrics") {
      const visibleChordCount = Math.max(section.lengthInBars || 0, section.chordProgression?.length || 0);
      const chords = Array.from({ length: visibleChordCount }, (_, index) => {
        const chord = section.chordProgression?.[index] || null;
        if (!chord) {
          return "—";
        }
        const label = getChordDisplayName(chord);
        return index >= section.lengthInBars ? `(${label})` : label;
      }).filter(Boolean);
      lines.push(chords.length ? chords.join(" | ") : "(no chords yet)");
    }
    if (format !== "chords") {
      (section.lyricsLines || []).forEach((line) => {
        lines.push(line.text || "...");
      });
      if (!section.lyricsLines?.length) {
        lines.push("(no lyrics yet)");
      }
    }
    lines.push("");
  });

  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  downloadBlob(`${song.title || "song"}.txt`, blob);
}

export async function exportWav(song) {
  const OfflineAudioContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineAudioContextClass) {
    throw new Error("Offline rendering is not supported in this browser.");
  }

  const performance = buildPerformance(song);
  const beatDuration = 60 / Math.max(1, song.tempo);
  const durationSeconds = performance.totalBeats * beatDuration + 1;
  const sampleRate = 44100;
  const offline = new OfflineAudioContextClass(2, Math.ceil(durationSeconds * sampleRate), sampleRate);
  const master = offline.createGain();
  master.gain.value = 0.88;
  master.connect(offline.destination);

  performance.events.forEach((event) => {
    scheduleSynthEvent(offline, master, event, event.startBeat * beatDuration, beatDuration);
  });

  const buffer = await offline.startRendering();
  downloadBlob(`${song.title || "song"}.wav`, audioBufferToWav(buffer));
}

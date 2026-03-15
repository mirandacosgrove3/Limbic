import {
  cloneSong,
  createChord,
  createDrumPercLane,
  createLyricsLine,
  createNote,
  createSection,
  findSection,
  getBeatsPerBar,
  getDrumPatternBars,
  getSectionTypes,
  moveItem,
  sanitizeSong,
  sectionLengthInBeats,
  sortNotes,
} from "./dataModel.js";
import {
  NOTE_NAMES,
  autoSuggestChords,
  chordToMidi,
  countSyllables,
  describeRomanFunction,
  describeBarPosition,
  formatNoteName,
  getBorrowedChords,
  getChordAtBeat,
  getChordDisplayName,
  getChordToneClasses,
  getDiatonicChords,
  getNoteIndex,
  getScaleNotes,
  matchChordToRoman,
  snapPitchToScale,
  suggestNextChords,
  transposeProgression,
} from "./musicTheoryEngine.js";
import {
  generateSongIdea,
  regenerateEntireSong,
  regenerateMelodies,
  regenerateProgressions,
} from "./songGenerator.js";
import { exportMidi, exportProjectJson, exportTextSheet, exportWav } from "./exportSystem.js";
import { primeAudioContext, pulsePlaybackAudioMode } from "./audioSession.js";
import {
  buildBassNotesFromSection,
  buildSectionChordTimeline,
  createDrumSequenceFromPreset,
  getPercLaneVariantLabel,
  PlaybackEngine,
  randomizePercLaneVariant,
  randomizePercLaneSteps,
} from "./playbackEngine.js";

const STORAGE_KEY = "limbic-pocket-song-v2";
const LAYOUT_MODE_KEY = "limbic-pocket-layout-mode-v1";
const PITCH_MAX = 96;
const PITCH_MIN = 36;
const PITCH_RANGE = Array.from(
  { length: PITCH_MAX - PITCH_MIN + 1 },
  (_, index) => PITCH_MAX - index,
);
const LAYOUT_LABELS = {
  auto: "Auto",
  iphone: "iPhone",
  ipad: "iPad",
  mac: "Mac",
};
const CHORD_EXTENSIONS = ["", "7", "maj7", "9", "sus2", "sus4", "add9", "dim7"];
const CHORD_QUALITIES = [
  ["major", "Major"],
  ["minor", "Minor"],
  ["diminished", "Diminished"],
  ["augmented", "Augmented"],
];
const SECTION_TEMPLATES = {
  "Verse / Chorus": ["Verse", "Chorus", "Verse", "Chorus", "Bridge", "Chorus"],
  "Pop Arc": ["Intro", "Verse", "PreChorus", "Chorus", "Verse", "PreChorus", "Chorus", "Bridge", "Chorus", "Outro"],
  AABA: ["Verse", "Verse", "Bridge", "Verse"],
  "Loop Minimal": ["Intro", "Verse", "Verse", "Chorus", "Verse", "Outro"],
};
const SNAP_DIVISOR_OPTIONS = [2, 4, 8, 16, 32];
const NOTE_LENGTH_DIVISOR_OPTIONS = [1, 2, 4, 8, 16, 32];
const DEFAULT_RHYTHM_SNAP_DIVISOR = 4;
const DEFAULT_QUANTIZE_DIVISOR = 16;
const MIN_NOTE_DURATION_DIVISOR = 32;
const DRUM_TIME_DIVISION_OPTIONS = [4, 8, 16, 32];
const NOTE_MULTI_SELECT_HOLD_MS = 320;
const NOTE_DRAG_START_DISTANCE = 8;
const NOTE_GRID_SCROLL_CANCEL_DISTANCE = 3;
const TOUCH_EDITOR_SCROLL_START_DISTANCE = 12;
const TOUCH_POST_PINCH_PAN_START_DISTANCE = 10;
const TOUCH_POST_PINCH_PAN_NOTE_START_DISTANCE = 18;
const TOUCH_QUICK_SELECT_CANCEL_DISTANCE = 16;
const TOUCH_NOTE_SCROLL_TAKEOVER_DISTANCE = 10;
const TOUCH_NOTE_DRAG_HOLD_MS = 140;
const MIN_MELODY_ZOOM = 0.75;
const MAX_MELODY_ZOOM = 6;
const MELODY_ZOOM_STEP = 0.25;
const NOTE_GRID_SIZE_OPTIONS = [0.75, 0.875, 1.0, 1.25, 1.5, 1.75, 2.0];
const NOTE_GRID_SIZE_LABELS = { 0.875: "8?" };
const DEFAULT_NOTE_GRID_SIZE = 1.0;
const MIN_DRUM_GRID_CELL_SIZE = 16;
const MAX_DRUM_GRID_CELL_SIZE = 38;
const NOTE_EDITOR_LAYERS = {
  melody: "Melody",
  bass: "Bass",
};
const NOTE_SELECTION_MODE_LABELS = {
  magnetic: "Smart",
  rectangle: "Box",
};
const PALETTE_MODES = {
  chords: "Chords",
  drums: "Drums",
};
const MELODY_PITCH_MIN = 24;
const BASS_PITCH_MIN = 24;
const BASS_PITCH_MAX = 67;
const INSTRUMENT_FLAVORS = ["piano", "pad", "pluck", "electric keys", "simple synth"];
const CHORD_STYLES = ["block", "pulse", "arpeggio", "arpeggio-down", "ping-pong", "strum"];
const BASS_STYLES = ["root", "root-fifth", "octave", "walking", "offbeat"];
const DRUM_STYLES = ["minimal", "pop", "rock", "electronic", "halftime"];
const INTENSITY_TAGS = ["low", "medium", "lift", "breakdown", "full"];
const TRACK_LAYERS = [
  { id: "chords", label: "Chords" },
  { id: "bass", label: "Bass" },
  { id: "drums", label: "Drums" },
  { id: "melody", label: "Melody" },
];
const LYRICS_VIEW_LABELS = {
  section: "Section View",
  sheet: "Song Sheet",
};
const DRUM_SEQUENCE_ROW_LABELS = {
  kick: "Kick",
  snare: "Snare",
  hat: "Hat",
  openHat: "Open Hat",
  clap: "Clap",
};
const DRUM_SEQUENCE_ROWS = ["kick", "snare", "hat", "openHat", "clap"];

// Piano key layout: which indices in the chromatic scale are black keys
const BLACK_KEY_INDICES = new Set([1, 3, 6, 8, 10]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hashString(value) {
  return String(value)
    .split("")
    .reduce((acc, char) => ((acc * 31) + char.charCodeAt(0)) >>> 0, 7);
}

function midiToLabel(midi, settings = {}) {
  const names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const octave = Math.floor(midi / 12) - 1;
  return `${formatNoteName(names[((midi % 12) + 12) % 12], settings)}${octave}`;
}

function progressionSummary(progression = []) {
  if (!progression.length) {
    return "No chords yet";
  }
  return progression.map((chord) => getChordDisplayName(chord)).join("  ");
}

function melodySummary(notes = []) {
  if (!notes.length) {
    return "No melody notes yet";
  }
  const lastBeat = Math.max(...notes.map((note) => note.startBeat + note.duration));
  return `${notes.length} notes across ${lastBeat.toFixed(1)} beats`;
}

function generatorDefaults(song) {
  return {
    genre: "pop",
    mood: song.scaleType === "minor" ? "moody" : "bright",
    complexity: "balanced",
    key: song.key,
    tempoRange: `${Math.max(60, song.tempo - 12)}-${Math.min(180, song.tempo + 12)}`,
  };
}

function createBlankSection(name = "Verse") {
  return createSection({
    name,
    lengthInBars: 4,
    chordProgression: [],
    melodyNotes: [],
    lyricsLines: [],
    accompanimentStyle: {
      chordStyle: name === "Chorus" ? "strum" : "block",
      bassPattern: name === "Bridge" ? "walking" : "root",
      drumPreset: "pop",
    },
  });
}

function createFallbackSong() {
  return sanitizeSong({
    title: "",
    tempo: 108,
    key: "C",
    scaleType: "major",
    timeSignature: "4/4",
    sections: [createBlankSection("Verse")],
  });
}

export class UIEditor {
  constructor(root) {
    this.root = root;
    this.state = {
      song: this.loadSong(),
      activeSectionId: null,
      activeTab: "melody",
      workspaceMode: "compose",
      selectedNoteId: null,
      selectedNoteIds: [],
      selectedLyricId: null,
      selectedChordIndex: null,
      scaleSnap: true,
      rhythmSnapDivisor: DEFAULT_RHYTHM_SNAP_DIVISOR,
      drumGridCellSize: null,
      melodyZoom: 1,
      noteGridSize: DEFAULT_NOTE_GRID_SIZE,
      noteSelectionMode: "magnetic",
      noteEditorLayer: "melody",
      paletteMode: "chords",
      lyricsViewMode: "section",
      transportState: "stopped",
      playheadBeat: 0,
      playbackSectionId: null,
      playbackChordIndex: null,
      layoutMode: this.loadLayoutMode(),
      generator: null,
      ideaSuggestions: {
        song: null,
        progression: null,
        melody: null,
        chordsFromMelody: null,
      },
      exportingWav: false,
      drumStepPaint: null,
      noteMultiSelectActive: false,
      pendingNotePress: null,
      suppressNextEditorClick: false,
      quantizeDivisor: DEFAULT_QUANTIZE_DIVISOR,
      settingsDialogOpen: false,
      exportDialogOpen: false,
      tempoDialogOpen: false,
    };
    this.constrainSongNotesToScale(this.state.song);
    this.state.activeSectionId = this.state.song.sections[0]?.id || null;
    this.state.activeTab = "melody";
    this.state.noteEditorLayer = "melody";
    this.state.paletteMode = "chords";
    this.state.workspaceMode = "compose";
    this.state.lyricsViewMode = "section";
    this.state.settingsDialogOpen = false;
    this.state.exportDialogOpen = false;
    this.state.iphoneView = "editor";
    this.state.generator = generatorDefaults(this.state.song);
    this.undoStack = [];
    this.redoStack = [];
    this.historySnapshot = this.captureHistoryEntry();
    this.historySerialized = JSON.stringify(this.state.song);

    this.dragState = null;
    this.noteQuickPopupEnabled = false;
    this.pendingNoteCopySelectionKey = null;
    this.pendingNoteResizeSelectionKey = null;
    this.touchPinchState = null;
    this.postPinchPanState = null;
    this.pendingMelodyZoom = null;
    this.melodyWheelZoomCommitTimer = null;
    this.pendingQuickSelect = null;
    this.pendingGridTouchTap = null;
    this.quickSelectState = null;
    this.editorScrollTouchState = null;
    this.tempoDialogDirty = false;
    this.tempoDialDrag = null;
    this.playback = new PlaybackEngine({
      onTick: (payload) => this.handlePlaybackTick(payload),
      onStateChange: (status) => this.handlePlaybackStateChange(status),
    });
    this.playback.setSong(this.state.song);
    this.enableLoopForActiveSection();

    this.cacheElements();
    this.populateSelectOptions();
    this.applyLayoutMetrics();
    this.bindStaticEvents();
    this.renderAll();
  }

  loadSong() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return createFallbackSong();
      }
      return sanitizeSong(JSON.parse(raw));
    } catch (error) {
      return createFallbackSong();
    }
  }

  cacheElements() {
    this.refs = {
      title: document.getElementById("song-title"),
      undoButton: document.getElementById("undo-button"),
      redoButton: document.getElementById("redo-button"),
      key: document.getElementById("song-key"),
      scale: document.getElementById("song-scale"),
      tempo: document.getElementById("song-tempo"),
      tempoReadout: document.getElementById("song-tempo-readout"),
      tempoLaunch: document.getElementById("tempo-launch"),
      playTransport: document.querySelector('[data-transport="play"]'),
      pauseTransport: document.querySelector('[data-transport="pause"]'),
      stopTransport: document.querySelector('[data-transport="stop"]'),
      loopToggle: document.getElementById("loop-toggle"),
      transportState: document.getElementById("transport-state"),
      playhead: document.getElementById("playhead-readout"),
      sectionList: document.getElementById("section-list"),
      arrangementOverview: document.getElementById("arrangement-overview"),
      progressionRow: document.getElementById("progression-row"),
      chordInspector: document.getElementById("chord-inspector"),
      suggestionRow: document.getElementById("suggestion-row"),
      chordPalette: document.getElementById("chord-palette"),
      borrowedPalette: document.getElementById("borrowed-palette"),
      paletteModeSwitch: document.getElementById("palette-mode-switch"),
      pianoVisualizer: document.getElementById("piano-visualizer"),
      paletteKeyLabel: document.getElementById("palette-key-label"),
      modeTitle: document.getElementById("mode-title"),
      modePanel: document.getElementById("mode-panel"),
      modeSurface: document.getElementById("mode-surface"),
      projectImportInput: document.getElementById("project-import-input"),
      exportDialog: document.getElementById("export-dialog"),
      exportDialogSurface: document.getElementById("export-dialog-surface"),
      tempoDialog: document.getElementById("tempo-dialog"),
      tempoDialogSurface: document.getElementById("tempo-dialog-surface"),
      settingsDialog: document.getElementById("settings-dialog"),
      settingsDialogSurface: document.getElementById("settings-dialog-surface"),
      editorSurface: document.getElementById("editor-surface"),
      activeSectionTitle: document.getElementById("active-section-title"),
      editorSectionTitle: document.getElementById("editor-section-title"),
      browserPill: document.getElementById("browser-pill"),
      layoutStatus: document.getElementById("layout-status"),
    };
  }

  populateSelectOptions() {
    const noteOptions = NOTE_NAMES.map((note) => `<option value="${note}">${note}</option>`).join("");
    this.refs.key.innerHTML = noteOptions;
  }

  bindStaticEvents() {
    window.addEventListener("resize", () => this.handleViewportResize());
    window.addEventListener("orientationchange", () => this.handleViewportResize());
    window.visualViewport?.addEventListener("resize", () => this.handleViewportResize());
    window.addEventListener("keydown", (event) => this.handleGlobalKeydown(event));

    this.refs.title.addEventListener("input", (event) => {
      this.state.song.title = event.target.value;
      this.persistSong({ refreshPlayback: false });
    });
    this.refs.undoButton.addEventListener("click", () => this.undo());
    this.refs.redoButton.addEventListener("click", () => this.redo());

    // Melody tools toggle (static panel-head button)
    const melodyToolsToggle = this.root.querySelector(".melody-tools-toggle");
    if (melodyToolsToggle) {
      melodyToolsToggle.addEventListener("click", () => {
        if (document.body.dataset.melodyToolsOpen) {
          delete document.body.dataset.melodyToolsOpen;
        } else {
          document.body.dataset.melodyToolsOpen = "true";
        }
      });
    }

    this.refs.key.addEventListener("change", (event) => this.handleSongKeyChange(event.target.value));
    this.refs.scale.addEventListener("change", (event) => {
      this.state.song.scaleType = event.target.value;
      this.constrainSongNotesToScale(this.state.song);
      this.state.generator.key = this.state.song.key;
      this.persistSong();
      this.renderAll();
    });
    this.refs.tempo.addEventListener("input", (event) => {
      this.updateTempoValue(event.target.value, { persist: false });
    });
    this.refs.tempo.addEventListener("change", (event) => {
      this.updateTempoValue(event.target.value, { persist: true });
    });
    this.refs.tempoLaunch?.addEventListener("click", (event) => {
      event.preventDefault();
      this.openTempoDialog();
    });
    this.root.querySelectorAll("[data-tempo-step]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const step = parseInt(btn.dataset.tempoStep, 10);
        this.updateTempoValue(this.state.song.tempo + step, { persist: true });
      });
    });
    this.root.querySelectorAll("[data-transport]").forEach((button) => {
      button.addEventListener("click", async () => {
        const action = button.dataset.transport;
        if (action === "play") {
          await this.playback.play();
          return;
        }
        if (action === "pause") {
          this.playback.pause();
          return;
        }
        this.playback.stop();
      });
    });

    this.refs.loopToggle.addEventListener("click", () => {
      const nextLoop =
        this.playback.loopSectionId === this.state.activeSectionId ? null : this.state.activeSectionId;
      this.playback.setLoopSection(nextLoop);
      this.renderTransportStatus();
      this.renderSections();
    });

    document.getElementById("add-section-quick").addEventListener("click", () => {
      const section = createBlankSection("Verse");
      const index = this.getActiveSectionIndex();
      this.state.song.sections.splice(index + 1, 0, section);
      this.state.activeSectionId = section.id;
      this.clearNoteSelection();
      this.persistSong();
      this.renderAll();
    });

    document.getElementById("add-chord-end").addEventListener("click", () => {
      // Add the tonic chord at the end as a quick action
      const section = this.getActiveSection();
      const chord = createChord({
        root: this.state.song.key,
        quality: this.state.song.scaleType === "minor" ? "minor" : "major",
        durationInBeats: getBeatsPerBar(this.state.song),
      });
      section.chordProgression.push(chord);
      this.state.selectedChordIndex = section.chordProgression.length - 1;
      this.persistSong();
      this.auditionChord(chord);
      this.refreshHarmonyViews();
    });

    this.root.querySelectorAll(".tab-button").forEach((button) => {
      button.addEventListener("click", () => {
        this.state.activeTab = button.dataset.tab;
        this.renderTabs();
        this.renderEditor();
      });
    });

    // iPhone view switching
    this.root.querySelectorAll("[data-iphone-view]").forEach((button) => {
      button.addEventListener("click", () => {
        this.setIphoneView(button.dataset.iphoneView);
      });
    });

    // Workspace mode buttons
    this.root.querySelectorAll("[data-workspace-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.workspaceMode === "settings") {
          if (this.state.settingsDialogOpen) {
            this.closeSettingsDialog();
          } else {
            this.openSettingsDialog();
          }
          return;
        }
        if (button.dataset.workspaceMode === "export") {
          if (this.state.exportDialogOpen) {
            this.closeExportDialog();
          } else {
            this.openExportDialog();
          }
          return;
        }
        this.closeExportDialog({ render: false });
        this.closeSettingsDialog({ render: false });
        this.state.workspaceMode = button.dataset.workspaceMode;
        this.renderWorkspaceModeButtons();
        this.renderModeSurface();
      });
    });

    // Chord palette click
    this.refs.paletteModeSwitch.addEventListener("click", (event) => this.handlePaletteModeSwitchClick(event));
    this.refs.chordPalette.addEventListener("click", (event) => this.handlePaletteClick(event));
    this.refs.chordPalette.addEventListener("change", (event) => this.handlePaletteChange(event));
    this.refs.chordPalette.addEventListener("pointerdown", (event) => this.handlePalettePointerDown(event));
    this.refs.borrowedPalette.addEventListener("click", (event) => this.handlePaletteClick(event));

    this.refs.sectionList.addEventListener("click", (event) => this.handleSectionListClick(event));
    this.refs.arrangementOverview.addEventListener("click", (event) => this.handleArrangementOverviewClick(event));
    this.refs.progressionRow.addEventListener("click", (event) => this.handleProgressionClick(event));
    this.refs.chordInspector.addEventListener("click", (event) => this.handleChordInspectorClick(event));
    this.refs.chordInspector.addEventListener("change", (event) => this.handleChordInspectorChange(event));
    this.refs.suggestionRow.addEventListener("click", (event) => this.handleSuggestionClick(event));
    this.refs.modeSurface.addEventListener("click", (event) => this.handleModeSurfaceClick(event));
    this.refs.modeSurface.addEventListener("input", (event) => this.handleModeSurfaceInput(event));
    this.refs.modeSurface.addEventListener("change", (event) => this.handleModeSurfaceChange(event));
    this.refs.projectImportInput?.addEventListener("change", (event) => this.handleProjectImportChange(event));
    this.refs.exportDialog?.addEventListener("click", (event) => this.handleExportDialogClick(event));
    this.refs.tempoDialog?.addEventListener("click", (event) => this.handleTempoDialogClick(event));
    this.refs.tempoDialog?.addEventListener("pointerdown", (event) => this.handleTempoDialogPointerDown(event));
    this.refs.settingsDialog.addEventListener("click", (event) => this.handleSettingsDialogClick(event));

    this.root.addEventListener("dragstart", (event) => this.handleDragStart(event));
    this.root.addEventListener("dragover", (event) => this.handleDragOver(event));
    this.root.addEventListener("drop", (event) => this.handleDrop(event));
    this.root.addEventListener("dragend", () => this.clearDropTargets());

    this.refs.editorSurface.addEventListener("click", (event) => this.handleEditorClick(event));
    this.refs.editorSurface.addEventListener("input", (event) => this.handleEditorInput(event));
    this.refs.editorSurface.addEventListener("change", (event) => this.handleEditorChange(event));
    this.refs.editorSurface.addEventListener("pointerdown", (event) => this.handleEditorPointerDown(event));
    this.refs.editorSurface.addEventListener("touchstart", (event) => this.handleEditorTouchGestureStart(event), { passive: false });
    this.refs.editorSurface.addEventListener("touchmove", (event) => this.handleTouchGestureMove(event), { passive: false });
    this.refs.editorSurface.addEventListener("touchend", (event) => this.handleTouchGestureEnd(event));
    this.refs.editorSurface.addEventListener("touchcancel", (event) => this.handleTouchGestureEnd(event));
    this.refs.editorSurface.addEventListener("contextmenu", (event) => this.handleEditorContextMenu(event));
    this.refs.editorSurface.addEventListener("selectstart", (event) => this.handleEditorSelectionStart(event));
    this.refs.editorSurface.addEventListener("wheel", (event) => this.handleEditorWheelZoom(event), { passive: false });
    this.refs.editorSurface.addEventListener("gesturestart", (event) => this.handleEditorBrowserGesture(event), { passive: false });
    this.refs.editorSurface.addEventListener("gesturechange", (event) => this.handleEditorBrowserGesture(event), { passive: false });
    this.refs.editorSurface.addEventListener("gestureend", (event) => this.handleEditorBrowserGesture(event), { passive: false });
    this.refs.chordPalette.addEventListener("touchstart", (event) => this.handlePaletteTouchGestureStart(event), { passive: false });
    this.refs.chordPalette.addEventListener("touchmove", (event) => this.handleTouchGestureMove(event), { passive: false });
    this.refs.chordPalette.addEventListener("touchend", (event) => this.handleTouchGestureEnd(event));
    this.refs.chordPalette.addEventListener("touchcancel", (event) => this.handleTouchGestureEnd(event));
    this.refs.chordPalette.addEventListener("contextmenu", (event) => this.handlePaletteContextMenu(event));
    this.refs.chordPalette.addEventListener("selectstart", (event) => this.handlePaletteSelectionStart(event));
    this.refs.chordPalette.addEventListener("wheel", (event) => this.handlePaletteWheelZoom(event), { passive: false });
    this.refs.chordPalette.addEventListener("gesturestart", (event) => this.handlePaletteBrowserGesture(event), { passive: false });
    this.refs.chordPalette.addEventListener("gesturechange", (event) => this.handlePaletteBrowserGesture(event), { passive: false });
    this.refs.chordPalette.addEventListener("gestureend", (event) => this.handlePaletteBrowserGesture(event), { passive: false });
  }

  // ===== CHORD AUDITION =====

  auditionChord(chord, durationSeconds = 0.6) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    pulsePlaybackAudioMode("preview", Math.ceil((durationSeconds + 0.18) * 1000));
    if (!this.previewContext) {
      this.previewContext = new AudioContextClass();
    }
    if (this.previewContext.state === "suspended") {
      this.previewContext.resume();
    }
    primeAudioContext(this.previewContext);

    const pitches = chordToMidi(chord, 4);
    const now = this.previewContext.currentTime;

    pitches.forEach((pitch, i) => {
      const oscillator = this.previewContext.createOscillator();
      const gain = this.previewContext.createGain();
      const filter = this.previewContext.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 2200;

      oscillator.type = "sawtooth";
      oscillator.frequency.value = 440 * 2 ** ((pitch - 69) / 12);
      gain.gain.value = 0.0001;

      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(this.previewContext.destination);

      const staggered = now + i * 0.012;
      gain.gain.setValueAtTime(0.0001, staggered);
      gain.gain.linearRampToValueAtTime(0.08, staggered + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, staggered + durationSeconds);
      oscillator.start(staggered);
      oscillator.stop(staggered + durationSeconds + 0.05);
    });
  }

  auditionPitch(pitch, durationSeconds = 0.25) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    pulsePlaybackAudioMode("preview", Math.ceil((durationSeconds + 0.18) * 1000));
    if (!this.previewContext) {
      this.previewContext = new AudioContextClass();
    }
    if (this.previewContext.state === "suspended") {
      this.previewContext.resume();
    }
    primeAudioContext(this.previewContext);
    const oscillator = this.previewContext.createOscillator();
    const gain = this.previewContext.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.value = 440 * 2 ** ((pitch - 69) / 12);
    gain.gain.value = 0.0001;
    oscillator.connect(gain);
    gain.connect(this.previewContext.destination);
    const now = this.previewContext.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);
    oscillator.start(now);
    oscillator.stop(now + durationSeconds + 0.03);
  }

  // ===== PIANO VISUALIZER =====

  renderPianoVisualizer(chord = null) {
    const activeTones = chord ? getChordToneClasses(chord) : [];
    const rootIndex = chord ? getNoteIndex(chord.root) : -1;

    // Render one octave of piano keys (C to B)
    let html = "";
    for (let i = 0; i < 12; i++) {
      const isBlack = BLACK_KEY_INDICES.has(i);
      const isActive = activeTones.includes(i);
      const isRoot = i === rootIndex;
      const classes = [
        "piano-key",
        isBlack ? "black" : "white",
        isRoot ? "root-tone" : isActive ? "active-tone" : "",
      ].filter(Boolean).join(" ");
      html += `<div class="${classes}"></div>`;
    }
    this.refs.pianoVisualizer.innerHTML = html;
  }

  renderPaletteModeSwitch() {
    this.refs.paletteModeSwitch.innerHTML = Object.entries(PALETTE_MODES)
      .map(
        ([value, label]) =>
          `<button class="mode-button ${this.state.paletteMode === value ? "active" : ""}" data-palette-mode="${value}">${label}</button>`,
      )
      .join("");
  }

  // ===== CHORD PALETTE (ChordButter hero element) =====

  renderChordPalette() {
    this.renderPaletteModeSwitch();
    if (this.state.paletteMode === "drums") {
      this.renderDrumPalette();
      return;
    }

    const diatonic = getDiatonicChords(this.state.song.key, this.state.song.scaleType);
    const borrowed = getBorrowedChords(this.state.song.key, this.state.song.scaleType);

    this.refs.paletteKeyLabel.textContent = `${this.state.song.key} ${this.state.song.scaleType.charAt(0).toUpperCase() + this.state.song.scaleType.slice(1)}`;
    this.refs.borrowedPalette.classList.remove("hidden");
    this.refs.chordPalette.classList.remove("drum-mode");

    this.refs.chordPalette.innerHTML = diatonic.map((chord) => `
      <button class="palette-chip" data-palette-root="${chord.root}" data-palette-quality="${chord.quality}" data-palette-extension="${chord.extension || ""}">
        ${escapeHtml(getChordDisplayName(chord))}
        <span class="palette-roman">${escapeHtml(chord.roman)}</span>
      </button>
    `).join("");

    this.refs.borrowedPalette.innerHTML = `
      <p class="subtle-label" style="width:100%;margin:0 0 4px">Borrowed</p>
      ${borrowed.map((chord) => `
        <button class="palette-chip borrowed" data-palette-root="${chord.root}" data-palette-quality="${chord.quality}" data-palette-extension="${chord.extension || ""}">
          ${escapeHtml(getChordDisplayName(chord))}
          <span class="palette-roman">${escapeHtml(chord.roman)}</span>
        </button>
      `).join("")}
    `;

    // Render piano with the last selected chord or first diatonic chord
    const selectedChord = this.getSelectedChord() || (diatonic[0] ? createChord(diatonic[0]) : null);
    this.renderPianoVisualizer(selectedChord);
  }

  renderDrumPalette() {
    const section = this.getActiveSection();
    this.ensureDrumSequenceSeeded(section, false);
    const sequence = section.drumSequence;
    const stepsPerBar = sequence.stepsPerBar || 16;
    const patternBars = getDrumPatternBars(section, sequence);
    const totalSteps = Math.max(1, Math.round(patternBars * stepsPerBar));
    const liveStep = this.getLiveDrumStepIndex(section, sequence);
    const drumsMuted = this.isLayerMuted(section, "drums");
    const drumsSolo = this.isLayerSolo(section, "drums");
    const patternLengthOptions = this.getDrumPatternLengthOptions(section);
    const preservedScrollLeft = this.refs.chordPalette.scrollLeft;
    const { cellSize, scale } = this.getDrumGridMetrics(totalSteps);

    this.refs.paletteKeyLabel.textContent = `${section.name} Drum Sequencer`;
    this.refs.pianoVisualizer.innerHTML = "";
    this.refs.borrowedPalette.classList.add("hidden");
    this.refs.borrowedPalette.innerHTML = "";
    this.refs.chordPalette.classList.add("drum-mode");

    const rowMarkup = DRUM_SEQUENCE_ROWS.map((row) => `
      <div class="drum-sequencer-row">
        <div class="drum-row-label">
          <div class="drum-row-header">
            <strong>${DRUM_SEQUENCE_ROW_LABELS[row]}</strong>
            <div class="drum-voice-toggles">
              <button class="drum-toggle-button ${this.isDrumVoiceSolo(sequence, row) ? "active" : ""}" data-action="toggle-drum-row-solo" data-drum-voice-id="${row}">s</button>
              <button class="drum-toggle-button ${this.isDrumVoiceMuted(sequence, row) ? "muted" : ""}" data-action="toggle-drum-row-mute" data-drum-voice-id="${row}">m</button>
            </div>
          </div>
        </div>
        ${this.renderDrumStepGridMarkup({
          totalSteps,
          stepsPerBar,
          activeSteps: sequence.rows?.[row] || [],
          liveStep,
          row,
          audible: this.isDrumVoiceAudible(sequence, row),
          cellSize,
          scale,
        })}
      </div>
    `).join("");

    const percMarkup = (sequence.percLanes || []).map((lane, index) => `
      <div class="drum-sequencer-row perc-row">
        <div class="drum-row-label">
          <div class="drum-row-header">
            <strong>${escapeHtml(lane.name || `Perc ${index + 1}`)}</strong>
            <div class="drum-voice-toggles">
              <button class="drum-toggle-button ${this.isDrumVoiceSolo(sequence, lane.id) ? "active" : ""}" data-action="toggle-drum-row-solo" data-drum-voice-id="${lane.id}">s</button>
              <button class="drum-toggle-button ${this.isDrumVoiceMuted(sequence, lane.id) ? "muted" : ""}" data-action="toggle-drum-row-mute" data-drum-voice-id="${lane.id}">m</button>
            </div>
          </div>
          <span class="small-copy">${escapeHtml(getPercLaneVariantLabel(lane.variant))}</span>
          <div class="drum-row-tools">
            <button class="mini-button" data-action="randomize-perc-lane" data-perc-lane-id="${lane.id}">Random Sound</button>
            <button class="mini-button danger" data-action="remove-perc-lane" data-perc-lane-id="${lane.id}">Remove</button>
          </div>
        </div>
        ${this.renderDrumStepGridMarkup({
          totalSteps,
          stepsPerBar,
          activeSteps: lane.steps || [],
          liveStep,
          laneId: lane.id,
          audible: this.isDrumVoiceAudible(sequence, lane.id),
          cellSize,
          scale,
        })}
      </div>
    `).join("");

    this.refs.chordPalette.innerHTML = `
      <div class="drum-palette-toolbar">
        <label class="meta-field drum-toolbar-field">
          <span>Kit</span>
          <select data-drum-setting="kit">
            ${DRUM_STYLES.map((style) => `<option value="${style}" ${sequence.kit === style ? "selected" : ""}>${style}</option>`).join("")}
          </select>
        </label>
        <label class="meta-field drum-toolbar-field">
          <span>Time</span>
          <select data-drum-setting="time-division" aria-label="Drum time division">
            ${DRUM_TIME_DIVISION_OPTIONS.map((value) => `<option value="${value}" ${stepsPerBar === value ? "selected" : ""}>/${value}</option>`).join("")}
          </select>
        </label>
        <label class="status-pill drum-pattern-pill drum-toolbar-pattern">
          <span>${totalSteps} steps</span>
          <select data-drum-setting="pattern-bars" aria-label="Drum pattern length">
            ${patternLengthOptions.map((option) => `<option value="${option.value}" ${option.value === patternBars ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
          </select>
        </label>
        <div class="drum-toolbar-actions">
          <button class="action-button ${drumsSolo ? "active" : ""}" data-action="toggle-drum-sequencer-solo">${drumsSolo ? "Solo On" : "Solo"}</button>
          <button class="action-button ${drumsMuted ? "active" : ""}" data-action="toggle-drum-sequencer-mute">${drumsMuted ? "Muted" : "Mute"}</button>
          <button class="action-button danger" data-action="clear-drum-sequence">Clear</button>
          <button class="action-button" data-action="add-perc-lane">Add Perc / Texture</button>
          <button class="action-button" data-action="reseed-drum-sequence">Use Kit Pattern</button>
        </div>
      </div>
      <div class="drum-sequencer">
        ${rowMarkup}
        ${percMarkup}
      </div>
    `;
    this.refs.chordPalette.scrollLeft = preservedScrollLeft;
  }

  renderDrumStepGridMarkup({
    totalSteps,
    stepsPerBar,
    activeSteps = [],
    liveStep = null,
    row = null,
    laneId = null,
    audible = true,
    cellSize,
    scale,
  }) {
    const activeSet = new Set(activeSteps);
    if (this.layoutProfile === "iphone") {
      const chunkSize = Math.max(1, Math.min(stepsPerBar, totalSteps));
      const chunkMarkup = Array.from({ length: Math.ceil(totalSteps / chunkSize) }, (_, chunkIndex) => {
        const startStep = chunkIndex * chunkSize;
        const stepCount = Math.min(chunkSize, totalSteps - startStep);
        return `
          <div class="drum-step-grid drum-step-grid--mobile-bar" style="grid-template-columns:repeat(${stepCount}, minmax(0, 1fr))">
            ${Array.from({ length: stepCount }, (_, index) => this.renderDrumStepButtonMarkup({
              step: startStep + index,
              activeSet,
              liveStep,
              stepsPerBar,
              row,
              laneId,
              audible,
            })).join("")}
          </div>
        `;
      }).join("");
      return `
        <div class="drum-step-grid-wrap stacked">
          <div class="drum-step-grid-stack">
            ${chunkMarkup}
          </div>
        </div>
      `;
    }
    return `
      <div class="drum-step-grid-wrap">
        <div class="drum-step-grid auto-fit" style="grid-template-columns:repeat(${totalSteps}, ${cellSize}px);--drum-fit-scale:${scale}">
          ${Array.from({ length: totalSteps }, (_, step) => this.renderDrumStepButtonMarkup({
            step,
            activeSet,
            liveStep,
            stepsPerBar,
            row,
            laneId,
            audible,
          })).join("")}
        </div>
      </div>
    `;
  }

  renderDrumStepButtonMarkup({
    step,
    activeSet,
    liveStep,
    stepsPerBar,
    row = null,
    laneId = null,
    audible = true,
  }) {
    const stepAttributes = row
      ? `data-drum-row="${row}"`
      : `data-perc-lane-id="${laneId}"`;
    return `
      <button
        class="drum-step ${activeSet.has(step) ? "active" : ""} ${liveStep === step ? "live" : ""} ${this.getDrumStepAccentClass(step, stepsPerBar)} ${audible ? "" : "dimmed"}"
        ${stepAttributes}
        data-drum-step="${step}"
      ></button>
    `;
  }

  handlePaletteModeSwitchClick(event) {
    const button = event.target.closest("[data-palette-mode]");
    if (!button) return;
    this.setPaletteMode(button.dataset.paletteMode);
  }

  getLiveDrumStepIndex(section, sequence) {
    if (this.state.transportState !== "playing") return null;
    if (this.state.playbackSectionId !== section.id) return null;
    const localBeat = this.state.playheadBeat - this.getSectionStartBeat(section.id);
    const patternBars = getDrumPatternBars(section, sequence);
    const patternBeats = patternBars * getBeatsPerBar(this.state.song);
    const stepsPerBar = sequence.stepsPerBar || 16;
    const stepDuration = getBeatsPerBar(this.state.song) / stepsPerBar;
    const totalSteps = Math.max(1, Math.round(patternBars * stepsPerBar));
    const patternBeat = ((localBeat % patternBeats) + patternBeats) % patternBeats;
    return clamp(Math.floor(patternBeat / stepDuration), 0, Math.max(0, totalSteps - 1));
  }

  getDrumPatternLengthOptions(section) {
    const sectionBars = Math.max(1, section.lengthInBars || 4);
    const optionValues = [...new Set(
      [0.5, 1, Math.max(0.5, sectionBars / 2), sectionBars]
        .map((value) => Math.round(Math.min(sectionBars, Math.max(0.5, value)) * 2) / 2),
    )].sort((left, right) => left - right);
    return optionValues.map((value) => ({
      value,
      label: value === sectionBars
        ? "Full section"
        : value === 0.5
          ? "1/2 bar"
          : `${value} bar${value === 1 ? "" : "s"}`,
    }));
  }

  getDrumGridMetrics(totalSteps) {
    const baseCellSize = this.layoutProfile === "iphone" ? 16 : 18;
    const gap = this.layoutProfile === "iphone" ? 4 : 6;
    const paletteWidth = this.refs?.chordPalette?.clientWidth || this.getViewportFrame().width || 320;
    const labelWidth = this.layoutProfile === "iphone" ? 86 : 120;
    const rowGap = this.layoutProfile === "iphone" ? 8 : 10;
    const availableWidth = Math.max(120, paletteWidth - labelWidth - rowGap - 8);
    const naturalWidth = totalSteps * baseCellSize + Math.max(0, totalSteps - 1) * gap;
    const scale = naturalWidth > 0 ? Math.min(1, availableWidth / naturalWidth) : 1;
    return {
      cellSize: clamp(baseCellSize, MIN_DRUM_GRID_CELL_SIZE, MAX_DRUM_GRID_CELL_SIZE),
      scale: Number(scale.toFixed(4)),
    };
  }

  getDrumBeatMarkers(stepsPerBar) {
    const normalizedStepsPerBar = Math.max(1, Number(stepsPerBar) || 16);
    const beatsPerBar = Math.max(1, getBeatsPerBar(this.state.song));
    return new Set(
      Array.from({ length: beatsPerBar }, (_, beatIndex) => {
        const marker = Math.round((beatIndex * normalizedStepsPerBar) / beatsPerBar);
        return Math.min(normalizedStepsPerBar - 1, Math.max(0, marker));
      }),
    );
  }

  getDrumStepAccentClass(step, stepsPerBar = 16) {
    const classes = [];
    const normalizedStepsPerBar = Math.max(1, Number(stepsPerBar) || 16);
    const stepInBar = ((step % normalizedStepsPerBar) + normalizedStepsPerBar) % normalizedStepsPerBar;
    if (this.getDrumBeatMarkers(normalizedStepsPerBar).has(stepInBar)) classes.push("beat-start");
    if (stepInBar === 0) classes.push("bar-start");
    return classes.join(" ");
  }

  remapDrumSteps(steps = [], sourceTotalSteps, targetTotalSteps) {
    const normalizedSourceTotal = Math.max(1, Number(sourceTotalSteps) || 1);
    const normalizedTargetTotal = Math.max(1, Number(targetTotalSteps) || normalizedSourceTotal);
    const normalizedSteps = [...new Set(
      (steps || []).filter((step) => Number.isFinite(step) && step >= 0 && step < normalizedSourceTotal),
    )].sort((left, right) => left - right);
    if (normalizedTargetTotal === normalizedSourceTotal) {
      return normalizedSteps;
    }
    if (normalizedTargetTotal < normalizedSourceTotal) {
      return normalizedSteps.filter((step) => step < normalizedTargetTotal);
    }
    const repeatedSteps = [];
    const repeats = Math.ceil(normalizedTargetTotal / normalizedSourceTotal);
    for (let repeatIndex = 0; repeatIndex < repeats; repeatIndex += 1) {
      const offset = repeatIndex * normalizedSourceTotal;
      normalizedSteps.forEach((step) => {
        const nextStep = step + offset;
        if (nextStep < normalizedTargetTotal) repeatedSteps.push(nextStep);
      });
    }
    return repeatedSteps;
  }

  setDrumTimeDivision(sequence, section, nextStepsPerBar) {
    const currentStepsPerBar = Math.max(1, Number(sequence.stepsPerBar) || 16);
    const targetStepsPerBar = Math.max(1, Number(nextStepsPerBar) || currentStepsPerBar);
    if (currentStepsPerBar === targetStepsPerBar) return;
    const patternBars = getDrumPatternBars(section, sequence);
    const sourceTotalSteps = Math.max(1, Math.round(patternBars * currentStepsPerBar));
    const targetTotalSteps = Math.max(1, Math.round(patternBars * targetStepsPerBar));

    DRUM_SEQUENCE_ROWS.forEach((row) => {
      sequence.rows[row] = this.remapDrumSteps(
        sequence.rows?.[row] || [],
        sourceTotalSteps,
        targetTotalSteps,
      );
    });
    sequence.percLanes = (sequence.percLanes || []).map((lane) => ({
      ...lane,
      steps: this.remapDrumSteps(
        lane.steps || [],
        sourceTotalSteps,
        targetTotalSteps,
      ),
    }));
    sequence.stepsPerBar = targetStepsPerBar;
    sequence.initialized = true;
  }

  setDrumPatternBars(sequence, section, patternBars) {
    const clampedPatternBars = getDrumPatternBars(section, { patternBars });
    const totalSteps = Math.max(1, Math.round(clampedPatternBars * (sequence.stepsPerBar || 16)));
    sequence.patternBars = clampedPatternBars;
    DRUM_SEQUENCE_ROWS.forEach((row) => {
      sequence.rows[row] = (sequence.rows?.[row] || []).filter((step) => step < totalSteps);
    });
    sequence.percLanes = (sequence.percLanes || []).map((lane) => ({
      ...lane,
      steps: (lane.steps || []).filter((step) => step < totalSteps),
    }));
  }

  isDrumVoiceMuted(sequence, voiceId) {
    return new Set(sequence?.mutedRows || []).has(voiceId);
  }

  isDrumVoiceSolo(sequence, voiceId) {
    return new Set(sequence?.soloRows || []).has(voiceId);
  }

  isDrumVoiceAudible(sequence, voiceId) {
    const mutedRows = new Set(sequence?.mutedRows || []);
    const soloRows = new Set(sequence?.soloRows || []);
    return !mutedRows.has(voiceId) && (!soloRows.size || soloRows.has(voiceId));
  }

  toggleDrumVoiceMute(sequence, voiceId) {
    const mutedRows = new Set(sequence?.mutedRows || []);
    if (mutedRows.has(voiceId)) mutedRows.delete(voiceId);
    else mutedRows.add(voiceId);
    sequence.mutedRows = [...mutedRows];
  }

  toggleDrumVoiceSolo(sequence, voiceId) {
    const soloRows = new Set(sequence?.soloRows || []);
    if (soloRows.has(voiceId)) soloRows.delete(voiceId);
    else soloRows.add(voiceId);
    sequence.soloRows = [...soloRows];
  }

  setDrumStepValue(sequence, row, laneId, step, shouldAdd) {
    if (row) {
      const steps = new Set(sequence.rows?.[row] || []);
      if (shouldAdd) steps.add(step);
      else steps.delete(step);
      sequence.rows[row] = [...steps].sort((left, right) => left - right);
      return;
    }
    if (!laneId) return;
    const lane = (sequence.percLanes || []).find((entry) => entry.id === laneId);
    if (!lane) return;
    const steps = new Set(lane.steps || []);
    if (shouldAdd) steps.add(step);
    else steps.delete(step);
    lane.steps = [...steps].sort((left, right) => left - right);
  }

  clearDrumSequence(sequence) {
    DRUM_SEQUENCE_ROWS.forEach((row) => {
      sequence.rows[row] = [];
    });
    sequence.percLanes = (sequence.percLanes || []).map((lane) => ({ ...lane, steps: [] }));
    sequence.initialized = true;
  }

  handlePaletteClick(event) {
    if (this.state.paletteMode === "drums") {
      this.handleDrumPaletteClick(event);
      return;
    }
    const chip = event.target.closest(".palette-chip");
    if (!chip) return;

    const section = this.getActiveSection();
    const chord = createChord({
      root: chip.dataset.paletteRoot,
      quality: chip.dataset.paletteQuality,
      extension: chip.dataset.paletteExtension || "",
      durationInBeats: getBeatsPerBar(this.state.song),
    });

    // Immediately add to progression (ChordButter tap-to-add)
    section.chordProgression.push(chord);
    this.state.selectedChordIndex = section.chordProgression.length - 1;

    this.auditionChord(chord);
    this.persistSong();
    this.refreshHarmonyViews();
    this.renderPianoVisualizer(chord);
  }

  handlePaletteChange(event) {
    if (this.state.paletteMode !== "drums") return;
    const target = event.target;
    if (target.dataset.drumSetting === "kit") {
      const section = this.getActiveSection();
      section.accompanimentStyle.drumPreset = target.value;
      section.accompanimentStyle.drumStyle = target.value;
      const nextSequence = createDrumSequenceFromPreset(section, this.state.song, target.value);
      nextSequence.mutedRows = [...(section.drumSequence?.mutedRows || [])];
      nextSequence.soloRows = [...(section.drumSequence?.soloRows || [])];
      section.drumSequence = nextSequence;
      this.persistSong();
      this.renderChordPalette();
      this.renderArrangementOverview();
      this.renderEditor();
      return;
    }
    if (target.dataset.drumSetting === "pattern-bars") {
      const section = this.getActiveSection();
      this.setDrumPatternBars(section.drumSequence, section, Number.parseFloat(target.value));
      this.persistSong();
      this.renderChordPalette();
      return;
    }
    if (target.dataset.drumSetting === "time-division") {
      const section = this.getActiveSection();
      this.setDrumTimeDivision(section.drumSequence, section, Number.parseInt(target.value, 10));
      this.persistSong();
      this.renderChordPalette();
      return;
    }
  }

  handlePalettePointerDown(event) {
    if (this.state.paletteMode !== "drums") return;
    const stepButton = event.target.closest(".drum-step");
    if (!stepButton) return;

    event.preventDefault();
    this.setDrumInteractionLock(true);
    try { stepButton.setPointerCapture(event.pointerId); } catch (error) {}

    const section = this.getActiveSection();
    this.ensureDrumSequenceSeeded(section, false);
    const sequence = section.drumSequence;
    const row = stepButton.dataset.drumRow || null;
    const laneId = stepButton.dataset.percLaneId || null;
    const step = Number.parseInt(stepButton.dataset.drumStep, 10);
    if (Number.isNaN(step)) return;

    const isActive = row
      ? (sequence.rows?.[row] || []).includes(step)
      : ((sequence.percLanes || []).find((entry) => entry.id === laneId)?.steps || []).includes(step);
    const mode = isActive ? "erase" : "paint";

    this.state.drumStepPaint = {
      pointerId: event.pointerId,
      mode,
      touched: new Set(),
      element: stepButton,
    };

    this.applyDrumPaintStep(stepButton, sequence);

    window.addEventListener("pointermove", this.boundDrumPaintMove || (this.boundDrumPaintMove = (e) => this.handleDrumPaintMove(e)));
    window.addEventListener("pointerup", this.boundDrumPaintUp || (this.boundDrumPaintUp = (e) => this.handleDrumPaintEnd(e)));
    window.addEventListener("pointercancel", this.boundDrumPaintCancel || (this.boundDrumPaintCancel = (e) => this.handleDrumPaintEnd(e)));
  }

  applyDrumPaintStep(stepButton, sequence = this.getActiveSection().drumSequence) {
    const paintState = this.state.drumStepPaint;
    if (!paintState) return;
    const row = stepButton.dataset.drumRow || null;
    const laneId = stepButton.dataset.percLaneId || null;
    const step = Number.parseInt(stepButton.dataset.drumStep, 10);
    if (Number.isNaN(step)) return;
    const key = `${row || laneId}:${step}`;
    if (paintState.touched.has(key)) return;
    paintState.touched.add(key);
    this.setDrumStepValue(sequence, row, laneId, step, paintState.mode === "paint");
    stepButton.classList.toggle("active", paintState.mode === "paint");
  }

  handleDrumPaintMove(event) {
    const paintState = this.state.drumStepPaint;
    if (!paintState || event.pointerId !== paintState.pointerId) return;
    if (event.cancelable) event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".drum-step");
    if (!target) return;
    this.applyDrumPaintStep(target);
  }

  handleDrumPaintEnd(event) {
    const paintState = this.state.drumStepPaint;
    if (!paintState || (typeof event.pointerId === "number" && event.pointerId !== paintState.pointerId)) return;
    try { paintState.element?.releasePointerCapture?.(paintState.pointerId); } catch (error) {}
    this.state.drumStepPaint = null;
    this.setDrumInteractionLock(false);
    window.removeEventListener("pointermove", this.boundDrumPaintMove);
    window.removeEventListener("pointerup", this.boundDrumPaintUp);
    window.removeEventListener("pointercancel", this.boundDrumPaintCancel);
    this.persistSong();
    this.renderChordPalette();
    this.renderArrangementOverview();
    if (this.state.activeTab === "studio") {
      this.renderEditor();
    }
  }

  handleDrumPaletteClick(event) {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.classList.contains("drum-step")) {
      return;
    }
    const section = this.getActiveSection();
    this.ensureDrumSequenceSeeded(section, false);
    const sequence = section.drumSequence;
    const totalSteps = Math.max(1, Math.round(getDrumPatternBars(section, sequence) * (sequence.stepsPerBar || 16)));

    if (button.dataset.action === "toggle-drum-row-mute" && button.dataset.drumVoiceId) {
      this.toggleDrumVoiceMute(sequence, button.dataset.drumVoiceId);
      this.persistSong();
      this.renderChordPalette();
      if (this.state.activeTab === "studio") this.renderEditor();
      return;
    }

    if (button.dataset.action === "toggle-drum-row-solo" && button.dataset.drumVoiceId) {
      this.toggleDrumVoiceSolo(sequence, button.dataset.drumVoiceId);
      this.persistSong();
      this.renderChordPalette();
      if (this.state.activeTab === "studio") this.renderEditor();
      return;
    }

    if (button.dataset.action === "toggle-drum-sequencer-mute") {
      this.toggleSectionLayerMute(section, "drums");
      this.persistSong();
      this.renderChordPalette();
      this.renderArrangementOverview();
      if (this.state.activeTab === "studio") this.renderEditor();
      return;
    }

    if (button.dataset.action === "toggle-drum-sequencer-solo") {
      this.toggleSectionLayerSolo(section, "drums");
      this.persistSong();
      this.renderChordPalette();
      this.renderArrangementOverview();
      if (this.state.activeTab === "studio") this.renderEditor();
      return;
    }

    if (button.dataset.action === "clear-drum-sequence") {
      this.clearDrumSequence(sequence);
      this.persistSong();
      this.renderChordPalette();
      return;
    }

    if (button.dataset.action === "add-perc-lane") {
      const laneIndex = (sequence.percLanes?.length || 0) + 1;
      const seed = `${section.id}-${sequence.kit}-perc-${laneIndex}`;
      const variant = randomizePercLaneVariant(seed);
      sequence.percLanes = [
        ...(sequence.percLanes || []),
        createDrumPercLane({
          name: `Perc ${laneIndex}`,
          variant,
          steps: randomizePercLaneSteps(totalSteps, seed),
        }),
      ];
      this.persistSong();
      this.renderChordPalette();
      return;
    }

    if (button.dataset.action === "reseed-drum-sequence") {
      const nextSequence = createDrumSequenceFromPreset(section, this.state.song, sequence.kit);
      nextSequence.mutedRows = [...(sequence.mutedRows || [])];
      nextSequence.soloRows = [...(sequence.soloRows || [])];
      section.drumSequence = nextSequence;
      this.persistSong();
      this.renderChordPalette();
      return;
    }

    if (button.dataset.action === "randomize-perc-lane") {
      const lane = (sequence.percLanes || []).find((entry) => entry.id === button.dataset.percLaneId);
      if (!lane) return;
      lane.variant = randomizePercLaneVariant(`${lane.id}-${Date.now()}`, lane.variant);
      this.persistSong();
      this.renderChordPalette();
      return;
    }

    if (button.dataset.action === "remove-perc-lane") {
      sequence.percLanes = (sequence.percLanes || []).filter((entry) => entry.id !== button.dataset.percLaneId);
      this.persistSong();
      this.renderChordPalette();
      return;
    }
  }

  // ===== CHORD EDIT SHEET (bottom sheet popup) =====

  // ===== LAYOUT =====

  loadLayoutMode() {
    try {
      const stored = window.localStorage.getItem(LAYOUT_MODE_KEY);
      if (stored && ["auto", "iphone", "ipad", "mac"].includes(stored)) {
        return stored;
      }
    } catch (error) {
      // Ignore storage failures.
    }
    return "auto";
  }

  detectEnvironment() {
    const userAgent = navigator.userAgent || "";
    const vendor = navigator.vendor || "";
    const platform = navigator.platform || "";
    const maxTouchPoints = navigator.maxTouchPoints || 0;
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches
      || window.navigator.standalone === true;
    const isSafari =
      /Safari/i.test(userAgent) &&
      /Apple/i.test(vendor) &&
      !/CriOS|Chrome|FxiOS|Firefox|EdgiOS|Edg|OPR|OPiOS|SamsungBrowser/i.test(userAgent);
    const isIPad = /iPad/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
    const isIPhone = /iPhone|iPod/i.test(userAgent);
    const device = isIPad ? "ipad" : isIPhone ? "iphone" : "mac";
    return {
      isSafari,
      isStandalone,
      hasTouch: maxTouchPoints > 0,
      device,
    };
  }

  getViewportFrame() {
    const visualViewport = window.visualViewport;
    return {
      width: visualViewport?.width || window.innerWidth || this.root?.clientWidth || 1024,
      height: visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 768,
      offsetTop: visualViewport?.offsetTop || 0,
    };
  }

  getResolvedLayoutMode() {
    if (this.state.layoutMode !== "auto") return this.state.layoutMode;
    const device = this.environment?.device || this.detectEnvironment().device;
    const vw = this.getViewportFrame().width;
    if (device === "mac" && vw < 600) return "iphone";
    if (device === "mac" && vw < 900) return "ipad";
    return device;
  }

  getLayoutMetrics() {
    const resolvedMode = this.getResolvedLayoutMode();
    const section = this.getActiveSection?.() || this.state.song?.sections?.[0] || createBlankSection("Verse");
    const totalBeats = Math.max(1, sectionLengthInBeats(this.state.song, section));
    const viewportWidth = this.refs?.editorSurface?.clientWidth || this.getViewportFrame().width || this.root?.clientWidth || 1024;
    const noteGridSize = this.state.noteGridSize || DEFAULT_NOTE_GRID_SIZE;
    const pitchRailWidth = resolvedMode === "iphone" ? 48 : 56;
    const shellAllowance = resolvedMode === "iphone" ? 18 : 36;
    const availableGridWidth = Math.max(resolvedMode === "iphone" ? 240 : 320, viewportWidth - pitchRailWidth - shellAllowance);

    // iPhone base = 1.5x original (rowHeight 20→30, beatWidth 32→48)
    let baseBeatWidth = 58;
    let rowHeight = 28;
    let maxSmartBeatWidth = 96;

    if (resolvedMode === "iphone") {
      baseBeatWidth = Math.round(48 * noteGridSize);
      rowHeight = Math.round(30 * noteGridSize);
      maxSmartBeatWidth = Math.round(96 * noteGridSize);
    } else if (resolvedMode === "ipad") {
      baseBeatWidth = 48;
      rowHeight = 30;
      maxSmartBeatWidth = 88;
    }

    const fitBeatWidth = availableGridWidth / totalBeats;
    const smartBeatWidth = clamp(Math.max(baseBeatWidth, fitBeatWidth), baseBeatWidth, maxSmartBeatWidth);
    const zoomedBeatWidth = clamp(
      smartBeatWidth * (this.state.melodyZoom || 1),
      22,
      maxSmartBeatWidth * MAX_MELODY_ZOOM,
    );

    return { beatWidth: Number(zoomedBeatWidth.toFixed(4)), rowHeight };
  }

  applyLayoutMetrics() {
    this.environment = this.detectEnvironment();
    this.layoutProfile = this.getResolvedLayoutMode();
    this.layoutMetrics = this.getLayoutMetrics();
    const viewportFrame = this.getViewportFrame();
    this.root.style.setProperty("--beat-width", `${this.layoutMetrics.beatWidth}px`);
    this.root.style.setProperty("--row-height", `${this.layoutMetrics.rowHeight}px`);
    document.documentElement.style.setProperty("--viewport-height", `${Math.round(viewportFrame.height)}px`);
    document.documentElement.style.setProperty("--viewport-offset-top", `${Math.round(viewportFrame.offsetTop)}px`);
    document.body.dataset.layoutProfile = this.layoutProfile;
    document.body.dataset.browserProfile = this.environment.isSafari ? "safari" : "default";
    document.body.dataset.standalone = this.environment.isStandalone ? "true" : "false";
    document.body.dataset.touch = this.environment.hasTouch ? "true" : "false";
    this.applyIphoneView();
  }

  setIphoneView(view) {
    if (this.layoutProfile !== "iphone") return;
    if (!["editor", "tracks", "chords"].includes(view)) return;
    if (this.state.iphoneView === view) return;
    this.state.iphoneView = view;
    // Close melody tools sheet when switching views
    delete document.body.dataset.melodyToolsOpen;
    // Auto-switch editor tab based on view
    if (view === "tracks" && !["studio", "arrangement"].includes(this.state.activeTab)) {
      this.state.activeTab = "studio";
    } else if (view === "editor" && !["melody", "lyrics"].includes(this.state.activeTab)) {
      this.state.activeTab = "melody";
    }
    this.applyIphoneView();
    this.renderTabs();
    this.renderEditor();
  }

  applyIphoneView() {
    if (this.layoutProfile !== "iphone") {
      delete document.body.dataset.iphoneView;
      return;
    }
    document.body.dataset.iphoneView = this.state.iphoneView;
    this.root.querySelectorAll(".iphone-view-tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.iphoneView === this.state.iphoneView);
    });
  }

  handleViewportResize() {
    const previous = this.layoutMetrics || {};
    const previousLayoutProfile = this.layoutProfile;
    const next = this.getLayoutMetrics();
    this.applyLayoutMetrics();
    if (
      previous.beatWidth === next.beatWidth &&
      previous.rowHeight === next.rowHeight &&
      previousLayoutProfile === this.layoutProfile
    ) return;
    this.renderAll();
  }

  async handleGlobalKeydown(event) {
    if (event.key === "Escape" && this.state.settingsDialogOpen) {
      event.preventDefault();
      this.closeSettingsDialog();
      return;
    }
    if (event.key === "Escape" && this.state.exportDialogOpen) {
      event.preventDefault();
      this.closeExportDialog();
      return;
    }
    if (event.key === "Escape" && this.state.tempoDialogOpen) {
      event.preventDefault();
      this.closeTempoDialog();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !isTypingTarget(event.target)) {
      event.preventDefault();
      if (event.shiftKey) {
        this.redo();
      } else {
        this.undo();
      }
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y" && !isTypingTarget(event.target)) {
      event.preventDefault();
      this.redo();
      return;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && !isTypingTarget(event.target) && this.state.activeTab === "melody") {
      if (this.getSelectedNoteIds().length) {
        event.preventDefault();
        this.deleteSelectedNote();
        return;
      }
    }
    if (event.code !== "Space" || event.repeat || isTypingTarget(event.target)) return;
    event.preventDefault();

    if (this.state.transportState === "playing") {
      this.playback.pause();
      return;
    }

    await this.playback.play();
  }

  setLayoutMode(mode) {
    if (!["auto", "iphone", "ipad", "mac"].includes(mode) || this.state.layoutMode === mode) return;
    this.state.layoutMode = mode;
    try {
      window.localStorage.setItem(LAYOUT_MODE_KEY, mode);
    } catch (error) {}
    this.applyLayoutMetrics();
    this.renderAll();
  }

  // ===== CORE HELPERS =====

  getActiveSection() {
    return findSection(this.state.song, this.state.activeSectionId);
  }

  getActiveSectionIndex() {
    return this.state.song.sections.findIndex((section) => section.id === this.state.activeSectionId);
  }

  ensureLoopSectionInitialized({ force = false } = {}) {
    if (!this.playback || !this.state.activeSectionId) return;
    const currentLoopId = this.playback.loopSectionId;
    const hasValidLoopSection = currentLoopId
      ? this.state.song.sections.some((section) => section.id === currentLoopId)
      : false;
    if (!force && (!currentLoopId || hasValidLoopSection)) return;
    this.playback.setLoopSection(this.state.activeSectionId);
  }

  enableLoopForActiveSection() {
    this.ensureRenderableState();
    this.ensureLoopSectionInitialized({ force: true });
  }

  ensureRenderableState() {
    if (!Array.isArray(this.state.song.sections) || !this.state.song.sections.length) {
      this.state.song = sanitizeSong(this.state.song);
    }

    const activeSection =
      this.state.song.sections.find((section) => section.id === this.state.activeSectionId)
      || this.state.song.sections[0]
      || null;
    this.state.activeSectionId = activeSection?.id || null;

    if (!Object.hasOwn(NOTE_EDITOR_LAYERS, this.state.noteEditorLayer)) {
      this.state.noteEditorLayer = "melody";
    }
    if (!Object.hasOwn(PALETTE_MODES, this.state.paletteMode)) {
      this.state.paletteMode = "chords";
    }
    if (!["melody", "lyrics", "studio", "arrangement"].includes(this.state.activeTab)) {
      this.state.activeTab = "melody";
    }
    if (!["compose", "ideas", "export"].includes(this.state.workspaceMode)) {
      this.state.workspaceMode = "compose";
    }
    if (!Object.hasOwn(LYRICS_VIEW_LABELS, this.state.lyricsViewMode)) {
      this.state.lyricsViewMode = "section";
    }

    const chordCount = activeSection?.chordProgression?.length || 0;
    if (
      !Number.isInteger(this.state.selectedChordIndex)
      || this.state.selectedChordIndex < 0
      || this.state.selectedChordIndex >= chordCount
    ) {
      this.state.selectedChordIndex = chordCount ? clamp(this.state.selectedChordIndex ?? 0, 0, chordCount - 1) : null;
    }
  }

  captureHistoryEntry() {
    return {
      song: cloneSong(this.state.song),
      activeSectionId: this.state.activeSectionId,
      activeTab: this.state.activeTab,
      noteEditorLayer: this.state.noteEditorLayer,
      paletteMode: this.state.paletteMode,
      selectedNoteId: this.state.selectedNoteId,
      selectedNoteIds: [...(this.state.selectedNoteIds || [])],
      noteMultiSelectActive: Boolean(this.state.noteMultiSelectActive),
      selectedChordIndex: this.state.selectedChordIndex,
    };
  }

  applyHistoryEntry(entry) {
    this.state.song = sanitizeSong(cloneSong(entry.song));
    this.state.activeSectionId = this.state.song.sections.find((section) => section.id === entry.activeSectionId)?.id
      || this.state.song.sections[0]?.id
      || null;
    this.state.activeTab = entry.activeTab || this.state.activeTab;
    this.state.noteEditorLayer = entry.noteEditorLayer || this.state.noteEditorLayer;
    this.state.paletteMode = entry.paletteMode || this.state.paletteMode;
    this.state.selectedNoteId = entry.selectedNoteId;
    this.state.selectedNoteIds = [...(entry.selectedNoteIds || (entry.selectedNoteId ? [entry.selectedNoteId] : []))];
    this.state.noteMultiSelectActive = Boolean(entry.noteMultiSelectActive && this.state.selectedNoteIds.length);
    this.state.selectedChordIndex = entry.selectedChordIndex;
    this.playback.stop();
    this.persistSong({ recordHistory: false });
    this.renderAll();
  }

  updateHistoryButtons() {
    this.refs.undoButton.disabled = this.undoStack.length === 0;
    this.refs.redoButton.disabled = this.redoStack.length === 0;
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push(this.captureHistoryEntry());
    this.applyHistoryEntry(entry);
    this.historySnapshot = this.captureHistoryEntry();
    this.historySerialized = JSON.stringify(this.state.song);
    this.updateHistoryButtons();
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push(this.captureHistoryEntry());
    this.applyHistoryEntry(entry);
    this.historySnapshot = this.captureHistoryEntry();
    this.historySerialized = JSON.stringify(this.state.song);
    this.updateHistoryButtons();
  }

  getSelectedChord() {
    if (typeof this.state.selectedChordIndex !== "number") return null;
    return this.getActiveSection().chordProgression[this.state.selectedChordIndex] || null;
  }

  getSelectedNote() {
    const notes = this.getActiveRollNotes();
    if (this.state.selectedNoteId) {
      const primary = notes.find((note) => note.id === this.state.selectedNoteId);
      if (primary) return primary;
    }
    const fallbackId = this.getSelectedNoteIds().at(-1);
    return notes.find((note) => note.id === fallbackId) || null;
  }

  getSelectedNoteIds(section = this.getActiveSection()) {
    const validIds = new Set(this.getActiveRollNotes(section).map((note) => note.id));
    const selectedIds = [...(this.state.selectedNoteIds || [])].filter((noteId) => validIds.has(noteId));
    if (this.state.selectedNoteId && validIds.has(this.state.selectedNoteId) && !selectedIds.includes(this.state.selectedNoteId)) {
      selectedIds.push(this.state.selectedNoteId);
    }
    return selectedIds;
  }

  getSelectedNotes(section = this.getActiveSection()) {
    const selectedIds = new Set(this.getSelectedNoteIds(section));
    return this.getActiveRollNotes(section).filter((note) => selectedIds.has(note.id));
  }

  isNoteSelected(noteId, section = this.getActiveSection()) {
    return this.getSelectedNoteIds(section).includes(noteId);
  }

  getNoteInteractionSelectionIds(noteId, section = this.getActiveSection()) {
    if (!noteId) return [];
    return this.state.noteMultiSelectActive && this.isNoteSelected(noteId, section)
      ? this.getSelectedNoteIds(section)
      : [noteId];
  }

  getNoteSelectionKey(noteIds = []) {
    const uniqueIds = [...new Set(noteIds.filter(Boolean))].sort();
    return uniqueIds.length ? uniqueIds.join("|") : null;
  }

  clearPendingNoteCopyDrag() {
    this.pendingNoteCopySelectionKey = null;
  }

  clearPendingNoteResizeDrag() {
    this.pendingNoteResizeSelectionKey = null;
  }

  isNoteCopyDragArmed(noteIds = this.getSelectedNoteIds()) {
    const selectionKey = this.getNoteSelectionKey(noteIds);
    return Boolean(selectionKey && this.pendingNoteCopySelectionKey === selectionKey);
  }

  isNoteResizeDragArmed(noteIds = this.getSelectedNoteIds()) {
    const selectionKey = this.getNoteSelectionKey(noteIds);
    return Boolean(selectionKey && this.pendingNoteResizeSelectionKey === selectionKey);
  }

  setSelectedNotes(noteIds = [], { primaryId = noteIds.at(-1) || null, multiSelect = noteIds.length > 1 } = {}) {
    const uniqueIds = [...new Set(noteIds.filter(Boolean))];
    const nextSelectionKey = this.getNoteSelectionKey(uniqueIds);
    if (this.pendingNoteCopySelectionKey && this.pendingNoteCopySelectionKey !== nextSelectionKey) {
      this.clearPendingNoteCopyDrag();
    }
    if (this.pendingNoteResizeSelectionKey && this.pendingNoteResizeSelectionKey !== nextSelectionKey) {
      this.clearPendingNoteResizeDrag();
    }
    this.state.selectedNoteIds = uniqueIds;
    this.state.selectedNoteId = uniqueIds.includes(primaryId) ? primaryId : (uniqueIds.at(-1) || null);
    this.state.noteMultiSelectActive = Boolean(uniqueIds.length && multiSelect);
  }

  clearNoteSelection() {
    this.setSelectedNotes([], { primaryId: null, multiSelect: false });
  }

  toggleNoteSelection(noteId) {
    const selectedIds = new Set(this.getSelectedNoteIds());
    if (selectedIds.has(noteId)) {
      selectedIds.delete(noteId);
    } else {
      selectedIds.add(noteId);
    }
    const nextIds = [...selectedIds];
    this.setSelectedNotes(nextIds, { primaryId: noteId, multiSelect: nextIds.length > 0 });
  }

  handleNoteSelectionTap(noteId) {
    const selectedIds = this.getSelectedNoteIds();
    const wasAlreadySelected = selectedIds.includes(noteId);
    if (this.state.noteMultiSelectActive) {
      if (wasAlreadySelected) {
        this.noteQuickPopupEnabled = true;
        this.setSelectedNotes(selectedIds, {
          primaryId: noteId,
          multiSelect: true,
        });
        return;
      }
      this.toggleNoteSelection(noteId);
      this.noteQuickPopupEnabled = false;
      return;
    }
    this.noteQuickPopupEnabled = wasAlreadySelected;
    this.setSelectedNotes([noteId], { primaryId: noteId, multiSelect: false });
  }

  armSelectedNotesForCopyDrag() {
    const selectionKey = this.getNoteSelectionKey(this.getSelectedNoteIds());
    if (!selectionKey) return;
    this.pendingNoteCopySelectionKey = selectionKey;
    this.clearPendingNoteResizeDrag();
    this.noteQuickPopupEnabled = false;
    this.renderMelodyEditor();
  }

  armSelectedNotesForResizeDrag(noteIds = this.getSelectedNoteIds(), {
    primaryId = noteIds.at(-1) || null,
    multiSelect = noteIds.length > 1,
  } = {}) {
    const selectionKey = this.getNoteSelectionKey(noteIds);
    if (!selectionKey) return;
    this.setSelectedNotes(noteIds, { primaryId, multiSelect });
    this.pendingNoteResizeSelectionKey = selectionKey;
    this.clearPendingNoteCopyDrag();
    this.noteQuickPopupEnabled = false;
    this.renderMelodyEditor();
  }

  getRhythmSnapStepBeats() {
    return 4 / Math.max(1, this.state.rhythmSnapDivisor || DEFAULT_RHYTHM_SNAP_DIVISOR);
  }

  getQuantizeStepBeats() {
    return 4 / Math.max(1, this.state.quantizeDivisor || DEFAULT_QUANTIZE_DIVISOR);
  }

  quantizeNotesToGrid() {
    const section = this.getActiveSection();
    const notes = this.getActiveRollNotes(section);
    if (!notes.length) return;
    const totalBeats = sectionLengthInBeats(this.state.song, section);
    const stepBeats = this.getQuantizeStepBeats();
    const quantizedNotes = sortNotes(notes.map((note) => {
      const duration = Math.max(stepBeats, Math.round(note.duration / stepBeats) * stepBeats);
      const startBeat = clamp(
        Math.round(note.startBeat / stepBeats) * stepBeats,
        0,
        Math.max(0, totalBeats - duration),
      );
      return {
        ...note,
        startBeat,
        duration: clamp(duration, stepBeats, Math.max(stepBeats, totalBeats - startBeat)),
      };
    }));
    this.setActiveRollNotes(quantizedNotes, section);
    this.persistSong();
    this.renderMelodyEditor();
  }

  getMinimumMelodyStepDuration() {
    return 4 / MIN_NOTE_DURATION_DIVISOR;
  }

  getNoteResizeStepBeats() {
    return Math.min(this.getRhythmSnapStepBeats(), this.getMinimumMelodyStepDuration());
  }

  getDefaultMelodyStepDuration() {
    return 1;
  }

  getActiveRollNotes(section = this.getActiveSection()) {
    return this.state.noteEditorLayer === "bass" ? (section.bassNotes || []) : (section.melodyNotes || []);
  }

  setActiveRollNotes(notes, section = this.getActiveSection()) {
    if (this.state.noteEditorLayer === "bass") {
      section.bassNotes = notes;
      return;
    }
    section.melodyNotes = notes;
  }

  setNoteEditorLayer(layer) {
    if (!NOTE_EDITOR_LAYERS[layer]) return;
    if (layer === "bass") {
      this.ensureBassNotesSeeded(this.getActiveSection(), false);
    }
    this.state.noteEditorLayer = layer;
    this.clearNoteSelection();
    if (this.state.activeTab !== "melody") {
      this.state.activeTab = "melody";
    }
    this.renderTabs();
    this.renderEditor();
  }

  setPaletteMode(mode) {
    if (!PALETTE_MODES[mode]) return;
    if (mode === "drums") {
      this.ensureDrumSequenceSeeded(this.getActiveSection(), false);
    }
    this.state.paletteMode = mode;
    this.renderChordPalette();
  }

  ensureBassNotesSeeded(section = this.getActiveSection(), persist = true) {
    if (section.bassNotesInitialized) return false;
    section.bassNotes = buildBassNotesFromSection(section, this.state.song).map((note) => createNote(note));
    section.bassNotesInitialized = true;
    if (persist) this.persistSong();
    return true;
  }

  ensureDrumSequenceSeeded(section = this.getActiveSection(), persist = true) {
    if (section.drumSequence?.initialized) return false;
    section.drumSequence = createDrumSequenceFromPreset(section, this.state.song);
    if (persist) this.persistSong();
    return true;
  }

  openTrackWorkspace(layer, sectionId = this.state.activeSectionId) {
    const targetSection = findSection(this.state.song, sectionId);
    this.state.activeSectionId = targetSection.id;
    if (layer === "chords") {
      this.setPaletteMode("chords");
      this.renderAll();
      return;
    }
    if (layer === "drums") {
      this.ensureDrumSequenceSeeded(targetSection, false);
      this.setPaletteMode("drums");
      this.renderAll();
      return;
    }
    if (layer === "bass") {
      this.ensureBassNotesSeeded(targetSection, false);
    }
    this.state.noteEditorLayer = layer === "bass" ? "bass" : "melody";
    this.clearNoteSelection();
    this.state.activeTab = "melody";
    this.renderAll();
  }

  getSectionStartBeat(sectionId) {
    let beatCursor = 0;
    for (const section of this.state.song.sections) {
      if (section.id === sectionId) return beatCursor;
      beatCursor += sectionLengthInBeats(this.state.song, section);
    }
    return 0;
  }

  persistSong({ refreshPlayback = true, recordHistory = true } = {}) {
    this.constrainSongNotesToScale(this.state.song);
    this.state.song.scale = this.state.song.scaleType;
    this.state.song.timeSignature = "4/4";
    this.state.song.meter = "4/4";
    this.state.song.arrangementOrder = this.state.song.sections.map((section) => section.id);
    this.state.song.sections = this.state.song.sections.map((section) => ({
      ...section,
      label: section.name,
      bars: section.lengthInBars,
      chords: section.chordProgression,
      melody: section.melodyNotes,
      bass: section.bassNotes,
      lyrics: section.lyricsLines,
      drums: section.drumSequence,
      accompaniment: section.accompanimentStyle,
    }));
    this.state.song = sanitizeSong(this.state.song);
    if (!this.state.song.sections.find((section) => section.id === this.state.activeSectionId)) {
      this.state.activeSectionId = this.state.song.sections[0]?.id || null;
    }
    const serializedSong = JSON.stringify(this.state.song);
    if (recordHistory && serializedSong !== this.historySerialized) {
      this.undoStack.push(this.historySnapshot);
      if (this.undoStack.length > 100) {
        this.undoStack.shift();
      }
      this.redoStack = [];
    }
    this.historySnapshot = this.captureHistoryEntry();
    this.historySerialized = serializedSong;
    try {
      window.localStorage.setItem(STORAGE_KEY, serializedSong);
    } catch (error) {}
    if (refreshPlayback) {
      this.playback.setSong(this.state.song);
    }
    this.ensureLoopSectionInitialized();
    this.updateHistoryButtons();
  }

  handleSongKeyChange(nextKey) {
    const interval = getNoteIndex(nextKey) - getNoteIndex(this.state.song.key);
    this.state.song.sections = this.state.song.sections.map((section) => ({
      ...section,
      chordProgression: transposeProgression(section.chordProgression, interval),
      melodyNotes: section.melodyNotes.map((note) => ({
        ...note,
        pitch: this.normalizePitchForLayer(
          snapPitchToScale(note.pitch + interval, nextKey, this.state.song.scaleType),
          "melody",
        ),
      })),
      bassNotes: (section.bassNotes || []).map((note) => ({
        ...note,
        pitch: this.normalizePitchForLayer(
          snapPitchToScale(note.pitch + interval, nextKey, this.state.song.scaleType),
          "bass",
        ),
      })),
    }));
    this.state.song.key = nextKey;
    this.state.generator.key = nextKey;
    this.persistSong();
    this.renderAll();
  }

  getSongSettings() {
    return this.state.song.settings || {};
  }

  getChordTheorySummary(chord) {
    if (!chord) {
      return {
        roman: "",
        role: "Start by tapping a chord above.",
        status: "No chord selected",
        chordTones: "",
      };
    }
    const roman = matchChordToRoman(chord, this.state.song.key, this.state.song.scaleType) || "color";
    const isBorrowed = roman.toLowerCase().includes("b") || roman === "iv";
    const chordTones = getChordToneClasses(chord)
      .map((pitchClass) => formatNoteName(NOTE_NAMES[pitchClass], this.getSongSettings()))
      .join(" · ");
    return {
      roman,
      role: describeRomanFunction(roman),
      status: isBorrowed ? "Borrowed color" : roman === "color" ? "Outside palette" : "Diatonic",
      chordTones,
    };
  }

  getRhythmPatternLabel(chordStyle) {
    const labels = {
      block: "Held",
      pulse: "Pulse",
      arpeggio: "Up arp",
      "arpeggio-down": "Down arp",
      "ping-pong": "Ping-pong",
      strum: "Strum",
    };
    return labels[chordStyle] || "Held";
  }

  getSectionLayerSets(section) {
    return {
      muted: new Set(section?.accompanimentStyle?.mutedLayers || []),
      solo: new Set(section?.accompanimentStyle?.soloLayers || []),
    };
  }

  isLayerMuted(section, layer) {
    return this.getSectionLayerSets(section).muted.has(layer);
  }

  isLayerSolo(section, layer) {
    return this.getSectionLayerSets(section).solo.has(layer);
  }

  isLayerAudible(section, layer) {
    const { muted, solo } = this.getSectionLayerSets(section);
    return !muted.has(layer) && (!solo.size || solo.has(layer));
  }

  getLayerVolume(section, layer) {
    return section?.accompanimentStyle?.layerVolumes?.[layer] ?? (layer === "melody" ? 1 : 0.9);
  }

  toggleSectionLayerMute(section, layer) {
    const mutedLayers = new Set(section.accompanimentStyle?.mutedLayers || []);
    if (mutedLayers.has(layer)) {
      mutedLayers.delete(layer);
    } else {
      mutedLayers.add(layer);
    }
    section.accompanimentStyle.mutedLayers = [...mutedLayers];
  }

  toggleSectionLayerSolo(section, layer) {
    const soloLayers = new Set(section.accompanimentStyle?.soloLayers || []);
    if (soloLayers.has(layer)) {
      soloLayers.delete(layer);
    } else {
      soloLayers.add(layer);
    }
    section.accompanimentStyle.soloLayers = [...soloLayers];
  }

  getTrackSummary(section, layer) {
    if (layer === "chords") {
      return `${this.getRhythmPatternLabel(section.accompanimentStyle?.chordStyle)} · ${section.accompanimentStyle?.instrumentFlavor || "piano"}`;
    }
    if (layer === "bass") {
      return section.bassNotesInitialized
        ? `${section.bassNotes.length} notes · ${section.accompanimentStyle?.bassPattern || "root"}`
        : `${section.accompanimentStyle?.bassPattern || "root"} bass`;
    }
    if (layer === "drums") {
      return `${section.drumSequence?.kit || section.accompanimentStyle?.drumPreset || "pop"} kit`;
    }
    return `${section.melodyNotes.length} notes`;
  }

  buildSuggestionGroups() {
    const section = this.getActiveSection();
    const previousChord =
      section.chordProgression[this.state.selectedChordIndex ?? section.chordProgression.length - 1] || null;
    const borrowed = getBorrowedChords(this.state.song.key, this.state.song.scaleType);
    const baseline = suggestNextChords({
      currentKey: this.state.song.key,
      scaleType: this.state.song.scaleType,
      previousChord,
      progressionHistory: section.chordProgression,
    });

    const groups = [
      {
        tone: "next",
        label: "Next moves",
        candidates: baseline.slice(0, 5).map((candidate) => ({
          chord: candidate,
        })),
      },
      {
        tone: "color",
        label: "Color",
        candidates: borrowed.slice(0, 3).map((candidate) => ({
          chord: createChord(candidate),
        })),
      },
    ];

    // Add melody fit if there are melody notes
    if (section.melodyNotes.length > 0) {
      groups.push({
        tone: "melody",
        label: "Melody fit",
        candidates: autoSuggestChords(section.melodyNotes, this.state.song, Math.max(1, Math.min(2, section.lengthInBars)))
          .slice(0, 3)
          .map((candidate) => ({
            chord: candidate,
          })),
      });
    }

    return groups
      .map((group) => ({
        ...group,
        candidates: group.candidates.filter(
          (entry, index, list) =>
            list.findIndex(
              (item) =>
                item.chord.root === entry.chord.root &&
                item.chord.quality === entry.chord.quality &&
                item.chord.extension === entry.chord.extension,
            ) === index,
        ),
      }))
      .filter((group) => group.candidates.length);
  }

  // ===== MELODY HELPERS =====

  quantizeBeat(value) {
    const stepBeats = this.getRhythmSnapStepBeats();
    return Math.round(value / stepBeats) * stepBeats;
  }

  quantizePlacementBeat(value) {
    const stepBeats = this.getRhythmSnapStepBeats();
    return Math.floor((value + 0.0001) / stepBeats) * stepBeats;
  }

  getPitchLabel(midi) {
    return midiToLabel(midi, this.getSongSettings());
  }

  getRollPitchBounds(layer = this.state.noteEditorLayer) {
    if (layer === "bass") {
      return { min: BASS_PITCH_MIN, max: BASS_PITCH_MAX };
    }
    return { min: MELODY_PITCH_MIN, max: PITCH_MAX };
  }

  normalizePitchForLayer(pitch, layer = this.state.noteEditorLayer) {
    const bounds = this.getRollPitchBounds(layer);
    let normalized = pitch;
    while (normalized > bounds.max) normalized -= 12;
    while (normalized < bounds.min) normalized += 12;
    return clamp(normalized, bounds.min, bounds.max);
  }

  lockPitchToScale(pitch, layer = this.state.noteEditorLayer) {
    const normalizedPitch = this.normalizePitchForLayer(pitch, layer);
    return this.normalizePitchForLayer(
      snapPitchToScale(normalizedPitch, this.state.song.key, this.state.song.scaleType),
      layer,
    );
  }

  constrainSectionNotesToScale(section) {
    section.melodyNotes = sortNotes(
      (section.melodyNotes || []).map((note) => ({
        ...note,
        pitch: this.lockPitchToScale(note.pitch, "melody"),
      })),
    );
    section.bassNotes = sortNotes(
      (section.bassNotes || []).map((note) => ({
        ...note,
        pitch: this.lockPitchToScale(note.pitch, "bass"),
      })),
    );
  }

  constrainSongNotesToScale(song = this.state.song) {
    (song.sections || []).forEach((section) => this.constrainSectionNotesToScale(section));
  }

  getVisiblePitchRange(section = this.getActiveSection(), layer = this.state.noteEditorLayer) {
    const bounds = this.getRollPitchBounds(layer);
    const layerRange = Array.from(
      { length: bounds.max - bounds.min + 1 },
      (_, index) => bounds.max - index,
    );

    const scalePitchClasses = new Set(
      getScaleNotes(this.state.song.key, this.state.song.scaleType).map((note) => getNoteIndex(note)),
    );
    return layerRange.filter((pitch) => scalePitchClasses.has(((pitch % 12) + 12) % 12));
  }

  buildGhostGuideEvents(section, layer = this.state.noteEditorLayer) {
    const chordOctave = layer === "bass" ? 2 : 4;
    const events = buildSectionChordTimeline(section, this.state.song, 0)
      .flatMap((event) =>
        chordToMidi(event.chord, chordOctave).map((pitch) => ({
          pitch: this.lockPitchToScale(pitch, layer),
          startBeat: event.localStartBeat,
          durationBeats: event.localEndBeat - event.localStartBeat,
          kind: "chord",
        })),
      );

    if (layer === "bass") {
      return events.concat(
        (section.melodyNotes || []).map((note) => ({
          pitch: this.lockPitchToScale(note.pitch - 12, layer),
          startBeat: note.startBeat,
          durationBeats: note.duration,
          kind: "melody",
        })),
      );
    }

    return events;
  }

  getPitchRowIndex(pitch, visiblePitches = this.getVisiblePitchRange()) {
    const { min, max } = this.getRollPitchBounds();
    const boundedPitch = clamp(pitch, min, max);
    const exactIndex = visiblePitches.indexOf(boundedPitch);
    if (exactIndex >= 0) {
      return exactIndex;
    }

    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    visiblePitches.forEach((candidate, index) => {
      const distance = Math.abs(candidate - boundedPitch);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    return closestIndex;
  }

  isPitchInKey(pitch) {
    const pitchClass = ((pitch % 12) + 12) % 12;
    return getScaleNotes(this.state.song.key, this.state.song.scaleType)
      .map((note) => getNoteIndex(note))
      .includes(pitchClass);
  }

  getNoteColorClass(section, note) {
    if (this.isChordTone(section, note)) return "chord-tone";
    if (this.isPitchInKey(note.pitch)) return "scale-tone";
    return "out-tone";
  }

  isChordTone(section, note) {
    const chordInfo = getChordAtBeat(section, note.startBeat, this.state.song);
    if (!chordInfo?.chord) return false;
    const pitchClass = ((note.pitch % 12) + 12) % 12;
    const rootIndex = getNoteIndex(chordInfo.chord.root);
    const intervals =
      chordInfo.chord.extension === "sus2" ? [0, 2, 7]
        : chordInfo.chord.extension === "sus4" ? [0, 5, 7]
          : chordInfo.chord.quality === "minor" ? [0, 3, 7]
            : chordInfo.chord.quality === "diminished" ? [0, 3, 6]
              : chordInfo.chord.quality === "augmented" ? [0, 4, 8]
                : [0, 4, 7];
    const extension =
      chordInfo.chord.extension === "7" ? [10]
        : chordInfo.chord.extension === "maj7" ? [11]
          : chordInfo.chord.extension === "9" || chordInfo.chord.extension === "add9" ? [2]
            : chordInfo.chord.extension === "dim7" ? [9]
              : [];
    return [...intervals, ...extension].some((interval) => (rootIndex + interval) % 12 === pitchClass);
  }

  renderGhostChordNotes(section, beatWidth, rowHeight, visiblePitches) {
    return this.buildGhostGuideEvents(section)
      .map((note) => {
        const noteTop = this.getPitchRowIndex(note.pitch, visiblePitches) * rowHeight + 6;
        const width = Math.max(14, note.durationBeats * beatWidth - 10);
        return `
          <div
            class="ghost-note-block ${note.kind === "melody" ? "melody-guide" : ""}"
            style="left:${note.startBeat * beatWidth + 5}px;top:${noteTop}px;width:${width}px;height:${Math.max(10, rowHeight - 12)}px"
          ></div>
        `;
      })
      .join("");
  }

  // ===== RENDER ALL =====

  renderAll() {
    this.ensureRenderableState();
    this.ensureLoopSectionInitialized();
    this.applyLayoutMetrics();
    this.syncSongFields();
    this.renderTransportStatus();
    this.renderTabs();
    this.renderWorkspaceModeButtons();
    this.renderChordPalette();
    this.renderSections();
    this.renderArrangementOverview();
    this.renderProgression();
    this.renderSuggestions();
    this.renderModeSurface();
    this.renderExportDialog();
    this.renderTempoDialog();
    this.renderSettingsDialog();
    this.renderEditor();
    this.updateHistoryButtons();
    this.updatePlaybackDecorations();
  }

  syncSongFields() {
    this.refs.title.value = this.state.song.title;
    this.refs.key.value = this.state.song.key;
    this.refs.scale.value = this.state.song.scaleType;
    this.refs.tempo.value = this.state.song.tempo;
    this.refs.tempoReadout.textContent = `${this.state.song.tempo} BPM`;
    if (this.refs.tempoLaunch) {
      this.refs.tempoLaunch.textContent = `${this.state.song.tempo} BPM`;
    }
    this.refs.activeSectionTitle.textContent = this.getActiveSection()?.name || "Section";
    this.refs.editorSectionTitle.textContent = this.getActiveSection()?.name || "Section";
  }

  updateTempoValue(rawValue, { persist = false } = {}) {
    const nextTempo = clamp(
      Number.parseInt(rawValue, 10) || this.state.song.tempo,
      50,
      200,
    );
    if (nextTempo === this.state.song.tempo && !persist) {
      this.refs.tempoReadout.textContent = `${nextTempo} BPM`;
      return;
    }
    this.state.song.tempo = nextTempo;
    this.refs.tempo.value = nextTempo;
    this.refs.tempoReadout.textContent = `${nextTempo} BPM`;
    if (this.refs.tempoLaunch) {
      this.refs.tempoLaunch.textContent = `${nextTempo} BPM`;
    }
    if (persist) {
      this.persistSong();
    } else {
      this.playback.setSong(this.state.song);
    }
    this.syncTempoDialogDisplay();
    this.renderTransportStatus();
  }

  renderTransportStatus() {
    const playbackSection = this.state.song.sections.find(
      (section) => section.id === this.state.playbackSectionId,
    );
    const loopEnabled = this.playback.loopSectionId === this.state.activeSectionId;
    const transportStatus = this.state.transportState;
    const beatsPerBar = getBeatsPerBar(this.state.song);
    const localBeat = playbackSection
      ? this.state.playheadBeat - this.getSectionStartBeat(playbackSection.id)
      : this.state.playheadBeat;
    const localBar = Math.floor(localBeat / beatsPerBar) + 1;
    const beatInBar = Math.floor(localBeat % beatsPerBar) + 1;
    this.refs.transportState.textContent = this.state.exportingWav
      ? "Rendering WAV"
      : transportStatus === "playing" && playbackSection
        ? `${this.playback.loopSectionId ? "Looping" : "Playing"} ${playbackSection.name}`
        : transportStatus.charAt(0).toUpperCase() + transportStatus.slice(1);
    this.refs.playhead.textContent = describeBarPosition(this.state.song, this.state.playheadBeat);
    this.refs.playTransport?.classList.toggle("active", transportStatus === "playing");
    this.refs.pauseTransport?.classList.toggle("active", transportStatus === "paused");
    this.refs.stopTransport?.classList.toggle("active", transportStatus === "stopped");
    this.refs.loopToggle.setAttribute(
      "aria-label",
      loopEnabled ? "Loop enabled" : "Loop",
    );
    this.refs.loopToggle.setAttribute("aria-pressed", loopEnabled ? "true" : "false");
    this.refs.loopToggle.title = loopEnabled ? "Loop enabled" : "Loop";
    this.refs.loopToggle.classList.toggle(
      "active",
      loopEnabled,
    );
  }

  refreshHarmonyViews() {
    this.renderSections();
    this.renderProgression();
    this.renderSuggestions();
    if (this.state.activeTab === "melody") {
      this.renderMelodyEditor();
    }
  }

  renderTabs() {
    this.root.querySelectorAll(".tab-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === this.state.activeTab);
    });
  }

  renderWorkspaceModeButtons() {
    this.root.querySelectorAll("[data-workspace-mode]").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.workspaceMode === "settings"
          ? this.state.settingsDialogOpen
          : button.dataset.workspaceMode === "export"
            ? this.state.exportDialogOpen
            : button.dataset.workspaceMode === this.state.workspaceMode,
      );
    });
    const showModePanel = this.state.workspaceMode === "ideas";
    this.refs.modePanel.classList.toggle("hidden", !showModePanel);
  }

  renderSections() {
    this.refs.sectionList.innerHTML = this.state.song.sections
      .map((section, index) => {
        const isActive = section.id === this.state.activeSectionId;
        const isPlaying = section.id === this.state.playbackSectionId;
        return `
          <article
            class="section-card ${isActive ? "active" : ""}"
            draggable="true"
            data-drag-type="section"
            data-section-index="${index}"
            data-section-id="${section.id}"
          >
            <div class="section-title-row">
              <p class="panel-kicker">${String(index + 1).padStart(2, "0")}</p>
              <span class="tag-pill">${section.lengthInBars}b${isPlaying ? " · Live" : ""}</span>
            </div>
            <h3>${escapeHtml(section.name)}</h3>
            <p class="small-copy">${section.chordProgression.length} chords</p>
            <div class="section-actions">
              <button class="section-button ${isActive ? "active" : ""}" data-action="select-section" data-section-id="${section.id}">Open</button>
              <button class="section-button ${this.playback.loopSectionId === section.id ? "active" : ""}" data-action="loop-section" data-section-id="${section.id}">Loop</button>
            </div>
          </article>
        `;
      })
      .join("");
  }

  renderArrangementOverview() {
    this.refs.arrangementOverview.innerHTML = this.state.song.sections
      .map((section) => `
        <article class="arrangement-overview-card ${section.id === this.state.activeSectionId ? "active" : ""}">
          <div class="arrangement-overview-head">
            <button class="section-button ${section.id === this.state.activeSectionId ? "active" : ""}" data-overview-action="select-section" data-section-id="${section.id}">
              ${escapeHtml(section.name)}
            </button>
            <span class="tag-pill">${section.lengthInBars} bars</span>
          </div>
          <div class="arrangement-overview-tracks">
            ${TRACK_LAYERS.map((track) => `
              <div class="arrangement-track-row ${this.isLayerAudible(section, track.id) ? "" : "dimmed"}">
                <div class="arrangement-track-copy">
                  <strong>${track.label}</strong>
                  <span class="small-copy">${escapeHtml(this.getTrackSummary(section, track.id))}</span>
                </div>
                <div class="arrangement-track-actions">
                  <button
                    class="mini-button"
                    data-overview-action="edit-track"
                    data-section-id="${section.id}"
                    data-layer="${track.id}"
                  >
                    Edit
                  </button>
                  <button
                    class="mini-button ${this.isLayerSolo(section, track.id) ? "accent" : ""}"
                    data-overview-action="toggle-solo"
                    data-section-id="${section.id}"
                    data-layer="${track.id}"
                  >
                    Solo
                  </button>
                  <button
                    class="mini-button ${this.isLayerMuted(section, track.id) ? "danger" : ""}"
                    data-overview-action="toggle-mute"
                    data-section-id="${section.id}"
                    data-layer="${track.id}"
                  >
                    ${this.isLayerMuted(section, track.id) ? "Muted" : "Mute"}
                  </button>
                </div>
              </div>
            `).join("")}
          </div>
        </article>
      `)
      .join("");
  }

  renderProgression() {
    const section = this.getActiveSection();
    const currentPlayingChordIndex =
      this.state.playbackSectionId === section.id ? this.state.playbackChordIndex : null;
    const markup = [];

    if (section.chordProgression.length === 0) {
      markup.push(`
        <div class="empty-state" style="min-width:min(70vw,300px)">
          <h3 style="margin:0">No chords yet</h3>
          <p class="small-copy">Tap any chord in the palette above to start building your progression.</p>
        </div>
      `);
    } else {
      section.chordProgression.forEach((chord, index) => {
        const theory = this.getChordTheorySummary(chord);
        markup.push(`
          <article
            class="chord-card ${index === this.state.selectedChordIndex ? "active" : ""} ${currentPlayingChordIndex === index ? "live" : ""}"
            draggable="true"
            data-drag-type="chord"
            data-chord-index="${index}"
          >
            <button
              class="chord-button"
              data-action="select-chord"
              data-chord-index="${index}"
              aria-pressed="${index === this.state.selectedChordIndex ? "true" : "false"}"
            >
              <div class="chord-topline">
                <span class="panel-kicker">${index + 1}</span>
                <span class="tag-pill">${chord.durationInBeats}b</span>
              </div>
              <span class="chord-name">${escapeHtml(getChordDisplayName(chord))}</span>
              <span class="small-copy">${escapeHtml(theory.roman)} · tap to edit</span>
            </button>
          </article>
        `);
      });
    }

    this.refs.progressionRow.innerHTML = markup.join("");
    this.renderChordInspector();
  }

  renderChordInspector() {
    const section = this.getActiveSection();
    const selectedChord = this.getSelectedChord();

    if (!section.chordProgression.length) {
      this.refs.chordInspector.innerHTML = `
        <div class="empty-state chord-inspector-empty">
          <h3 style="margin:0">Start with an empty progression</h3>
          <p class="small-copy">Projects now stay chord-free until you add them yourself from the palette, suggestions, or the + Chord button.</p>
        </div>
      `;
      return;
    }

    if (!selectedChord) {
      this.refs.chordInspector.innerHTML = `
        <div class="empty-state chord-inspector-empty">
          <h3 style="margin:0">Select a chord</h3>
          <p class="small-copy">Choose any chord card above to edit its root, quality, voicing, timing, or quick actions.</p>
        </div>
      `;
      return;
    }

    const theory = this.getChordTheorySummary(selectedChord);
    const chordIndex = this.state.selectedChordIndex;

    this.refs.chordInspector.innerHTML = `
      <section class="chord-inspector-card">
        <div class="chord-inspector-head">
          <div>
            <p class="panel-kicker">Selected Chord</p>
            <h3>${escapeHtml(getChordDisplayName(selectedChord))}</h3>
          </div>
          <div class="chord-inspector-meta">
            <span class="status-pill">#${chordIndex + 1}</span>
            <span class="status-pill">${escapeHtml(theory.roman)}</span>
            <span class="status-pill">${selectedChord.durationInBeats} beats</span>
          </div>
        </div>
        <p class="small-copy chord-inspector-copy">${escapeHtml(theory.status)} · ${escapeHtml(theory.role)} · ${escapeHtml(theory.chordTones)}</p>

        <div class="chord-inspector-grid">
          <label class="meta-field">
            <span>Root</span>
            <select data-chord-field="root">
              ${NOTE_NAMES.map((note) => `<option value="${note}" ${selectedChord.root === note ? "selected" : ""}>${note}</option>`).join("")}
            </select>
          </label>
          <label class="meta-field">
            <span>Duration</span>
            <input type="number" min="1" max="16" step="1" value="${selectedChord.durationInBeats}" data-chord-field="durationInBeats" />
          </label>
          <label class="meta-field">
            <span>Inversion</span>
            <input type="number" min="0" max="3" step="1" value="${selectedChord.inversion || 0}" data-chord-field="inversion" />
          </label>
          <label class="meta-field">
            <span>Slash Bass</span>
            <select data-chord-field="slashBass">
              <option value="">Root bass</option>
              ${NOTE_NAMES.map((note) => `<option value="${note}" ${selectedChord.slashBass === note ? "selected" : ""}>/${note}</option>`).join("")}
            </select>
          </label>
        </div>

        <div class="chord-chip-group">
          <p class="sheet-section-title">Quality</p>
          <div class="extension-grid">
            ${CHORD_QUALITIES.map(([value, label]) => `
              <button class="extension-chip ${selectedChord.quality === value ? "active" : ""}" data-action="set-chord-quality" data-quality="${value}">${label}</button>
            `).join("")}
          </div>
        </div>

        <div class="chord-chip-group">
          <p class="sheet-section-title">Extension</p>
          <div class="extension-grid">
            ${CHORD_EXTENSIONS.map((ext) => `
              <button class="extension-chip ${selectedChord.extension === ext ? "active" : ""}" data-action="set-chord-extension" data-extension="${ext}">${ext || "Triad"}</button>
            `).join("")}
          </div>
        </div>

        <div class="sheet-action-row chord-inspector-actions">
          <button class="action-button primary" data-action="audition-selected-chord">Play</button>
          <button class="action-button" data-action="duplicate-selected-chord">Duplicate</button>
          <button class="action-button" data-action="split-selected-chord">Split</button>
          <button class="action-button" data-action="merge-selected-chord">Merge Next</button>
          <button class="action-button danger" data-action="delete-selected-chord">Delete</button>
        </div>
      </section>
    `;
  }

  renderSuggestions() {
    const groups = this.buildSuggestionGroups();
    if (!groups.length) {
      this.refs.suggestionRow.innerHTML = '<div class="empty-state suggestion-empty">No chord suggestions yet.</div>';
      return;
    }
    this.refs.suggestionRow.innerHTML = groups
      .map(
        (group) => `
          <article class="suggestion-group suggestion-group--${escapeHtml(group.tone)}" data-suggestion-group="${escapeHtml(group.tone)}">
            <p class="subtle-label">${escapeHtml(group.label)}</p>
            <div class="chip-cloud">
              ${group.candidates
                .map(
                  (entry) =>
                    `<button class="suggestion-chip suggestion-chip--${escapeHtml(group.tone)}" data-action="insert-suggestion" data-root="${entry.chord.root}" data-quality="${entry.chord.quality}" data-extension="${entry.chord.extension || ""}" data-duration="${getBeatsPerBar(this.state.song)}"><span>${escapeHtml(getChordDisplayName(entry.chord))}</span></button>`,
                )
                .join("")}
            </div>
          </article>
        `,
      )
      .join("");
  }

  // ===== MODE SURFACES =====

  renderModeSurface() {
    if (this.state.workspaceMode === "ideas") {
      this.refs.modeTitle.textContent = "Ideas";
      this.renderIdeasMode();
      return;
    }
    this.refs.modeSurface.innerHTML = "";
  }

  renderIdeasMode() {
    const generator = this.state.generator;
    const suggestionCards = [];

    if (this.state.ideaSuggestions.song) {
      suggestionCards.push(`
        <article class="idea-card">
          <div class="stat-row">
            <span class="status-pill">Suggested song</span>
            <button class="action-button primary" data-mode-action="apply-suggested-song">Apply</button>
          </div>
          <p class="small-copy">${escapeHtml(this.state.ideaSuggestions.song.key)} ${escapeHtml(this.state.ideaSuggestions.song.scaleType)} · ${this.state.ideaSuggestions.song.tempo} BPM · ${this.state.ideaSuggestions.song.sections.length} sections</p>
        </article>
      `);
    }

    if (this.state.ideaSuggestions.progression) {
      suggestionCards.push(`
        <article class="idea-card">
          <div class="stat-row">
            <span class="status-pill">Suggested progression</span>
            <button class="action-button primary" data-mode-action="apply-suggested-progression">Apply</button>
          </div>
          <p class="small-copy">${escapeHtml(progressionSummary(this.state.ideaSuggestions.progression))}</p>
        </article>
      `);
    }

    if (this.state.ideaSuggestions.melody) {
      suggestionCards.push(`
        <article class="idea-card">
          <div class="stat-row">
            <span class="status-pill">Suggested melody</span>
            <button class="action-button primary" data-mode-action="apply-suggested-melody">Apply</button>
          </div>
          <p class="small-copy">${escapeHtml(melodySummary(this.state.ideaSuggestions.melody))}</p>
        </article>
      `);
    }

    if (this.state.ideaSuggestions.chordsFromMelody) {
      suggestionCards.push(`
        <article class="idea-card">
          <div class="stat-row">
            <span class="status-pill">Chords from melody</span>
            <button class="action-button primary" data-mode-action="apply-suggested-chords">Apply</button>
          </div>
          <p class="small-copy">${escapeHtml(progressionSummary(this.state.ideaSuggestions.chordsFromMelody))}</p>
        </article>
      `);
    }

    this.refs.modeSurface.innerHTML = `
      <div class="mode-stack">
        <article class="inspector-card">
          <div class="mode-grid">
            <label class="meta-field">
              <span>Genre</span>
              <select data-generator-field="genre">
                ${["pop", "rock", "hiphop", "electronic"].map((v) => `<option value="${v}" ${generator.genre === v ? "selected" : ""}>${v}</option>`).join("")}
              </select>
            </label>
            <label class="meta-field">
              <span>Mood</span>
              <select data-generator-field="mood">
                ${["bright", "moody", "anthemic", "dreamy"].map((v) => `<option value="${v}" ${generator.mood === v ? "selected" : ""}>${v}</option>`).join("")}
              </select>
            </label>
            <label class="meta-field">
              <span>Complexity</span>
              <select data-generator-field="complexity">
                ${["simple", "balanced", "adventurous"].map((v) => `<option value="${v}" ${generator.complexity === v ? "selected" : ""}>${v}</option>`).join("")}
              </select>
            </label>
            <label class="meta-field">
              <span>Key</span>
              <select data-generator-field="key">
                ${NOTE_NAMES.map((note) => `<option value="${note}" ${generator.key === note ? "selected" : ""}>${note}</option>`).join("")}
              </select>
            </label>
          </div>
          <div class="sheet-actions" style="margin-top:12px">
            <button class="action-button primary" data-mode-action="suggest-song">Suggest Song</button>
            <button class="action-button" data-mode-action="suggest-progression">Suggest Progression</button>
            <button class="action-button" data-mode-action="suggest-melody">Suggest Melody</button>
            <button class="action-button" data-mode-action="suggest-chords-from-melody">Auto-Fill Chords</button>
            <button class="action-button" data-mode-action="reset-blank">Start Blank</button>
          </div>
        </article>
        ${suggestionCards.length ? `<div class="idea-stack">${suggestionCards.join("")}</div>` : '<div class="empty-state">No suggestions yet. Generate an idea above.</div>'}
      </div>
    `;
  }

  getExportMarkup() {
    return `
      <div class="mode-stack">
        <article class="inspector-card">
          <div class="summary-list compact">
            <div class="summary-row">
              <strong>Song</strong>
              <span>${escapeHtml(this.state.song.title || "Untitled")} · ${escapeHtml(this.state.song.key)} ${escapeHtml(this.state.song.scaleType)} · ${this.state.song.tempo} BPM</span>
            </div>
          </div>
          <div class="sheet-actions" style="margin-top:12px">
            <button class="action-button primary" data-mode-action="export-json">Save Project</button>
            <button class="action-button" data-mode-action="import-json">Import Project</button>
          </div>
          <p class="subtle-label" style="margin-top:12px">Project files keep the full song so you can reopen it later and keep editing.</p>
        </article>
        <article class="inspector-card">
          <p class="subtle-label">Other Exports</p>
          <div class="export-list" style="margin-top:12px">
            <button class="action-button primary" data-mode-action="export-midi">MIDI</button>
            <button class="action-button" data-mode-action="export-text-chords">Chord Sheet</button>
            <button class="action-button" data-mode-action="export-text-lyrics">Lyrics</button>
            <button class="action-button" data-mode-action="export-text-full">Chords + Lyrics</button>
            <button class="action-button" data-mode-action="export-wav">${this.state.exportingWav ? "Rendering..." : "WAV"}</button>
          </div>
        </article>
      </div>
    `;
  }

  renderExportMode() {
    this.refs.modeSurface.innerHTML = this.getExportMarkup();
  }

  renderSettingsDialog() {
    if (!this.state.settingsDialogOpen) {
      this.refs.settingsDialog.classList.add("hidden");
      this.refs.settingsDialog.setAttribute("aria-hidden", "true");
      this.refs.settingsDialogSurface.innerHTML = "";
      return;
    }

    this.refs.settingsDialog.classList.remove("hidden");
    this.refs.settingsDialog.setAttribute("aria-hidden", "false");
    this.refs.settingsDialogSurface.innerHTML = `
      <div class="mode-stack">
        <article class="inspector-card">
          <p class="subtle-label">Project Settings</p>
          <div class="sheet-actions" style="margin-top:12px">
            <button class="action-button danger" data-settings-dialog-action="start-blank-project">Start Blank</button>
          </div>
        </article>
        <article class="inspector-card">
          <p class="subtle-label">Layout</p>
          <div class="mode-switch embedded" role="tablist" style="margin-top:12px">
            ${["auto", "iphone", "ipad", "mac"].map((mode) =>
              `<button class="mode-button ${this.state.layoutMode === mode ? "active" : ""}" data-settings-layout-mode="${mode}">${LAYOUT_LABELS[mode]}</button>`
            ).join("")}
          </div>
        </article>
      </div>
    `;
  }

  renderExportDialog() {
    if (!this.state.exportDialogOpen) {
      this.refs.exportDialog.classList.add("hidden");
      this.refs.exportDialog.setAttribute("aria-hidden", "true");
      this.refs.exportDialogSurface.innerHTML = "";
      return;
    }

    this.refs.exportDialog.classList.remove("hidden");
    this.refs.exportDialog.setAttribute("aria-hidden", "false");
    this.refs.exportDialogSurface.innerHTML = this.getExportMarkup();
  }

  getTempoDialAngle(tempo = this.state.song.tempo) {
    const ratio = (clamp(tempo, 50, 200) - 50) / 150;
    return 225 + ratio * 270;
  }

  getTempoFromDialPoint(clientX, clientY, dial) {
    if (!dial) return this.state.song.tempo;
    const rect = dial.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = clientX - centerX;
    const dy = centerY - clientY;
    let angle = Math.atan2(dx, dy) * (180 / Math.PI);
    if (angle <= 135) angle += 360;
    const clampedAngle = clamp(angle, 225, 495);
    const ratio = (clampedAngle - 225) / 270;
    return Math.round(50 + ratio * 150);
  }

  openTempoDialog() {
    if (this.layoutProfile !== "iphone") return;
    this.state.tempoDialogOpen = true;
    this.tempoDialogDirty = false;
    this.renderTempoDialog();
  }

  closeTempoDialog({ persist = true, render = true } = {}) {
    this.stopTempoDialGesture();
    if (persist && this.tempoDialogDirty) {
      this.persistSong();
    }
    this.tempoDialogDirty = false;
    this.state.tempoDialogOpen = false;
    if (render) {
      this.renderTempoDialog();
    }
  }

  renderTempoDialog() {
    if (!this.refs.tempoDialog || !this.refs.tempoDialogSurface) return;
    if (!this.state.tempoDialogOpen || this.layoutProfile !== "iphone") {
      if (this.layoutProfile !== "iphone") {
        this.state.tempoDialogOpen = false;
        this.tempoDialogDirty = false;
      }
      this.refs.tempoDialog.classList.add("hidden");
      this.refs.tempoDialog.setAttribute("aria-hidden", "true");
      this.refs.tempoDialogSurface.innerHTML = "";
      return;
    }

    const tempo = this.state.song.tempo;
    const dialAngle = this.getTempoDialAngle(tempo);
    const dialSweep = Math.max(0, dialAngle - 225);
    this.refs.tempoDialog.classList.remove("hidden");
    this.refs.tempoDialog.setAttribute("aria-hidden", "false");
    this.refs.tempoDialogSurface.innerHTML = `
      <div class="tempo-dialog-shell">
        <div class="tempo-dialog-head">
          <div class="tempo-dialog-title-block">
            <p class="tempo-dialog-kicker">Project Tempo</p>
            <h2 id="tempo-dialog-title">Tempo</h2>
          </div>
          <button class="tempo-dialog-done" data-tempo-dialog-action="close">Done</button>
        </div>
        <div class="tempo-dialog-display">
          <span class="tempo-dialog-unit">BPM</span>
          <output class="tempo-dialog-value">${tempo}</output>
        </div>
        <div class="tempo-dialog-stepper">
          <button class="tempo-dialog-step" data-tempo-dialog-step="-1" aria-label="Decrease tempo">-</button>
          <button class="tempo-dialog-step" data-tempo-dialog-step="1" aria-label="Increase tempo">+</button>
        </div>
        <div
          class="tempo-dial"
          data-tempo-dial
          role="slider"
          aria-label="Tempo"
          aria-valuemin="50"
          aria-valuemax="200"
          aria-valuenow="${tempo}"
          tabindex="0"
        >
          <div class="tempo-dial-ring" style="--tempo-sweep:${dialSweep}deg;">
            <div class="tempo-dial-ticks"></div>
            <div class="tempo-dial-knob" style="transform:translate(-50%, -50%) rotate(${dialAngle}deg) translateY(-74px);"></div>
            <div class="tempo-dial-center"></div>
          </div>
        </div>
      </div>
    `;
    this.syncTempoDialogDisplay();
  }

  syncTempoDialogDisplay() {
    if (!this.state.tempoDialogOpen || !this.refs.tempoDialogSurface) return;
    const tempo = this.state.song.tempo;
    const dialAngle = this.getTempoDialAngle(tempo);
    const dialSweep = Math.max(0, dialAngle - 225);
    const value = this.refs.tempoDialogSurface.querySelector(".tempo-dialog-value");
    const dial = this.refs.tempoDialogSurface.querySelector("[data-tempo-dial]");
    const ring = this.refs.tempoDialogSurface.querySelector(".tempo-dial-ring");
    const knob = this.refs.tempoDialogSurface.querySelector(".tempo-dial-knob");
    if (value) value.textContent = String(tempo);
    if (dial) dial.setAttribute("aria-valuenow", String(tempo));
    if (ring) ring.style.setProperty("--tempo-sweep", `${dialSweep}deg`);
    if (knob) {
      knob.style.transform = `translate(-50%, -50%) rotate(${dialAngle}deg) translateY(-74px)`;
    }
  }

  openSettingsDialog() {
    this.closeExportDialog({ render: false });
    this.state.settingsDialogOpen = true;
    this.renderWorkspaceModeButtons();
    this.renderSettingsDialog();
  }

  closeSettingsDialog({ render = true } = {}) {
    if (!this.state.settingsDialogOpen) return;
    this.state.settingsDialogOpen = false;
    if (render) {
      this.renderWorkspaceModeButtons();
      this.renderSettingsDialog();
    }
  }

  openExportDialog() {
    this.closeSettingsDialog({ render: false });
    this.state.exportDialogOpen = true;
    this.renderWorkspaceModeButtons();
    this.renderExportDialog();
  }

  closeExportDialog({ render = true } = {}) {
    if (!this.state.exportDialogOpen) return;
    this.state.exportDialogOpen = false;
    if (render) {
      this.renderWorkspaceModeButtons();
      this.renderExportDialog();
    }
  }

  applySettingsDialogAction(action, value = null) {
    if (action === "close") {
      this.closeSettingsDialog();
      return;
    }
    if (action === "start-blank-project") {
      this.closeSettingsDialog({ render: false });
      this.resetBlankSong();
      return;
    }
    if (action === "set-layout-mode") {
      const nextMode = value;
      this.closeSettingsDialog();
      if (nextMode && nextMode !== this.state.layoutMode) {
        this.setLayoutMode(nextMode);
      }
    }
  }

  // ===== EDITOR =====

  renderEditor() {
    if (this.state.activeTab === "melody") {
      this.renderMelodyEditor();
      return;
    }
    if (this.state.activeTab === "lyrics") {
      this.renderLyricsEditor();
      return;
    }
    if (this.state.activeTab === "arrangement") {
      this.renderArrangementEditor();
      return;
    }
    this.renderStudioEditor();
  }

  getMelodyNoteStripMarkup(section = this.getActiveSection(), noteLayer = this.state.noteEditorLayer) {
    const layerLabel = NOTE_EDITOR_LAYERS[noteLayer];
    const selectedNotes = this.getSelectedNotes(section);
    const hasMultiSelection = selectedNotes.length > 1;
    const selectionCount = selectedNotes.length;
    const sameDurationTolerance = 0.0001;
    const formatBeatValue = (value) => (value + 1).toFixed(2).replace(/\.00$/, "");
    const allSelectedMuted = selectionCount > 0 && selectedNotes.every((note) => note.muted);
    if (!selectionCount) {
      return `
        <div class="melody-note-strip melody-note-strip-empty">
          <p class="small-copy">Tap a note to edit it, or hold empty grid space to quick-select notes.</p>
        </div>
      `;
    }

    const selectedNote = this.getSelectedNote() || selectedNotes.at(-1) || null;
    if (!selectedNote) {
      return `
        <div class="melody-note-strip melody-note-strip-empty">
          <p class="small-copy">Tap a note to edit it, or hold empty grid space to quick-select notes.</p>
        </div>
      `;
    }

    const singleNoteLengthOptions = NOTE_LENGTH_DIVISOR_OPTIONS.map((divisor) => {
      const durationBeats = 4 / divisor;
      return {
        divisor,
        durationBeats,
        label: `1/${divisor}`,
      };
    });
    const sharedSelectedDuration = selectedNotes[0]?.duration ?? selectedNote.duration;
    const hasSharedSelectedDuration = selectedNotes.every((note) => Math.abs(note.duration - sharedSelectedDuration) <= sameDurationTolerance);
    const showLengthField = !hasMultiSelection || hasSharedSelectedDuration;
    const selectedLengthDivisor = showLengthField
      ? singleNoteLengthOptions.reduce((best, option) =>
        Math.abs(option.durationBeats - sharedSelectedDuration) < Math.abs(best.durationBeats - sharedSelectedDuration)
          ? option
          : best, singleNoteLengthOptions[0]).divisor
      : null;
    const isResizeArmed = this.isNoteResizeDragArmed(selectedNotes.map((note) => note.id));

    return `
      <div class="melody-note-strip">
        <div class="melody-note-summary">
          <p class="panel-kicker">${hasMultiSelection ? `${selectionCount} Selected ${layerLabel} Notes` : `Selected ${layerLabel} Note`}</p>
          <h3>${hasMultiSelection ? `${selectionCount} notes` : `${escapeHtml(this.getPitchLabel(selectedNote.pitch))}${selectedNote.muted ? " · Muted" : ""}`}</h3>
          ${isResizeArmed ? `<p class="melody-note-mode-pill">Stretch ready</p>` : ""}
          <p class="small-copy">${hasMultiSelection
            ? `Beats ${formatBeatValue(Math.min(...selectedNotes.map((note) => note.startBeat)))} to ${formatBeatValue(Math.max(...selectedNotes.map((note) => note.startBeat + note.duration)))}`
            : `Beat ${formatBeatValue(selectedNote.startBeat)} · Length ${selectedNote.duration.toFixed(2).replace(/\.00$/, "")}`}</p>
        </div>
        <div class="melody-note-actions">
          ${showLengthField ? `
            <label class="meta-field melody-note-length-field">
              <span>Length</span>
              <select data-action="set-selected-note-length-divisor">
                ${singleNoteLengthOptions.map((option) => `
                  <option value="${option.divisor}" ${selectedLengthDivisor === option.divisor ? "selected" : ""}>${option.label}</option>
                `).join("")}
              </select>
            </label>
          ` : ""}
          ${hasMultiSelection && !hasSharedSelectedDuration ? `
            <button class="action-button" data-action="set-selected-notes-quarter-length">Make 1/4</button>
          ` : ""}
          <div class="melody-note-transpose-pair">
            <button class="action-button" data-action="transpose-selected-note-down">-1</button>
            <button class="action-button" data-action="transpose-selected-note-up">+1</button>
          </div>
          <button class="action-button" data-action="toggle-mute-selected-note">${allSelectedMuted ? "Unmute" : "Mute"}</button>
          <button class="action-button danger" data-action="delete-selected-note">${hasMultiSelection ? "Delete All" : "Delete"}</button>
        </div>
      </div>
    `;
  }

  renderMelodyEditor() {
    const { beatWidth, rowHeight } = this.layoutMetrics;
    const section = this.getActiveSection();
    const noteLayer = this.state.noteEditorLayer;
    const layerLabel = NOTE_EDITOR_LAYERS[noteLayer];
    const visiblePitches = this.getVisiblePitchRange(section, noteLayer);
    const notes = this.getActiveRollNotes(section);
    const scrollSource = this.refs.editorSurface.querySelector(".grid-scroll");
    const vScrollSource = this.refs.editorSurface.querySelector(".melody-shell");
    const preservedScroll = scrollSource
      ? { left: scrollSource.scrollLeft, top: vScrollSource?.scrollTop ?? scrollSource.scrollTop }
      : { left: 0, top: 0 };
    const beatsPerBar = getBeatsPerBar(this.state.song);
    const totalBeats = section.lengthInBars * beatsPerBar;
    const gridWidth = totalBeats * beatWidth;
    const gridHeight = visiblePitches.length * rowHeight;
    const sectionStart = this.getSectionStartBeat(section.id);
    const localPlayhead = this.state.playheadBeat - sectionStart;
    const ghostChordMarkup = this.renderGhostChordNotes(section, beatWidth, rowHeight, visiblePitches);
    const selectionCount = this.getSelectedNotes(section).length;
    const selectedNote = this.getSelectedNote();
    const selectedNoteIds = this.getSelectedNoteIds(section);
    const resizeArmedIds = this.isNoteResizeDragArmed(selectedNoteIds) ? new Set(selectedNoteIds) : new Set();
    const showNoteStrip = this.layoutProfile === "iphone";
    const layerBarLengthOptions = NOTE_LENGTH_DIVISOR_OPTIONS.map((d) => ({ divisor: d, durationBeats: 4 / d, label: `1/${d}` }));
    const layerBarDivisor = selectedNote ? layerBarLengthOptions.reduce((best, opt) =>
      Math.abs(opt.durationBeats - selectedNote.duration) < Math.abs(best.durationBeats - selectedNote.duration) ? opt : best,
      layerBarLengthOptions[0]).divisor : 4;
    const allSelectedMuted = selectionCount > 0 && this.getSelectedNotes(section).every((n) => n.muted);
    if (selectionCount > 0) {
      document.body.dataset.notesSelected = "true";
    } else {
      delete document.body.dataset.notesSelected;
    }

    const noteMarkup = notes
      .map((note) => {
        const noteTop = this.getPitchRowIndex(note.pitch, visiblePitches) * rowHeight + 2;
        const width = Math.max(18, note.duration * beatWidth - 4);
        const noteClass = this.getNoteColorClass(section, note);
        return `
          <div
            class="note-block ${noteClass} ${note.muted ? "muted" : ""} ${this.isNoteSelected(note.id, section) ? "active" : ""} ${resizeArmedIds.has(note.id) ? "resize-armed" : ""}"
            style="left:${note.startBeat * beatWidth + 2}px;top:${noteTop}px;width:${width}px;height:${rowHeight - 4}px"
            data-note-id="${note.id}"
          >
            <span class="note-label">${escapeHtml(this.getPitchLabel(note.pitch))}</span>
            <span class="resize-handle" data-note-id="${note.id}" data-note-handle="resize"></span>
          </div>
        `;
      })
      .join("");

    const barLines = Array.from({ length: section.lengthInBars + 1 }, (_, index) => {
      const left = index * beatsPerBar * beatWidth;
      return `<span class="bar-line" style="left:${left}px"></span>`;
    }).join("");

    this.refs.editorSurface.innerHTML = `
      <section class="melody-layout">
        <div class="melody-layer-bar">
          <div class="mode-switch embedded note-layer-switch">
            ${Object.entries(NOTE_EDITOR_LAYERS).map(([value, label]) =>
              `<button class="mode-button ${noteLayer === value ? "active" : ""}" data-action="set-note-editor-layer" data-note-layer="${value}">${label}</button>`
            ).join("")}
          </div>
          <div class="note-layer-actions">
            <button class="mini-button" data-action="toggle-mute-selected-note">${allSelectedMuted ? "Unmute" : "Mute"}</button>
            <select class="mini-length-select" data-action="set-selected-note-length-divisor">
              ${layerBarLengthOptions.map((opt) => `<option value="${opt.divisor}" ${layerBarDivisor === opt.divisor ? "selected" : ""}>${opt.label}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="melody-toolbar">
          <div class="mode-switch embedded selection-mode-switch">
            ${Object.entries(NOTE_SELECTION_MODE_LABELS).map(([value, label]) =>
              `<button class="mode-button ${this.state.noteSelectionMode === value ? "active" : ""}" data-action="set-note-selection-mode" data-selection-mode="${value}">${label}</button>`
            ).join("")}
          </div>
          <label class="meta-field snap-field melody-snap-field">
            <span>Snap</span>
            <select data-action="set-rhythm-snap-divisor">
              ${SNAP_DIVISOR_OPTIONS.map((value) => `
                <option value="${value}" ${this.state.rhythmSnapDivisor === value ? "selected" : ""}>1/${value}</option>
              `).join("")}
            </select>
          </label>
          <label class="meta-field snap-field melody-snap-field">
            <span>Quantize</span>
            <select data-action="set-quantize-divisor">
              ${SNAP_DIVISOR_OPTIONS.map((value) => `
                <option value="${value}" ${this.state.quantizeDivisor === value ? "selected" : ""}>1/${value}</option>
              `).join("")}
            </select>
          </label>
          <label class="meta-field snap-field melody-snap-field melody-size-field">
            <span>Size</span>
            <select data-action="set-note-grid-size">
              ${NOTE_GRID_SIZE_OPTIONS.map((val) => `
                <option value="${val}" ${(this.state.noteGridSize || DEFAULT_NOTE_GRID_SIZE) === val ? "selected" : ""}>${NOTE_GRID_SIZE_LABELS[val] ?? `${Math.round(val * 100)}%`}</option>
              `).join("")}
            </select>
          </label>
          <button class="action-button" data-action="quantize-notes">Quantize</button>
          <button class="action-button" data-action="delete-selected-note">Delete ${selectionCount > 1 ? "Selected" : layerLabel} ${selectionCount > 1 ? "Notes" : "Note"}</button>
          ${noteLayer === "melody"
            ? `<button class="action-button" data-action="fit-melody">Fit To Chords</button>`
            : `<button class="action-button" data-action="seed-bass-from-pattern">Use Preset Bass</button>`}
        </div>

        <div class="melody-shell">
          <div class="pitch-rail">
            ${visiblePitches.map((pitch) => `<div class="pitch-label">${escapeHtml(midiToLabel(pitch))}</div>`).join("")}
          </div>
          <div class="grid-scroll">
            <div
              id="melody-grid"
              class="melody-grid"
              style="width:${gridWidth}px;height:${gridHeight}px"
              data-total-beats="${totalBeats}"
            >
              ${barLines}
              ${ghostChordMarkup}
              <div class="playhead-line ${this.state.playbackSectionId === section.id ? "" : "hidden"}" style="left:${clamp(localPlayhead, 0, totalBeats) * beatWidth}px"></div>
              <div class="quick-select-layer hidden"></div>
              ${noteMarkup || `<div class="empty-state melody-empty" style="position:absolute;left:16px;top:16px;max-width:280px">Tap the grid to sketch a ${layerLabel.toLowerCase()} line.</div>`}
            </div>
          </div>
        </div>

        <div class="legend-row">
          <span class="legend-item"><span class="legend-swatch rose"></span>${noteLayer === "bass" ? "Chord + melody guides" : "Chord ghost"}</span>
          <span class="legend-item"><span class="legend-swatch green"></span>Chord tone</span>
          <span class="legend-item"><span class="legend-swatch teal"></span>In key</span>
          <span class="legend-item"><span class="legend-swatch gray"></span>Outside key</span>
        </div>

        ${showNoteStrip ? `<div class="melody-note-strip-slot">${this.getMelodyNoteStripMarkup(section, noteLayer)}</div>` : ""}
      </section>
    `;

    const nextScroll = this.refs.editorSurface.querySelector(".grid-scroll");
    const nextVScroll = this.refs.editorSurface.querySelector(".melody-shell");
    if (nextScroll) {
      nextScroll.scrollLeft = clamp(
        preservedScroll.left,
        0,
        Math.max(0, nextScroll.scrollWidth - nextScroll.clientWidth),
      );
    }
    if (nextVScroll) {
      nextVScroll.scrollTop = clamp(
        preservedScroll.top,
        0,
        Math.max(0, nextVScroll.scrollHeight - nextVScroll.clientHeight),
      );
    } else if (nextScroll) {
      nextScroll.scrollTop = clamp(
        preservedScroll.top,
        0,
        Math.max(0, nextScroll.scrollHeight - nextScroll.clientHeight),
      );
    }
    this.updateQuickSelectOverlay();
    this.refreshNoteSelection();
  }

  renderLyricsEditor() {
    const section = this.getActiveSection();
    if (this.state.lyricsViewMode === "sheet") {
      this.refs.editorSurface.innerHTML = `
        <section>
          <div class="stat-row">
            <div class="mode-switch embedded">
              ${Object.entries(LYRICS_VIEW_LABELS).map(([value, label]) =>
                `<button class="mode-button ${this.state.lyricsViewMode === value ? "active" : ""}" data-action="set-lyrics-view" data-view="${value}">${label}</button>`
              ).join("")}
            </div>
          </div>
          <div class="lyrics-list">
            ${this.state.song.sections.map((entry) => `
              <article class="lyrics-row">
                <div class="summary-row">
                  <strong>${escapeHtml(entry.name)}</strong>
                  <span>${escapeHtml(progressionSummary(entry.chordProgression))}</span>
                </div>
                <div class="song-sheet-block">
                  ${(entry.lyricsLines || []).map((line) => `
                    <div class="song-sheet-line">
                      <span class="small-copy">bar ${line.barIndex + 1}</span>
                      <p>${escapeHtml(line.text || "...")}</p>
                    </div>
                  `).join("") || '<div class="small-copy">No lyrics.</div>'}
                </div>
              </article>
            `).join("")}
          </div>
        </section>
      `;
      return;
    }

    this.refs.editorSurface.innerHTML = `
      <section>
        <div class="stat-row">
          <div class="mode-switch embedded">
            ${Object.entries(LYRICS_VIEW_LABELS).map(([value, label]) =>
              `<button class="mode-button ${this.state.lyricsViewMode === value ? "active" : ""}" data-action="set-lyrics-view" data-view="${value}">${label}</button>`
            ).join("")}
          </div>
          <button class="action-button primary" data-action="add-line">Add Line</button>
        </div>
        <div class="lyrics-list">
          ${section.lyricsLines.length
            ? section.lyricsLines.map((line, index) => `
                <article class="lyrics-row" data-line-id="${line.id}">
                  <textarea class="lyrics-text" data-line-id="${line.id}" data-field="text">${escapeHtml(line.text)}</textarea>
                  <div class="line-controls">
                    <span class="counter-pill" data-counter-for="${line.id}">${line.syllableCount} syl</span>
                    <input class="line-bar-input" type="number" min="0" max="${Math.max(0, section.lengthInBars - 1)}" value="${line.barIndex}" data-line-id="${line.id}" data-field="barIndex" />
                    <button class="section-button" data-action="line-up" data-line-index="${index}">Up</button>
                    <button class="section-button" data-action="line-down" data-line-index="${index}">Down</button>
                    <button class="section-button" data-action="delete-line" data-line-id="${line.id}">Del</button>
                  </div>
                </article>
              `).join("")
            : '<div class="empty-state">No lyrics. Add a line to start writing.</div>'}
        </div>
      </section>
    `;
  }

  renderArrangementEditor() {
    const sectionTypes = getSectionTypes();
    this.refs.editorSurface.innerHTML = `
      <section>
        <div class="stat-row">
          <label class="meta-field" style="min-width:180px">
            <span>Section type</span>
            <select id="arrangement-add-type">
              ${sectionTypes.map((type) => `<option value="${type}">${type}</option>`).join("")}
            </select>
          </label>
          <button class="action-button primary" data-action="create-section">Add</button>
        </div>
        <div class="chip-cloud">
          ${Object.keys(SECTION_TEMPLATES).map((label) =>
            `<button class="choice-chip" data-action="apply-template" data-template="${label}">${label}</button>`
          ).join("")}
        </div>
        <div class="arrangement-stack">
          ${this.state.song.sections.map((section, index) => `
            <article
              class="arrangement-card ${section.id === this.state.activeSectionId ? "active" : ""}"
              draggable="true"
              data-drag-type="section"
              data-section-index="${index}"
              data-section-id="${section.id}"
            >
              <div class="arrangement-title-row">
                <h3>${escapeHtml(section.name)}</h3>
                <span class="tag-pill">${section.chordProgression.length} chords</span>
              </div>
              <div class="accompaniment-grid">
                <label class="meta-field">
                  <span>Type</span>
                  <select data-section-id="${section.id}" data-field="name">
                    ${sectionTypes.map((type) => `<option value="${type}" ${type === section.name ? "selected" : ""}>${type}</option>`).join("")}
                  </select>
                </label>
                <label class="meta-field">
                  <span>Bars</span>
                  <input type="number" min="1" max="32" value="${section.lengthInBars}" data-section-id="${section.id}" data-field="lengthInBars" />
                </label>
                <label class="meta-field">
                  <span>Repeat</span>
                  <input type="number" min="1" max="8" value="${section.repeatCount || 1}" data-section-id="${section.id}" data-field="repeatCount" />
                </label>
                <label class="meta-field">
                  <span>Intensity</span>
                  <select data-section-id="${section.id}" data-field="intensityTag">
                    ${INTENSITY_TAGS.map((tag) => `<option value="${tag}" ${section.intensityTag === tag ? "selected" : ""}>${tag}</option>`).join("")}
                  </select>
                </label>
              </div>
              <div class="section-actions" style="margin-top:8px">
                <button class="section-button ${section.id === this.state.activeSectionId ? "active" : ""}" data-action="select-section" data-section-id="${section.id}">Select</button>
                <button class="section-button" data-action="duplicate-section" data-section-id="${section.id}">Duplicate</button>
                <button class="section-button" data-action="delete-section" data-section-id="${section.id}">Delete</button>
              </div>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  // Studio tab (renamed from "Accompaniment" to match ChordButter)
  renderStudioEditor() {
    const section = this.getActiveSection();
    const sectionVolumes = section.accompanimentStyle?.layerVolumes || {};
    this.refs.editorSurface.innerHTML = `
      <section class="studio-layout">
        <article class="studio-card studio-master-card">
          <div class="arrangement-title-row">
            <h3>${escapeHtml(section.name)} Mix</h3>
            <span class="tag-pill">${section.lengthInBars} bars</span>
          </div>
          <div class="stat-row">
            <span class="status-pill">${section.chordProgression.length} chords</span>
            <span class="status-pill">${section.melodyNotes.length} notes</span>
            <span class="status-pill">Intensity: ${escapeHtml(section.intensityTag || "medium")}</span>
          </div>
          <div class="accompaniment-grid" style="margin-top:12px">
            <label class="meta-field">
              <span>Instrument</span>
              <select data-action="set-instrument-flavor">
                ${INSTRUMENT_FLAVORS.map((style) => `<option value="${style}" ${section.accompanimentStyle?.instrumentFlavor === style ? "selected" : ""}>${style}</option>`).join("")}
              </select>
            </label>
            <label class="meta-field">
              <span>Density</span>
              <input type="range" min="0" max="1" step="0.05" value="${section.accompanimentStyle?.density ?? 0.5}" data-action="set-density" />
            </label>
            <label class="meta-field">
              <span>Energy</span>
              <input type="range" min="0" max="1" step="0.05" value="${section.accompanimentStyle?.energy ?? 0.5}" data-action="set-energy" />
            </label>
            <label class="meta-field">
              <span>Intensity</span>
              <select data-action="set-section-intensity">
                ${INTENSITY_TAGS.map((tag) => `<option value="${tag}" ${section.intensityTag === tag ? "selected" : ""}>${tag}</option>`).join("")}
              </select>
            </label>
          </div>
        </article>

        <div class="studio-track-grid">
          <article class="studio-card">
            <div class="arrangement-title-row">
              <h3>Chords</h3>
              <div class="section-actions">
                <button class="section-button" data-action="edit-track-workspace" data-layer="chords">Edit</button>
                <button class="section-button ${this.isLayerSolo(section, "chords") ? "active" : ""}" data-action="toggle-track-solo" data-layer="chords">Solo</button>
                <button class="section-button ${this.isLayerMuted(section, "chords") ? "active" : ""}" data-action="toggle-track-mute" data-layer="chords">Mute</button>
              </div>
            </div>
            <div class="accompaniment-grid">
              <label class="meta-field">
                <span>Style</span>
                <select data-action="set-chord-style">
                  ${CHORD_STYLES.map((style) => `<option value="${style}" ${section.accompanimentStyle?.chordStyle === style ? "selected" : ""}>${style}</option>`).join("")}
                </select>
              </label>
              <label class="meta-field">
                <span>Level</span>
                <input type="range" min="0" max="1" step="0.05" value="${sectionVolumes.chords ?? 0.9}" data-action="set-track-volume" data-layer="chords" />
              </label>
            </div>
          </article>

          <article class="studio-card">
            <div class="arrangement-title-row">
              <h3>Bass</h3>
              <div class="section-actions">
                <button class="section-button" data-action="edit-track-workspace" data-layer="bass">Edit</button>
                <button class="section-button ${this.isLayerSolo(section, "bass") ? "active" : ""}" data-action="toggle-track-solo" data-layer="bass">Solo</button>
                <button class="section-button ${this.isLayerMuted(section, "bass") ? "active" : ""}" data-action="toggle-track-mute" data-layer="bass">Mute</button>
              </div>
            </div>
            <div class="accompaniment-grid">
              <label class="meta-field">
                <span>Pattern</span>
                <select data-action="set-bass-pattern">
                  ${BASS_STYLES.map((style) => `<option value="${style}" ${section.accompanimentStyle?.bassPattern === style ? "selected" : ""}>${style}</option>`).join("")}
                </select>
              </label>
              <label class="meta-field">
                <span>Level</span>
                <input type="range" min="0" max="1" step="0.05" value="${sectionVolumes.bass ?? 0.9}" data-action="set-track-volume" data-layer="bass" />
              </label>
            </div>
          </article>

          <article class="studio-card">
            <div class="arrangement-title-row">
              <h3>Drums</h3>
              <div class="section-actions">
                <button class="section-button" data-action="edit-track-workspace" data-layer="drums">Edit</button>
                <button class="section-button ${this.isLayerSolo(section, "drums") ? "active" : ""}" data-action="toggle-track-solo" data-layer="drums">Solo</button>
                <button class="section-button ${this.isLayerMuted(section, "drums") ? "active" : ""}" data-action="toggle-track-mute" data-layer="drums">Mute</button>
              </div>
            </div>
            <div class="accompaniment-grid">
              <label class="meta-field">
                <span>Preset</span>
                <select data-action="set-drum-preset">
                  ${DRUM_STYLES.map((style) => `<option value="${style}" ${section.accompanimentStyle?.drumPreset === style ? "selected" : ""}>${style}</option>`).join("")}
                </select>
              </label>
              <label class="meta-field">
                <span>Level</span>
                <input type="range" min="0" max="1" step="0.05" value="${sectionVolumes.drums ?? 0.9}" data-action="set-track-volume" data-layer="drums" />
              </label>
            </div>
          </article>

          <article class="studio-card">
            <div class="arrangement-title-row">
              <h3>Melody</h3>
              <div class="section-actions">
                <button class="section-button" data-action="edit-track-workspace" data-layer="melody">Edit</button>
                <button class="section-button ${this.isLayerSolo(section, "melody") ? "active" : ""}" data-action="toggle-track-solo" data-layer="melody">Solo</button>
                <button class="section-button ${this.isLayerMuted(section, "melody") ? "active" : ""}" data-action="toggle-track-mute" data-layer="melody">Mute</button>
              </div>
            </div>
            <div class="accompaniment-grid">
              <label class="meta-field">
                <span>Level</span>
                <input type="range" min="0" max="1" step="0.05" value="${sectionVolumes.melody ?? 1}" data-action="set-track-volume" data-layer="melody" />
              </label>
              <label class="meta-field">
                <span>Status</span>
                <input type="text" value="${escapeHtml(this.getTrackSummary(section, "melody"))}" disabled />
              </label>
            </div>
          </article>
        </div>
      </section>
    `;
  }

  // ===== EVENT HANDLERS =====

  handleSectionListClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const { action, sectionId } = button.dataset;
    if (action === "select-section") {
      this.state.activeSectionId = sectionId;
      this.clearNoteSelection();
      this.state.selectedChordIndex = null;
      this.renderAll();
      return;
    }
    if (action === "loop-section") {
      const nextLoop = this.playback.loopSectionId === sectionId ? null : sectionId;
      this.playback.setLoopSection(nextLoop);
      this.renderTransportStatus();
      this.renderSections();
    }
  }

  handleArrangementOverviewClick(event) {
    const button = event.target.closest("[data-overview-action]");
    if (!button) return;

    const section = findSection(this.state.song, button.dataset.sectionId);
    if (!section) return;

    if (button.dataset.overviewAction === "select-section") {
      this.state.activeSectionId = section.id;
      this.renderAll();
      return;
    }

    if (button.dataset.overviewAction === "edit-track") {
      this.openTrackWorkspace(button.dataset.layer, section.id);
      return;
    }

    if (button.dataset.overviewAction === "toggle-mute") {
      this.toggleSectionLayerMute(section, button.dataset.layer);
      this.persistSong();
      this.renderAll();
      return;
    }

    if (button.dataset.overviewAction === "toggle-solo") {
      this.toggleSectionLayerSolo(section, button.dataset.layer);
      this.persistSong();
      this.renderAll();
    }
  }

  handleProgressionClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    if (button.dataset.action === "select-chord") {
      const index = Number.parseInt(button.dataset.chordIndex, 10);
      if (Number.isNaN(index)) return;
      this.state.selectedChordIndex = index;
      const chord = this.getSelectedChord();
      if (chord) {
        this.auditionChord(chord);
        this.renderPianoVisualizer(chord);
      }
      this.renderProgression();
    }
  }

  handleChordInspectorClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const section = this.getActiveSection();
    const index = this.state.selectedChordIndex;
    if (typeof index !== "number") return;
    const chord = section.chordProgression[index];
    if (!chord) return;

    if (button.dataset.action === "set-chord-quality") {
      chord.quality = button.dataset.quality;
      section.chordProgression[index] = createChord(chord);
      this.persistSong();
      this.auditionChord(section.chordProgression[index]);
      this.renderPianoVisualizer(section.chordProgression[index]);
      this.refreshHarmonyViews();
      return;
    }

    if (button.dataset.action === "set-chord-extension") {
      chord.extension = button.dataset.extension || "";
      section.chordProgression[index] = createChord(chord);
      this.persistSong();
      this.auditionChord(section.chordProgression[index]);
      this.renderPianoVisualizer(section.chordProgression[index]);
      this.refreshHarmonyViews();
      return;
    }

    if (button.dataset.action === "audition-selected-chord") {
      this.auditionChord(chord);
      return;
    }

    if (button.dataset.action === "duplicate-selected-chord") {
      const copy = createChord({ ...chord });
      section.chordProgression.splice(index + 1, 0, copy);
      this.state.selectedChordIndex = index + 1;
      this.persistSong();
      this.auditionChord(copy);
      this.renderPianoVisualizer(copy);
      this.refreshHarmonyViews();
      return;
    }

    if (button.dataset.action === "split-selected-chord") {
      if (chord.durationInBeats <= 1) return;
      const firstDuration = Math.max(1, Math.floor(chord.durationInBeats / 2));
      const secondDuration = Math.max(1, chord.durationInBeats - firstDuration);
      chord.durationInBeats = firstDuration;
      chord.durationBeats = firstDuration;
      const copy = createChord({ ...chord, durationInBeats: secondDuration, durationBeats: secondDuration });
      section.chordProgression[index] = createChord(chord);
      section.chordProgression.splice(index + 1, 0, copy);
      this.state.selectedChordIndex = index;
      this.persistSong();
      this.renderPianoVisualizer(section.chordProgression[index]);
      this.refreshHarmonyViews();
      return;
    }

    if (button.dataset.action === "merge-selected-chord") {
      const next = section.chordProgression[index + 1];
      if (!next) return;
      chord.durationInBeats += next.durationInBeats;
      chord.durationBeats = chord.durationInBeats;
      section.chordProgression[index] = createChord(chord);
      section.chordProgression.splice(index + 1, 1);
      this.persistSong();
      this.renderPianoVisualizer(section.chordProgression[index]);
      this.refreshHarmonyViews();
      return;
    }

    if (button.dataset.action === "delete-selected-chord") {
      section.chordProgression.splice(index, 1);
      if (!section.chordProgression.length) {
        this.state.selectedChordIndex = null;
        this.renderPianoVisualizer(null);
      } else {
        this.state.selectedChordIndex = Math.min(index, section.chordProgression.length - 1);
        this.renderPianoVisualizer(this.getSelectedChord());
      }
      this.persistSong();
      this.refreshHarmonyViews();
    }
  }

  handleChordInspectorChange(event) {
    const target = event.target;
    const field = target.dataset.chordField;
    if (!field) return;

    const section = this.getActiveSection();
    const index = this.state.selectedChordIndex;
    if (typeof index !== "number") return;
    const chord = section.chordProgression[index];
    if (!chord) return;

    if (field === "root") {
      chord.root = target.value;
    } else if (field === "durationInBeats") {
      chord.durationInBeats = clamp(
        Number.parseInt(target.value, 10) || getBeatsPerBar(this.state.song),
        1,
        16,
      );
      chord.durationBeats = chord.durationInBeats;
    } else if (field === "inversion") {
      chord.inversion = clamp(Number.parseInt(target.value, 10) || 0, 0, 3);
    } else if (field === "slashBass") {
      chord.slashBass = target.value;
    }

    section.chordProgression[index] = createChord(chord);
    this.persistSong();
    this.auditionChord(section.chordProgression[index]);
    this.renderPianoVisualizer(section.chordProgression[index]);
    this.refreshHarmonyViews();
  }

  handleSuggestionClick(event) {
    const button = event.target.closest("[data-action='insert-suggestion']");
    if (!button) return;

    const section = this.getActiveSection();
    const chord = createChord({
      root: button.dataset.root,
      quality: button.dataset.quality,
      extension: button.dataset.extension || "",
      durationInBeats: Number.parseInt(button.dataset.duration, 10) || getBeatsPerBar(this.state.song),
    });
    section.chordProgression.push(chord);
    this.state.selectedChordIndex = section.chordProgression.length - 1;
    this.auditionChord(chord);
    this.persistSong();
    this.refreshHarmonyViews();
    this.renderPianoVisualizer(chord);
  }

  handleModeSurfaceClick(event) {
    const layoutButton = event.target.closest("[data-layout-mode]");
    if (layoutButton) {
      this.setLayoutMode(layoutButton.dataset.layoutMode);
      return;
    }

    const button = event.target.closest("[data-mode-action]");
    if (!button) return;

    const action = button.dataset.modeAction;

    if (action === "suggest-song") {
      this.state.ideaSuggestions.song = sanitizeSong(generateSongIdea(this.state.generator));
      this.renderModeSurface();
      return;
    }
    if (action === "suggest-progression") {
      const suggestionSong = regenerateProgressions(cloneSong(this.state.song), this.state.generator);
      this.state.ideaSuggestions.progression =
        suggestionSong.sections[this.getActiveSectionIndex()]?.chordProgression || [];
      this.renderModeSurface();
      return;
    }
    if (action === "suggest-melody") {
      const suggestionSong = regenerateMelodies(cloneSong(this.state.song));
      this.state.ideaSuggestions.melody =
        suggestionSong.sections[this.getActiveSectionIndex()]?.melodyNotes || [];
      this.renderModeSurface();
      return;
    }
    if (action === "suggest-chords-from-melody") {
      this.suggestChordsFromMelody();
      return;
    }
    if (action === "apply-suggested-song") {
      if (!this.state.ideaSuggestions.song) return;
      this.state.song = sanitizeSong(cloneSong(this.state.ideaSuggestions.song));
      this.state.activeSectionId = this.state.song.sections[0]?.id || null;
      this.state.activeTab = "melody";
      this.clearNoteSelection();
      this.state.noteEditorLayer = "melody";
      this.state.generator = generatorDefaults(this.state.song);
      this.playback.stop();
      this.enableLoopForActiveSection();
      this.persistSong();
      this.renderAll();
      return;
    }
    if (action === "apply-suggested-progression") {
      const suggestion = this.state.ideaSuggestions.progression;
      if (!suggestion) return;
      this.getActiveSection().chordProgression = cloneSong(suggestion);
      this.persistSong();
      this.refreshHarmonyViews();
      this.renderModeSurface();
      return;
    }
    if (action === "apply-suggested-melody") {
      const suggestion = this.state.ideaSuggestions.melody;
      if (!suggestion) return;
      this.getActiveSection().melodyNotes = sortNotes(cloneSong(suggestion));
      this.persistSong();
      this.renderEditor();
      this.renderModeSurface();
      return;
    }
    if (action === "apply-suggested-chords") {
      const suggestion = this.state.ideaSuggestions.chordsFromMelody;
      if (!suggestion) return;
      this.getActiveSection().chordProgression = cloneSong(suggestion);
      this.persistSong();
      this.refreshHarmonyViews();
      this.renderModeSurface();
      return;
    }
    if (action === "reset-blank") {
      this.resetBlankSong();
      return;
    }
    if (action === "start-blank-project") {
      this.resetBlankSong();
      return;
    }
    if (action === "import-json") {
      this.openProjectImportPicker();
      return;
    }
    if (action === "export-json") {
      if (this.state.exportDialogOpen) this.closeExportDialog();
      exportProjectJson(this.state.song);
      return;
    }
    if (action === "export-midi") {
      if (this.state.exportDialogOpen) this.closeExportDialog();
      exportMidi(this.state.song);
      return;
    }
    if (action === "export-wav") {
      this.exportWavFromMode({ closeExportDialogOnFinish: this.state.exportDialogOpen });
      return;
    }
    if (action === "export-text-chords") {
      if (this.state.exportDialogOpen) this.closeExportDialog();
      exportTextSheet(this.state.song, "chords");
      return;
    }
    if (action === "export-text-lyrics") {
      if (this.state.exportDialogOpen) this.closeExportDialog();
      exportTextSheet(this.state.song, "lyrics");
      return;
    }
    if (action === "export-text-full") {
      if (this.state.exportDialogOpen) this.closeExportDialog();
      exportTextSheet(this.state.song, "chords-lyrics");
    }
  }

  handleModeSurfaceInput(event) {
    const target = event.target;
  }

  handleModeSurfaceChange(event) {
    const target = event.target;
    if (target.dataset.generatorField) {
      this.state.generator[target.dataset.generatorField] = target.value;
      return;
    }
  }

  handleSettingsDialogClick(event) {
    if (event.target === this.refs.settingsDialog) {
      this.applySettingsDialogAction("close");
      return;
    }

    const closeButton = event.target.closest("[data-settings-dialog-action='close']");
    if (closeButton) {
      this.applySettingsDialogAction("close");
      return;
    }

    const layoutButton = event.target.closest("[data-settings-layout-mode]");
    if (layoutButton) {
      this.applySettingsDialogAction("set-layout-mode", layoutButton.dataset.settingsLayoutMode);
      return;
    }

    const button = event.target.closest("[data-settings-dialog-action]");
    if (!button) return;

    if (button.dataset.settingsDialogAction === "start-blank-project") {
      this.applySettingsDialogAction("start-blank-project");
    }
  }

  handleExportDialogClick(event) {
    if (event.target === this.refs.exportDialog) {
      this.closeExportDialog();
      return;
    }

    const closeButton = event.target.closest("[data-export-dialog-action='close']");
    if (closeButton) {
      this.closeExportDialog();
      return;
    }

    const modeAction = event.target.closest("[data-mode-action]");
    if (!modeAction) return;
    this.handleModeSurfaceClick(event);
  }

  handleTempoDialogClick(event) {
    if (event.target === this.refs.tempoDialog) {
      this.closeTempoDialog();
      return;
    }

    const closeButton = event.target.closest("[data-tempo-dialog-action='close']");
    if (closeButton) {
      this.closeTempoDialog();
      return;
    }

    const stepButton = event.target.closest("[data-tempo-dialog-step]");
    if (!stepButton) return;
    this.tempoDialogDirty = true;
    this.updateTempoValue(this.state.song.tempo + (Number.parseInt(stepButton.dataset.tempoDialogStep, 10) || 0), { persist: false });
  }

  handleTempoDialogPointerDown(event) {
    const dial = event.target.closest("[data-tempo-dial]");
    if (!dial) return;
    if (typeof event.button === "number" && event.button !== 0) return;
    if (event.cancelable) event.preventDefault();
    this.stopTempoDialGesture();
    this.tempoDialogDirty = true;
    this.updateTempoValue(this.getTempoFromDialPoint(event.clientX, event.clientY, dial), { persist: false });
    const move = (moveEvent) => {
      if (typeof event.pointerId === "number" && moveEvent.pointerId !== event.pointerId) return;
      if (moveEvent.cancelable) moveEvent.preventDefault();
      this.updateTempoValue(this.getTempoFromDialPoint(moveEvent.clientX, moveEvent.clientY, dial), { persist: false });
    };
    const end = (endEvent) => {
      if (typeof event.pointerId === "number" && endEvent.pointerId !== event.pointerId) return;
      this.stopTempoDialGesture();
    };
    this.tempoDialDrag = {
      dial,
      pointerId: event.pointerId,
      move,
      end,
    };
    try { dial.setPointerCapture(event.pointerId); } catch (error) {}
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  stopTempoDialGesture() {
    if (!this.tempoDialDrag) return;
    const { dial, pointerId, move, end } = this.tempoDialDrag;
    try { dial?.releasePointerCapture?.(pointerId); } catch (error) {}
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    this.tempoDialDrag = null;
  }

  resetBlankSong() {
    this.closeTempoDialog({ persist: false, render: false });
    this.state.song = createFallbackSong();
    this.state.activeSectionId = this.state.song.sections[0]?.id || null;
    this.state.activeTab = "melody";
    this.clearNoteSelection();
    this.state.selectedChordIndex = null;
    this.state.noteEditorLayer = "melody";
    this.state.paletteMode = "chords";
    this.state.ideaSuggestions = { song: null, progression: null, melody: null, chordsFromMelody: null };
    this.state.generator = generatorDefaults(this.state.song);
    this.playback.stop();
    this.enableLoopForActiveSection();
    this.persistSong();
    this.renderAll();
  }

  openProjectImportPicker() {
    if (!this.refs.projectImportInput) return;
    this.refs.projectImportInput.value = "";
    this.refs.projectImportInput.click();
  }

  loadProjectSong(projectData) {
    if (!projectData || typeof projectData !== "object" || Array.isArray(projectData)) {
      throw new Error("That file doesn't look like a saved project.");
    }

    this.closeTempoDialog({ persist: false, render: false });
    this.playback.stop();
    this.state.song = sanitizeSong(cloneSong(projectData));
    this.state.activeSectionId = this.state.song.sections[0]?.id || null;
    this.state.activeTab = "melody";
    this.state.workspaceMode = "compose";
    this.state.noteEditorLayer = "melody";
    this.state.paletteMode = "chords";
    this.state.lyricsViewMode = "section";
    this.state.selectedChordIndex = null;
    this.state.selectedLyricId = null;
    this.state.playheadBeat = 0;
    this.state.playbackSectionId = null;
    this.state.playbackChordIndex = null;
    this.state.ideaSuggestions = { song: null, progression: null, melody: null, chordsFromMelody: null };
    this.state.generator = generatorDefaults(this.state.song);
    this.clearNoteSelection();
    this.undoStack = [];
    this.redoStack = [];
    this.persistSong({ recordHistory: false });
    this.enableLoopForActiveSection();
    this.renderAll();
  }

  async handleProjectImportChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const raw = await file.text();
      this.closeExportDialog({ render: false });
      this.loadProjectSong(JSON.parse(raw));
    } catch (error) {
      window.alert(error?.message || "Couldn't import that project file.");
    } finally {
      event.target.value = "";
    }
  }

  async exportWavFromMode({ closeExportDialogOnFinish = false } = {}) {
    if (this.state.exportingWav) return;
    try {
      this.state.exportingWav = true;
      this.renderTransportStatus();
      this.renderModeSurface();
      this.renderExportDialog();
      await exportWav(this.state.song);
    } catch (error) {
      window.alert(error.message);
    } finally {
      this.state.exportingWav = false;
      this.renderTransportStatus();
      this.renderModeSurface();
      if (closeExportDialogOnFinish) {
        this.closeExportDialog();
      } else {
        this.renderExportDialog();
      }
    }
  }

  suggestChordsFromMelody() {
    const section = this.getActiveSection();
    this.state.ideaSuggestions.chordsFromMelody = autoSuggestChords(
      section.melodyNotes,
      this.state.song,
      Math.max(1, Math.min(section.lengthInBars || 4, 4)),
    );
    this.state.workspaceMode = "ideas";
    this.renderWorkspaceModeButtons();
    this.renderModeSurface();
  }

  // ===== EDITOR EVENT HANDLERS =====

  handleEditorClick(event) {
    // Melody tools sheet toggle (works on any tab)
    const toolsToggle = event.target.closest("[data-action='toggle-melody-tools']");
    if (toolsToggle) {
      if (document.body.dataset.melodyToolsOpen) {
        delete document.body.dataset.melodyToolsOpen;
      } else {
        document.body.dataset.melodyToolsOpen = "true";
      }
      return;
    }
    // Close tools sheet when clicking inside editor surface (not on the toolbar)
    if (document.body.dataset.melodyToolsOpen && !event.target.closest(".melody-toolbar")) {
      delete document.body.dataset.melodyToolsOpen;
    }
    if (this.state.activeTab === "melody") {
      const grid = event.target.closest("#melody-grid");
      const noteBlock = event.target.closest(".note-block");
      const actionButton = event.target.closest("[data-action]");
      if (actionButton?.dataset.action === "set-note-editor-layer") {
        this.setNoteEditorLayer(actionButton.dataset.noteLayer);
        return;
      }
      if (actionButton?.dataset.action === "set-note-selection-mode") {
        const nextMode = actionButton.dataset.selectionMode;
        if (nextMode && nextMode !== this.state.noteSelectionMode) {
          this.state.noteSelectionMode = nextMode;
          this.renderMelodyEditor();
        }
        return;
      }
      if (actionButton?.dataset.action === "delete-selected-note") {
        this.deleteSelectedNote();
        return;
      }
      if (actionButton?.dataset.action === "copy-selected-note-on-drag") {
        this.armSelectedNotesForCopyDrag();
        return;
      }
      if (actionButton?.dataset.action === "arm-selected-note-resize-drag") {
        this.armSelectedNotesForResizeDrag();
        return;
      }
      if (actionButton?.dataset.action === "transpose-selected-note-up") {
        this.transposeSelectedNote(12);
        return;
      }
      if (actionButton?.dataset.action === "transpose-selected-note-down") {
        this.transposeSelectedNote(-12);
        return;
      }
      if (actionButton?.dataset.action === "transpose-selected-note-up-semitone") {
        this.transposeSelectedNoteByScaleStep(1);
        return;
      }
      if (actionButton?.dataset.action === "transpose-selected-note-down-semitone") {
        this.transposeSelectedNoteByScaleStep(-1);
        return;
      }
      if (actionButton?.dataset.action === "toggle-mute-selected-note") {
        this.toggleSelectedNoteMute();
        return;
      }
      if (actionButton?.dataset.action === "set-selected-notes-quarter-length") {
        const section = this.getActiveSection();
        const selectedNotes = this.getSelectedNotes(section);
        if (!selectedNotes.length) return;
        const totalBeats = sectionLengthInBeats(this.state.song, section);
        const minimumDuration = this.getMinimumMelodyStepDuration();
        selectedNotes.forEach((note) => {
          note.duration = clamp(1, minimumDuration, Math.max(minimumDuration, totalBeats - note.startBeat));
        });
        this.persistSong();
        this.renderMelodyEditor();
        return;
      }
      if (actionButton?.dataset.action === "fit-melody") {
        this.fitMelodyToHarmony();
        return;
      }
      if (actionButton?.dataset.action === "seed-bass-from-pattern") {
        const section = this.getActiveSection();
        section.bassNotes = buildBassNotesFromSection(section, this.state.song).map((note) => createNote(note));
        section.bassNotesInitialized = true;
        this.clearNoteSelection();
        this.persistSong();
        this.renderMelodyEditor();
        return;
      }
      if (actionButton?.dataset.action === "quantize-notes") {
        this.quantizeNotesToGrid();
        return;
      }
      if (this.state.suppressNextEditorClick) {
        this.state.suppressNextEditorClick = false;
        return;
      }
      if (noteBlock) {
        this.handleNoteSelectionTap(noteBlock.dataset.noteId);
        this.renderMelodyEditor();
        return;
      }
      if (grid) {
        this.noteQuickPopupEnabled = false;
        if (this.state.noteMultiSelectActive) {
          this.clearNoteSelection();
          this.renderMelodyEditor();
          return;
        }
        this.addNoteFromGrid(event, grid);
      }
      return;
    }

    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    const action = actionButton.dataset.action;

    if (action === "add-line") {
      this.getActiveSection().lyricsLines.push(
        createLyricsLine({
          text: "",
          syllableCount: 0,
          barIndex: this.getActiveSection().lyricsLines.length,
        }),
      );
      this.persistSong({ refreshPlayback: false });
      this.renderLyricsEditor();
      return;
    }

    if (action === "set-lyrics-view") {
      this.state.lyricsViewMode = actionButton.dataset.view || "section";
      this.renderLyricsEditor();
      return;
    }

    if (action === "delete-line") {
      const section = this.getActiveSection();
      section.lyricsLines = section.lyricsLines.filter((line) => line.id !== actionButton.dataset.lineId);
      this.persistSong({ refreshPlayback: false });
      this.renderLyricsEditor();
      return;
    }

    if (action === "line-up" || action === "line-down") {
      const index = Number.parseInt(actionButton.dataset.lineIndex, 10);
      const nextIndex = clamp(
        index + (action === "line-up" ? -1 : 1),
        0,
        this.getActiveSection().lyricsLines.length - 1,
      );
      this.getActiveSection().lyricsLines = moveItem(this.getActiveSection().lyricsLines, index, nextIndex);
      this.persistSong({ refreshPlayback: false });
      this.renderLyricsEditor();
      return;
    }

    if (action === "create-section") {
      const type = this.refs.editorSurface.querySelector("#arrangement-add-type")?.value || "Verse";
      const section = createBlankSection(type);
      this.state.song.sections.splice(this.getActiveSectionIndex() + 1, 0, section);
      this.state.activeSectionId = section.id;
      this.persistSong();
      this.renderAll();
      return;
    }

    if (action === "apply-template") {
      const template = SECTION_TEMPLATES[actionButton.dataset.template] || SECTION_TEMPLATES["Verse / Chorus"];
      this.state.song.sections = template.map((name) => createBlankSection(name));
      this.state.activeSectionId = this.state.song.sections[0]?.id || null;
      this.persistSong();
      this.renderAll();
      return;
    }

    if (action === "select-section") {
      this.state.activeSectionId = actionButton.dataset.sectionId;
      this.renderAll();
      return;
    }

    if (action === "duplicate-section") {
      const source = findSection(this.state.song, actionButton.dataset.sectionId);
      const fresh = createSection({
        name: source.name,
        lengthInBars: source.lengthInBars,
        chordProgression: cloneSong(source.chordProgression),
        melodyNotes: source.melodyNotes.map((note) =>
          createNote({
            pitch: note.pitch,
            startBeat: note.startBeat,
            duration: note.duration,
            velocity: note.velocity,
            muted: note.muted,
          }),
        ),
        bassNotes: (source.bassNotes || []).map((note) =>
          createNote({
            pitch: note.pitch,
            startBeat: note.startBeat,
            duration: note.duration,
            velocity: note.velocity,
            muted: note.muted,
          }),
        ),
        bassNotesInitialized: source.bassNotesInitialized,
        lyricsLines: source.lyricsLines.map((line) =>
          createLyricsLine({ text: line.text, syllableCount: line.syllableCount, barIndex: line.barIndex }),
        ),
        drumSequence: cloneSong(source.drumSequence),
        accompanimentStyle: cloneSong(source.accompanimentStyle),
      });
      this.state.song.sections.splice(
        this.state.song.sections.findIndex((entry) => entry.id === actionButton.dataset.sectionId) + 1,
        0,
        fresh,
      );
      this.state.activeSectionId = fresh.id;
      this.persistSong();
      this.renderAll();
      return;
    }

    if (action === "delete-section") {
      if (this.state.song.sections.length === 1) return;
      this.state.song.sections = this.state.song.sections.filter(
        (section) => section.id !== actionButton.dataset.sectionId,
      );
      this.state.activeSectionId = this.state.song.sections[0]?.id || null;
      if (this.playback.loopSectionId === actionButton.dataset.sectionId) {
        this.playback.setLoopSection(null);
      }
      this.persistSong();
      this.renderAll();
      return;
    }

    if (this.state.activeTab === "studio" && action === "toggle-track-mute") {
      const section = this.getActiveSection();
      this.toggleSectionLayerMute(section, actionButton.dataset.layer);
      this.persistSong();
      this.renderAll();
      return;
    }

    if (this.state.activeTab === "studio" && action === "edit-track-workspace") {
      this.openTrackWorkspace(actionButton.dataset.layer, this.state.activeSectionId);
      return;
    }

    if (this.state.activeTab === "studio" && action === "toggle-track-solo") {
      const section = this.getActiveSection();
      this.toggleSectionLayerSolo(section, actionButton.dataset.layer);
      this.persistSong();
      this.renderAll();
    }
  }

  handleEditorInput(event) {
    if (this.state.activeTab !== "lyrics") return;
    const target = event.target;
    if (target.dataset.field !== "text") return;
    const line = this.getActiveSection().lyricsLines.find((entry) => entry.id === target.dataset.lineId);
    if (!line) return;
    line.text = target.value;
    line.syllableCount = countSyllables(target.value);
    line.syllables = line.syllableCount;
    this.persistSong({ refreshPlayback: false });
    const counter = this.refs.editorSurface.querySelector(`[data-counter-for="${line.id}"]`);
    if (counter) {
      counter.textContent = `${line.syllableCount} syl`;
    }
  }

  handleEditorChange(event) {
    const target = event.target;
    if (this.state.activeTab === "melody" && target.dataset.action === "set-rhythm-snap-divisor") {
      this.state.rhythmSnapDivisor = Number.parseInt(target.value, 10) || DEFAULT_RHYTHM_SNAP_DIVISOR;
      return;
    }

    if (this.state.activeTab === "melody" && target.dataset.action === "set-quantize-divisor") {
      this.state.quantizeDivisor = Number.parseInt(target.value, 10) || DEFAULT_QUANTIZE_DIVISOR;
      return;
    }

    if (this.state.activeTab === "melody" && target.dataset.action === "set-note-grid-size") {
      const val = parseFloat(target.value);
      if (NOTE_GRID_SIZE_OPTIONS.includes(val)) {
        this.state.noteGridSize = val;
        this.applyLayoutMetrics();
        this.renderMelodyEditor();
      }
      return;
    }

    if (this.state.activeTab === "melody" && target.dataset.action === "set-selected-note-length-divisor") {
      const section = this.getActiveSection();
      const selectedNotes = this.getSelectedNotes(section);
      if (!selectedNotes.length) return;
      const divisor = Math.max(1, Number.parseInt(target.value, 10) || 4);
      const totalBeats = sectionLengthInBeats(this.state.song, section);
      const minimumDuration = this.getMinimumMelodyStepDuration();
      const maximumSharedDuration = Math.max(
        minimumDuration,
        Math.min(...selectedNotes.map((note) => Math.max(minimumDuration, totalBeats - note.startBeat))),
      );
      const nextDuration = clamp(4 / divisor, minimumDuration, maximumSharedDuration);
      selectedNotes.forEach((note) => {
        note.duration = nextDuration;
      });
      this.persistSong();
      this.renderMelodyEditor();
      return;
    }

    if (this.state.activeTab === "lyrics") {
      if (target.dataset.field === "barIndex") {
        const line = this.getActiveSection().lyricsLines.find((entry) => entry.id === target.dataset.lineId);
        if (!line) return;
        line.barIndex = clamp(
          Number.parseInt(target.value, 10) || 0,
          0,
          Math.max(0, this.getActiveSection().lengthInBars - 1),
        );
        this.persistSong({ refreshPlayback: false });
      }
      return;
    }

    if (this.state.activeTab === "arrangement") {
      const section = findSection(this.state.song, target.dataset.sectionId);
      if (!section) return;
      if (target.dataset.field === "name") section.name = target.value;
      if (target.dataset.field === "lengthInBars") section.lengthInBars = clamp(Number.parseInt(target.value, 10) || section.lengthInBars, 1, 32);
      if (target.dataset.field === "repeatCount") section.repeatCount = clamp(Number.parseInt(target.value, 10) || 1, 1, 8);
      if (target.dataset.field === "intensityTag") section.intensityTag = target.value;
      this.persistSong();
      this.renderAll();
      return;
    }

    if (this.state.activeTab === "studio") {
      const section = this.getActiveSection();
      if (target.dataset.action === "set-chord-style") section.accompanimentStyle.chordStyle = target.value;
      if (target.dataset.action === "set-bass-pattern") {
        section.accompanimentStyle.bassPattern = target.value;
        section.accompanimentStyle.bassStyle = target.value;
      }
      if (target.dataset.action === "set-drum-preset") {
        section.accompanimentStyle.drumPreset = target.value;
        section.accompanimentStyle.drumStyle = target.value;
        section.drumSequence = createDrumSequenceFromPreset(section, this.state.song, target.value);
      }
      if (target.dataset.action === "set-instrument-flavor") section.accompanimentStyle.instrumentFlavor = target.value;
      if (target.dataset.action === "set-density") section.accompanimentStyle.density = Number.parseFloat(target.value) || 0.5;
      if (target.dataset.action === "set-energy") section.accompanimentStyle.energy = Number.parseFloat(target.value) || 0.5;
      if (target.dataset.action === "set-section-intensity") section.intensityTag = target.value;
      if (target.dataset.action === "set-track-volume" && target.dataset.layer) {
        section.accompanimentStyle.layerVolumes = {
          ...section.accompanimentStyle.layerVolumes,
          [target.dataset.layer]: Number.parseFloat(target.value) || 0,
        };
      }
      if (target.dataset.action === "toggle-muted-layer" && target.value) {
        const mutedLayers = new Set(section.accompanimentStyle.mutedLayers || []);
        if (mutedLayers.has(target.value)) mutedLayers.delete(target.value);
        else mutedLayers.add(target.value);
        section.accompanimentStyle.mutedLayers = [...mutedLayers];
        target.value = "";
      }
      this.persistSong();
      this.renderEditor();
      this.renderArrangementOverview();
    }
  }

  // ===== MELODY INTERACTIONS =====

  addNotePointerListeners() {
    window.addEventListener("pointermove", this.boundPointerMove || (this.boundPointerMove = (e) => this.handlePointerMove(e)));
    window.addEventListener("pointerup", this.boundPointerUp || (this.boundPointerUp = (e) => this.handlePointerUp(e)));
    window.addEventListener("pointercancel", this.boundPointerCancel || (this.boundPointerCancel = (e) => this.handlePointerUp(e)));
  }

  removeNotePointerListeners() {
    window.removeEventListener("pointermove", this.boundPointerMove);
    window.removeEventListener("pointerup", this.boundPointerUp);
    window.removeEventListener("pointercancel", this.boundPointerCancel);
  }

  clearPendingNotePress() {
    this.state.pendingNotePress = null;
  }

  clearPendingQuickSelect() {
    if (this.pendingQuickSelect?.timerId) {
      window.clearTimeout(this.pendingQuickSelect.timerId);
    }
    this.pendingQuickSelect = null;
  }

  clearPendingGridTouchTap() {
    this.pendingGridTouchTap = null;
  }

  clearEditorScrollTouchState() {
    this.editorScrollTouchState = null;
  }

  clearPostPinchPanState({ unlock = true, resetPreview = false } = {}) {
    this.postPinchPanState = null;
    if (resetPreview) {
      this.applyLiveMelodyPinchScale(1);
    }
    if (unlock) {
      this.setMelodyInteractionLock(false);
    }
  }

  startPostPinchPan(touch, {
    surface = "melody",
    mode = "scroll",
    previousZoom = this.state.melodyZoom || 1,
    nextZoom = this.state.melodyZoom || 1,
    anchor = null,
    viewport = null,
  } = {}) {
    if (!touch) return;
    const scrollElement = surface === "melody"
      ? this.refs?.editorSurface?.querySelector(".grid-scroll")
      : null;
    const startedOnNote = surface === "melody" && this.isClientPointOverMelodyNote(touch.clientX, touch.clientY);
    this.postPinchPanState = {
      surface,
      mode,
      identifier: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
      previousZoom,
      nextZoom,
      anchor,
      viewportStart: viewport,
      viewport,
      liveScale: nextZoom / Math.max(previousZoom, 0.001),
      scrollElement,
      armed: false,
      startedOnNote,
      activationDistance: startedOnNote ? TOUCH_POST_PINCH_PAN_NOTE_START_DISTANCE : TOUCH_POST_PINCH_PAN_START_DISTANCE,
    };
  }

  startPendingGridTouchTap(touch, grid) {
    if (!touch || !grid) return;
    const scrollElement = grid.closest(".grid-scroll");
    const vScrollElement = scrollElement?.closest(".melody-shell") || scrollElement;
    this.pendingGridTouchTap = {
      identifier: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      clientX: touch.clientX,
      clientY: touch.clientY,
      grid,
      scrollElement,
      vScrollElement,
      startScrollLeft: scrollElement?.scrollLeft ?? 0,
      startScrollTop: vScrollElement?.scrollTop ?? 0,
      moved: false,
    };
  }

  startEditorScrollTouch(touch, scrollElement = this.refs?.editorSurface?.querySelector(".grid-scroll")) {
    if (!touch || !scrollElement) return;
    // vScrollElement = melody-shell (scrolls pitch-rail + grid together vertically)
    const vScrollElement = scrollElement.closest(".melody-shell") || scrollElement;
    this.editorScrollTouchState = {
      identifier: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
      scrollElement,
      vScrollElement,
      manualScroll: false,
    };
  }

  getEditorScrollTouchDelta(touch) {
    if (!this.editorScrollTouchState || !touch) return { deltaX: 0, deltaY: 0, totalX: 0, totalY: 0 };
    if (typeof this.editorScrollTouchState.identifier === "number" && touch.identifier !== this.editorScrollTouchState.identifier) {
      return { deltaX: 0, deltaY: 0, totalX: 0, totalY: 0 };
    }
    const deltaX = touch.clientX - this.editorScrollTouchState.lastX;
    const deltaY = touch.clientY - this.editorScrollTouchState.lastY;
    const totalX = touch.clientX - this.editorScrollTouchState.startX;
    const totalY = touch.clientY - this.editorScrollTouchState.startY;
    this.editorScrollTouchState.lastX = touch.clientX;
    this.editorScrollTouchState.lastY = touch.clientY;
    return {
      deltaX,
      deltaY,
      totalX,
      totalY,
    };
  }

  isClientPointOverMelodyNote(clientX, clientY) {
    if (typeof clientX !== "number" || typeof clientY !== "number" || typeof document.elementFromPoint !== "function") {
      return false;
    }
    const target = document.elementFromPoint(clientX, clientY);
    return target instanceof Element && Boolean(target.closest(".note-block"));
  }

  didPendingGridTouchTapScroll(tapState = this.pendingGridTouchTap) {
    const scrollElement = tapState?.scrollElement;
    const vScrollElement = tapState?.vScrollElement || scrollElement;
    if (!tapState || !scrollElement) return false;
    return Math.hypot(
      (scrollElement.scrollLeft || 0) - (tapState.startScrollLeft || 0),
      (vScrollElement?.scrollTop || 0) - (tapState.startScrollTop || 0),
    ) > NOTE_GRID_SCROLL_CANCEL_DISTANCE;
  }

  updatePendingGridTouchTap(touch) {
    if (!this.pendingGridTouchTap || !touch) return;
    if (typeof this.pendingGridTouchTap.identifier === "number" && touch.identifier !== this.pendingGridTouchTap.identifier) return;
    this.pendingGridTouchTap.clientX = touch.clientX;
    this.pendingGridTouchTap.clientY = touch.clientY;
    const distance = Math.hypot(
      touch.clientX - this.pendingGridTouchTap.startX,
      touch.clientY - this.pendingGridTouchTap.startY,
    );
    if (distance > 12 || this.didPendingGridTouchTapScroll(this.pendingGridTouchTap)) {
      this.pendingGridTouchTap.moved = true;
    }
  }

  handleLockedMelodyTouchMove(event) {
    if (!document.body.classList.contains("melody-interaction-locked")) return;
    if (this.touchPinchState?.surface === "melody" && event.touches?.length >= 2) return;
    if (event.cancelable) event.preventDefault();
  }

  setMelodyInteractionLock(isLocked) {
    this.refs.editorSurface.querySelector(".grid-scroll")?.classList.toggle("interaction-locked", isLocked);
    document.documentElement.classList.toggle("melody-interaction-locked", isLocked);
    document.body.classList.toggle("melody-interaction-locked", isLocked);
    const touchBlocker = this.boundLockedMelodyTouchMove
      || (this.boundLockedMelodyTouchMove = (event) => this.handleLockedMelodyTouchMove(event));
    if (isLocked) {
      window.addEventListener("touchmove", touchBlocker, { passive: false });
    } else {
      window.removeEventListener("touchmove", touchBlocker);
    }
  }

  setDrumInteractionLock(isLocked) {
    this.refs.chordPalette.classList.toggle("interaction-locked", isLocked);
  }

  getDrumGridCellSize() {
    const totalSteps = Number.parseInt(
      this.refs?.chordPalette?.querySelector(".drum-step-grid .drum-step:last-child")?.dataset?.drumStep || "0",
      10,
    ) + 1;
    return this.getDrumGridMetrics(Math.max(1, totalSteps || 16)).cellSize;
  }

  getMelodyZoomAnchor(clientX, clientY) {
    const scroll = this.refs?.editorSurface?.querySelector(".grid-scroll");
    if (!scroll) return null;
    const scrollRect = scroll.getBoundingClientRect();
    return {
      viewportX: clamp(clientX - scrollRect.left, 0, scrollRect.width),
      viewportY: clamp(clientY - scrollRect.top, 0, scrollRect.height),
      contentX: scroll.scrollLeft + clamp(clientX - scrollRect.left, 0, scrollRect.width),
      contentY: scroll.scrollTop + clamp(clientY - scrollRect.top, 0, scrollRect.height),
    };
  }

  getMelodyViewportPoint(clientX, clientY) {
    const scroll = this.refs?.editorSurface?.querySelector(".grid-scroll");
    if (!scroll) return null;
    const scrollRect = scroll.getBoundingClientRect();
    return {
      viewportX: clamp(clientX - scrollRect.left, 0, scrollRect.width),
      viewportY: clamp(clientY - scrollRect.top, 0, scrollRect.height),
    };
  }

  clampMelodyPreviewViewport(scale = 1, anchor = null, viewport = null) {
    if (!anchor || !viewport) {
      return {
        viewport,
        translateX: 0,
        translateY: 0,
      };
    }
    const scroll = this.refs?.editorSurface?.querySelector(".grid-scroll");
    const grid = this.refs?.editorSurface?.querySelector(".melody-grid");
    const rawTranslateX = viewport.viewportX - anchor.viewportX;
    const rawTranslateY = viewport.viewportY - anchor.viewportY;
    if (!scroll || !grid) {
      return {
        viewport,
        translateX: rawTranslateX,
        translateY: rawTranslateY,
      };
    }

    const normalizedScale = Math.max(scale, 0.001);
    const originX = Number.isFinite(anchor.contentX) ? anchor.contentX : 0;
    const scaledGridWidth = (grid.offsetWidth || 0) * normalizedScale;
    const gridHeight = grid.offsetHeight || 0;

    const minTranslateX = scroll.clientWidth + scroll.scrollLeft - scaledGridWidth + originX * (normalizedScale - 1);
    const maxTranslateX = scroll.scrollLeft + originX * (normalizedScale - 1);
    const minTranslateY = scroll.clientHeight + scroll.scrollTop - gridHeight;
    const maxTranslateY = scroll.scrollTop;

    const translateX = clamp(rawTranslateX, Math.min(minTranslateX, maxTranslateX), Math.max(minTranslateX, maxTranslateX));
    const translateY = clamp(rawTranslateY, Math.min(minTranslateY, maxTranslateY), Math.max(minTranslateY, maxTranslateY));

    return {
      viewport: {
        viewportX: anchor.viewportX + translateX,
        viewportY: anchor.viewportY + translateY,
      },
      translateX,
      translateY,
    };
  }

  applyLiveMelodyPinchScale(scale = 1, anchor = null, viewport = null) {
    const grid = this.refs?.editorSurface?.querySelector(".melody-grid");
    if (!grid) return;
    const preview = this.clampMelodyPreviewViewport(scale, anchor, viewport);
    const translateX = preview.translateX;
    const translateY = preview.translateY;
    if (Math.abs(scale - 1) < 0.001 && Math.abs(translateX) < 0.5 && Math.abs(translateY) < 0.5) {
      grid.style.transform = "";
      grid.style.transformOrigin = "";
      grid.style.removeProperty("--live-note-label-scale");
      return;
    }
    grid.style.transformOrigin = `${Number.isFinite(anchor?.contentX) ? anchor.contentX : 0}px top`;
    grid.style.setProperty("--live-note-label-scale", `${(1 / Math.max(scale, 0.001)).toFixed(4)}`);
    grid.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scaleX(${scale})`;
  }

  commitMelodyPinchZoom({
    previousZoom = this.state.melodyZoom || 1,
    nextZoom = this.state.melodyZoom || 1,
    anchor = null,
    viewport = null,
  } = {}) {
    this.applyLiveMelodyPinchScale(1);
    this.pendingMelodyZoom = null;
    this.state.melodyZoom = nextZoom;
    this.applyLayoutMetrics();
    this.renderMelodyEditor();
    if (anchor && Number.isFinite(anchor.contentX) && Number.isFinite(anchor.viewportX) && previousZoom > 0) {
      const scroll = this.refs?.editorSurface?.querySelector(".grid-scroll");
      if (scroll) {
        const zoomRatio = nextZoom / previousZoom;
        const targetViewport = viewport || anchor;
        const nextScrollLeft = anchor.contentX * zoomRatio - targetViewport.viewportX;
        const nextScrollTop = anchor.contentY - targetViewport.viewportY;
        scroll.scrollLeft = clamp(nextScrollLeft, 0, Math.max(0, scroll.scrollWidth - scroll.clientWidth));
        scroll.scrollTop = clamp(nextScrollTop, 0, Math.max(0, scroll.scrollHeight - scroll.clientHeight));
      }
    }
    this.updatePlaybackDecorations();
  }

  queueMelodyZoomCommit(delay = 90) {
    if (this.melodyWheelZoomCommitTimer) {
      window.clearTimeout(this.melodyWheelZoomCommitTimer);
    }
    this.melodyWheelZoomCommitTimer = window.setTimeout(() => {
      this.melodyWheelZoomCommitTimer = null;
      const previousZoom = this.state.melodyZoom || 1;
      const nextZoom = typeof this.pendingMelodyZoom === "number" && Number.isFinite(this.pendingMelodyZoom)
        ? this.pendingMelodyZoom
        : previousZoom;
      this.commitMelodyPinchZoom({ previousZoom, nextZoom });
    }, delay);
  }

  getTouchDistance(firstTouch, secondTouch) {
    if (!firstTouch || !secondTouch) return 0;
    return Math.hypot(
      secondTouch.clientX - firstTouch.clientX,
      secondTouch.clientY - firstTouch.clientY,
    );
  }

  getNotePressDragThreshold(pointerType = "mouse") {
    return pointerType === "touch" || pointerType === "pen" ? 12 : NOTE_DRAG_START_DISTANCE;
  }

  getNotePointerMode(noteBlock, event) {
    const noteId = noteBlock?.dataset?.noteId || null;
    const selectedIds = this.getNoteInteractionSelectionIds(noteId);
    if ((event.pointerType === "touch" || event.pointerType === "pen") && this.isNoteResizeDragArmed(selectedIds)) {
      return "resize";
    }
    if (event.target.closest(".resize-handle")) return "resize";
    if (event.pointerType === "touch" || event.pointerType === "pen") return "move";
    const rect = noteBlock.getBoundingClientRect();
    const resizeZoneWidth = 14;
    return event.clientX >= rect.right - resizeZoneWidth ? "resize" : "move";
  }

  getQuickSelectBrushRadius(pointerType = "mouse") {
    return pointerType === "touch" || pointerType === "pen" ? 28 : 18;
  }

  getMelodyGridClientPoint(clientX, clientY, grid = this.refs.editorSurface.querySelector("#melody-grid")) {
    if (!grid) return null;
    const rect = grid.getBoundingClientRect();
    return {
      clientX,
      clientY,
      localX: clamp(clientX - rect.left, 0, rect.width),
      localY: clamp(clientY - rect.top, 0, rect.height),
    };
  }

  getMelodyGridPointerPoint(event, grid = this.refs.editorSurface.querySelector("#melody-grid")) {
    return this.getMelodyGridClientPoint(event.clientX, event.clientY, grid);
  }

  getQuickSelectNoteTargets(grid) {
    if (!grid) return [];
    return [...grid.querySelectorAll(".note-block[data-note-id]")].map((block) => {
      const rect = block.getBoundingClientRect();
      return {
        id: block.dataset.noteId,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    });
  }

  pathTouchesTarget(startPoint, endPoint, target, padding = 0) {
    if (!startPoint || !endPoint || !target) return false;
    const left = target.left - padding;
    const right = target.right + padding;
    const top = target.top - padding;
    const bottom = target.bottom + padding;
    const minX = Math.min(startPoint.clientX, endPoint.clientX);
    const maxX = Math.max(startPoint.clientX, endPoint.clientX);
    const minY = Math.min(startPoint.clientY, endPoint.clientY);
    const maxY = Math.max(startPoint.clientY, endPoint.clientY);
    if (maxX < left || minX > right || maxY < top || minY > bottom) {
      return false;
    }
    const distance = Math.hypot(endPoint.clientX - startPoint.clientX, endPoint.clientY - startPoint.clientY);
    const steps = Math.max(1, Math.ceil(distance / Math.max(6, padding * 0.65)));
    for (let index = 0; index <= steps; index += 1) {
      const ratio = index / steps;
      const sampleX = startPoint.clientX + (endPoint.clientX - startPoint.clientX) * ratio;
      const sampleY = startPoint.clientY + (endPoint.clientY - startPoint.clientY) * ratio;
      if (sampleX >= left && sampleX <= right && sampleY >= top && sampleY <= bottom) {
        return true;
      }
    }
    return false;
  }

  pointTouchesTarget(point, target, padding = 0) {
    if (!point || !target) return false;
    return (
      point.clientX >= target.left - padding &&
      point.clientX <= target.right + padding &&
      point.clientY >= target.top - padding &&
      point.clientY <= target.bottom + padding
    );
  }

  rectTouchesTarget(startPoint, endPoint, target, padding = 0) {
    if (!startPoint || !endPoint || !target) return false;
    const left = Math.min(startPoint.clientX, endPoint.clientX) - padding;
    const right = Math.max(startPoint.clientX, endPoint.clientX) + padding;
    const top = Math.min(startPoint.clientY, endPoint.clientY) - padding;
    const bottom = Math.max(startPoint.clientY, endPoint.clientY) + padding;
    return (
      right >= target.left &&
      left <= target.right &&
      bottom >= target.top &&
      top <= target.bottom
    );
  }

  activateQuickSelectGesture(gesture) {
    if (!gesture || gesture.longPressTriggered) return;
    gesture.longPressTriggered = true;
    this.clearEditorScrollTouchState();
    this.clearPendingGridTouchTap();
    this.setMelodyInteractionLock(true);
    gesture.noteTargets = this.getQuickSelectNoteTargets(gesture.element);
    gesture.forceRefresh = true;
    gesture.lastAppliedPoint = gesture.currentPoint || gesture.startPoint;
    this.quickSelectState = gesture;
    this.applyQuickSelectGesture(gesture);
  }

  updateQuickSelectOverlay(gesture = this.quickSelectState) {
    const layer = this.refs.editorSurface.querySelector(".quick-select-layer");
    if (!layer || !gesture?.longPressTriggered || !gesture.currentPoint) {
      if (layer) {
        layer.innerHTML = "";
        layer.classList.add("hidden");
      }
      return;
    }
    if (gesture.selectionMode === "rectangle") {
      const left = Math.min(gesture.startPoint.localX, gesture.currentPoint.localX);
      const top = Math.min(gesture.startPoint.localY, gesture.currentPoint.localY);
      const width = Math.max(2, Math.abs(gesture.currentPoint.localX - gesture.startPoint.localX));
      const height = Math.max(2, Math.abs(gesture.currentPoint.localY - gesture.startPoint.localY));
      layer.innerHTML = `
        <div
          class="quick-select-rect"
          style="left:${left}px;top:${top}px;width:${width}px;height:${height}px"
        ></div>
      `;
      layer.classList.remove("hidden");
      return;
    }
    const diameter = gesture.radius * 2;
    layer.innerHTML = `
      <div
        class="quick-select-cursor"
        style="left:${gesture.currentPoint.localX}px;top:${gesture.currentPoint.localY}px;width:${diameter}px;height:${diameter}px"
      ></div>
    `;
    layer.classList.remove("hidden");
  }

  applyQuickSelectGesture(gesture = this.quickSelectState) {
    if (!gesture?.longPressTriggered) return;
    const startPoint = gesture.lastAppliedPoint || gesture.startPoint;
    const endPoint = gesture.currentPoint || gesture.startPoint;
    if (gesture.selectionMode === "rectangle") {
      const rectPadding = gesture.pointerType === "touch" || gesture.pointerType === "pen" ? 2 : 0;
      const nextIds = gesture.noteTargets
        .filter((target) => this.rectTouchesTarget(gesture.startPoint, endPoint, target, rectPadding))
        .map((target) => target.id);
      const nextIdSet = new Set(nextIds);
      const currentIds = this.getSelectedNoteIds();
      const selectionChanged = currentIds.length !== nextIds.length
        || currentIds.some((noteId) => !nextIdSet.has(noteId));
      if (selectionChanged || gesture.forceRefresh) {
        this.setSelectedNotes(nextIds, {
          primaryId: nextIds.at(-1) || null,
          multiSelect: nextIds.length > 1,
        });
        this.refreshNoteSelection();
      }
      gesture.selectedIds = nextIdSet;
      gesture.lastTouchedNoteId = nextIds.at(-1) || null;
      gesture.forceRefresh = false;
      gesture.lastAppliedPoint = endPoint;
      gesture.engagedIds = new Set(nextIds);
      gesture.selectionChanged = gesture.selectionChanged || selectionChanged;
      this.quickSelectState = gesture;
      this.updateQuickSelectOverlay(gesture);
      return;
    }
    let affectedId = null;
    let selectionChanged = false;
    const activeEngagedIds = new Set();
    const isTouchGesture = gesture.pointerType === "touch" || gesture.pointerType === "pen";
    const enterPadding = Math.max(isTouchGesture ? 14 : 8, gesture.radius * (isTouchGesture ? 0.92 : 0.72));
    const exitPadding = Math.max(isTouchGesture ? 24 : 12, gesture.radius * (isTouchGesture ? 1.45 : 1.28));

    gesture.noteTargets.forEach((target) => {
      const engaged = gesture.engagedIds?.has(target.id);
      const insideEnterZone = this.pointTouchesTarget(endPoint, target, enterPadding);
      const insideReleaseZone = this.pointTouchesTarget(endPoint, target, exitPadding);
      const touchesTarget = isTouchGesture
        ? insideEnterZone
        : this.pathTouchesTarget(startPoint, endPoint, target, enterPadding);
      if (engaged) {
        if (insideReleaseZone) {
          activeEngagedIds.add(target.id);
        }
        return;
      }
      if (!touchesTarget) return;
      if (gesture.selectedIds.has(target.id)) {
        gesture.selectedIds.delete(target.id);
        selectionChanged = true;
        affectedId = target.id;
      } else {
        gesture.selectedIds.add(target.id);
        selectionChanged = true;
        affectedId = target.id;
      }
      activeEngagedIds.add(target.id);
    });

    const nextIds = [...gesture.selectedIds];
    if (selectionChanged || gesture.forceRefresh || activeEngagedIds.size !== (gesture.engagedIds?.size || 0)) {
      this.setSelectedNotes(nextIds, {
        primaryId: (nextIds.includes(affectedId) ? affectedId : null) || gesture.lastTouchedNoteId || nextIds.at(-1) || null,
        multiSelect: nextIds.length > 1,
      });
      this.refreshNoteSelection();
    }
    if (affectedId) {
      gesture.lastTouchedNoteId = affectedId;
    }
    gesture.forceRefresh = false;
    gesture.lastAppliedPoint = endPoint;
    gesture.engagedIds = activeEngagedIds;
    gesture.selectionChanged = gesture.selectionChanged || selectionChanged;
    this.quickSelectState = gesture;
    this.updateQuickSelectOverlay(gesture);
  }

  createQuickSelectGesture({ clientX, clientY, pointerType, pointerId = null, grid }) {
    const startPoint = this.getMelodyGridClientPoint(clientX, clientY, grid);
    if (!startPoint) return null;
    return {
      pointerId,
      element: grid,
      pointerType,
      startX: clientX,
      startY: clientY,
      startPoint,
      currentPoint: startPoint,
      lastAppliedPoint: startPoint,
      radius: this.getQuickSelectBrushRadius(pointerType || "mouse"),
      noteTargets: [],
      selectedIds: new Set(this.getSelectedNoteIds()),
      selectionMode: this.state.noteSelectionMode || "magnetic",
      lastTouchedNoteId: this.state.selectedNoteId || null,
      engagedIds: new Set(),
      selectionChanged: false,
      forceRefresh: false,
      longPressTriggered: false,
      timerId: null,
    };
  }

  startPendingQuickSelect(event, grid) {
    this.clearPendingQuickSelect();
    if (event.cancelable) event.preventDefault();
    this.setMelodyInteractionLock(true);
    const gesture = this.createQuickSelectGesture({
      clientX: event.clientX,
      clientY: event.clientY,
      pointerType: event.pointerType || "mouse",
      pointerId: event.pointerId,
      grid,
    });
    if (!gesture) return;
    try { grid.setPointerCapture(event.pointerId); } catch (error) {}
    if (gesture.pointerType === "touch") {
      gesture.timerId = window.setTimeout(() => {
        if (this.pendingQuickSelect?.pointerId !== gesture.pointerId) return;
        this.activateQuickSelectGesture(gesture);
      }, NOTE_MULTI_SELECT_HOLD_MS);
    } else {
      this.activateQuickSelectGesture(gesture);
    }
    this.pendingQuickSelect = gesture;
    this.addNotePointerListeners();
  }

  startTouchQuickSelect(touch, grid) {
    this.clearPendingQuickSelect();
    const gesture = this.createQuickSelectGesture({
      clientX: touch.clientX,
      clientY: touch.clientY,
      pointerType: "touch",
      pointerId: null,
      grid,
    });
    if (!gesture) return;
    gesture.timerId = window.setTimeout(() => {
      if (this.pendingQuickSelect !== gesture) return;
      this.activateQuickSelectGesture(gesture);
    }, NOTE_MULTI_SELECT_HOLD_MS);
    this.pendingQuickSelect = gesture;
    this.quickSelectState = null;
  }

  cancelPendingNotePointer() {
    const pendingPress = this.state.pendingNotePress;
    if (!pendingPress) return;
    try { pendingPress.element?.releasePointerCapture?.(pendingPress.pointerId); } catch (error) {}
    this.clearPendingNotePress();
  }

  finishActiveNoteDragForGesture() {
    if (this.dragState?.type !== "note") return;
    try { this.dragState.element?.releasePointerCapture?.(this.dragState.pointerId); } catch (error) {}
    this.dragState.element?.classList.remove("is-resizing");
    this.setActiveRollNotes(sortNotes(this.getActiveRollNotes()));
    this.persistSong();
    this.dragState = null;
  }

  cancelDrumPaintGesture() {
    const paintState = this.state.drumStepPaint;
    if (!paintState) return;
    try { paintState.element?.releasePointerCapture?.(paintState.pointerId); } catch (error) {}
    this.state.drumStepPaint = null;
    this.setDrumInteractionLock(false);
    window.removeEventListener("pointermove", this.boundDrumPaintMove);
    window.removeEventListener("pointerup", this.boundDrumPaintUp);
    window.removeEventListener("pointercancel", this.boundDrumPaintCancel);
    if (paintState.touched?.size) {
      this.persistSong();
    }
  }

  isMelodyGestureTarget(target) {
    return target instanceof Element && Boolean(target.closest(".melody-shell"));
  }

  isDrumGestureTarget(target) {
    return target instanceof Element && Boolean(target.closest(".drum-sequencer"));
  }

  handleEditorTouchGestureStart(event) {
    if (this.state.activeTab !== "melody") return;
    if (!this.isMelodyGestureTarget(event.target)) return;
    if (event.target.closest(".note-quick-popup")) return;
    if (event.touches.length === 1) {
      this.startEditorScrollTouch(event.touches[0], this.refs?.editorSurface?.querySelector(".grid-scroll"));
      const grid = event.target.closest("#melody-grid");
      const noteBlock = event.target.closest(".note-block");
      if (!noteBlock && grid) {
        this.startTouchQuickSelect(event.touches[0], grid);
        this.startPendingGridTouchTap(event.touches[0], grid);
      }
      return;
    }
    if (event.touches.length < 2) return;
    this.clearEditorScrollTouchState();
    if (this.postPinchPanState?.surface === "melody") {
      this.commitMelodyPinchZoom({
        previousZoom: this.postPinchPanState.previousZoom,
        nextZoom: this.postPinchPanState.nextZoom,
        anchor: this.postPinchPanState.anchor,
        viewport: this.postPinchPanState.viewport,
      });
    }
    this.clearPostPinchPanState({ unlock: false, resetPreview: true });
    const [firstTouch, secondTouch] = event.touches;
    const initialDistance = this.getTouchDistance(firstTouch, secondTouch);
    if (!initialDistance) return;
    const pinchCenterX = (firstTouch.clientX + secondTouch.clientX) / 2;
    const pinchCenterY = (firstTouch.clientY + secondTouch.clientY) / 2;

    if (this.pendingQuickSelect?.pointerType === "touch") {
      this.clearPendingQuickSelect();
      this.quickSelectState = null;
      this.updateQuickSelectOverlay(null);
    }
    this.clearPendingGridTouchTap();
    this.cancelPendingNotePointer();
    this.finishActiveNoteDragForGesture();
    this.removeNotePointerListeners();
    this.setMelodyInteractionLock(true);
    this.touchPinchState = {
      surface: "melody",
      initialDistance,
      initialValue: this.state.melodyZoom || 1,
      anchor: this.getMelodyZoomAnchor(pinchCenterX, pinchCenterY),
      currentCenterX: pinchCenterX,
      currentCenterY: pinchCenterY,
    };
    if (event.cancelable) event.preventDefault();
  }

  handlePaletteTouchGestureStart(event) {
    if (this.state.paletteMode !== "drums" || event.touches.length < 2) return;
    if (!this.isDrumGestureTarget(event.target)) return;
    this.cancelDrumPaintGesture();
    this.setDrumInteractionLock(true);
    if (event.cancelable) event.preventDefault();
  }

  handleTouchGestureMove(event) {
    if (this.postPinchPanState?.surface === "melody" && event.touches.length === 1) {
      this.clearPostPinchPanState({ resetPreview: true });
    }
    if (this.pendingQuickSelect?.pointerType === "touch" && event.touches.length === 1) {
      const touch = event.touches[0];
      const point = this.getMelodyGridClientPoint(
        touch.clientX,
        touch.clientY,
        this.pendingQuickSelect.element,
      );
      if (point) {
        this.pendingQuickSelect.currentPoint = point;
        if (this.pendingQuickSelect.longPressTriggered) {
          this.clearEditorScrollTouchState();
          this.clearPendingGridTouchTap();
          this.quickSelectState = this.pendingQuickSelect;
          this.applyQuickSelectGesture(this.pendingQuickSelect);
          if (event.cancelable) event.preventDefault();
          return;
        }
        const touchTravel = Math.hypot(
          touch.clientX - this.pendingQuickSelect.startX,
          touch.clientY - this.pendingQuickSelect.startY,
        );
        if (touchTravel > TOUCH_QUICK_SELECT_CANCEL_DISTANCE) {
          this.clearPendingQuickSelect();
          this.quickSelectState = null;
          this.updateQuickSelectOverlay(null);
        }
        return;
      }
    }
    if (
      this.editorScrollTouchState
      && !this.touchPinchState
      && !this.postPinchPanState
      && event.touches.length === 1
      && !this.dragState
      && !this.pendingQuickSelect?.longPressTriggered
    ) {
      const touch = [...event.touches].find((entry) => entry.identifier === this.editorScrollTouchState.identifier) || event.touches[0];
      const scroll = this.editorScrollTouchState.scrollElement;
      const touchDelta = this.getEditorScrollTouchDelta(touch);
      const pendingPress = this.state.pendingNotePress;
      const isTouchNotePress = pendingPress
        && (pendingPress.pointerType === "touch" || pendingPress.pointerType === "pen")
        && pendingPress.mode !== "resize";
      const canTakeOverTouchNotePress = Boolean(
        isTouchNotePress
        && Math.hypot(touchDelta.totalX, touchDelta.totalY) > TOUCH_NOTE_SCROLL_TAKEOVER_DISTANCE
        && (Date.now() - (pendingPress.startedAt || 0)) < TOUCH_NOTE_DRAG_HOLD_MS
      );
      if (canTakeOverTouchNotePress) {
        try { pendingPress.element?.releasePointerCapture?.(pendingPress.pointerId); } catch (error) {}
        this.clearPendingNotePress();
        this.removeNotePointerListeners();
        this.setMelodyInteractionLock(false);
      }
      if (this.state.pendingNotePress) {
        return;
      }
      const scrollIntent = Math.hypot(touchDelta.totalX, touchDelta.totalY) > TOUCH_EDITOR_SCROLL_START_DISTANCE;
      if (scrollIntent) {
        this.editorScrollTouchState.manualScroll = true;
      }
      if (this.editorScrollTouchState.manualScroll && scroll) {
        const vScroll = this.editorScrollTouchState.vScrollElement || scroll;
        scroll.scrollLeft = clamp(
          scroll.scrollLeft - touchDelta.deltaX,
          0,
          Math.max(0, scroll.scrollWidth - scroll.clientWidth),
        );
        vScroll.scrollTop = clamp(
          vScroll.scrollTop - touchDelta.deltaY,
          0,
          Math.max(0, vScroll.scrollHeight - vScroll.clientHeight),
        );
        if (this.pendingGridTouchTap) {
          this.pendingGridTouchTap.moved = true;
        }
        if (this.pendingQuickSelect?.pointerType === "touch" && !this.pendingQuickSelect.longPressTriggered) {
          this.clearPendingQuickSelect();
          this.quickSelectState = null;
          this.updateQuickSelectOverlay(null);
        }
        if (event.cancelable) event.preventDefault();
        return;
      }
      if (scrollIntent && event.cancelable) {
        event.preventDefault();
      }
    }
    if (this.pendingGridTouchTap && event.touches.length === 1) {
      const matchingTouch = [...event.touches].find((touch) => touch.identifier === this.pendingGridTouchTap.identifier) || event.touches[0];
      this.updatePendingGridTouchTap(matchingTouch);
      if (this.pendingGridTouchTap?.moved && this.pendingQuickSelect?.pointerType === "touch" && !this.pendingQuickSelect.longPressTriggered) {
        this.clearPendingQuickSelect();
        this.quickSelectState = null;
        this.updateQuickSelectOverlay(null);
      }
    }

    if (!this.touchPinchState || event.touches.length < 2) return;
    const [firstTouch, secondTouch] = event.touches;
    const nextDistance = this.getTouchDistance(firstTouch, secondTouch);
    if (!nextDistance) return;
    if (event.cancelable) event.preventDefault();
    const pinchCenterX = (firstTouch.clientX + secondTouch.clientX) / 2;
    const pinchCenterY = (firstTouch.clientY + secondTouch.clientY) / 2;

    const zoomRatio = nextDistance / this.touchPinchState.initialDistance;
    if (!Number.isFinite(zoomRatio) || zoomRatio <= 0) return;

    if (this.touchPinchState.surface === "melody") {
      const nextZoom = clamp(
        this.touchPinchState.initialValue * zoomRatio,
        MIN_MELODY_ZOOM,
        MAX_MELODY_ZOOM,
      );
      const pinchScale = nextZoom / Math.max(this.touchPinchState.initialValue, 0.001);
      const viewport = this.getMelodyViewportPoint(pinchCenterX, pinchCenterY);
      this.touchPinchState.nextValue = nextZoom;
      this.touchPinchState.currentCenterX = pinchCenterX;
      this.touchPinchState.currentCenterY = pinchCenterY;
      this.touchPinchState.viewport = viewport;
      this.applyLiveMelodyPinchScale(pinchScale, this.touchPinchState.anchor, viewport);
      return;
    }
  }

  handleTouchGestureEnd(event) {
    const didManualEditorScroll = Boolean(this.editorScrollTouchState?.manualScroll);
    if ((this.pendingQuickSelect?.pointerType === "touch" || this.pendingGridTouchTap) && event.touches.length === 0) {
      const gesture = this.pendingQuickSelect;
      const tapState = this.pendingGridTouchTap;
      const tapDidScroll = this.didPendingGridTouchTapScroll(tapState);
      const didQuickSelect = Boolean(gesture?.longPressTriggered);
      const tapPoint = tapState
        ? {
          clientX: tapState.clientX ?? tapState.startX,
          clientY: tapState.clientY ?? tapState.startY,
        }
        : null;
      const gesturePoint = gesture?.currentPoint || gesture?.startPoint || null;
      this.clearPendingQuickSelect();
      this.clearPendingGridTouchTap();
      this.quickSelectState = null;
      this.updateQuickSelectOverlay(null);
      this.setMelodyInteractionLock(false);
      this.state.suppressNextEditorClick = true;
      if (!didQuickSelect && tapState?.grid && tapPoint && !tapState.moved && !tapDidScroll) {
        this.addNoteFromGrid({
          clientX: tapPoint.clientX,
          clientY: tapPoint.clientY,
        }, tapState.grid);
      } else if (!didQuickSelect && !tapState && gesture?.element && gesturePoint) {
        this.addNoteFromGrid({
          clientX: gesturePoint.clientX,
          clientY: gesturePoint.clientY,
        }, gesture.element);
      }
      return;
    }
    if (event.touches.length === 0) {
      this.clearEditorScrollTouchState();
      if (didManualEditorScroll) {
        this.state.suppressNextEditorClick = true;
      }
    } else if (this.editorScrollTouchState) {
      const touch = [...event.touches].find((entry) => entry.identifier === this.editorScrollTouchState.identifier);
      if (!touch) {
        this.clearEditorScrollTouchState();
        if (didManualEditorScroll) {
          this.state.suppressNextEditorClick = true;
        }
      } else {
        this.editorScrollTouchState.lastX = touch.clientX;
        this.editorScrollTouchState.lastY = touch.clientY;
      }
    }

    if (this.postPinchPanState?.surface === "melody" && !this.touchPinchState) {
      this.clearPostPinchPanState({ resetPreview: true });
      return;
    }

    if (!this.touchPinchState) return;
    if (event.touches.length >= 2) return;
    const surface = this.touchPinchState.surface;
    const nextValue = this.touchPinchState.nextValue;
    const pinchAnchor = this.touchPinchState.anchor;
    const pinchViewport = this.touchPinchState.viewport
      || this.getMelodyViewportPoint(
        this.touchPinchState.currentCenterX ?? 0,
        this.touchPinchState.currentCenterY ?? 0,
      );
    const previousZoom = this.touchPinchState.initialValue || this.state.melodyZoom || 1;
    this.touchPinchState = null;
    if (surface === "melody") {
      if (this.melodyWheelZoomCommitTimer) {
        window.clearTimeout(this.melodyWheelZoomCommitTimer);
        this.melodyWheelZoomCommitTimer = null;
      }
      const resolvedNextZoom = typeof nextValue === "number" && Number.isFinite(nextValue) ? nextValue : previousZoom;
      if (event.touches.length === 1) {
        this.commitMelodyPinchZoom({
          previousZoom,
          nextZoom: resolvedNextZoom,
          anchor: pinchAnchor,
          viewport: pinchViewport,
        });
        this.setMelodyInteractionLock(false);
        this.state.suppressNextEditorClick = true;
        return;
      }
      this.commitMelodyPinchZoom({
        previousZoom,
        nextZoom: resolvedNextZoom,
        anchor: pinchAnchor,
        viewport: pinchViewport,
      });
      this.setMelodyInteractionLock(false);
      return;
    }
    if (surface === "drums") {
      this.setDrumInteractionLock(false);
    }
  }

  handleEditorContextMenu(event) {
    if (this.state.activeTab !== "melody") return;
    if (!this.isMelodyGestureTarget(event.target)) return;
    event.preventDefault();
  }

  handleEditorBrowserGesture(event) {
    if (this.state.activeTab !== "melody") return;
    if (!this.isMelodyGestureTarget(event.target)) return;
    if (event.cancelable) event.preventDefault();
  }

  handlePaletteContextMenu(event) {
    if (this.state.paletteMode !== "drums") return;
    if (!this.isDrumGestureTarget(event.target)) return;
    event.preventDefault();
  }

  handlePaletteBrowserGesture(event) {
    if (this.state.paletteMode !== "drums") return;
    if (!this.isDrumGestureTarget(event.target)) return;
    if (event.cancelable) event.preventDefault();
  }

  handleEditorSelectionStart(event) {
    if (this.state.activeTab !== "melody") return;
    if (!this.isMelodyGestureTarget(event.target)) return;
    event.preventDefault();
  }

  handlePaletteSelectionStart(event) {
    if (this.state.paletteMode !== "drums") return;
    if (!this.isDrumGestureTarget(event.target)) return;
    event.preventDefault();
  }

  handleEditorWheelZoom(event) {
    if (this.state.activeTab !== "melody" || !event.ctrlKey) return;
    if (!this.isMelodyGestureTarget(event.target)) return;
    if (event.cancelable) event.preventDefault();
    const deltaUnit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 64 : 1;
    const normalizedDelta = clamp(event.deltaY * deltaUnit, -120, 120);
    const zoomMultiplier = Math.exp(-normalizedDelta * 0.012);
    const currentZoom = typeof this.pendingMelodyZoom === "number" ? this.pendingMelodyZoom : (this.state.melodyZoom || 1);
    const nextZoom = clamp(
      currentZoom * zoomMultiplier,
      MIN_MELODY_ZOOM,
      MAX_MELODY_ZOOM,
    );
    if (nextZoom === currentZoom) return;
    this.pendingMelodyZoom = nextZoom;
    this.applyLiveMelodyPinchScale(nextZoom / Math.max(this.state.melodyZoom || 1, 0.001));
    this.queueMelodyZoomCommit(45);
  }

  handlePaletteWheelZoom(event) {
    if (this.state.paletteMode !== "drums" || !event.ctrlKey) return;
    if (!this.isDrumGestureTarget(event.target)) return;
    if (event.cancelable) event.preventDefault();
  }

  startNoteDrag(noteBlock, note, event, mode = "move") {
    const selectedIds = this.getNoteInteractionSelectionIds(note.id);
    const copyOnDrop = mode === "move" && this.isNoteCopyDragArmed(selectedIds);
    const consumeResizeArm = mode === "resize" && this.isNoteResizeDragArmed(selectedIds);
    const visiblePitches = this.getVisiblePitchRange();
    const originalNotes = Object.fromEntries(
      selectedIds.map((noteId) => {
        const sourceNote = this.getActiveRollNotes().find((entry) => entry.id === noteId);
        return [noteId, {
          startBeat: sourceNote.startBeat,
          pitch: sourceNote.pitch,
          duration: sourceNote.duration,
          pitchIndex: this.getPitchRowIndex(sourceNote.pitch, visiblePitches),
        }];
      }),
    );

    this.setSelectedNotes(selectedIds, {
      primaryId: note.id,
      multiSelect: selectedIds.length > 1,
    });
    this.refreshNoteSelection();
    this.setMelodyInteractionLock(true);
    this.dragState = {
      type: "note",
      pointerId: event.pointerId,
      mode,
      noteId: note.id,
      noteIds: selectedIds,
      element: noteBlock,
      startX: event.clientX,
      startY: event.clientY,
      originalStartBeat: note.startBeat,
      originalPitch: note.pitch,
      originalDuration: note.duration,
      originalNotes,
      copyOnDrop,
      consumeResizeArm,
      moved: false,
    };

    try { noteBlock.setPointerCapture(event.pointerId); } catch (error) {}
    this.addNotePointerListeners();
  }

  handleEditorPointerDown(event) {
    if (this.state.activeTab !== "melody") return;
    const grid = event.target.closest("#melody-grid");
    const noteBlock = event.target.closest(".note-block");
    if (event.pointerType === "touch" && !noteBlock && grid) {
      return;
    }
    if (!noteBlock && grid) {
      // Don't intercept clicks on the note quick-popup (transpose/length buttons)
      if (event.target.closest(".note-quick-popup")) return;
      this.startPendingQuickSelect(event, grid);
      return;
    }
    if (!noteBlock) return;
    const noteId = noteBlock.dataset.noteId;
    const note = this.getActiveRollNotes().find((entry) => entry.id === noteId);
    if (!note) return;

    event.preventDefault();
    const selectedIds = this.getNoteInteractionSelectionIds(noteId);
    const touchedResizeHandle = Boolean(event.target.closest(".resize-handle"));
    const isTouchResizeArmGesture = touchedResizeHandle
      && (event.pointerType === "touch" || event.pointerType === "pen")
      && !this.isNoteResizeDragArmed(selectedIds);
    if (isTouchResizeArmGesture) {
      this.armSelectedNotesForResizeDrag(selectedIds, {
        primaryId: note.id,
        multiSelect: selectedIds.length > 1,
      });
      this.state.suppressNextEditorClick = true;
      return;
    }
    const mode = this.getNotePointerMode(noteBlock, event);
    const modifierMultiSelect = mode === "move" && (event.shiftKey || event.metaKey || event.ctrlKey);

    if (modifierMultiSelect) {
      this.toggleNoteSelection(noteId);
      this.state.suppressNextEditorClick = true;
      this.renderMelodyEditor();
      return;
    }

    if (mode === "move" && this.state.noteMultiSelectActive && !this.isNoteSelected(noteId)) {
      this.toggleNoteSelection(noteId);
      this.state.suppressNextEditorClick = true;
      this.renderMelodyEditor();
      return;
    }

    this.clearPendingNotePress();
    if (mode === "resize") {
      this.setMelodyInteractionLock(true);
      try { noteBlock.setPointerCapture(event.pointerId); } catch (error) {}
      this.startNoteDrag(noteBlock, note, event, mode);
      return;
    }

    const pendingPress = {
      pointerId: event.pointerId,
      pointerType: event.pointerType || "mouse",
      noteId,
      element: noteBlock,
      startX: event.clientX,
      startY: event.clientY,
      mode,
      startedAt: Date.now(),
    };
    this.state.pendingNotePress = pendingPress;
    this.addNotePointerListeners();
  }

  handlePointerMove(event) {
    if (this.pendingQuickSelect && typeof this.pendingQuickSelect.pointerId === "number" && event.pointerId === this.pendingQuickSelect.pointerId && !this.dragState) {
      const gesture = this.pendingQuickSelect;
      const point = this.getMelodyGridPointerPoint(event, gesture.element);
      if (!point) return;
      if (event.cancelable) event.preventDefault();
      if (!gesture.longPressTriggered && gesture.pointerType === "touch") {
        gesture.currentPoint = point;
        this.quickSelectState = gesture;
        return;
      }
      if (gesture.pointerType === "touch") {
        gesture.currentPoint = point;
        this.quickSelectState = gesture;
        return;
      }
      gesture.currentPoint = point;
      this.quickSelectState = gesture;
      this.applyQuickSelectGesture(gesture);
      return;
    }

    if (this.state.pendingNotePress && typeof this.state.pendingNotePress.pointerId === "number" && event.pointerId === this.state.pendingNotePress.pointerId && !this.dragState) {
      const pendingPress = this.state.pendingNotePress;
      if (event.cancelable) event.preventDefault();
      const distance = Math.hypot(event.clientX - pendingPress.startX, event.clientY - pendingPress.startY);
      const isTouchPress = pendingPress.pointerType === "touch" || pendingPress.pointerType === "pen";
      const allowImmediateTouchResize = pendingPress.mode === "resize";
      const heldLongEnoughForTouchDrag = Date.now() - (pendingPress.startedAt || 0) >= TOUCH_NOTE_DRAG_HOLD_MS;
      if (isTouchPress && !heldLongEnoughForTouchDrag && !allowImmediateTouchResize) return;
      if (distance < this.getNotePressDragThreshold(event.pointerType || "mouse")) return;
      const note = this.getActiveRollNotes().find((entry) => entry.id === pendingPress.noteId);
      if (!note) {
        this.clearPendingNotePress();
        this.removeNotePointerListeners();
        return;
      }
      this.clearPendingNotePress();
      this.startNoteDrag(pendingPress.element, note, event, pendingPress.mode);
      return;
    }

    if (!this.dragState || this.dragState.type !== "note") return;
    if (typeof this.dragState.pointerId === "number" && event.pointerId !== this.dragState.pointerId) return;
    if (event.cancelable) event.preventDefault();

    const { beatWidth, rowHeight } = this.layoutMetrics;
    const sectionBeats = sectionLengthInBeats(this.state.song, this.getActiveSection());
    const visiblePitches = this.getVisiblePitchRange();
    const rawBeatDelta = (event.clientX - this.dragState.startX) / beatWidth;
    const beatDelta = this.dragState.mode === "resize"
      ? Math.round(rawBeatDelta / this.getNoteResizeStepBeats()) * this.getNoteResizeStepBeats()
      : this.quantizeBeat(rawBeatDelta);
    const rowDelta = Math.round((event.clientY - this.dragState.startY) / rowHeight);
    this.dragState.moved = this.dragState.moved || Math.abs(beatDelta) > 0 || Math.abs(rowDelta) > 0;

    if (this.dragState.mode === "resize") {
      const originalNotes = Object.values(this.dragState.originalNotes || {});
      if (!originalNotes.length) return;
      const minDuration = this.getMinimumMelodyStepDuration();
      const clampedBeatDelta = clamp(
        beatDelta,
        -Math.min(...originalNotes.map((entry) => Math.max(0, entry.duration - minDuration))),
        Math.min(...originalNotes.map((entry) => Math.max(0, sectionBeats - entry.startBeat - entry.duration))),
      );
      this.dragState.noteIds.forEach((noteId) => {
        const note = this.getActiveRollNotes().find((entry) => entry.id === noteId);
        const original = this.dragState.originalNotes?.[noteId];
        if (!note || !original) return;
        note.duration = clamp(
          original.duration + clampedBeatDelta,
          minDuration,
          Math.max(minDuration, sectionBeats - original.startBeat),
        );
        note.startBeat = original.startBeat;
        this.updateDraggedNoteElement(note);
      });
    } else {
      const originalNotes = Object.values(this.dragState.originalNotes || {});
      const clampedBeatDelta = clamp(
        beatDelta,
        -Math.min(...originalNotes.map((entry) => entry.startBeat)),
        Math.min(...originalNotes.map((entry) => sectionBeats - entry.duration - entry.startBeat)),
      );
      const clampedRowDelta = clamp(
        rowDelta,
        Math.max(...originalNotes.map((entry) => -entry.pitchIndex)),
        Math.min(...originalNotes.map((entry) => visiblePitches.length - 1 - entry.pitchIndex)),
      );

      this.dragState.noteIds.forEach((noteId) => {
        const note = this.getActiveRollNotes().find((entry) => entry.id === noteId);
        const original = this.dragState.originalNotes?.[noteId];
        if (!note || !original) return;
        note.startBeat = clamp(
          this.quantizeBeat(original.startBeat + clampedBeatDelta),
          0,
          Math.max(0, sectionBeats - note.duration),
        );
        note.pitch = visiblePitches[clamp(original.pitchIndex + clampedRowDelta, 0, visiblePitches.length - 1)] ?? original.pitch;
        this.updateDraggedNoteElement(note);
      });
    }
  }

  handlePointerUp(event) {
    if (this.pendingQuickSelect && (typeof event.pointerId !== "number" || event.pointerId === this.pendingQuickSelect.pointerId)) {
      const gesture = this.pendingQuickSelect;
      const didQuickSelect = gesture.longPressTriggered && (gesture.selectionChanged || gesture.pointerType === "touch");
      try { gesture.element?.releasePointerCapture?.(gesture.pointerId); } catch (error) {}
      this.clearPendingQuickSelect();
      this.quickSelectState = null;
      this.updateQuickSelectOverlay(null);
      this.setMelodyInteractionLock(false);
      if (didQuickSelect) {
        this.state.suppressNextEditorClick = true;
      }
      if (!this.state.pendingNotePress && !this.dragState) {
        this.removeNotePointerListeners();
      }
    }

    if (this.state.pendingNotePress && (typeof event.pointerId !== "number" || event.pointerId === this.state.pendingNotePress.pointerId)) {
      const pendingPress = this.state.pendingNotePress;
      const heldLongEnough = Date.now() - (pendingPress.startedAt || 0) >= NOTE_MULTI_SELECT_HOLD_MS;
      try { pendingPress.element?.releasePointerCapture?.(pendingPress.pointerId); } catch (error) {}
      this.clearPendingNotePress();
      if (heldLongEnough) {
        this.state.suppressNextEditorClick = true;
      }
      if (!this.dragState && !heldLongEnough) {
        this.state.suppressNextEditorClick = true;
        if (pendingPress.mode !== "resize") {
          // Clean tap on a note block — handle selection and popup here.
          // Suppress the subsequent click event to prevent double-handling on touch.
          this.handleNoteSelectionTap(pendingPress.noteId);
          this.renderMelodyEditor();
        }
      }
      if (!this.dragState) {
        this.removeNotePointerListeners();
      }
    }

    if (this.dragState?.type === "note") {
      try { this.dragState.element?.releasePointerCapture?.(this.dragState.pointerId); } catch (error) {}
      this.finalizeCopiedNoteDrag();
      if (this.dragState.consumeResizeArm) {
        this.clearPendingNoteResizeDrag();
      }
      this.setActiveRollNotes(sortNotes(this.getActiveRollNotes()));
      this.persistSong();
      this.renderEditor();
      this.renderProgression();
      this.renderSuggestions();
      this.state.suppressNextEditorClick = true;
    }

    this.setMelodyInteractionLock(false);
    this.removeNotePointerListeners();
    this.dragState = null;
  }

  finalizeCopiedNoteDrag() {
    if (this.dragState?.type !== "note" || !this.dragState.copyOnDrop || this.dragState.mode !== "move") {
      return;
    }
    const section = this.getActiveSection();
    const activeNotes = this.getActiveRollNotes(section);
    const copies = [];
    let primaryCopyId = null;

    this.dragState.noteIds.forEach((noteId) => {
      const note = activeNotes.find((entry) => entry.id === noteId);
      const original = this.dragState.originalNotes?.[noteId];
      if (!note || !original) return;
      const didMove = Math.abs(note.startBeat - original.startBeat) > 0.0001 || note.pitch !== original.pitch;
      const movedNoteState = {
        startBeat: note.startBeat,
        pitch: note.pitch,
        duration: note.duration,
        durationBeats: note.durationBeats,
        velocity: note.velocity,
        muted: note.muted,
        startBar: note.startBar,
      };
      note.startBeat = original.startBeat;
      note.pitch = original.pitch;
      note.duration = original.duration;
      note.durationBeats = original.duration;
      if (!didMove) return;
      const copy = createNote(movedNoteState);
      copies.push(copy);
      if (noteId === this.dragState.noteId) {
        primaryCopyId = copy.id;
      }
    });

    if (!copies.length) return;

    this.setActiveRollNotes(sortNotes([...activeNotes, ...copies]), section);
    this.setSelectedNotes(copies.map((note) => note.id), {
      primaryId: primaryCopyId || copies.at(-1)?.id || null,
      multiSelect: copies.length > 1,
    });
    this.noteQuickPopupEnabled = false;
    this.clearPendingNoteCopyDrag();
  }

  updateDraggedNoteElement(note) {
    const element = note.id === this.dragState?.noteId
      ? (this.dragState?.element || this.refs.editorSurface.querySelector(`.note-block[data-note-id="${note.id}"]`))
      : this.refs.editorSurface.querySelector(`.note-block[data-note-id="${note.id}"]`);
    if (!element) return;

    const { beatWidth, rowHeight } = this.layoutMetrics;
    const noteTop = this.getPitchRowIndex(note.pitch) * rowHeight + 2;
    const width = Math.max(18, note.duration * beatWidth - 4);
    element.style.left = `${note.startBeat * beatWidth + 2}px`;
    element.style.top = `${noteTop}px`;
    element.style.width = `${width}px`;
    const noteClass = this.getNoteColorClass(this.getActiveSection(), note);
    element.classList.toggle("chord-tone", noteClass === "chord-tone");
    element.classList.toggle("scale-tone", noteClass === "scale-tone");
    element.classList.toggle("out-tone", noteClass === "out-tone");
    element.classList.toggle("muted", Boolean(note.muted));
    element.classList.toggle("resize-armed", this.isNoteResizeDragArmed(this.dragState?.noteIds || [note.id]));
    element.classList.remove("passing-tone");
    element.classList.add("active");
    element.classList.toggle("is-resizing", this.dragState?.mode === "resize");
    const label = element.querySelector(".note-label");
    if (label) label.textContent = this.getPitchLabel(note.pitch);
  }

  updateNoteQuickPopup() {
    const grid = this.refs?.editorSurface?.querySelector(".melody-grid");
    if (!grid) return;
    const existing = grid.querySelector(".note-quick-popup");
    if (existing) existing.remove();

    const section = this.getActiveSection();
    const selectedNote = this.getSelectedNote();
    if (!selectedNote || this.state.activeTab !== "melody") return;

    const { beatWidth, rowHeight } = this.layoutMetrics;
    const visiblePitches = this.getVisiblePitchRange(section);
    const noteTop = this.getPitchRowIndex(selectedNote.pitch, visiblePitches) * rowHeight + 2;
    const noteLeft = selectedNote.startBeat * beatWidth + 2;

    const popupH = 36;
    const top = noteTop >= popupH + 4 ? noteTop - popupH - 4 : noteTop + rowHeight + 2;
    const left = Math.max(0, noteLeft);

    const popup = document.createElement("div");
    popup.className = "note-quick-popup";
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    const resizeArmed = this.isNoteResizeDragArmed();
    const copyArmed = this.isNoteCopyDragArmed();
    popup.innerHTML = `
      <button class="nqp-btn ${resizeArmed ? "nqp-armed" : ""}" data-action="arm-selected-note-resize-drag" title="Stretch next drag">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2.5 8h11"></path>
          <path d="m5 5.5-2.5 2.5L5 10.5"></path>
          <path d="m11 5.5 2.5 2.5-2.5 2.5"></path>
        </svg>
      </button>
      <button class="nqp-btn ${copyArmed ? "nqp-armed" : ""}" data-action="copy-selected-note-on-drag" title="Copy on next move">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <rect x="6" y="3" width="7" height="9" rx="1.5"></rect>
          <path d="M10 13H4.5A1.5 1.5 0 0 1 3 11.5V4"></path>
        </svg>
      </button>
      <button class="nqp-btn" data-action="transpose-selected-note-up" title="Octave up">▲</button>
      <button class="nqp-btn" data-action="transpose-selected-note-down" title="Octave down">▼</button>
      <button class="nqp-btn nqp-trash" data-action="delete-selected-note" title="Delete note">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M6 2h4l1 1H3L4 2h2zM2 4h12l-1 9H3L2 4zm3 2v5h1V6H5zm3 0v5h1V6H8z"/></svg>
      </button>
    `;
    grid.appendChild(popup);
  }

  refreshNoteSelection() {
    const selectedIds = this.getSelectedNoteIds();
    const resizeArmedIds = this.isNoteResizeDragArmed(selectedIds) ? new Set(selectedIds) : new Set();
    this.refs.editorSurface.querySelectorAll(".note-block[data-note-id]").forEach((block) => {
      block.classList.toggle("active", this.isNoteSelected(block.dataset.noteId));
      block.classList.toggle("resize-armed", resizeArmedIds.has(block.dataset.noteId));
    });
    const selectionCount = this.getSelectedNotes().length;
    if (selectionCount > 0) {
      document.body.dataset.notesSelected = "true";
    } else {
      delete document.body.dataset.notesSelected;
      this.noteQuickPopupEnabled = false;
    }
    // Sync length select in layer bar without full re-render
    const selectedNote = this.getSelectedNote();
    const lengthSelect = this.refs.editorSurface.querySelector(".mini-length-select");
    if (lengthSelect && selectedNote) {
      const opts = NOTE_LENGTH_DIVISOR_OPTIONS.map((d) => ({ divisor: d, durationBeats: 4 / d }));
      const best = opts.reduce((b, o) => Math.abs(o.durationBeats - selectedNote.duration) < Math.abs(b.durationBeats - selectedNote.duration) ? o : b, opts[0]);
      lengthSelect.value = String(best.divisor);
    }
    const noteStripSlot = this.refs.editorSurface.querySelector(".melody-note-strip-slot");
    if (noteStripSlot) {
      noteStripSlot.innerHTML = this.getMelodyNoteStripMarkup();
    }
    if (this.noteQuickPopupEnabled) {
      this.updateNoteQuickPopup();
    }
  }

  addNoteFromGrid(event, grid) {
    const { beatWidth, rowHeight } = this.layoutMetrics;
    const rect = grid.getBoundingClientRect();
    const section = this.getActiveSection();
    const totalBeats = sectionLengthInBeats(this.state.song, section);
    const visiblePitches = this.getVisiblePitchRange(section);
    const rawBeat = (event.clientX - rect.left) / beatWidth;
    const defaultDuration = this.getDefaultMelodyStepDuration();
    const startBeat = clamp(this.quantizePlacementBeat(rawBeat), 0, Math.max(0, totalBeats - defaultDuration));
    const pitchIndex = clamp(Math.floor((event.clientY - rect.top) / rowHeight), 0, visiblePitches.length - 1);
    const rawPitch = visiblePitches[pitchIndex];
    const note = createNote({
      pitch: this.lockPitchToScale(rawPitch, this.state.noteEditorLayer),
      startBeat,
      duration: defaultDuration,
      velocity: 0.8,
    });
    if (this.state.noteEditorLayer === "bass") {
      section.bassNotesInitialized = true;
    }
    this.setActiveRollNotes(sortNotes([...this.getActiveRollNotes(section), note]), section);
    this.setSelectedNotes([note.id], { primaryId: note.id, multiSelect: false });
    this.persistSong();
    this.auditionPitch(note.pitch);
    this.renderMelodyEditor();
  }

  deleteSelectedNote() {
    const selectedIds = new Set(this.getSelectedNoteIds());
    if (!selectedIds.size) return;
    const section = this.getActiveSection();
    this.setActiveRollNotes(
      this.getActiveRollNotes(section).filter((note) => !selectedIds.has(note.id)),
      section,
    );
    this.clearNoteSelection();
    this.persistSong();
    this.renderMelodyEditor();
  }

  toggleSelectedNoteMute() {
    const selectedNotes = this.getSelectedNotes();
    if (!selectedNotes.length) return;
    const shouldMute = !selectedNotes.every((note) => note.muted);
    selectedNotes.forEach((note) => {
      note.muted = shouldMute;
    });
    this.persistSong();
    this.renderMelodyEditor();
  }

  transposeSelectedNote(interval) {
    const selectedNotes = this.getSelectedNotes();
    if (!selectedNotes.length) return;
    selectedNotes.forEach((note) => {
      note.pitch = this.lockPitchToScale(note.pitch + interval, this.state.noteEditorLayer);
    });
    this.persistSong();
    this.auditionPitch(selectedNotes[selectedNotes.length - 1].pitch);
    this.renderMelodyEditor();
  }

  // Move selected notes up/down by one scale step (+1 = up, -1 = down)
  transposeSelectedNoteByScaleStep(steps) {
    const selectedNotes = this.getSelectedNotes();
    if (!selectedNotes.length) return;
    const scalePitches = this.getVisiblePitchRange(); // high → low
    selectedNotes.forEach((note) => {
      const idx = scalePitches.indexOf(note.pitch);
      if (idx === -1) {
        // Pitch not in current scale view — lock it first then step
        note.pitch = this.lockPitchToScale(note.pitch, this.state.noteEditorLayer);
        return;
      }
      // steps > 0 = up = lower index; steps < 0 = down = higher index
      const nextIdx = Math.max(0, Math.min(scalePitches.length - 1, idx - steps));
      note.pitch = scalePitches[nextIdx];
    });
    this.persistSong();
    this.auditionPitch(selectedNotes[selectedNotes.length - 1].pitch);
    this.renderMelodyEditor();
  }

  suggestNextNote() {
    const section = this.getActiveSection();
    const activeNotes = this.getActiveRollNotes(section);
    const lastNote = activeNotes[activeNotes.length - 1];
    const activeChord = section.chordProgression[section.chordProgression.length - 1];
    const chordTones = activeChord ? getChordToneClasses(activeChord) : [getNoteIndex(this.state.song.key)];
    const pitchBase = lastNote?.pitch ?? 67;
    const pitchClass = chordTones[0] ?? getNoteIndex(this.state.song.key);
    const pitch = snapPitchToScale(60 + pitchClass + (pitchBase > 71 ? 12 : 0), this.state.song.key, this.state.song.scaleType);
    const startBeat = this.quantizeBeat((lastNote?.startBeat || 0) + (lastNote?.duration || 1));
    const defaultDuration = this.getDefaultMelodyStepDuration();
    const note = createNote({
      pitch,
      startBeat: clamp(startBeat, 0, Math.max(0, sectionLengthInBeats(this.state.song, section) - defaultDuration)),
      duration: defaultDuration,
    });
    this.setActiveRollNotes(sortNotes([...activeNotes, note]), section);
    this.setSelectedNotes([note.id], { primaryId: note.id, multiSelect: false });
    this.persistSong();
    this.auditionPitch(note.pitch);
    this.renderMelodyEditor();
  }

  fitMelodyToHarmony() {
    const section = this.getActiveSection();
    section.melodyNotes = sortNotes(
      section.melodyNotes.map((note) => {
        const chord = getChordAtBeat(section, note.startBeat, this.state.song)?.chord;
        if (!chord) return note;
        const tones = getChordToneClasses(chord);
        const bestTone = tones.reduce((best, tone) => {
          const candidate = 60 + tone + (note.pitch >= 72 ? 12 : 0);
          return Math.abs(candidate - note.pitch) < Math.abs(best - note.pitch) ? candidate : best;
        }, 60 + tones[0]);
        return { ...note, pitch: this.lockPitchToScale(bestTone, "melody") };
      }),
    );
    this.persistSong();
    this.renderMelodyEditor();
  }

  autoGenerateTopLine() {
    const suggestionSong = regenerateMelodies(cloneSong(this.state.song));
    this.state.ideaSuggestions.melody =
      suggestionSong.sections[this.getActiveSectionIndex()]?.melodyNotes || [];
    this.state.workspaceMode = "ideas";
    this.renderWorkspaceModeButtons();
    this.renderModeSurface();
  }

  // ===== PLAYBACK =====

  handlePlaybackTick(payload) {
    this.state.playheadBeat = payload.beat;
    this.state.playbackSectionId = payload.section?.id || null;
    this.state.playbackChordIndex = payload.chord?.chordIndex ?? null;
    this.updatePlaybackDecorations();
  }

  handlePlaybackStateChange(status) {
    this.state.transportState = status;
    this.renderTransportStatus();
  }

  updatePlaybackDecorations() {
    this.renderTransportStatus();

    this.refs.sectionList.querySelectorAll(".section-card[data-section-id]").forEach((card) => {
      const index = Number.parseInt(card.dataset.sectionIndex, 10);
      const section = this.state.song.sections[index];
      const tag = card.querySelector(".tag-pill");
      if (tag) {
        tag.textContent = `${section.lengthInBars}b${section.id === this.state.playbackSectionId ? " · Live" : ""}`;
      }
    });

    this.refs.progressionRow.querySelectorAll(".chord-card[data-chord-index]").forEach((card) => {
      const index = Number.parseInt(card.dataset.chordIndex, 10);
      const isLive =
        this.state.playbackSectionId === this.state.activeSectionId &&
        index === this.state.playbackChordIndex;
      card.classList.toggle("active", index === this.state.selectedChordIndex || isLive);
      card.classList.toggle("live", isLive);
    });

    const playheadLine = this.refs.editorSurface.querySelector(".playhead-line");
    if (playheadLine) {
      const section = this.getActiveSection();
      const localBeat = this.state.playheadBeat - this.getSectionStartBeat(section.id);
      const visible = this.state.playbackSectionId === section.id;
      playheadLine.classList.toggle("hidden", !visible);
      if (visible) {
        playheadLine.style.left = `${clamp(localBeat, 0, sectionLengthInBeats(this.state.song, section)) * this.layoutMetrics.beatWidth}px`;
      }
    }

    if (this.state.paletteMode === "drums") {
      const section = this.getActiveSection();
      const sequence = section.drumSequence;
      const liveStep = this.getLiveDrumStepIndex(section, sequence);
      this.refs.chordPalette.querySelectorAll(".drum-step[data-drum-step]").forEach((stepButton) => {
        stepButton.classList.toggle(
          "live",
          this.state.playbackSectionId === section.id &&
            Number.parseInt(stepButton.dataset.drumStep, 10) === liveStep,
        );
      });
    }
  }

  // ===== DRAG AND DROP =====

  clearDropTargets() {
    this.root.querySelectorAll(".drop-target").forEach((element) => element.classList.remove("drop-target"));
  }

  handleDragStart(event) {
    const draggable = event.target.closest("[data-drag-type]");
    if (!draggable) return;
    if (draggable.dataset.dragType === "chord") {
      this.dragState = { type: "chord", fromIndex: Number.parseInt(draggable.dataset.chordIndex, 10) };
      return;
    }
    if (draggable.dataset.dragType === "section") {
      this.dragState = { type: "section", fromIndex: Number.parseInt(draggable.dataset.sectionIndex, 10) };
    }
  }

  handleDragOver(event) {
    if (!this.dragState || this.dragState.type === "note") return;
    const chordTarget = event.target.closest("[data-chord-index]");
    const sectionTarget = event.target.closest("[data-section-index]");
    if (this.dragState.type === "chord" && chordTarget) {
      event.preventDefault();
      chordTarget.classList.add("drop-target");
    }
    if (this.dragState.type === "section" && sectionTarget) {
      event.preventDefault();
      sectionTarget.classList.add("drop-target");
    }
  }

  handleDrop(event) {
    if (!this.dragState || this.dragState.type === "note") return;
    event.preventDefault();

    if (this.dragState.type === "chord") {
      const target = event.target.closest("[data-chord-index]");
      if (target) {
        const section = this.getActiveSection();
        let toIndex = Number.parseInt(target.dataset.chordIndex, 10);
        if (this.dragState.fromIndex < toIndex) toIndex -= 1;
        section.chordProgression = moveItem(section.chordProgression, this.dragState.fromIndex, toIndex);
        this.state.selectedChordIndex = toIndex;
        this.persistSong();
        this.refreshHarmonyViews();
      }
    }

    if (this.dragState.type === "section") {
      const target = event.target.closest("[data-section-index]");
      if (target) {
        let toIndex = Number.parseInt(target.dataset.sectionIndex, 10);
        if (this.dragState.fromIndex < toIndex) toIndex -= 1;
        this.state.song.sections = moveItem(this.state.song.sections, this.dragState.fromIndex, toIndex);
        this.persistSong();
        this.renderSections();
        if (this.state.activeTab === "arrangement") this.renderArrangementEditor();
      }
    }

    this.clearDropTargets();
    this.dragState = null;
  }
}

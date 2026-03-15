const activePlaybackReasons = new Set();
const releaseTimers = new Map();

function applyAudioSessionType(type) {
  try {
    if (navigator.audioSession && navigator.audioSession.type !== type) {
      navigator.audioSession.type = type;
    }
  } catch (error) {
    // Ignore unsupported audio session APIs.
  }
}

function syncAudioSessionType() {
  applyAudioSessionType(activePlaybackReasons.size ? "playback" : "ambient");
}

export async function ensurePlaybackAudioMode(reason = "transport") {
  if (!reason) return;
  const existingTimer = releaseTimers.get(reason);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
    releaseTimers.delete(reason);
  }
  activePlaybackReasons.add(reason);
  syncAudioSessionType();
}

export function pulsePlaybackAudioMode(reason = "preview", durationMs = 600) {
  ensurePlaybackAudioMode(reason);
  const existingTimer = releaseTimers.get(reason);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
  }
  releaseTimers.set(reason, window.setTimeout(() => {
    releaseTimers.delete(reason);
    releasePlaybackAudioMode(reason);
  }, Math.max(120, durationMs)));
}

export function releasePlaybackAudioMode(reason = "transport") {
  if (!reason) return;
  const existingTimer = releaseTimers.get(reason);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
    releaseTimers.delete(reason);
  }
  activePlaybackReasons.delete(reason);
  syncAudioSessionType();
}

export function primeAudioContext(context) {
  if (!context || typeof context.createBuffer !== "function") return;
  try {
    const buffer = context.createBuffer(1, 1, 22050);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(0);
    source.stop(context.currentTime + 0.001);
  } catch (error) {
    // Ignore context priming failures.
  }
}

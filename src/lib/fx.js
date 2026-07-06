// ─── HAPTICS + SOUND ──────────────────────────────────────────────────────────
// Tactile + audio feedback. Haptics: subtle vibration on supported mobile devices,
// no-op elsewhere. Sound: synthesized via Web Audio API — no audio files, tiny,
// works offline. Sound respects a user preference in localStorage (default ON).
import { STORAGE_KEY } from "./keys";

export function haptic(pattern = 12) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch {}
}

let _soundOn = (() => { try { return localStorage.getItem(STORAGE_KEY + "_sound") !== "off"; } catch { return true; } })();
export function setSoundPref(on) { _soundOn = on; try { localStorage.setItem(STORAGE_KEY + "_sound", on ? "on" : "off"); } catch {} }
export function soundEnabled() { return _soundOn; }

let _audioCtx = null;
function audioCtx() {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === "suspended") _audioCtx.resume();
    return _audioCtx;
  } catch { return null; }
}

// Play a single tone. freq in Hz, dur in seconds, type of wave, gain 0-1, startOffset for sequencing.
function tone(freq, dur, { type = "sine", gain = 0.18, when = 0, glideTo = null } = {}) {
  const ctx = audioCtx();
  if (!ctx) return;
  const t0 = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  // Quick attack, smooth exponential release — avoids clicks
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// Named sound effects. Each is a no-op when sound is disabled.
export const SFX = {
  log()    { if (!soundEnabled()) return; tone(660, 0.12, { type: "triangle", gain: 0.16 }); tone(880, 0.14, { type: "triangle", gain: 0.14, when: 0.06 }); },
  water()  { if (!soundEnabled()) return; tone(440, 0.10, { type: "sine", gain: 0.18, glideTo: 880 }); },
  tap()    { if (!soundEnabled()) return; tone(520, 0.05, { type: "square", gain: 0.06 }); },
  pr()     { if (!soundEnabled()) return; [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, { type: "triangle", gain: 0.18, when: i * 0.10 })); },
  success(){ if (!soundEnabled()) return; tone(587, 0.12, { type: "triangle", gain: 0.16 }); tone(880, 0.18, { type: "triangle", gain: 0.16, when: 0.10 }); },
  error()  { if (!soundEnabled()) return; tone(220, 0.18, { type: "sine", gain: 0.16, glideTo: 160 }); },
  start()  { if (!soundEnabled()) return; tone(440, 0.10, { type: "triangle", gain: 0.12, glideTo: 660 }); },
};

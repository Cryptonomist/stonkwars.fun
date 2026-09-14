/* THE FIGHT'S FOUR SOUNDS, MADE ON THE SPOT.
 *
 * No audio files: each cue is a few oscillators and a gain envelope built with
 * WebAudio when it plays, so nothing is downloaded and nothing can fail to load.
 *
 *   bell  the round goes live: two struck partials ringing out
 *   lead  the leader changes on a real price: a short rising blip
 *   tick  each second of the last ten: a dry click
 *   ko    the fight settles while the page is open: a falling thud
 *
 * OFF UNTIL THE VIEWER TURNS IT ON, and remembered in localStorage per viewer.
 * A fight page that starts making noise uninvited is the fastest way to get a
 * tab closed. Browsers agree: an AudioContext made without a user gesture
 * starts suspended. So the context is made lazily, and resumed from a gesture:
 * the toggle's own click, or the first tap or key press on a page where the
 * setting was already on.
 *
 * Whether a cue should fire is the page's call, and it fires them only on real
 * transitions it watched happen. This only makes the sound, and only when on. */

import { SOUND_KEY } from "@/components/ui/intents";

export type Cue = "bell" | "lead" | "tick" | "ko";

type AudioCtor = typeof AudioContext;

let ctx: AudioContext | null = null;
let on: boolean | null = null;
let armed = false;
const listeners = new Set<() => void>();

function readStored(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
}

/* A page loaded with sound already on still cannot play until the viewer
 * touches it, so the first gesture anywhere wakes the context. */
function armGesture() {
  if (armed || typeof window === "undefined") return;
  armed = true;
  const wake = () => {
    window.removeEventListener("pointerdown", wake, true);
    window.removeEventListener("keydown", wake, true);
    if (on) unlockAudio();
  };
  window.addEventListener("pointerdown", wake, true);
  window.addEventListener("keydown", wake, true);
}

/** Whether sound is on for this viewer. False on the server. */
export function soundOn(): boolean {
  if (on === null) {
    on = readStored();
    if (on) armGesture();
  }
  return on;
}

export function subscribeSound(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Turn sound on or off. Call it from the click that asked, so the context can start. */
export function setSoundOn(next: boolean): void {
  on = next;
  try {
    window.localStorage.setItem(SOUND_KEY, next ? "on" : "off");
  } catch {
    /* Storage refused: the setting lasts for this page only. */
  }
  if (next) unlockAudio();
  for (const l of listeners) l();
}

/** Make or resume the audio context. Only works inside a user gesture. */
export function unlockAudio(): void {
  if (typeof window === "undefined") return;
  try {
    if (!ctx) {
      const Ctor: AudioCtor | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    ctx = null;
  }
}

/* One voice: an oscillator through its own gain, attacked fast and let decay.
 * `to` sweeps the pitch, for the thud. */
function voice(
  c: AudioContext,
  o: { type: OscillatorType; freq: number; to?: number; at?: number; attack?: number; decay: number; gain: number },
) {
  const t0 = c.currentTime + (o.at ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + o.decay);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(o.gain, t0 + (o.attack ?? 0.005));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.decay);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + o.decay + 0.05);
}

/** Play a cue, if sound is on and the context is running. Never throws. */
export function play(cue: Cue): void {
  if (!soundOn() || !ctx || ctx.state !== "running") return;
  const c = ctx;
  try {
    switch (cue) {
      case "bell":
        voice(c, { type: "sine", freq: 880, decay: 1.4, gain: 0.18 });
        voice(c, { type: "sine", freq: 1_320, decay: 0.9, gain: 0.08 });
        voice(c, { type: "sine", freq: 880, at: 0.32, decay: 1.2, gain: 0.14 });
        break;
      case "lead":
        voice(c, { type: "triangle", freq: 520, decay: 0.09, gain: 0.12 });
        voice(c, { type: "triangle", freq: 780, at: 0.08, decay: 0.12, gain: 0.12 });
        break;
      case "tick":
        voice(c, { type: "square", freq: 1_600, attack: 0.001, decay: 0.03, gain: 0.05 });
        break;
      case "ko":
        voice(c, { type: "sine", freq: 180, to: 45, attack: 0.002, decay: 0.6, gain: 0.35 });
        voice(c, { type: "sawtooth", freq: 90, to: 40, attack: 0.002, decay: 0.25, gain: 0.08 });
        break;
    }
  } catch {
    /* A browser that refuses a node plays nothing, which is the default anyway. */
  }
}

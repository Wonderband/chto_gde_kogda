import { SOUND_VOLUMES, BEEP_START, BEEP_END } from "../config.js";

/**
 * Plays a sound file once. Returns a promise that resolves when the audio ends.
 * Silently resolves on error so a missing file never breaks the game flow.
 */
export function playSound(src, { volume = 1.0 } = {}) {
  return new Promise((resolve) => {
    const audio = new Audio(src);
    audio.volume = volume;
    audio.onended = resolve;
    audio.onerror = resolve;
    audio.play().catch(resolve);
  });
}

/**
 * Plays a sound file in a loop. Returns { stop } to stop playback.
 */
export function playLooped(src, { volume = 0.5 } = {}) {
  const audio = new Audio(src);
  audio.loop = true;
  audio.volume = volume;
  audio.play().catch(() => {});
  return {
    stop() {
      audio.pause();
      audio.src = "";
    },
  };
}

export const playGong = () =>
  playSound("/sounds/gong.mp3", { volume: SOUND_VOLUMES.gong });
export const playBlackBoxMusic = () =>
  playSound("/sounds/black_box.mp3", { volume: SOUND_VOLUMES.blackBox });

/**
 * Synthesises a short beep via Web Audio API.
 * @param {number} frequency  Hz
 * @param {number} duration   ms
 * @param {number} volume     0–1
 */
function beep(frequency, duration, volume = 0.5) {
  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.type = "triangle";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      ctx.currentTime + duration / 1000
    );
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration / 1000);
    oscillator.onended = () => ctx.close();
  } catch {
    // Web Audio not available — silently skip
  }
}

/** Short high beep — played when the discussion timer starts. */
export const playTimerStartBeep = () =>
  beep(BEEP_START.frequency, BEEP_START.duration, BEEP_START.volume);

/** Short low beep — played when the discussion timer reaches zero. */
export const playTimerEndBeep = () =>
  beep(BEEP_END.frequency, BEEP_END.duration, BEEP_END.volume);

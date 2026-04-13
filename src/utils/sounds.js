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

export const playGong = () => playSound("/sounds/gong.mp3", { volume: 0.9 });
export const playBlackBoxMusic = () => playSound("/sounds/black_box.mp3", { volume: 0.8 });

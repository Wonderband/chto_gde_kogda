/**
 * src/game/gameText.js — Shared localised game text helpers.
 *
 * Single source of truth for strings that appear in multiple code paths
 * (Realtime prompts, TTS fallbacks, mock mode scripts).
 * All helpers take plain (question, lang) arguments — no gameContext object —
 * so they can be used both in service files and in React hooks.
 */

/**
 * Time line spoken after the question is read.
 * e.g. "Час! Хвилина обговорення!" or "Час! Двадцять секунд!" (blitz)
 */
export function timeLine(question, lang) {
  const isRu = lang === "ru";
  return question?.round_type === "blitz"
    ? isRu ? "Время! Двадцать секунд!" : "Час! Двадцять секунд!"
    : isRu ? "Время! Минута обсуждения!" : "Час! Хвилина обговорення!";
}

/**
 * Ordinal label for a blitz question position (agrees with «питання» / «вопрос»).
 * pos: 1-based position (1=first, 2=second, 3=third)
 * e.g. blitzPositionLabel(1, "uk") → "Перше"
 */
export function blitzPositionLabel(pos, lang) {
  const isRu = lang === "ru";
  return isRu
    ? ["Первый", "Второй", "Третий"][pos - 1] || `${pos}-й`
    : ["Перше", "Друге", "Третє"][pos - 1] || `${pos}-е`;
}

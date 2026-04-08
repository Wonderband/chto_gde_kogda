/**
 * src/config.js — Central game configuration
 *
 * All hardcoded game constants live here.
 * Most values can be overridden via .env (see .env.example).
 *
 * Import what you need:
 *   import { WINNING_SCORE, GAME_LANGUAGE, TOKENS } from '../config.js'
 */

const e = import.meta.env

// ─── Game rules ────────────────────────────────────────────────────────────
/** Points needed to win the game */
export const WINNING_SCORE    = Number(e.VITE_WINNING_SCORE)    || 6
/** Roulette wheel spin duration in ms */
export const SPIN_DURATION_MS = Number(e.VITE_SPIN_DURATION_MS) || 30_000
/** Standard question discussion time in seconds */
export const DISCUSSION_SEC   = Number(e.VITE_DISCUSSION_SEC)   || 60
/** Blitz question discussion time in seconds */
export const BLITZ_SEC        = Number(e.VITE_BLITZ_SEC)        || 20

// ─── Timer display thresholds ──────────────────────────────────────────────
/** Timer arc turns orange (warning) below this many seconds */
export const TIMER_WARNING_SEC = 10
/** Timer arc turns red (danger) below this many seconds */
export const TIMER_DANGER_SEC  = 5

// ─── Language ──────────────────────────────────────────────────────────────
/** Game UI and moderator speech language: 'ru' | 'uk' */
export const GAME_LANGUAGE = e.VITE_GAME_LANGUAGE || 'uk'

// ─── Players ───────────────────────────────────────────────────────────────
/** Names of players sitting at the table (comma-separated in .env) */
export const PLAYER_NAMES = (e.VITE_PLAYER_NAMES || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

// ─── AI models & voices ────────────────────────────────────────────────────
/** OpenAI Realtime API model */
export const REALTIME_MODEL   = e.VITE_REALTIME_MODEL   || 'gpt-realtime-mini'
/** Realtime API voice (used for ALL live moderator speech) */
export const REALTIME_VOICE   = e.VITE_REALTIME_VOICE   || 'echo'
/** TTS model for non-realtime announcements (Стоп!, mock mode) */
export const TTS_MODEL        = e.VITE_TTS_MODEL        || 'tts-1'
/** TTS voice */
export const TTS_VOICE        = e.VITE_TTS_VOICE        || 'onyx'
/** Speech-to-text model for team answer transcription */
export const TRANSCRIBE_MODEL = e.VITE_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe'
/** Responses API model for main moderator (mock/fallback mode) */
export const RESPONSES_MODEL  = e.VITE_RESPONSES_MODEL  || 'gpt-4o'
/** Cheap text-only model for answer evaluation + explanation generation */
export const EVALUATOR_MODEL  = e.VITE_EVALUATOR_MODEL  || 'gpt-4.1-nano'
/** Fast evaluator override (defaults to EVALUATOR_MODEL) */
export const FAST_EVALUATOR_MODEL = e.VITE_FAST_EVALUATOR_MODEL || EVALUATOR_MODEL

// ─── Realtime audio token budgets ──────────────────────────────────────────
/**
 * Maximum audio tokens per Realtime cue.
 * Realtime API bills ~60 audio tokens/second of output.
 * Increase if speech is cut off; decrease to save cost.
 */
export const TOKENS = {
  WHEEL_OPENING:   120,   // spinning phase opener          (~2–3 s)
  SECTOR_INTRO:    220,   // sector + character + flavor    (~5–6 s)
  LISTENING_CUE:   220,   // "Стоп!" announcement           (~4–5 s)
  VERDICT_CUE:     320,   // short verdict (legacy, unused) (~6–7 s)
  SEGUE_CUE:       200,   // "А теперь — к правильному…"    (~3–4 s)
  EXPLANATION_CUE: 1000,  // full explanation narrative     (~20–30 s)
}

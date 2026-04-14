/**
 * src/config.js — Central game configuration
 *
 * All hardcoded game constants live here.
 * Most values can be overridden via .env (see .env.example).
 *
 * Import what you need:
 *   import { WINNING_SCORE, GAME_LANGUAGE, TOKENS } from '../config.js'
 */

const e = import.meta.env;

// ─── Game rules ────────────────────────────────────────────────────────────
/** Points needed to win the game */
export const WINNING_SCORE = Number(e.VITE_WINNING_SCORE) || 6;
/** Roulette wheel spin duration in ms */
export const SPIN_DURATION_MS = Number(e.VITE_SPIN_DURATION_MS) || 30_000;
/** Standard question discussion time in seconds */
export const DISCUSSION_SEC = Number(e.VITE_DISCUSSION_SEC) || 60;
/** Blitz question discussion time in seconds */
export const BLITZ_SEC = Number(e.VITE_BLITZ_SEC) || 20;

// ─── Timer display thresholds ──────────────────────────────────────────────
/** Timer arc turns orange (warning) below this many seconds */
export const TIMER_WARNING_SEC = 10;
/** Timer arc turns red (danger) below this many seconds */
export const TIMER_DANGER_SEC = 5;

// ─── Language ──────────────────────────────────────────────────────────────
/** Game UI and moderator speech language: 'ru' | 'uk' */
export const GAME_LANGUAGE = e.VITE_GAME_LANGUAGE || "uk";

// ─── Players ───────────────────────────────────────────────────────────────
/** Names of players sitting at the table (comma-separated in .env) */
export const PLAYER_NAMES = (e.VITE_PLAYER_NAMES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ─── AI models & voices ────────────────────────────────────────────────────
/** OpenAI Realtime API model */
export const REALTIME_MODEL = e.VITE_REALTIME_MODEL || "gpt-realtime-mini";
/** Realtime API voice (used for ALL live moderator speech) */
export const REALTIME_VOICE = e.VITE_REALTIME_VOICE || "echo";
/** TTS model for non-realtime announcements (Стоп!, mock mode).
 *  gpt-4o-mini-tts supports the `instructions` field for language hints,
 *  which fixes the English accent on Ukrainian text. */
export const TTS_MODEL = e.VITE_TTS_MODEL || "gpt-4o-mini-tts";
/** TTS voice */
export const TTS_VOICE = e.VITE_TTS_VOICE || "onyx";
/** Speech-to-text model for team answer transcription */
export const TRANSCRIBE_MODEL =
  e.VITE_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
/** Responses API model for main moderator (mock/fallback mode) */
export const RESPONSES_MODEL = e.VITE_RESPONSES_MODEL || "gpt-4o";
/** Cheap text-only model for answer evaluation + explanation generation */
export const EVALUATOR_MODEL = e.VITE_EVALUATOR_MODEL || "gpt-4.1-mini";
/** Fast evaluator override (defaults to EVALUATOR_MODEL) */
export const FAST_EVALUATOR_MODEL =
  e.VITE_FAST_EVALUATOR_MODEL || EVALUATOR_MODEL;

// ─── Realtime audio token budgets ──────────────────────────────────────────
/**
 * Maximum audio tokens per Realtime cue.
 * Realtime API bills ~60 audio tokens/second of output.
 * Increase if speech is cut off; decrease to save cost.
 */
export const TOKENS = {
  WHEEL_OPENING: 350, // spinning phase opener            (~6–7 s, player-specific banter + reaction)
  COMBINED_INTRO: 600, // sector + character + intro_flavor (~10 s, one combined monologue)
  WARMUP_REACTION: 200, // warmup reaction phrase            (~3 s; +video cue when needed)
  VIDEO_CUE: 150, // "увага на екран" / "Час! Двадцять секунд!" (~2 s, 3–5 words max)
  ATTENTION_CUE: 400, // "Увага! Питання!" or blitz announcement  (~6 s, up to ~15 words for blitz)
  LISTENING_CUE: 220, // "Час вийшов. Хто відповідатиме?"         (~4–5 s)
  SEGUE_CUE: 200, // "А тепер — правильна відповідь."         (~3 s)
  EXPLANATION_CUE: 1000, // full explanation narrative         (~20–30 s)
  NAME_CONFIRM: 120, // "Слухаємо вас, пані Наталю!"      (~2 s)
};

// ─── Session dialogue timing ───────────────────────────────────────────────────
/** Delay (ms) before wheel banter starts after SPINNING phase begins.
 *  Allows wheel music to settle and players to get ready.
 *  Used in useGamePhaseEffects.js SPINNING effect → startWheelDialogue. */
export const WHEEL_DIALOGUE_DELAY_MS = 4000;

/** Delay (ms) after video backdrop exits before the moderator speaks the time cue.
 *  Gives the UI time to animate the backdrop away cleanly.
 *  Used in useGamePhaseEffects.js handleQuestionVideoEnded. */
export const VIDEO_TO_SPEECH_DELAY_MS = 350;

/** Roulette envelope animation: time (ms) after sector selection before fading starts.
 *  Used in Roulette.jsx openTimer. */
export const ENVELOPE_FADE_MS = 450;

/** Roulette envelope animation: time (ms) until envelope is fully committed to openedSectors.
 *  Must be >= ENVELOPE_FADE_MS. Used in Roulette.jsx openTimerCommit. */
export const ENVELOPE_COMMIT_MS = 650;

// ─── Audio recording ──────────────────────────────────────────────────────────
/** Minimum audio blob size (bytes) to attempt STT transcription.
 *  Blobs below this are almost certainly silence or noise — skip the API call.
 *  Used in src/services/transcribe.js. */
export const MIN_RECORDING_BLOB_BYTES = 20_000;

// ─── Sound volumes ────────────────────────────────────────────────────────────
/**
 * Master volume levels for all named sounds.
 *   gong / blackBox  — one-shot via sounds.js
 *   wheel            — looped inline in useGamePhaseEffects SPINNING effect
 *   pause            — looped via playLooped in READY state
 *   final            — looped via playLooped in GAME_OVER state
 */
export const SOUND_VOLUMES = {
  gong: 0.9,
  blackBox: 0.8,
  wheel: 0.35,
  pause: 0.45,
  final: 0.55,
};

// ─── Timer beeps ──────────────────────────────────────────────────────────────
/**
 * Synthesised beeps played at timer start and end (Web Audio API, no file needed).
 *   frequency  — Hz
 *   duration   — ms
 *   volume     — 0–1
 */
export const BEEP_START = { frequency: 1800, duration: 1000, volume: 0.75 };
export const BEEP_END = { frequency: 1200, duration: 1000, volume: 0.75 };

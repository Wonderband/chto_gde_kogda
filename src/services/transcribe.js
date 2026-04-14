/**
 * Speech-to-Text — gpt-4o-mini-transcribe
 *
 * Pass a `question` object to transcribeAudio() to activate question-aware
 * prompting. The STT model uses the expected answer vocabulary as context, which:
 *   • steers it toward real words from the answer/variants instead of inventing
 *     phonetically similar nonsense (e.g. "надвасерій" from "назва серії")
 *   • improves recognition of chemistry terms, proper names, and uncommon words
 */

import { mockTranscribeAudio } from "./mock";
import { TRANSCRIBE_MODEL, GAME_LANGUAGE, MIN_RECORDING_BLOB_BYTES } from "../config.js";

const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";
const API_URL = "https://api.openai.com/v1/audio/transcriptions";

// ─── Base vocabulary prompts ───────────────────────────────────────────────────

const UK_BASE_PROMPT =
  "Мова відповіді: українська. Розпізнавай саме українську мову." +
  " Можливі слова та імена: Волтер Вайт, Джессі Пінкман, Гайзенберг, Густаво Фрінг," +
  " Сол Гудман, Скайлер Вайт, Генк Шрейдер, Майк Ермантраут, Тодд Алквіст, Гейл Боеттікер," +
  " Джейн Марголіс, Альбукерке, Pollos Hermanos." +
  " ВАЖЛИВО: не вигадуй слів, яких не було сказано. Якщо слово нечітке — пиши те, що почув, без заміни на схожі терміни.";

const RU_BASE_PROMPT =
  "Язык ответа: русский. Распознавай именно русский язык." +
  " Возможные слова и имена: Уолтер Уайт, Джесси Пинкман, Хайзенберг, Густаво Фринг," +
  " Сол Гудман, Скайлер Уайт, Хэнк Шрейдер, Майк Эрмантраут, Тодд Алквист, Гейл Боэттикер," +
  " Джейн Марголис, Альбукерке, Pollos Hermanos." +
  " ВАЖНО: не придумывай слов, которых не было сказано. Если слово нечёткое — пиши что слышишь, без замены на похожие термины.";

// ─── Normalisation map ─────────────────────────────────────────────────────────

const NORMALIZE = new Map([
  ["волтер вайт", "Волтер Вайт"],
  ["уолтер уайт", "Волтер Вайт"],
  ["walter white", "Волтер Вайт"],

  ["джессі пінкман", "Джессі Пінкман"],
  ["джесси пинкман", "Джессі Пінкман"],
  ["jesse pinkman", "Джессі Пінкман"],

  ["гайзенберг", "Гайзенберг"],
  ["хайзенберг", "Гайзенберг"],
  ["heisenberg", "Гайзенберг"],

  ["сол гудман", "Сол Гудман"],
  ["saul goodman", "Сол Гудман"],

  ["альбукерке", "Альбукерке"],
  ["albuquerque", "Альбукерке"],
]);

// ─── Helpers ───────────────────────────────────────────────────────────────────

function resolveLanguage(lang) {
  return lang === "ru" ? "ru" : "uk";
}

/**
 * Build the full STT prompt.
 * If a question is provided, its answer and accepted variants are appended as
 * expected vocabulary. This drastically reduces hallucinations for uncommon
 * words (chemistry terms, proper names, titles) that appear in answers.
 */
function buildPrompt(lang, question = null) {
  const base = lang === "ru" ? RU_BASE_PROMPT : UK_BASE_PROMPT;
  if (!question) return base;

  const ans = question.answer || question.correct_answer || "";
  const variants = Array.isArray(question.answer_variants)
    ? question.answer_variants
    : [];

  const keywords = [ans, ...variants]
    .filter(Boolean)
    .join(", ");

  if (!keywords) return base;

  const label = lang === "ru"
    ? "Ключевые слова вопроса:"
    : "Ключові слова питання:";

  return `${base} ${label} ${keywords}.`;
}

function normalizeTranscript(text = "") {
  const trimmed = text.trim();
  const key = trimmed.toLowerCase();
  return NORMALIZE.get(key) || trimmed;
}

function looksGarbled(text = "") {
  const t = text.trim();
  if (!t) return true;

  const latin = (t.match(/[A-Za-z]/g) || []).length;
  const cyr = (t.match(/[А-Яа-яЁёІіЇїЄєҐґ]/g) || []).length;

  if (t.length < 2) return true;
  // Pure Latin is acceptable — chemical symbols (Fe, Li, Na) are Latin
  if (cyr === 0 && latin === 0) return true;
  // More Latin than Cyrillic is suspicious only if there are Cyrillic chars too
  // (all-Latin is fine for chemical symbols)
  if (cyr > 0 && latin > cyr * 3) return true;

  return false;
}

async function doTranscribe(audioBlob, language, apiKey, prompt) {
  const formData = new FormData();
  formData.append("file", audioBlob, "answer.webm");
  formData.append("model", TRANSCRIBE_MODEL);
  formData.append("language", language);
  formData.append("prompt", prompt);

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Transcribe API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return normalizeTranscript(data.text ?? "");
}

/**
 * Transcribe a recorded audio blob to text.
 *
 * @param {Blob} audioBlob   - recorded audio
 * @param {object} [options]
 * @param {object} [options.question] - current question object from game state.
 *   Pass this to activate question-aware prompting (strongly recommended).
 *   Fields used: question.answer, question.answer_variants.
 */
export async function transcribeAudio(audioBlob, { question = null } = {}) {
  if (USE_MOCK) return mockTranscribeAudio(audioBlob);

  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey) throw new Error("VITE_OPENAI_API_KEY not set in .env");

  if (audioBlob.size < MIN_RECORDING_BLOB_BYTES) {
    console.warn(`[STT] Blob too small (${audioBlob.size} bytes) — skipping transcription`);
    return "";
  }

  const primaryLanguage = resolveLanguage(GAME_LANGUAGE);
  const primaryPrompt = buildPrompt(primaryLanguage, question);

  console.log("[STT] prompt keywords:", question
    ? `"${[question.answer, ...(question.answer_variants || [])].filter(Boolean).slice(0, 4).join(", ")}..."`
    : "(no question hint)"
  );

  const firstPass = await doTranscribe(audioBlob, primaryLanguage, apiKey, primaryPrompt);

  // Ukrainian first, Russian fallback only when result looks completely garbled.
  if (primaryLanguage === "uk" && looksGarbled(firstPass)) {
    const ruPrompt = buildPrompt("ru", question);
    const secondPass = await doTranscribe(audioBlob, "ru", apiKey, ruPrompt);
    if (!looksGarbled(secondPass)) return secondPass;
  }

  return firstPass;
}

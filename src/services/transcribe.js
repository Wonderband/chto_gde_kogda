/**
 * Speech-to-Text — gpt-4o-mini-transcribe
 */

import { mockTranscribeAudio } from "./mock";
import { TRANSCRIBE_MODEL, GAME_LANGUAGE } from "../config.js";

const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";
const API_URL = "https://api.openai.com/v1/audio/transcriptions";

const UK_PROMPT =
  "Мова відповіді: українська. Розпізнавай саме українську мову. Можливі слова та імена: Волтер Вайт, Джессі Пінкман, Гайзенберг, Густаво Фрінг, Сол Гудман, Скайлер Вайт, Генк Шрейдер, Майк Ермантраут, Альбукерке, Pollos Hermanos.";

const RU_PROMPT =
  "Язык ответа: русский. Распознавай именно русский язык. Возможные слова и имена: Уолтер Уайт, Джесси Пинкман, Хайзенберг, Густаво Фринг, Сол Гудман, Скайлер Уайт, Хэнк Шрейдер, Майк Эрмантраут, Альбукерке, Pollos Hermanos.";

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

function resolveLanguage(lang) {
  return lang === "ru" ? "ru" : "uk";
}

function buildPrompt(lang) {
  return lang === "ru" ? RU_PROMPT : UK_PROMPT;
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
  if (cyr === 0 && latin > 0) return true;
  if (latin > cyr) return true;

  return false;
}

async function doTranscribe(audioBlob, language, apiKey) {
  const formData = new FormData();
  formData.append("file", audioBlob, "answer.webm");
  formData.append("model", TRANSCRIBE_MODEL);
  formData.append("language", language);
  formData.append("prompt", buildPrompt(language));

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

// Blobs smaller than this are almost certainly silence/noise — skip the API call.
const MIN_BLOB_BYTES = 20_000;

export async function transcribeAudio(audioBlob) {
  if (USE_MOCK) return mockTranscribeAudio(audioBlob);

  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey) throw new Error("VITE_OPENAI_API_KEY not set in .env");

  if (audioBlob.size < MIN_BLOB_BYTES) {
    console.warn(`[STT] Blob too small (${audioBlob.size} bytes) — skipping transcription`);
    return "";
  }

  const primaryLanguage = resolveLanguage(GAME_LANGUAGE);
  const firstPass = await doTranscribe(audioBlob, primaryLanguage, apiKey);

  // Ukrainian first, Russian fallback only when the result is obviously broken.
  if (primaryLanguage === "uk" && looksGarbled(firstPass)) {
    const secondPass = await doTranscribe(audioBlob, "ru", apiKey);
    if (!looksGarbled(secondPass)) return secondPass;
  }

  return firstPass;
}

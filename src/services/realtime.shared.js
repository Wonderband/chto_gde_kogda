import { REALTIME_MODEL, REALTIME_VOICE } from "../config.js";

export const DEFAULT_MODEL = REALTIME_MODEL;
export const DEFAULT_VOICE = REALTIME_VOICE;

export function uid(prefix = "rt") {
  const rnd =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${rnd}`;
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeText(value = "") {
  return value
    .toLowerCase()
    .replace(/[“”«»"'.,!?;:()\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const id = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms} ms`)),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(id);
        resolve(value);
      },
      (err) => {
        clearTimeout(id);
        reject(err);
      }
    );
  });
}

export function makeDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function safeJsonParse(value, fallback = {}) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return fallback;
  }
}

export function extractPersonaPrelude(systemPrompt = "") {
  if (!systemPrompt) return "";
  const stopMarkers = [
    "## СЦЕНАРИЙ ИГРЫ",
    "### ФАЗА 1",
    "## HOW TO USE THIS FILE",
    "--- SYSTEM PROMPT START ---",
  ];

  let end = systemPrompt.length;
  for (const marker of stopMarkers) {
    const idx = systemPrompt.indexOf(marker);
    if (idx !== -1) end = Math.min(end, idx);
  }

  return systemPrompt.slice(0, end).trim();
}

export function wheelBanterSeed(index = 0, isRu) {
  const ru = [
    "Как настроение у стола? Готовы к новому раунду?",
    "Кто сегодня отвечает за спокойствие, а кто — за азарт?",
    "Как полагаете, лёгкий будет вопрос или коварный?",
    "Господа знатоки, стол сегодня звучит уверенно или делает вид?",
    "Кто из вас сейчас больше верит в интуицию, чем в знания?",
    "Хватило времени сосредоточиться после прошлого раунда?",
    "Как ощущения — стол готов к бою?",
    "Волнение сейчас помогает или мешает?",
    "Если бы вы могли выбрать тему — что бы предпочли?",
    "Кто сегодня первым предложит версию?",
  ];
  const uk = [
    "Який настрій у столу? Готові до нового раунду?",
    "Хто сьогодні відповідає за спокій, а хто — за азарт?",
    "Як гадаєте, питання буде легке чи підступне?",
    "Панове знавці, стіл сьогодні звучить упевнено чи тільки вдає?",
    "Хто з вас зараз більше вірить в інтуїцію, ніж у знання?",
    "Чи вистачило часу зосередитися після минулого раунду?",
    "Як відчуття — стіл готовий до бою?",
    "Хвилювання зараз допомагає чи заважає?",
    "Якби ви могли обрати тему — що б обрали?",
    "Хто сьогодні першим запропонує версію?",
  ];
  const source = isRu ? ru : uk;
  return source[index % source.length];
}

export const DEFAULT_TRIGGER_PHRASES = [
  "внимание вопрос",
  "внимание первый вопрос",
  "увага питання",
  "увага перше питання",
];

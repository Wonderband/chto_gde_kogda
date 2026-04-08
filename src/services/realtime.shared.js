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

export function inferQuestionTheme(gameContext) {
  const q = gameContext.current_question || {};
  const haystack = normalizeText(
    `${q.question_text || ""} ${q.correct_answer || ""} ${
      q.hint_for_evaluator || ""
    }`
  );

  const chemistry = [
    "хим",
    "chem",
    "молек",
    "реакц",
    "кислот",
    "элемент",
    "element",
    "atomic",
    "период",
    "лаборат",
  ];
  const law = [
    "адвокат",
    "law",
    "legal",
    "суд",
    "договор",
    "право",
    "юрист",
    "prosecut",
  ];
  const history = [
    "истор",
    "history",
    "войн",
    "корол",
    "век",
    "револю",
    "импер",
    "president",
    "полит",
  ];
  const language = [
    "слово",
    "word",
    "букв",
    "язык",
    "language",
    "назван",
    "slang",
    "термин",
  ];
  const math = [
    "числ",
    "матем",
    "логик",
    "number",
    "count",
    "формул",
    "calculate",
    "процент",
  ];

  const hit = (needles) => needles.some((n) => haystack.includes(n));

  if (hit(chemistry)) return "chemistry";
  if (hit(law)) return "law";
  if (hit(history)) return "history";
  if (hit(language)) return "language";
  if (hit(math)) return "math";
  return "general";
}

export function warmupLineByTheme(theme, isRu) {
  const prompts = {
    chemistry: isRu
      ? "Скажите честно: кто из вас в школе любил химию?"
      : "Скажіть чесно: хто з вас у школі любив хімію?",
    law: isRu
      ? "У кого из вас сегодня особенно убедительный адвокатский тон?"
      : "У кого з вас сьогодні особливо переконливий адвокатський тон?",
    history: isRu
      ? "Кто из вас лучше всех дружил в школе с историей?"
      : "Хто з вас найкраще дружив у школі з історією?",
    language: isRu
      ? "Кто за этим столом любит играть со словами?"
      : "Хто за цим столом любить гратися зі словами?",
    math: isRu
      ? "Кто из вас любит задачи, где всё решают логика и точность?"
      : "Хто з вас любить задачі, де все вирішують логіка і точність?",
    general: isRu
      ? "Ну что, господа знатоки, настроение у стола боевое?"
      : "Ну що, панове знавці, настрій у столу бойовий?",
  };
  return prompts[theme] || prompts.general;
}

export function themeFlavorByTheme(theme, isRu) {
  const flavors = {
    chemistry: isRu
      ? "Тема вопроса явно пахнет наукой, но без прямых подсказок."
      : "Тема питання виразно пахне наукою, але без прямих підказок.",
    law: isRu
      ? "Тут важны точные формулировки и холодная голова."
      : "Тут важливі точні формулювання і холодна голова.",
    history: isRu
      ? "Иногда память о прошлом спасает очко в настоящем."
      : "Іноді пам’ять про минуле рятує очко в теперішньому.",
    language: isRu
      ? "Сегодня одно слово может весить больше длинной речи."
      : "Сьогодні одне слово може важити більше за довгу промову.",
    math: isRu
      ? "Иногда интуиция полезна, но сегодня ей нужна логика."
      : "Іноді інтуїція корисна, але сьогодні їй потрібна логіка.",
    general: isRu
      ? "Вопрос выглядит простым только до первой ошибки."
      : "Питання виглядає простим лише до першої помилки.",
  };
  return flavors[theme] || flavors.general;
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

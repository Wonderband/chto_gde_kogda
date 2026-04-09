import {
  extractPersonaPrelude,
  wheelBanterSeed,
} from "./realtime.shared.js";

export const TOOL_END_ROUND = {
  type: "function",
  name: "end_round",
  description:
    "Call AFTER you have fully finished the evaluation ritual, including the correct answer and the updated score. This must be the final action of the evaluation response.",
  parameters: {
    type: "object",
    properties: {
      correct: {
        type: "boolean",
        description: "Whether the experts' answer was accepted as correct.",
      },
      who_scores: {
        type: "string",
        enum: ["experts", "viewers"],
      },
      correct_answer_reveal: {
        type: "string",
        description:
          "The correct answer phrased naturally for on-screen reveal.",
      },
    },
    required: ["correct", "who_scores", "correct_answer_reveal"],
  },
};

function timeLineForQuestion(gameContext) {
  const isRu = (gameContext.game_language || "uk") !== "uk";
  return gameContext.current_question?.round_type === "blitz"
    ? isRu
      ? "Время! Двадцать секунд."
      : "Час! Двадцять секунд."
    : isRu
      ? "Время! Минута обсуждения."
      : "Час! Хвилина обговорення.";
}

function attentionLineForQuestion(gameContext) {
  const isRu = (gameContext.game_language || "uk") !== "uk";
  const q = gameContext.current_question || {};
  const pos = q.blitz_position || 1;
  const blitzPosLabel = isRu
    ? ["Первый", "Второй", "Третий"][pos - 1] || `${pos}-й`
    : ["Перше", "Друге", "Третє"][pos - 1] || `${pos}-е`;

  if (q.round_type !== "blitz") {
    return isRu ? "Внимание! Вопрос!" : "Увага! Питання!";
  }

  if (pos === 1) {
    return isRu
      ? "Сектор Блиц! Три вопроса. Три телезрителя. Двадцать секунд на каждый. Внимание! Первый вопрос!"
      : "Сектор Бліц! Три питання. Три телеглядачі. Двадцять секунд на кожне. Увага! Перше питання!";
  }

  return isRu
    ? `Внимание! ${blitzPosLabel} вопрос!`
    : `Увага! ${blitzPosLabel} питання!`;
}

export function buildModeratorBaseInstructions(systemPrompt = "") {
  const personaPrelude = extractPersonaPrelude(systemPrompt);
  return `${personaPrelude}

---

ПОТОЧНА REALTIME-РОЛЬ:
Ти — живий ведучий за ігровим столом. Застосунок керує фазами й таймінгом.

ЖОРСТКІ ПРАВИЛА:
1. Виконуй лише поточну фазу, вказану в instructions цього response.create або поточних session instructions.
2. Під час wheel small talk говори лише з гравцями. Не згадуй персонажів Breaking Bad, сектор або майбутнє питання.
3. Під час sector intro оголошуй лише сектор і автора питання. Не починай warm-up і не зачитуй питання.
4. Під час warm-up дозволено лише одне коротке запитання гравцям і одна коротка реакція на їхню відповідь. Застосунок сам вирішує, коли warm-up завершено.
5. Під час protected monologue зачитуй питання дослівно і не реагуй на гравців.
6. Не імпровізуй сюжет. Не вигадуй додаткових персонажів, подій або сцен.
7. Не називай правильну відповідь до фази оцінки.
8. Якщо поточна фаза забороняє функцію — не викликай її.
9. Усі репліки мають бути короткими і сценічно точними.
10. Ніколи не починай новий turn самостійно, якщо застосунок не дав явну команду на цей turn.
`;
}

export function buildWheelOpeningPrompt(gameContext) {
  const isRu = (gameContext.game_language || "uk") !== "uk";
  const round = gameContext.round_number || 1;
  const seed = wheelBanterSeed(round - 1, isRu);
  const scoreExperts = gameContext.score?.experts ?? 0;
  const scoreViewers = gameContext.score?.viewers ?? 0;

  return `ПОТОЧНА ФАЗА: СТАРТОВА РЕПЛІКА — РАУНД ${round}.

ЗАВДАННЯ — суворо дві короткі фрази:
1. Оголоси номер раунду: «Раунд ${round}!» (або короткий синонім).
2. Постав ОДНЕ легке запитання гравцям у дусі: «${seed}»
Після другої фрази одразу замовкни і чекай.

Не говори більше двох фраз. Не згадуй персонажів Breaking Bad, сектор або майбутнє питання.
Кожна фраза — максимум 8 слів.

Рахунок: ${scoreExperts} : ${scoreViewers}. Мова: ${isRu ? "російська" : "українська"}.
`;
}

export function buildWheelSmallTalkPrompt(gameContext, index = 0) {
  const isRu = (gameContext.game_language || "uk") !== "uk";
  return `ПОТОЧНА ФАЗА: КОЛЕСО КРУТИТЬСЯ.

Скажи ОДНУ коротку живу репліку столу — привітання, легкий жарт або просте запитання.
Підказка: ${wheelBanterSeed(index, isRu)}
Після однієї репліки зупинись. Не згадуй персонажів, сектор або майбутнє питання.

Мова: ${isRu ? "російська" : "українська"}. Рахунок: ${gameContext.score?.experts ?? 0} : ${gameContext.score?.viewers ?? 0}.
`;
}

export function buildSectorIntroPrompt(gameContext) {
  const q = gameContext.current_question || {};
  const isRu = (gameContext.game_language || "uk") !== "uk";
  const flavor = q.intro_flavor || (isRu ? "Подивимося, що приготовлено для знатоків." : "Подивимося, що приготовлено для знавців.");
  return `ПОТОЧНА ФАЗА: КОРОТКЕ ПРЕДСТАВЛЕННЯ СЕКТОРА І АВТОРА ПИТАННЯ.

Скажи лише коротку завершену репліку з 2-3 фраз:
1. Оголоси сектор номер ${gameContext.sector_number}.
2. Представ автора питання: ${q.character || "Невідомий персонаж"}.
3. Вимов цю атмосферну фразу дослівно: «${flavor}»
Одразу зупинись.

Не починай warm-up. Не постав нового запитання. Не зачитуй текст питання.
Мова: ${isRu ? "російська" : "українська"}.
`;
}

export function buildWarmupSessionInstructions(systemPrompt, gameContext) {
  const isRu = (gameContext.game_language || "uk") !== "uk";
  const q = gameContext.current_question || {};
  const flavor = q.intro_flavor || "";
  return `${buildModeratorBaseInstructions(systemPrompt)}

ПОТОЧНА ФАЗА: КОРОТКИЙ APP-DIRECTED WARM-UP ПЕРЕД ЗАЧИТУВАННЯМ ПИТАННЯ.
${flavor ? `Контекст питання (для натхнення, без спойлерів): «${flavor}»` : ""}

Кроки суворо такі:
A. На першу команду застосунку ти ставиш РІВНО ОДНЕ коротке розігрівальне запитання і одразу замовкаєш.
B. Потім застосунок дає гравцям коротке вікно для відповіді.
C. На наступну команду застосунку ти даєш РІВНО ОДНУ дуже коротку реакцію і знову замовкаєш.

Не став друге warm-up запитання. Не уточнюй відповідь. Не зачитуй майбутнє питання.
Якщо відповідь гравців нерозбірлива — дай нейтральну коротку реакцію.

Мова: ${isRu ? "російська" : "українська"}.
`;
}

export function buildWarmupPrompt(gameContext) {
  const q = gameContext.current_question || {};
  const flavor = q.intro_flavor || "";
  return `ПОТОЧНА ФАЗА: СТАРТ WARM-UP.

Постав РІВНО ОДНЕ коротке розігрівальне запитання гравцям.
${flavor ? `Орієнтуйся на цю підказку (не переказуй її дослівно): «${flavor}»` : "Запитання має бути легким і розмовним."}
Запитання — коротке, завершене. Після запитання одразу зупинись.
`;
}

export function buildWarmupReactionPrompt(gameContext) {
  const isRu = (gameContext.game_language || "uk") !== "uk";
  return `ПОТОЧНА ФАЗА: КОРОТКА РЕАКЦІЯ НА WARM-UP ВІДПОВІДЬ ГРАВЦІВ.

Скажи РІВНО ОДНУ коротку завершену фразу — максимум 8 слів.
Не став нове запитання. Не переходь до зачитування питання.
Якщо відповідь нерозбірлива — ${isRu ? "«Хорошо, стол проснулся.»" : "«Добре, стіл прокинувся.»"}
Після фрази одразу зупинись.
`;
}

export function buildSimpleStopToQuestionPrompt(gameContext) {
  const q = gameContext.current_question || {};
  const isRu = (gameContext.game_language || "uk") !== "uk";
  const questionText = q.question_text || "";
  const attention = attentionLineForQuestion(gameContext);
  const timeLine = timeLineForQuestion(gameContext);
  const flavor = q.intro_flavor || (isRu ? "Подивимося." : "Подивимося.");

  return `ПОТОЧНА ФАЗА: БЕЗПЕРЕРВНИЙ ЗАХИЩЕНИЙ МОНОЛОГ.

Говори суворо у такому порядку:
1. Оголоси сектор номер ${gameContext.sector_number}.
2. Представ автора питання: ${q.character || "Невідомий персонаж"}.
3. Вимов дослівно: «${flavor}»
4. Скажи рівно: «${attention}»
5. Зачитай питання ДОСЛІВНО: «${questionText}»
6. Скажи рівно: «${timeLine}»
7. Одразу замовкни.

Не роби пауз для діалогу. Не переказуй питання своїми словами. Нічого не додавай після «${timeLine}».
Мова: ${isRu ? "російська" : "українська"}.
`;
}

export function buildQuestionReadPrompt(gameContext) {
  const q = gameContext.current_question || {};
  const questionText = q.question_text || "";
  const attention = attentionLineForQuestion(gameContext);
  const timeLine = timeLineForQuestion(gameContext);
  return `ПОТОЧНА ФАЗА: ЗАХИЩЕНИЙ МОНОЛОГ — ЗАЧИТУВАННЯ ПИТАННЯ.

Виконай суворо у такому порядку:
1. Скажи рівно: «${attention}»
2. Зачитай питання ДОСЛІВНО: «${questionText}»
3. Скажи рівно: «${timeLine}»
4. Одразу замовкни.

Не додавай прелюдію. Не переказуй питання. Нічого не додавай після «${timeLine}».
`;
}


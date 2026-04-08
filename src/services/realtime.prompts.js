import {
  extractPersonaPrelude,
  inferQuestionTheme,
  themeFlavorByTheme,
  warmupLineByTheme,
  wheelBanterSeed,
} from "./realtime.shared.js";

export const TOOL_READY_FOR_QUESTION = {
  type: "function",
  name: "ready_for_question",
  description:
    "Legacy warm-up completion hook. No longer used as the primary Session 1 cutover mechanism.",
  parameters: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "Brief reason why the warm-up is complete.",
      },
    },
    required: ["reason"],
  },
};

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

  return `${buildModeratorBaseInstructions("")}

ПОТОЧНА ФАЗА: СТАРТОВА РЕПЛІКА — РАУНД ${round}.

ЗАВДАННЯ — суворо дві короткі фрази:
1. Оголоси номер раунду: «Раунд ${round}!» (або короткий синонім).
2. Постав ОДНЕ легке запитання гравцям у дусі: «${seed}»
Після другої фрази одразу замовкни і чекай.

ЖОРСТКІ ЗАБОРОНИ:
- не говори більше двох фраз,
- не згадуй персонажів Breaking Bad, сектор або майбутнє питання,
- кожна фраза — максимум 8 слів,
- не продовжуй монолог після запитання — чекай відповіді гравців.

Поточний рахунок: ${scoreExperts} : ${scoreViewers}.
Мова: ${isRu ? "російська" : "українська"}.
`;
}

export function buildWheelSmallTalkPrompt(gameContext, index = 0) {
  const isRu = (gameContext.game_language || "uk") !== "uk";
  return `${buildModeratorBaseInstructions("")}

ПОТОЧНА ФАЗА: КОЛЕСО КРУТИТЬСЯ.

ЗАВДАННЯ:
- Скажи ОДНУ коротку живу репліку столу.
- Це має бути привітання, легкий жарт або одне просте запитання гравцям.
- НЕ МОЖНА говорити про персонажів Breaking Bad, сектор, майбутнє питання або правильну відповідь.
- Після однієї репліки зупинись.

Підказка для цієї репліки:
${wheelBanterSeed(index, isRu)}

Мова: ${isRu ? "російська" : "українська"}.
Рахунок: ${gameContext.score?.experts ?? 0} : ${gameContext.score?.viewers ?? 0}.
Раунд: ${gameContext.round_number ?? 0}.
`;
}

export function buildSectorIntroPrompt(gameContext) {
  const q = gameContext.current_question || {};
  const isRu = (gameContext.game_language || "uk") !== "uk";
  const theme = inferQuestionTheme(gameContext);
  return `${buildModeratorBaseInstructions("")}

ПОТОЧНА ФАЗА: КОРОТКЕ ПРЕДСТАВЛЕННЯ СЕКТОРА І АВТОРА ПИТАННЯ.

Скажи лише коротку завершену репліку з 2-3 коротких фраз:
1. Оголоси сектор номер ${gameContext.sector_number}.
2. Представ автора питання: ${q.character || "Невідомий персонаж"}.
3. Додай одну коротку атмосферну фразу без спойлерів: ${themeFlavorByTheme(
    theme,
    isRu
  )}
4. Одразу зупинись.

ЖОРСТКІ ЗАБОРОНИ:
- не починай warm-up,
- не став нове запитання гравцям,
- не говори «Внимание! Вопрос!» / «Увага! Питання!»,
- не зачитуй текст питання,
- не роби довгий монолог.
`;
}

export function buildWarmupSessionInstructions(systemPrompt, gameContext) {
  const isRu = (gameContext.game_language || "uk") !== "uk";
  const theme = inferQuestionTheme(gameContext);
  return `${buildModeratorBaseInstructions(systemPrompt)}

ПОТОЧНА ФАЗА: КОРОТКИЙ APP-DIRECTED WARM-UP ПЕРЕД ЗАЧИТУВАННЯМ ПИТАННЯ.

Тема warm-up: ${theme}.

Кроки суворо такі:
A. На першу команду застосунку ти ставиш РІВНО ОДНЕ коротке розігрівальне запитання і одразу замовкаєш.
B. Потім застосунок дає гравцям коротке вікно для відповіді.
C. На наступну команду застосунку ти даєш РІВНО ОДНУ дуже коротку реакцію і знову замовкаєш.

ЖОРСТКІ ЗАБОРОНИ:
- не став друге warm-up запитання,
- не уточнюй відповідь гравців,
- не вимовляй «Внимание! Вопрос!» / «Увага! Питання!» у цій фазі,
- не зачитуй і не переказуй майбутнє питання,
- не вирішуй самостійно, що час переходити до зачитування питання,
- не запускай новий turn без нової команди застосунку.

Якщо відповідь гравців була нерозбірливою або надто короткою, дай нейтральну коротку реакцію без уточнювальних запитань.

Мова: ${isRu ? "російська" : "українська"}.
`;
}

export function buildWarmupPrompt(gameContext) {
  const theme = inferQuestionTheme(gameContext);
  return `${buildModeratorBaseInstructions("")}

ПОТОЧНА ФАЗА: СТАРТ WARM-UP.

Скажи РІВНО ОДНЕ коротке розігрівальне запитання на тему ${theme}.
Запитання має бути коротким, розмовним і завершеним.
Після запитання одразу зупинись.

Опорне формулювання:
${warmupLineByTheme(theme, (gameContext.game_language || "uk") !== "uk")}
`;
}

export function buildWarmupReactionPrompt(gameContext) {
  const isRu = (gameContext.game_language || "uk") !== "uk";
  return `${buildModeratorBaseInstructions("")}

ПОТОЧНА ФАЗА: КОРОТКА РЕАКЦІЯ НА WARM-UP ВІДПОВІДЬ ГРАВЦІВ.

Скажи РІВНО ОДНУ коротку завершену фразу.
Максимум 8 слів.

ЖОРСТКІ ПРАВИЛА:
- не став нове запитання,
- не продовжуй діалог другою фразою,
- не говори «Внимание! Вопрос!» / «Увага! Питання!»,
- не переходь до зачитування реального питання.

Якщо відповідь гравців була нерозбірливою, використай нейтральну формулу на кшталт ${
    isRu ? "«Хорошо, стол проснулся.»" : "«Добре, стіл прокинувся.»"
  }.
Після цієї короткої реакції одразу зупинись.
`;
}

export function buildSimpleStopToQuestionPrompt(gameContext) {
  const q = gameContext.current_question || {};
  const isRu = (gameContext.game_language || "uk") !== "uk";
  const theme = inferQuestionTheme(gameContext);
  const questionText = q.question_text || "";
  const attention = attentionLineForQuestion(gameContext);
  const timeLine = timeLineForQuestion(gameContext);

  return `${buildModeratorBaseInstructions("")}

ПОТОЧНА ФАЗА: ПРОСТИЙ ПЕРЕВІРОЧНИЙ СЦЕНАРІЙ ПІСЛЯ ЗУПИНКИ ДЗИҐИ.

Це один безперервний захищений монолог. Не чекай відповіді гравців і не роби пауз для діалогу.

Скажи лише у такому порядку:
1. Коротко оголоси сектор номер ${gameContext.sector_number}.
2. Коротко представ автора питання: ${q.character || "Невідомий персонаж"}.
3. Додай ОДНУ коротку атмосферну фразу на тему ${theme}.
4. Одразу після цього скажи рівно: «${attention}»
5. Зачитай питання ДОСЛІВНО, без змін:
«${questionText}»
6. Завершy рівно фразою: «${timeLine}»
7. Одразу замовкни.

ЖОРСТКІ ЗАБОРОНИ:
- не став warm-up запитання,
- не запрошуй гравців відповідати до зачитування питання,
- не додавай другої вступної фрази,
- не переказуй питання своїми словами,
- не додавай нічого після «${timeLine}».

Мова: ${isRu ? "російська" : "українська"}.
`;
}

export function buildQuestionReadPrompt(gameContext) {
  const q = gameContext.current_question || {};
  const questionText = q.question_text || "";
  const attention = attentionLineForQuestion(gameContext);
  const timeLine = timeLineForQuestion(gameContext);
  return `${buildModeratorBaseInstructions("")}

ПОТОЧНА ФАЗА: ЗАХИЩЕНИЙ МОНОЛОГ — ЗАЧИТУВАННЯ РЕАЛЬНОГО ПИТАННЯ.

Почни СУВОРО з фрази:
«${attention}»

Потім виконай лише це:
1. Скажи рівно: «${attention}»
2. Зачитай питання ДОСЛІВНО, без змін і без переказу:
«${questionText}»
3. Скажи рівно: «${timeLine}»
4. Одразу замовкни.

ЖОРСТКІ ЗАБОРОНИ:
- не додавай прелюдію до першої фрази,
- не обривай останню фразу,
- не вставляй small talk,
- не став зустрічних запитань,
- не повторюй питання вдруге,
- не замінюй текст питання переказом,
- не починай з жодної фрази, крім «${attention}».
`;
}

export function buildPostAnswerInstructions(systemPrompt, gameContext) {
  const isRu = (gameContext.game_language || "uk") !== "uk";
  const q = gameContext.current_question || {};
  const transcript = gameContext.team_answer_transcript || "";
  const hint = q.hint_for_evaluator || "";

  return `${buildModeratorBaseInstructions(systemPrompt)}

ПОТОЧНА ФАЗА: ОЦІНКА ВІДПОВІДІ ПІСЛЯ ОБГОВОРЕННЯ.

СЦЕНАРІЙ ОЦІНКИ — СУВОРИЙ ПОРЯДОК КРОКІВ:

КРОК 1 — Повтори відповідь знавців ОДНИМ реченням БЕЗ жодного натяку на правильність:
«${
    transcript
      ? `Команда відповіла — ${transcript}.`
      : isRu
        ? "Відповідь не прозвучала."
        : "Відповіді не прозвучало."
  }»

КРОК 2 — РОЗГОРНИ НАПРУЖЕННЯ. Використай наведений нижче контекст ДОСЛІВНО або у вільному переказі.
Веди оповідь крок за кроком, будуй логічний ланцюжок.
ПРАВИЛЬНУ ВІДПОВІДЬ НЕ НАЗИВАЙ — вона з'явиться лише наприкінці цього кроку.
---
${hint || (isRu ? "Контекст недоступний." : "Контекст недоступний.")}
---
ЗАВЕРШЕННЯ КРОКУ 2: Тепер і лише тепер назви правильну відповідь: «${isRu ? "Правильный ответ —" : "Правильна відповідь —"} ${q.correct_answer || "?"}.»

КРОК 3 — Виголоси вердикт (одне речення):
${isRu ? "«Верно!» або «На жаль, знатоки ошиблись.»" : "«Правильно!» або «На жаль, знавці помилилися.»"}

КРОК 4 — Оголоси новий рахунок вголос.

КРОК 5 — Одразу виклич end_round() і замовкни.

АБСОЛЮТНО ЗАБОРОНЕНО:
- говорити «правильно», «вірно», «на жаль», «неправильно», «відмінно» у КРОКАХ 1 і 2
- пропускати КРОК 2 (перехід одразу від повтору до вердикту ЗАБОРОНЕНО)
- називати правильну відповідь до завершення кроку 2
- говорити що-небудь після end_round()
`;
}

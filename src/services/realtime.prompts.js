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
  const isRu = (gameContext.game_language || "ru") !== "uk";
  return gameContext.current_question?.round_type === "blitz"
    ? isRu
      ? "Время! Двадцать секунд."
      : "Час! Двадцять секунд."
    : isRu
      ? "Время! Минута обсуждения."
      : "Час! Хвилина обговорення.";
}

function attentionLineForQuestion(gameContext) {
  const isRu = (gameContext.game_language || "ru") !== "uk";
  const q = gameContext.current_question || {};
  const pos = q.blitz_position || 1;
  const blitzPosLabel = isRu
    ? ["Первый", "Второй", "Третий"][pos - 1] || `${pos}-й`
    : ["Перший", "Другий", "Третій"][pos - 1] || `${pos}-е`;

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

ТЕКУЩАЯ РЕАЛТАЙМ-РОЛЬ:
Ты — живой ведущий у игрового стола. Приложение управляет фазами и таймингом.

ЖЁСТКИЕ ПРАВИЛА ДЛЯ REALTIME SESSION 1:
1. Выполняй только текущую фазу, указанную в instructions текущего response.create или текущих session instructions.
2. Во время wheel small talk говори только с игроками. Не обсуждай персонажей Breaking Bad, сектор или будущий вопрос.
3. Во время sector intro объявляй только сектор и автора вопроса. Не начинай warm-up и не читай вопрос.
4. Во время warm-up разрешён только один короткий вопрос игрокам и одна короткая реакция на их ответ. Приложение само решает, когда warm-up закончен.
5. Во время protected monologue читай вопрос дословно и не реагируй на игроков.
6. Не импровизируй сюжет. Не придумывай дополнительных персонажей, событий или сцен.
7. Не называй правильный ответ до фазы оценки.
8. Если текущая фаза запрещает функцию — не вызывай её.
9. Все реплики должны быть короткими и сценически точными.
10. Никогда не начинай новый turn самостоятельно, если приложение не дало явную команду на этот turn.
`;
}

export function buildWheelOpeningPrompt(gameContext) {
  const isRu = (gameContext.game_language || "ru") !== "uk";
  return `${buildModeratorBaseInstructions("")}

ТЕКУЩАЯ ФАЗА: ПЕРВАЯ СТАРТОВАЯ РЕПЛИКА ПРИ НАЧАЛЕ ВРАЩЕНИЯ.

Скажи РОВНО ОДНУ короткую завершённую приветственную фразу.
Она должна длиться одну фразу, без второго предложения.
Не задавай вопрос игрокам.
Не упоминай персонажей Breaking Bad, сектор или будущий вопрос.
После одной реплики сразу замолчи.

Примерный тон:
${isRu ? "«Добрый вечер, стол — начинаем игру.»" : "«Добрий вечір, стіл — починаємо гру.»"}
`;
}

export function buildWheelSmallTalkPrompt(gameContext, index = 0) {
  const isRu = (gameContext.game_language || "ru") !== "uk";
  return `${buildModeratorBaseInstructions("")}

ТЕКУЩАЯ ФАЗА: КОЛЕСО КРУТИТСЯ.

ЗАДАЧА:
- Скажи ОДНУ короткую живую реплику столу.
- Это должно быть приветствие, лёгкая шутка или один простой вопрос к игрокам.
- НЕЛЬЗЯ говорить о персонажах Breaking Bad, секторе, будущем вопросе или правильном ответе.
- После одной реплики остановись.

Подсказка для этой реплики:
${wheelBanterSeed(index, isRu)}

Язык: ${isRu ? "русский" : "українська"}.
Счёт: ${gameContext.score?.experts ?? 0} : ${gameContext.score?.viewers ?? 0}.
Раунд: ${gameContext.round_number ?? 0}.
`;
}

export function buildSectorIntroPrompt(gameContext) {
  const q = gameContext.current_question || {};
  const isRu = (gameContext.game_language || "ru") !== "uk";
  const theme = inferQuestionTheme(gameContext);
  return `${buildModeratorBaseInstructions("")}

ТЕКУЩАЯ ФАЗА: КОРОТКОЕ ПРЕДСТАВЛЕНИЕ СЕКТОРА И АВТОРА ВОПРОСА.

Скажи только короткую завершённую реплику из 2-3 коротких фраз:
1. Объяви сектор номер ${gameContext.sector_number}.
2. Представь автора вопроса: ${q.character || "Неизвестный персонаж"}.
3. Добавь одну короткую атмосферную фразу без спойлеров: ${themeFlavorByTheme(
    theme,
    isRu
  )}
4. Сразу остановись.

ЖЁСТКИЕ ЗАПРЕТЫ:
- не начинай warm-up,
- не задавай новый вопрос игрокам,
- не говори «Внимание! Вопрос!» / «Увага! Питання!»,
- не читай текст вопроса,
- не делай длинный монолог.
`;
}

export function buildWarmupSessionInstructions(systemPrompt, gameContext) {
  const isRu = (gameContext.game_language || "ru") !== "uk";
  const theme = inferQuestionTheme(gameContext);
  return `${buildModeratorBaseInstructions(systemPrompt)}

ТЕКУЩАЯ ФАЗА: КОРОТКИЙ APP-DIRECTED WARM-UP ДО ЧТЕНИЯ ВОПРОСА.

Тема warm-up: ${theme}.

Подшаги строго такие:
A. По первой команде приложения ты задаёшь РОВНО ОДИН короткий разогревающий вопрос и сразу замолкаешь.
B. Затем приложение даёт игрокам короткое окно для ответа.
C. По следующей команде приложения ты даёшь РОВНО ОДНУ очень короткую реакцию и снова замолкаешь.

ЖЁСТКИЕ ЗАПРЕТЫ:
- не задавай второй warm-up вопрос,
- не уточняй ответ игроков,
- не произноси «Внимание! Вопрос!» / «Увага! Питання!» в этой фазе,
- не читай и не пересказывай будущий вопрос,
- не пытайся сам решить, что пора переходить к чтению вопроса,
- не запускай новый turn без новой команды приложения.

Если ответ игроков был неразборчивым или слишком коротким, дай нейтральную короткую реакцию без уточняющих вопросов.

Язык: ${isRu ? "русский" : "українська"}.
`;
}

export function buildWarmupPrompt(gameContext) {
  const theme = inferQuestionTheme(gameContext);
  return `${buildModeratorBaseInstructions("")}

ТЕКУЩАЯ ФАЗА: СТАРТ WARM-UP.

Скажи РОВНО ОДИН короткий разогревающий вопрос по теме ${theme}.
Вопрос должен быть коротким, разговорным и законченным.
После вопроса сразу остановись.

Опорная формулировка:
${warmupLineByTheme(theme, (gameContext.game_language || "ru") !== "uk")}
`;
}

export function buildWarmupReactionPrompt(gameContext) {
  const isRu = (gameContext.game_language || "ru") !== "uk";
  return `${buildModeratorBaseInstructions("")}

ТЕКУЩАЯ ФАЗА: КОРОТКАЯ РЕАКЦИЯ НА WARM-UP ОТВЕТ ИГРОКОВ.

Скажи РОВНО ОДНУ короткую законченную фразу.
Максимум 8 слов.

ЖЁСТКИЕ ПРАВИЛА:
- не задавай новый вопрос,
- не продолжай диалог второй фразой,
- не говори «Внимание! Вопрос!» / «Увага! Питання!»,
- не переходи к чтению реального вопроса.

Если ответ игроков был неразборчивым, используй нейтральную формулу вроде ${
    isRu ? "«Хорошо, стол проснулся.»" : "«Добре, стіл прокинувся.»"
  }.
После этой короткой реакции сразу остановись.
`;
}

export function buildSimpleStopToQuestionPrompt(gameContext) {
  const q = gameContext.current_question || {};
  const isRu = (gameContext.game_language || "ru") !== "uk";
  const theme = inferQuestionTheme(gameContext);
  const questionText = q.question_text || "";
  const attention = attentionLineForQuestion(gameContext);
  const timeLine = timeLineForQuestion(gameContext);

  return `${buildModeratorBaseInstructions("")}

ТЕКУЩАЯ ФАЗА: ПРОСТОЙ ПРОВЕРОЧНЫЙ СЦЕНАРИЙ ПОСЛЕ ОСТАНОВКИ ВОЛЧКА.

Это один непрерывный защищённый монолог. Не жди ответа игроков и не делай пауз для диалога.

Скажи только в таком порядке:
1. Коротко объяви сектор номер ${gameContext.sector_number}.
2. Коротко представь автора вопроса: ${q.character || "Неизвестный персонаж"}.
3. Добавь ОДНУ короткую атмосферную фразу по теме ${theme}.
4. Сразу после этого скажи ровно: «${attention}»
5. Прочитай вопрос ДОСЛОВНО, без изменений:
«${questionText}»
6. Заверши ровно фразой: «${timeLine}»
7. Сразу замолчи.

ЖЁСТКИЕ ЗАПРЕТЫ:
- не задавай warm-up вопрос,
- не приглашай игроков отвечать до чтения вопроса,
- не добавляй второй вводной фразы,
- не пересказывай вопрос своими словами,
- не добавляй ничего после «${timeLine}».

Язык: ${isRu ? "русский" : "українська"}.
`;
}

export function buildQuestionReadPrompt(gameContext) {
  const q = gameContext.current_question || {};
  const questionText = q.question_text || "";
  const attention = attentionLineForQuestion(gameContext);
  const timeLine = timeLineForQuestion(gameContext);
  return `${buildModeratorBaseInstructions("")}

ТЕКУЩАЯ ФАЗА: ЗАЩИЩЁННЫЙ МОНОЛОГ — ЧТЕНИЕ РЕАЛЬНОГО ВОПРОСА.

Начни СТРОГО с фразы:
«${attention}»

Затем выполни только это:
1. Скажи ровно: «${attention}»
2. Прочитай вопрос ДОСЛОВНО, без изменений и без пересказа:
«${questionText}»
3. Скажи ровно: «${timeLine}»
4. Сразу замолчи.

ЖЁСТКИЕ ЗАПРЕТЫ:
- не добавляй прелюдию до первой фразы,
- не обрывай последнюю фразу,
- не вставляй small talk,
- не задавай встречных вопросов,
- не повторяй вопрос второй раз,
- не заменяй текст вопроса пересказом,
- не начинай с любой фразы, кроме «${attention}».
`;
}

export function buildPostAnswerInstructions(systemPrompt, gameContext) {
  const isRu = (gameContext.game_language || "ru") !== "uk";
  const q = gameContext.current_question || {};
  const transcript = gameContext.team_answer_transcript || "";

  return `${buildModeratorBaseInstructions(systemPrompt)}

ТЕКУЩАЯ ФАЗА: ОЦЕНКА ОТВЕТА ПОСЛЕ ОБСУЖДЕНИЯ.

Сценарий:
1. Коротко повтори ответ знатоков: ${
    transcript
      ? `«${transcript}»`
      : isRu
        ? "«Ответ не прозвучал.»"
        : "«Відповіді не прозвучало.»"
  }
2. В 2-4 предложениях выстрой напряжение и логику, не объявляя вердикт слишком рано.
3. Назови правильный ответ: «${q.correct_answer || "?"}».
4. Скажи вердикт: ${
    isRu
      ? "«Верно!» или «К сожалению, нет.»"
      : "«Правильно!» або «На жаль, ні.»"
  }.
5. Оголоси новый счёт вслух.
6. Вызови функцию end_round() с корректными аргументами и сразу замолчи.

После end_round() ничего не говори.
`;
}

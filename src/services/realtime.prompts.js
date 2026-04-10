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
  const scoreExperts = gameContext.score?.experts ?? 0;
  const scoreViewers = gameContext.score?.viewers ?? 0;
  const players = gameContext.players || [];

  const isFirstRound = scoreExperts === 0 && scoreViewers === 0;
  const scoreDiff = scoreExperts - scoreViewers;
  const totalRoundsPlayed = scoreExperts + scoreViewers;

  // Precise game situation description — drives tone
  const situationHint = isRu
    ? (isFirstRound
        ? "Это ПЕРВЫЙ раунд — игра только начинается. Никаких прошлых раундов не было. Говори о начале, предвкушении, настрое."
        : scoreDiff >= 2
        ? `Знатоки ведут ${scoreExperts}:${scoreViewers}. Похвали команду — но не давай расслабляться.`
        : scoreDiff <= -2
        ? `Телезрители ведут ${scoreViewers}:${scoreExperts}. Поддержи знатоков — добавь тепла и веры в них.`
        : Math.max(scoreExperts, scoreViewers) >= 4
        ? `Счёт ${scoreExperts}:${scoreViewers} — развязка близко. Напряжение максимальное.`
        : `Счёт ${scoreExperts}:${scoreViewers}. Борьба идёт ровно — ${totalRoundsPlayed} ${totalRoundsPlayed === 1 ? "раунд" : "раунда"} позади.`)
    : (isFirstRound
        ? "Це ПЕРШИЙ раунд — гра тільки починається. Жодних попередніх раундів не було. Говори про початок, передчуття, налаштування."
        : scoreDiff >= 2
        ? `Знавці ведуть ${scoreExperts}:${scoreViewers}. Похвали команду — але не давай розслаблятись.`
        : scoreDiff <= -2
        ? `Телеглядачі ведуть ${scoreViewers}:${scoreExperts}. Підтримай знавців — додай тепла і впевненості в них.`
        : Math.max(scoreExperts, scoreViewers) >= 4
        ? `Рахунок ${scoreExperts}:${scoreViewers} — розв'язка близько. Напруга максимальна.`
        : `Рахунок ${scoreExperts}:${scoreViewers}. Боротьба йде рівно — ${totalRoundsPlayed} ${totalRoundsPlayed === 1 ? "раунд" : "раунди"} позаду.`);

  // Topic angle rotates by round — 7 distinct angles prevent repetition
  const angles = isRu ? [
    "Спроси о настроении и ожиданиях перед этим раундом.",
    "Обратись к конкретному игроку — упомяни его хобби или профессию, свяжи с игрой.",
    "Спроси, кто сегодня чувствует себя главным экспертом за столом.",
    "Спроси — лёгким будет этот вопрос или коварным, что думают?",
    "Обратись к конкретному игроку — спроси, как его профессиональный опыт помогает в игре.",
    "Спроси у команды — кто из них рискнёт отвечать первым сегодня.",
    "Лёгкая провокация: что сложнее — угадать тему или найти ответ?",
  ] : [
    "Запитай про настрій і очікування перед цим раундом.",
    "Звернись до конкретного гравця — згадай його хобі або професію, прив'яжи до гри.",
    "Запитай, хто сьогодні відчуває себе головним знавцем за столом.",
    "Запитай — легким буде це питання чи підступним, що думають?",
    "Звернись до конкретного гравця — запитай, як його фаховий досвід допомагає в грі.",
    "Запитай у команди — хто з них ризикне відповідати першим сьогодні.",
    "Легка провокація: що складніше — вгадати тему чи знайти відповідь?",
  ];

  const topicAngle = angles[(round - 1) % angles.length];

  const playerList = players.length > 0
    ? players.map((p, i) => {
        const hobbies = (p.hobbies || []).join(", ");
        return `${i + 1}. ${p.name}${p.profession ? ` (${p.profession})` : ""}${hobbies ? `, захоплення: ${hobbies}` : ""}`;
      }).join("\n")
    : (isRu ? "  (список игроков не задан)" : "  (список гравців не задано)");

  const firstRoundBan = isFirstRound
    ? (isRu
        ? "; НЕЛЬЗЯ упоминать «прошлый раунд», «предыдущий вопрос», «в прошлый раз»"
        : "; ЗАБОРОНЕНО згадувати «минулий раунд», «попереднє питання», «минулого разу»")
    : "";

  return `ПОТОЧНА ФАЗА: ЖИВА РОЗМОВА З ГРАВЦЯМИ — РАУНД ${round}.

ГРАВЦІ ЗА СТОЛОМ:
${playerList}

СИТУАЦІЯ: ${situationHint}
КУТ ЗАПИТАННЯ: ${topicAngle}

ЗАВДАННЯ:
1. Звернись або до ОДНОГО конкретного гравця (назви на ім'я), або до команди — залежно від кута запитання.
2. Постав ОДНЕ коротке живе запитання відповідно до кута. Можна з легким гумором. Разом не більше 2 речень.
3. Одразу замовкни і чекай відповіді.

Після відповіді гравця: скажи ОДНУ коротку реакцію (максимум 7 слів) — і замовкни назавжди.

СУВОРО ЗАБОРОНЕНО: більше двох реплік; згадувати персонажів Breaking Bad, сектор, майбутнє питання${firstRoundBan}.
Мова: ${isRu ? "російська" : "українська"}.
`;
}

export function buildWheelReactionPrompt(gameContext) {
  const isRu = (gameContext.game_language || "uk") !== "uk";
  return isRu
    ? `ПОТОЧНА ФАЗА: КОРОТКА РЕАКЦІЯ НА ВІДПОВІДЬ ГРАВЦЯ.

Скажи ОДНУ коротку живу фразу у відповідь на те, що щойно сказав гравець (максимум 8 слів). Можна з гумором або теплотою.
Після однієї фрази — одразу замовкни. Більше нічого не кажи.

ЗАБОРОНЕНО: розпочинати новий діалог; перепитувати; згадувати персонажів Breaking Bad, сектор, майбутнє питання.
Мова: російська.
`
    : `ПОТОЧНА ФАЗА: КОРОТКА РЕАКЦІЯ НА ВІДПОВІДЬ ГРАВЦЯ.

Скажи ОДНУ коротку живу фразу у відповідь на те, що щойно сказав гравець (максимум 8 слів). Можна з гумором або теплотою.
Після однієї фрази — одразу замовкни. Більше нічого не кажи.

ЗАБОРОНЕНО: розпочинати новий діалог; перепитувати; згадувати персонажів Breaking Bad, сектор, майбутнє питання.
Мова: українська.
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


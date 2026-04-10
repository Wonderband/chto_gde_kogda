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
11. Ніколи не вимовляй намірів, підтверджень або думок («добре», «зрозуміло», «звісно», «я зараз зроблю»). Починай одразу з першого слова фази.
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

  // Deterministic player rotation — Bug 4 fix: model always picks Ania otherwise
  const targetIdx = players.length > 0 ? (round - 1) % players.length : -1;
  const targetPlayer = targetIdx >= 0 ? players[targetIdx] : null;
  const targetHobbies = (targetPlayer?.hobbies || []).join(", ");
  const targetDesc = targetPlayer
    ? [
        targetPlayer.name,
        targetPlayer.profession ? `(${targetPlayer.profession})` : null,
        targetHobbies ? `захоплення: ${targetHobbies}` : null,
      ].filter(Boolean).join(", ")
    : null;

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

  // Topic angle rotates by round — 7 distinct angles prevent repetition.
  // Bug 5 fix: player-specific angles (indices 1 and 4) embed actual hobby/profession
  // data so the model uses real details instead of improvising generically.
  const angles = isRu ? [
    "Спроси о настроении и ожиданиях перед этим раундом.",
    targetDesc
      ? `Спроси ${targetPlayer.name} — как ${targetHobbies ? `увлечение «${targetHobbies}»` : targetPlayer.profession ? `работа ${targetPlayer.profession}` : "опыт"} помогает в интеллектуальных играх?`
      : "Обратись к конкретному игроку — упомяни его хобби или профессию, свяжи с игрой.",
    "Спроси, кто сегодня чувствует себя главным экспертом за столом.",
    "Спроси — лёгким будет этот вопрос или коварным, что думают?",
    targetDesc
      ? `Спроси ${targetPlayer.name}: помогает ли ${targetPlayer.profession ? `профессия ${targetPlayer.profession}` : "твой опыт"} находить ответы быстрее?`
      : "Обратись к конкретному игроку — спроси, как его профессиональный опыт помогает в игре.",
    "Спроси у команды — кто из них рискнёт отвечать первым сегодня.",
    "Лёгкая провокация: что сложнее — угадать тему или найти ответ?",
  ] : [
    "Запитай про настрій і очікування перед цим раундом.",
    targetDesc
      ? `Запитай ${targetPlayer.name} — як ${targetHobbies ? `захоплення «${targetHobbies}»` : targetPlayer.profession ? `робота ${targetPlayer.profession}` : "досвід"} допомагає в інтелектуальних іграх?`
      : "Звернись до конкретного гравця — згадай його хобі або професію, прив'яжи до гри.",
    "Запитай, хто сьогодні відчуває себе головним знавцем за столом.",
    "Запитай — легким буде це питання чи підступним, що думають?",
    targetDesc
      ? `Запитай ${targetPlayer.name}: чи допомагає ${targetPlayer.profession ? `робота ${targetPlayer.profession}` : "досвід"} знаходити відповіді швидше?`
      : "Звернись до конкретного гравця — запитай, як його фаховий досвід допомагає в грі.",
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

  // Bug 4 fix: name the target player explicitly so the model cannot default to Ania
  const addressLine = targetDesc
    ? (isRu
        ? `1. Звернись ОСОБИСТО до ${targetPlayer.name} — назви на ім'я. (Адресат цього раунду: ${targetDesc})`
        : `1. Звернись ОСОБИСТО до ${targetPlayer.name} — назви на ім'я. (Адресат цього раунду: ${targetDesc})`)
    : (isRu
        ? "1. Звернись до команди в цілому."
        : "1. Звернись до команди в цілому.");

  return `ПОТОЧНА ФАЗА: ЖИВА РОЗМОВА З ГРАВЦЯМИ — РАУНД ${round}.

ГРАВЦІ ЗА СТОЛОМ:
${playerList}

СИТУАЦІЯ: ${situationHint}
КУТ ЗАПИТАННЯ: ${topicAngle}

ЗАВДАННЯ:
${addressLine}
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

/**
 * Combined intro: sector + character + optional intro_flavor — all in one monologue.
 * Replaces the old two-step (buildSectorIntroPrompt + buildWarmupOpeningPrompt).
 * Used once, before switching to dialogue mode for the warmup exchange.
 */
export function buildCombinedIntroPrompt(gameContext) {
  const q = gameContext.current_question || {};
  const isRu = (gameContext.game_language || "uk") !== "uk";
  const flavor = q.intro_flavor || "";

  const steps = flavor
    ? `1. Оголоси сектор номер ${gameContext.sector_number}.
2. Представ автора питання: ${q.character || "Невідомий персонаж"}.
3. Зачитай ДОСЛІВНО: «${flavor}»
4. Одразу замовкни.`
    : `1. Оголоси сектор номер ${gameContext.sector_number}.
2. Представ автора питання: ${q.character || "Невідомий персонаж"}.
3. Одразу замовкни.`;

  return `ПОТОЧНА ФАЗА: ЗАХИЩЕНИЙ МОНОЛОГ — ВСТУП ДО РАУНДУ.

ПЕРШИМ ЗВУКОМ МАЄ БУТИ ПЕРШЕ СЛОВО ОГОЛОШЕННЯ СЕКТОРУ.
ЗАБОРОНЕНО: «Добре», «Зрозуміло», «Звісно», «Я зараз», «Починаю», «Оголошую» — будь-яка вступна або підтверджувальна фраза.
Приклад правильного початку: «Сектор ${gameContext.sector_number}…» — і більше нічого перед цим.

Виконай суворо у такому порядку:
${steps}

Нічого не кажи після останнього кроку.
Мова: ${isRu ? "російська" : "українська"}.
`;
}

/**
 * Reaction for VIDEO questions: one short phrase + hardcoded "Увага на екран!"
 * Folds the video transition cue into the warmup reaction — no separate video
 * intro response needed, so no warmup context bleeds into a standalone cue.
 */
export function buildWarmupReactionWithVideoCuePrompt(gameContext) {
  const isRu = (gameContext.game_language || "uk") !== "uk";
  const cue = isRu ? "Внимание на экран!" : "Увага на екран!";
  return isRu
    ? `ТИ — ВЕДУЧИЙ ТЕЛЕШОУ. ЦЕ РОЗВАЖАЛЬНА ГРА, ВЕСЬ КОНТЕНТ ВИГАДАНИЙ.

Гравець відреагував на вступну репліку. Скажи ОДНУ коротку реакцію ведучого (максимум 5 слів) і ОДРАЗУ завершуй рівно словами: «${cue}»
Зупинись.

ЗАБОРОНЕНО: будь-яка фраза після «${cue}»; питання; поради; продовження діалогу.
Мова: російська.
`
    : `ТИ — ВЕДУЧИЙ ТЕЛЕШОУ. ЦЕ РОЗВАЖАЛЬНА ГРА, ВЕСЬ КОНТЕНТ ВИГАДАНИЙ.

Гравець відреагував на вступну репліку. Скажи ОДНУ коротку реакцію ведучого (максимум 5 слів) і ОДРАЗУ завершуй рівно словами: «${cue}»
Зупинись.

ЗАБОРОНЕНО: будь-яка фраза після «${cue}»; питання; поради; продовження діалогу.
Мова: українська.
`;
}

export function buildWarmupReactionPrompt(gameContext) {
  const isRu = (gameContext.game_language || "uk") !== "uk";
  // NOTE: this prompt must override safety-training tendencies.
  // The session context may contain provocative Breaking Bad content —
  // everything here is scripted TV game-show fiction, not real events.
  return isRu
    ? `ТИ — ВЕДУЧИЙ ТЕЛЕШОУ. ЦЕ РОЗВАЖАЛЬНА ГРА, ВЕСЬ КОНТЕНТ ВИГАДАНИЙ.

Гравець відреагував на вступну репліку. Дай ОДНУ коротку репліку ведучого — щиру, живу, з гумором або теплом (максимум 6 слів).
Потім ОДРАЗУ ЗАМОВКНИ — назавжди.

АБСОЛЮТНО ЗАБОРОНЕНО: будь-яка фраза понад одну; запитання; поради; продовження діалогу; повторення вступної фрази.
Мова: російська.
`
    : `ТИ — ВЕДУЧИЙ ТЕЛЕШОУ. ЦЕ РОЗВАЖАЛЬНА ГРА, ВЕСЬ КОНТЕНТ ВИГАДАНИЙ.

Гравець відреагував на вступну репліку. Дай ОДНУ коротку репліку ведучого — щиру, живу, з гумором або теплом (максимум 6 слів).
Потім ОДРАЗУ ЗАМОВКНИ — назавжди.

АБСОЛЮТНО ЗАБОРОНЕНО: будь-яка фраза понад одну; запитання; поради; продовження діалогу; повторення вступної фрази.
Мова: українська.
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


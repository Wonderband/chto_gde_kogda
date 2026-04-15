import { extractPersonaPrelude, wheelBanterSeed } from "./realtime.shared.js";
import { timeLine, blitzPositionLabel } from "../game/gameText.js";

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

// Thin wrappers around shared gameText helpers — keep prompt-file API unchanged.
function timeLineForQuestion(gameContext) {
  const lang = gameContext.game_language || "uk";
  return timeLine(gameContext.current_question, lang);
}

function attentionLineForQuestion(gameContext) {
  const isRu = (gameContext.game_language || "uk") !== "uk";
  const q = gameContext.current_question || {};

  if (q.round_type !== "blitz") {
    return isRu ? "Внимание! Вопрос!" : "Увага! Питання!";
  }

  // All blitz positions use the same short cue — blitz rules are announced
  // once in buildCombinedIntroPrompt at the start of the round, not repeated here.
  const label = blitzPositionLabel(q.blitz_position || 1, isRu ? "ru" : "uk");
  return isRu ? `Внимание! ${label} вопрос!` : `Увага! ${label} питання!`;
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
      ]
        .filter(Boolean)
        .join(", ")
    : null;

  // Precise game situation description — drives tone
  const situationHint = isRu
    ? isFirstRound
      ? "Это ПЕРВЫЙ раунд — игра только начинается. Никаких прошлых раундов не было. Говори о начале, предвкушении, настрое."
      : scoreDiff >= 2
      ? `Знатоки ведут ${scoreExperts}:${scoreViewers}. Похвали команду — но не давай расслабляться.`
      : scoreDiff <= -2
      ? `Герои сериала ведут ${scoreViewers}:${scoreExperts}. Поддержи знатоков — добавь тепла и веры в них.`
      : Math.max(scoreExperts, scoreViewers) >= 4
      ? `Счёт ${scoreExperts}:${scoreViewers} — развязка близко. Напряжение максимальное.`
      : `Счёт ${scoreExperts}:${scoreViewers}. Борьба идёт ровно — ${totalRoundsPlayed} ${
          totalRoundsPlayed === 1 ? "раунд" : "раунда"
        } позади.`
    : isFirstRound
    ? "Це ПЕРШИЙ раунд — гра тільки починається. Жодних попередніх раундів не було. Говори про початок, передчуття, налаштування."
    : scoreDiff >= 2
    ? `Знавці ведуть ${scoreExperts}:${scoreViewers}. Похвали команду — але не давай розслаблятись.`
    : scoreDiff <= -2
    ? `Герої серіалу ведуть ${scoreViewers}:${scoreExperts}. Підтримай знавців — додай тепла і впевненості в них.`
    : Math.max(scoreExperts, scoreViewers) >= 4
    ? `Рахунок ${scoreExperts}:${scoreViewers} — розв'язка близько. Напруга максимальна.`
    : `Рахунок ${scoreExperts}:${scoreViewers}. Боротьба йде рівно — ${totalRoundsPlayed} ${
        totalRoundsPlayed === 1 ? "раунд" : "раунди"
      } позаду.`;

  // Topic angle rotates by round — 7 distinct angles prevent repetition.
  // Bug 5 fix: player-specific angles (indices 1 and 4) embed actual hobby/profession
  // data so the model uses real details instead of improvising generically.
  const angles = isRu
    ? [
        "Спроси о настроении и ожиданиях перед этим раундом.",
        targetDesc
          ? `Спроси ${targetPlayer.name} — как ${
              targetHobbies
                ? `увлечение «${targetHobbies}»`
                : targetPlayer.profession
                ? `работа ${targetPlayer.profession}`
                : "опыт"
            } помогает в интеллектуальных играх?`
          : "Обратись к конкретному игроку — упомяни его хобби или профессию, свяжи с игрой.",
        "Спроси, кто сегодня чувствует себя главным экспертом за столом.",
        "Спроси — лёгким будет этот вопрос или коварным, что думают?",
        targetDesc
          ? `Спроси ${targetPlayer.name}: помогает ли ${
              targetPlayer.profession
                ? `профессия ${targetPlayer.profession}`
                : "твой опыт"
            } находить ответы быстрее?`
          : "Обратись к конкретному игроку — спроси, как его профессиональный опыт помогает в игре.",
        "Спроси у команды — кто из них рискнёт отвечать первым сегодня.",
        "Лёгкая провокация: что сложнее — угадать тему или найти ответ?",
      ]
    : [
        "Запитай про настрій і очікування перед цим раундом.",
        targetDesc
          ? `Запитай ${targetPlayer.name} — як ${
              targetHobbies
                ? `захоплення «${targetHobbies}»`
                : targetPlayer.profession
                ? `робота ${targetPlayer.profession}`
                : "досвід"
            } допомагає в інтелектуальних іграх?`
          : "Звернись до конкретного гравця — згадай його хобі або професію, прив'яжи до гри.",
        "Запитай, хто сьогодні відчуває себе головним знавцем за столом.",
        "Запитай — легким буде це питання чи підступним, що думають?",
        targetDesc
          ? `Запитай ${targetPlayer.name}: чи допомагає ${
              targetPlayer.profession
                ? `робота ${targetPlayer.profession}`
                : "досвід"
            } знаходити відповіді швидше?`
          : "Звернись до конкретного гравця — запитай, як його фаховий досвід допомагає в грі.",
        "Запитай у команди — хто з них ризикне відповідати першим сьогодні.",
        "Легка провокація: що складніше — вгадати тему чи знайти відповідь?",
      ];

  const topicAngle = angles[(round - 1) % angles.length];

  const playerList =
    players.length > 0
      ? players
          .map((p, i) => {
            const hobbies = (p.hobbies || []).join(", ");
            return `${i + 1}. ${p.name}${
              p.profession ? ` (${p.profession})` : ""
            }${hobbies ? `, захоплення: ${hobbies}` : ""}`;
          })
          .join("\n")
      : isRu
      ? "  (список игроков не задан)"
      : "  (список гравців не задано)";

  const firstRoundBan = isFirstRound
    ? isRu
      ? "; НЕЛЬЗЯ упоминать «прошлый раунд», «предыдущий вопрос», «в прошлый раз»"
      : "; ЗАБОРОНЕНО згадувати «минулий раунд», «попереднє питання», «минулого разу»"
    : "";

  // Bug 4 fix: name the target player explicitly so the model cannot default to Ania
  const addressLine = targetDesc
    ? isRu
      ? `1. Звернись ОСОБИСТО до ${targetPlayer.name} — назви на ім'я. (Адресат цього раунду: ${targetDesc})`
      : `1. Звернись ОСОБИСТО до ${targetPlayer.name} — назви на ім'я. (Адресат цього раунду: ${targetDesc})`
    : isRu
    ? "1. Звернись до команди в цілому."
    : "1. Звернись до команди в цілому.";

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

export function buildWheelReactionPrompt(gameContext, transcript = null) {
  const isRu = (gameContext.game_language || "uk") !== "uk";
  const lang = isRu ? "російська" : "українська";

  const transcriptLine = transcript
    ? isRu
      ? `Игрок только что сказал: «${transcript}»\n\nОдна короткая реплика Ворошилова — иронично, точно, с характером. Зацепись за что-то конкретное из сказанного. Не повторяй слова дословно.`
      : `Гравець щойно сказав: «${transcript}»\n\nОдна коротка репліка Ворошилова — іронічно, точно, з характером. Зачепись за щось конкретне зі сказаного. НЕ повторюй слова дослівно.`
    : isRu
    ? "Одна короткая живая реплика Ворошилова. С характером, без банальностей."
    : "Одна коротка жива репліка Ворошилова. З характером, без банальностей.";

  return `ПОТОЧНА ФАЗА: РЕПЛІКА-РЕАКЦІЯ — ПОТІМ ТИША.

${transcriptLine}

Після реакції — ПОВНА ТИША.

АБСОЛЮТНО ЗАБОРОНЕНО:
- Нові запитання, що вимагають відповіді
- Порожні фрази без зв'язку зі сказаним: «цікаво», «ого», «добре», «це цікава історія», «бажаю успіху», «вперед», «дякую», «так-так», «розумію»
- Більше однієї фрази
- Згадувати персонажів Breaking Bad, сектор, майбутнє питання
Мова: ${lang}.
`;
}

export function buildWheelSmallTalkPrompt(gameContext, index = 0) {
  const isRu = (gameContext.game_language || "uk") !== "uk";
  return `ПОТОЧНА ФАЗА: КОЛЕСО КРУТИТЬСЯ.

Скажи ОДНУ коротку живу репліку столу — привітання, легкий жарт або просте запитання.
Підказка: ${wheelBanterSeed(index, isRu)}
Після однієї репліки зупинись. Не згадуй персонажів, сектор або майбутнє питання.

Мова: ${isRu ? "російська" : "українська"}. Рахунок: ${
    gameContext.score?.experts ?? 0
  } : ${gameContext.score?.viewers ?? 0}.
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
  const isBlackBox = q.round_type === "black_box";
  const isBlitz = q.round_type === "blitz";
  const blackBoxCue = isRu ? "Внимание, чёрный ящик!" : "Увага, чорний ящик!";
  const character =
    q.character || (isRu ? "Неизвестный персонаж" : "Невідомий персонаж");

  // ── Blitz: announce sector + blitz rules once, then introduce character ──
  // The "three questions, 20 seconds each" announcement lives here — NOT in the
  // attention cue — so it is said exactly once, at the very start of the round.
  if (isBlitz) {
    const blitzRules = isRu
      ? `Сектор ${gameContext.sector_number}. Сектор Блиц! Три вопроса. Двадцять секунд на каждый.`
      : `Сектор ${gameContext.sector_number}. Сектор Бліц! Три питання. Двадцять секунд на кожне.`;

    if (flavor) {
      return `ПОТОЧНА ФАЗА: ЗАХИЩЕНИЙ МОНОЛОГ — ВСТУП ДО БЛИЦ-РАУНДУ.

ПЕРШИМ ЗВУКОМ МАЄ БУТИ «Сектор ${gameContext.sector_number}».
ЗАБОРОНЕНО: будь-яка вступна фраза перед «Сектор».

Виконай суворо у такому порядку:
1. Скажи РІВНО: «${blitzRules}»
2. В ОДНІЙ короткій фразі представ ${character} — театрально, в дусі Ворошилова.
3. Зачитай ДОСЛІВНО: «${flavor}»

Після третього пункту одразу замовкни.
Разом: фіксована фраза + 1 речення від себе + дослівна репліка. Мова: ${
        isRu ? "російська" : "українська"
      }.
`;
    }

    return `ПОТОЧНА ФАЗА: ЗАХИЩЕНИЙ МОНОЛОГ — ВСТУП ДО БЛИЦ-РАУНДУ.

ПЕРШИМ ЗВУКОМ МАЄ БУТИ «Сектор ${gameContext.sector_number}».
ЗАБОРОНЕНО: будь-яка вступна фраза перед «Сектор».

Виконай суворо у такому порядку:
1. Скажи РІВНО: «${blitzRules}»
2. В ОДНІЙ короткій фразі представ ${character} — театрально, в дусі Ворошилова.

Після другого пункту одразу замовкни.
Разом: фіксована фраза + 1 речення від себе. Мова: ${
      isRu ? "російська" : "українська"
    }.
`;
  }

  if (isBlackBox) {
    // Black box: must end with exact cue phrase; intro_flavor is read AFTER music.
    return `ПОТОЧНА ФАЗА: ЗАХИЩЕНИЙ МОНОЛОГ — ВСТУП ДО РАУНДУ.

ПЕРШИМ ЗВУКОМ МАЄ БУТИ «Сектор ${gameContext.sector_number}».
ЗАБОРОНЕНО: будь-яка вступна фраза перед «Сектор».

Оголоси сектор і в ОДНІЙ короткій фразі представ ${character} — театрально, в дусі Ворошилова.
Наприкінці скажи РІВНО: «${blackBoxCue}» — і замовкни.

Разом: максимум 2 речення. Мова: ${isRu ? "російська" : "українська"}.
`;
  }

  if (flavor) {
    return `ПОТОЧНА ФАЗА: ЗАХИЩЕНИЙ МОНОЛОГ — ВСТУП ДО РАУНДУ.

ПЕРШИМ ЗВУКОМ МАЄ БУТИ «Сектор ${gameContext.sector_number}».
ЗАБОРОНЕНО: будь-яка вступна фраза перед «Сектор».

Оголоси сектор і в ОДНІЙ короткій фразі представ ${character} — театрально, в дусі Ворошилова.
Потім зачитай ДОСЛІВНО: «${flavor}»
Після цього одразу замовкни.

Разом: 1 коротке речення від себе + дослівна репліка. Мова: ${
      isRu ? "російська" : "українська"
    }.
`;
  }

  return `ПОТОЧНА ФАЗА: ЗАХИЩЕНИЙ МОНОЛОГ — ВСТУП ДО РАУНДУ.

ПЕРШИМ ЗВУКОМ МАЄ БУТИ «Сектор ${gameContext.sector_number}».
ЗАБОРОНЕНО: будь-яка вступна фраза перед «Сектор».

Оголоси сектор і в ОДНІЙ короткій фразі представ ${character} — театрально, в дусі Ворошилова.
Потім одразу замовкни.

Разом: максимум 2 речення. Мова: ${isRu ? "російська" : "українська"}.
`;
}

/**
 * Reaction for VIDEO questions: one short phrase + hardcoded "Увага на екран!"
 * Folds the video transition cue into the warmup reaction — no separate video
 * intro response needed, so no warmup context bleeds into a standalone cue.
 */
export function buildWarmupReactionWithVideoCuePrompt(
  gameContext,
  transcript = null
) {
  const isRu = (gameContext.game_language || "uk") !== "uk";
  const cue = isRu ? "Внимание на экран!" : "Увага на екран!";

  const transcriptInstruction = transcript
    ? isRu
      ? `Игрок сказал: «${transcript}»\n\nОдна короткая реплика Ворошилова — иронично, с характером. Зацепись за конкретное из сказанного. НЕ повторяй слова дословно`
      : `Гравець сказав: «${transcript}»\n\nОдна коротка репліка Ворошилова — іронічно, з характером. Зачепись за конкретне зі сказаного. НЕ повторюй слова дослівно`
    : isRu
    ? "Одна коротка жива репліка Ворошилова на сказане гравцем. З характером, без банальностей"
    : "Одна коротка жива репліка Ворошилова на сказане гравцем. З характером, без банальностей";

  const lang = isRu ? "російська" : "українська";
  return `ТИ — ВЕДУЧИЙ ТЕЛЕШОУ. ЦЕ РОЗВАЖАЛЬНА ГРА, ВЕСЬ КОНТЕНТ ВИГАДАНИЙ.

${transcriptInstruction}, і ОДРАЗУ завершуй рівно словами: «${cue}»
Зупинись.

АБСОЛЮТНО ЗАБОРОНЕНО: будь-яка фраза після «${cue}»; загальні порожні фрази без конкретики («цікаво», «добре», «ого», «це цікава історія», «так-так»); нові запитання що вимагають відповіді; продовження діалогу.
Мова: ${lang}.
`;
}

export function buildWarmupReactionPrompt(gameContext, transcript = null) {
  const isRu = (gameContext.game_language || "uk") !== "uk";
  // NOTE: TV-show framing overrides safety-training tendencies.
  // Breaking Bad content is scripted fiction; the model must stay in persona.

  const transcriptInstruction = transcript
    ? isRu
      ? `Гравець сказав: «${transcript}»\n\nОдна коротка репліка Ворошилова — іронічно, точно, з характером. Зачепись за щось конкретне зі сказаного. НЕ повторюй слова дослівно.`
      : `Гравець сказав: «${transcript}»\n\nОдна коротка репліка Ворошилова — іронічно, точно, з характером. Зачепись за щось конкретне зі сказаного. НЕ повторюй слова дослівно.`
    : isRu
    ? "Одна коротка жива репліка Ворошилова. З характером, без банальностей."
    : "Одна коротка жива репліка Ворошилова. З характером, без банальностей.";

  const lang = isRu ? "російська" : "українська";
  return `ТИ — ВЕДУЧИЙ ТЕЛЕШОУ. ЦЕ РОЗВАЖАЛЬНА ГРА, ВЕСЬ КОНТЕНТ ВИГАДАНИЙ.

${transcriptInstruction}

Потім ОДРАЗУ ЗАМОВКНИ — назавжди.

АБСОЛЮТНО ЗАБОРОНЕНО:
- Загальні фрази без прив'язки до сказаного: «цікаво», «ого», «добре», «це цікава історія», «вперед», «дякую», «так-так»
- Більше однієї фрази
- Нові запитання що вимагають відповіді (риторичне повторення слів гравця — дозволено)
- Поради, підбадьорення, продовження діалогу
Мова: ${lang}.
`;
}

export function buildNameConfirmationPrompt(
  gameContext = {},
  transcript = null
) {
  const ru = (gameContext.game_language || "uk") !== "uk";
  const fallback = ru ? "Слушаем вас!" : "Слухаємо вас!";
  const lang = ru ? "російська" : "українська";

  if (!transcript) {
    return `ПОТОЧНА ФАЗА: ПІДТВЕРДЖЕННЯ ВІДПОВІДАЧА.
Скажи РІВНО: «${fallback}»
Більше нічого не кажи.`;
  }

  const template = ru
    ? `«Слушаем вас, [господин/пани] [имя в нужной форме обращения]!»`
    : `«Слухаємо вас, [пані/пане] [ім'я у кличному відмінку]!»`;

  return `ПОТОЧНА ФАЗА: ПІДТВЕРДЖЕННЯ ВІДПОВІДАЧА.

Капітан щойно сказав: «${transcript}»

Витягни ім'я відповідача зі сказаного і скажи РІВНО одну фразу за шаблоном:
${template}

Якщо ім'я не розпізнано — скажи: «${fallback}»

ЖОРСТКО ЗАБОРОНЕНО: будь-які інші слова крім шаблону; повторення питання; коментарі; друга фраза.
Мова: ${lang}.`;
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
  return `ПОПЕРЕДНІЙ ДІАЛОГ ЗАВЕРШЕНО. Ти більше НЕ в розмові з гравцем — будь-який попередній обмін репліками не має значення і НЕ повинен впливати на наступну репліку.

ПОТОЧНА ФАЗА: ЗАХИЩЕНИЙ МОНОЛОГ — ЗАЧИТУВАННЯ ПИТАННЯ З КОНВЕРТА.

Виконай суворо у такому порядку:
1. Скажи рівно: «${attention}»
2. Зачитай питання ДОСЛІВНО: «${questionText}»
3. Скажи рівно: «${timeLine}»
4. Одразу замовкни.

ЗАБОРОНЕНО: продовжувати попередню розмову; реагувати на те, що сказав гравець; давати поради чи коментарі; додавати будь-що крім зазначеного тексту.
`;
}

/**
 * Attention-only cue — first half of the split question read.
 * Says only the attention line (e.g. "Увага! Питання!") then goes silent.
 * App plays gong after this completes, then sends buildQuestionBodyPrompt.
 */
/**
 * Black box warmup opening — spoken AFTER black_box.mp3 finishes.
 * Reads intro_flavor verbatim as a live question to players, then goes silent
 * and waits for a response. Reaction is handled by buildWarmupReactionWithVideoCuePrompt.
 */
export function buildBlackBoxWarmupOpeningPrompt(gameContext) {
  const q = gameContext.current_question || {};
  const isRu = (gameContext.game_language || "uk") !== "uk";
  const flavor =
    q.intro_flavor || (isRu ? "Итак, что думаете?" : "Отже, що думаєте?");

  return `ПОТОЧНА ФАЗА: ЖИВИЙ ДІАЛОГ З ГРАВЦЯМИ ПІСЛЯ ЧОРНОГО ЯЩИКА.

ПЕРШИМ ЗВУКОМ МАЄ БУТИ ПЕРШЕ СЛОВО ПИТАННЯ.
ЗАБОРОНЕНО: будь-яка вступна фраза перед питанням.

Зачитай ДОСЛІВНО: «${flavor}»

Одразу замовкни і чекай відповіді гравця. Нічого не додавай.
Мова: ${isRu ? "російська" : "українська"}.
`;
}

export function buildAttentionCuePrompt(gameContext) {
  const attention = attentionLineForQuestion(gameContext);
  return `ПОПЕРЕДНІЙ ДІАЛОГ ЗАВЕРШЕНО. Ти більше НЕ в розмові з гравцями. Будь-який попередній обмін репліками не має значення і НЕ повинен впливати на цю репліку.

ПОТОЧНА ФАЗА: ОДНА РЕПЛІКА — УВАГА.

ПЕРШИМ ЗВУКОМ МАЄ БУТИ ПЕРШЕ СЛОВО ОГОЛОШЕННЯ.
ЗАБОРОНЕНО: продовжувати попередню розмову. ЗАБОРОНЕНО: будь-яка вступна або підтверджувальна фраза.

Скажи РІВНО: «${attention}»

Одразу замовкни. Нічого не кажи після цієї фрази.
`;
}

/**
 * Question body — second half of the split question read (after gong).
 * Reads question verbatim + time line, then silence.
 */
export function buildQuestionBodyPrompt(gameContext) {
  const q = gameContext.current_question || {};
  const questionText = q.question_text || "";
  const timeLine = timeLineForQuestion(gameContext);
  return `ПОПЕРЕДНІЙ ДІАЛОГ ЗАВЕРШЕНО. Ти більше НЕ в розмові з гравцями. Жоден попередній обмін репліками не має значення.

ПОТОЧНА ФАЗА: ЗАХИЩЕНИЙ МОНОЛОГ — ЗАЧИТУВАННЯ ТЕКСТУ ПИТАННЯ.

ПЕРШИМ ЗВУКОМ МАЄ БУТИ ПЕРШЕ СЛОВО ПИТАННЯ — без жодного вступного слова.
ЗАБОРОНЕНО: «Добре», «Зрозуміло», «Отже», «Слухайте», будь-яка вступна фраза, продовження попередньої розмови.

Виконай суворо у такому порядку:
1. Зачитай питання ДОСЛІВНО: «${questionText}»
2. Скажи рівно: «${timeLine}»
3. Одразу замовкни.
`;
}

// ─── Video question cues ──────────────────────────────────────────────────────

/**
 * Prompt spoken right before the video plays for a video question.
 * One short phrase directing attention to the screen, then silence.
 * (Was in realtime.session1.js — moved here so all prompts are in one file.)
 */
export function buildWatchScreenPrompt(gameContext) {
  const isRu = (gameContext?.game_language || "uk") !== "uk";
  const q = gameContext?.current_question || {};
  const pos = q.blitz_position || 1;

  if (q.round_type === "blitz") {
    const posLabel = isRu
      ? ["Первый", "Второй", "Третий"][pos - 1] || `${pos}-й`
      : ["Перше", "Друге", "Третє"][pos - 1] || `${pos}-е`;
    return isRu
      ? `ПОТОЧНА ФАЗА: ПЕРЕД ВІДЕОПИТАННЯМ. Скажи рівно одну коротку фразу: «Внимание на экран. ${posLabel} вопрос.» Після цього одразу замовкни.`
      : `ПОТОЧНА ФАЗА: ПЕРЕД ВІДЕОПИТАННЯМ. Скажи рівно одну коротку фразу: «Увага на екран. ${posLabel} питання.» Після цього одразу замовкни.`;
  }

  return isRu
    ? "ПОТОЧНА ФАЗА: ПЕРЕД ВІДЕОПИТАННЯМ. Скажи рівно одну коротку фразу: «А теперь — внимание на экран.» Після цього одразу замовкни."
    : "ПОТОЧНА ФАЗА: ПЕРЕД ВІДЕОПИТАННЯМ. Скажи рівно одну коротку фразу: «А тепер — увага на екран.» Після цього одразу замовкни.";
}

/**
 * Prompt spoken after a video question ends, launching the discussion timer.
 * One short phrase with the time cue, then silence.
 * (Was in realtime.session1.js — moved here so all prompts are in one file.)
 */
export function buildTimeCuePrompt(gameContext) {
  const isRu = (gameContext?.game_language || "uk") !== "uk";
  const isBlitz = gameContext?.current_question?.round_type === "blitz";
  const line = isBlitz
    ? isRu
      ? "Время! Двадцать секунд!"
      : "Час! Двадцять секунд!"
    : isRu
    ? "Время! Минута обсуждения!"
    : "Час! Хвилина обговорення!";
  return `ПОТОЧНА ФАЗА: ЗАПУСК ОБГОВОРЕННЯ ПІСЛЯ ВІДЕОПИТАННЯ. Скажи рівно одну коротку фразу: «${line}» Після цього одразу замовкни.`;
}

// ─── Listening cue ────────────────────────────────────────────────────────────

/**
 * Prompt for announcing end-of-discussion / early-answer.
 * One phrase asking who will answer, then silence.
 * (Was in realtime.session2.js — moved here so all prompts are in one file.)
 */
export function buildListeningCuePrompt(gameContext = {}, earlyAnswer = false) {
  const isRu = (gameContext.game_language || "uk") !== "uk";
  const line = earlyAnswer
    ? isRu
      ? "Досрочный ответ. Кто будет отвечать?"
      : "Дострокова відповідь. Хто відповідатиме?"
    : isRu
    ? "Время вышло. Кто будет отвечать?"
    : "Час вийшов. Хто відповідатиме?";
  return `ПОТОЧНА ФАЗА: КОРОТКА РЕПЛІКА ПЕРЕД ЗАПИСОМ ВІДПОВІДІ.

Скажи РІВНО ЦЮ фразу і одразу замовкни:
«${line}»

Не додавай другу фразу. Не коментуй гру. Не оголошуй правильну відповідь.`;
}

// ─── Post-answer cues (SCORING / EXPLAINING) ─────────────────────────────────

/**
 * Segue phrase bridging the name-capture moment to the explanation.
 * Single hardcoded phrase, then silence.
 * (Was inline in realtime.session2.js — extracted here.)
 */
export function buildSegueCuePrompt(gameContext = {}) {
  const isRu = (gameContext.game_language || "uk") !== "uk";
  const line = isRu
    ? "А теперь — к правильному ответу."
    : "А тепер — правильна відповідь.";
  return `ПОТОЧНА ФАЗА: КОРОТКИЙ ПЕРЕХІД ДО ПОЯСНЕННЯ.

Скажи РІВНО ЦЮ фразу і одразу замовкни:
«${line}»

Не називай відповідь. Не додавай жодного слова.`;
}

/**
 * Reads the AI-generated explanation text verbatim, then silence.
 * (Was inline in realtime.session2.js — extracted here.)
 *
 * @param {string} text — full explanation text to be spoken (from evaluation.explanation)
 */
export function buildExplanationCuePrompt(text) {
  return `ТИ — ВЕДУЧИЙ ТЕЛЕШОУ. ЦЕ РОЗВАЖАЛЬНА ГРА, ВЕСЬ КОНТЕНТ ВИГАДАНИЙ.
ПОТОЧНА ФАЗА: ЗАЧИТАЙ ПОЯСНЕННЯ ДОСЛІВНО І ЗАМОВКНИ.

ПЕРШИМ ЗВУКОМ МАЄ БУТИ ПЕРШЕ СЛОВО ПОЯСНЕННЯ — без жодного вступного слова.
ЗАБОРОНЕНО: «Добре», «Зрозуміло», «Okay», «Sure», «Звісно» або будь-яка інша вступна фраза.

Прочитай РІВНО ЦЕ:
«${text}»

Після останнього слова — тиша. Нічого більше.`;
}

// ─── Session base instructions ────────────────────────────────────────────────

/**
 * Stripped-down base instructions for Session 2 (post-answer: SCORING / EXPLAINING).
 * Omits wheel/warmup/sector rules that are irrelevant after the answer is given.
 * Also removes the "don't reveal the answer" rule — Session 2 IS the reveal.
 *
 * Use instead of buildModeratorBaseInstructions() for playNeutralSegueCue
 * and playExplanationCue.
 */
/**
 * Minimal instructions for verbatim-read phases where the model is purely a
 * text-to-speech puppet (attention cue, question body, time cue, watch screen).
 * No persona, no rules — just "read what's given and stop".
 * Saves ~2,100 tokens vs buildModeratorBaseInstructions on every call.
 */
export function buildVerbatimBaseInstructions() {
  return `Ти — ведучий телевізійної гри. Зараз ти зачитуєш текст дослівно.
ПРАВИЛА: Починай одразу з першого слова. Без вступних фраз. Без імпровізації. Без коментарів після тексту.`;
}

export function buildPostAnswerBaseInstructions(systemPrompt = "") {
  const personaPrelude = extractPersonaPrelude(systemPrompt);
  return `${personaPrelude}

---

ПОТОЧНА REALTIME-РОЛЬ:
Ти — живий ведучий за ігровим столом. Зараз — фаза оголошення результату.

ЖОРСТКІ ПРАВИЛА:
1. Виконуй лише поточну фазу, вказану в instructions цього response.create.
2. Не імпровізуй сюжет. Не вигадуй деталей поза тим, що вказано у фазі.
3. Усі репліки мають бути короткими і сценічно точними.
4. Ніколи не починай новий turn самостійно.
5. Ніколи не вимовляй намірів або підтверджень («добре», «зрозуміло», «звісно»). Починай одразу з першого слова фази.
`;
}

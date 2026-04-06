import { buildModeratorBaseInstructions } from "./realtime.prompts.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRu(gameContext = {}) {
  return (gameContext.game_language || "ru") !== "uk";
}

function buildListeningCuePrompt(gameContext = {}, earlyAnswer = false) {
  const ru = isRu(gameContext);
  const line = earlyAnswer
    ? ru
      ? "Досрочный ответ. Кто будет отвечать?"
      : "Дострокова відповідь. Хто відповідатиме?"
    : ru
      ? "Время вышло. Кто будет отвечать?"
      : "Час вийшов. Хто відповідатиме?";

  return `${buildModeratorBaseInstructions("")}

ТЕКУЩАЯ ФАЗА: КОРОТКАЯ ЗАЩИЩЁННАЯ РЕПЛИКА ПЕРЕД ЗАПИСЬЮ ОТВЕТА.

Скажи РОВНО ЭТУ фразу и сразу замолчи:
«${line}»

ЖЁСТКИЕ ЗАПРЕТЫ:
- не добавляй вторую фразу,
- не комментируй игру,
- не объявляй правильный ответ,
- не задавай уточняющих вопросов.`;
}

function buildVerdictCuePrompt(gameContext = {}, evaluation = {}) {
  const fallback = isRu(gameContext)
    ? "Ответ принят."
    : "Відповідь прийнято.";
  const phrase = (evaluation?.moderator_phrase || fallback).trim();

  return `${buildModeratorBaseInstructions("")}

ТЕКУЩАЯ ФАЗА: КОРОТКИЙ ЗАЩИЩЁННЫЙ ВЕРДИКТ ПОСЛЕ ОЦЕНКИ.

Скажи РОВНО ЭТУ фразу и сразу замолчи:
«${phrase}»

ЖЁСТКИЕ ЗАПРЕТЫ:
- не добавляй новый комментарий,
- не меняй смысл фразы,
- не задавай вопросов,
- не начинай следующий раунд.`;
}

async function waitForCompletedSpokenTurn(
  session,
  responseId,
  stage,
  timeoutMs = 30000
) {
  const done = await session.waitForResponseDone(responseId, timeoutMs);
  const status = done?.response?.status || "";
  const reason = done?.response?.status_details?.reason || "";
  console.log(`[Realtime][Session2] ${stage} response.done`, {
    responseId,
    status,
    reason,
  });

  await session.waitForAudioStopped(responseId, timeoutMs);
  console.log(`[Realtime][Session2] ${stage} output audio stopped`, {
    responseId,
    status,
    reason,
  });

  await delay(250);
  console.log(`[Realtime][Session2] ${stage} grace tail complete`, {
    responseId,
  });

  if (status !== "completed") {
    throw new Error(
      `${stage} did not complete cleanly (status=${status}, reason=${reason || ""})`
    );
  }
}

export async function playListeningCue({
  session,
  systemPrompt,
  gameContext,
  earlyAnswer = false,
}) {
  await session.setMonologueMode({
    tools: [],
    instructions: buildModeratorBaseInstructions(systemPrompt),
  });

  const created = await session.createResponse({
    instructions: buildListeningCuePrompt(gameContext, earlyAnswer),
    tools: [],
    outputModalities: ["audio"],
    metadata: { stage: earlyAnswer ? "early_answer_cue" : "time_over_cue" },
    maxOutputTokens: 220,
  });

  console.log("[Realtime][Session2] listening cue response created", {
    responseId: created.responseId,
    earlyAnswer,
  });

  await waitForCompletedSpokenTurn(
    session,
    created.responseId,
    earlyAnswer ? "early answer cue" : "time over cue",
    30000
  );
}

export async function playVerdictCue({
  session,
  systemPrompt,
  gameContext,
  evaluation,
}) {
  await session.setMonologueMode({
    tools: [],
    instructions: buildModeratorBaseInstructions(systemPrompt),
  });

  const created = await session.createResponse({
    instructions: buildVerdictCuePrompt(gameContext, evaluation),
    tools: [],
    outputModalities: ["audio"],
    metadata: { stage: "session2_verdict" },
    maxOutputTokens: 320,
  });

  console.log("[Realtime][Session2] verdict response created", {
    responseId: created.responseId,
  });

  await waitForCompletedSpokenTurn(
    session,
    created.responseId,
    "verdict cue",
    30000
  );
}

export async function evaluateSessionTwo({
  buildCtx,
  state,
  currentQuestion,
  evaluateAnswerFn,
}) {
  const gameContext = buildCtx({
    team_answer_transcript: state.transcript,
    early_answer: state.earlyAnswer,
  });

  const { evaluation, responseId } = await evaluateAnswerFn(gameContext, null);

  const correct = evaluation?.correct ?? false;
  return {
    responseId,
    evaluation: {
      ...evaluation,
      correct,
      score_delta: evaluation?.score_delta ?? 1,
      who_scores: evaluation?.who_scores ?? (correct ? "experts" : "viewers"),
      moderator_phrase:
        evaluation?.moderator_phrase ||
        (correct
          ? "Ответ принят. Знатоки получают очко."
          : "Ответ не принят. Очко получает телезритель."),
      correct_answer_reveal:
        evaluation?.correct_answer_reveal ?? currentQuestion?.answer ?? "?",
    },
  };
}

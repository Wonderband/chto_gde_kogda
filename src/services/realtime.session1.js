import { delay } from "./realtime.shared.js";
import { TOKENS } from "../config.js";
import {
  buildModeratorBaseInstructions,
  buildWheelOpeningPrompt,
  buildSectorIntroPrompt,
  buildQuestionReadPrompt,
} from "./realtime.prompts.js";

function getResponseStatus(doneEvent) {
  return doneEvent?.response?.status || "unknown";
}

function getStatusReason(doneEvent) {
  return (
    doneEvent?.response?.status_details?.reason ||
    doneEvent?.response?.status_details?.error?.message ||
    ""
  );
}

function isVideoQuestion(gameContext) {
  const q = gameContext?.current_question || {};
  return q.presentation_mode === "video" && !!q.video_src;
}

function buildWatchScreenPrompt(gameContext) {
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

function buildTimeCuePrompt(gameContext) {
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

async function waitForCompletedSpokenTurn(session, responseId, label) {
  const doneEvent = await session.waitForResponseDone(responseId, 60000);
  const status = getResponseStatus(doneEvent);
  const reason = getStatusReason(doneEvent);

  console.log(`[Realtime][Session1] ${label} response.done`, {
    responseId,
    status,
    reason,
  });

  await session.waitForAudioStopped(responseId, 60000);
  console.log(`[Realtime][Session1] ${label} output audio stopped`, {
    responseId,
    status,
    reason,
  });

  await delay(1200);
  console.log(`[Realtime][Session1] ${label} grace tail complete`, {
    responseId,
  });

  if (status !== "completed") {
    throw new Error(
      `${label} response did not complete cleanly (status=${status}${
        reason ? `, reason=${reason}` : ""
      })`
    );
  }

  return doneEvent;
}

export async function startWheelDialogue(session, systemPrompt, gameContext) {
  console.log("[Realtime][Spin] simplest dialogue mode start", {
    round: gameContext?.round_number,
  });

  await session.setDialogueMode({
    tools: [],
    instructions: buildModeratorBaseInstructions(systemPrompt),
    eagerness: "low",
    interruptResponse: true,
    createResponse: true,
  });

  session.clearInputBuffer();
  session.setMicEnabled(true);

  await session.primeAudioOutput(8000);
  console.log("[Realtime][Spin] simplest dialogue mode armed + audio primed");

  await session.createResponse({
    instructions: buildWheelOpeningPrompt(gameContext),
    outputModalities: ["audio"],
    maxOutputTokens: TOKENS.WHEEL_OPENING,
  });

  console.log("[Realtime][Spin] opening line triggered");
  return null;
}

export async function continueWheelDialogue() {
  return null;
}

export async function runSessionOneFlow({
  session,
  systemPrompt,
  gameContext,
  warmupTimeoutMs = 6000,
}) {
  console.log("[Realtime][Session1] simple flow enter", {
    sector: gameContext?.sector_number,
    questionId: gameContext?.current_question?.id,
    character: gameContext?.current_question?.character,
    warmupTimeoutMs,
    videoMode: isVideoQuestion(gameContext),
  });

  if (!session) {
    throw new Error("runSessionOneFlow requires an opened RealtimeSession");
  }

  await session.setMonologueMode({
    tools: [],
    instructions: buildModeratorBaseInstructions(systemPrompt),
  });
  console.log("[Realtime][Session1] monologue mode set for simple read path");

  await session.primeAudioOutput(8000);
  console.log("[Realtime][Session1] read-session audio primed");

  const blitzPos = gameContext?.current_question?.blitz_position || 1;
  const isBlitzContinuation =
    gameContext?.current_question?.round_type === "blitz" && blitzPos > 1;

  if (!isBlitzContinuation) {
    const introResponse = await session.createResponse({
      instructions: buildSectorIntroPrompt(gameContext),
      outputModalities: ["audio"],
      metadata: { stage: "sector_intro" },
      maxOutputTokens: TOKENS.SECTOR_INTRO,
    });

    console.log("[Realtime][Session1] sector intro response created", {
      responseId: introResponse.responseId,
    });

    await waitForCompletedSpokenTurn(
      session,
      introResponse.responseId,
      "sector intro"
    );
  } else {
    console.log(
      "[Realtime][Session1] blitz continuation — sector intro skipped",
      {
        blitzPos,
      }
    );
  }

  if (isVideoQuestion(gameContext)) {
    const screenResponse = await session.createResponse({
      instructions: buildWatchScreenPrompt(gameContext),
      outputModalities: ["audio"],
      metadata: { stage: "video_question_intro" },
      maxOutputTokens: TOKENS.WHEEL_OPENING,
    });

    console.log("[Realtime][Session1] video intro response created", {
      responseId: screenResponse.responseId,
    });

    await waitForCompletedSpokenTurn(
      session,
      screenResponse.responseId,
      "video intro"
    );

    return {
      awaitVideoEnd: true,
      warmupReactionResponseId: null,
      questionResponseId: null,
    };
  }

  const questionResponse = await session.createResponse({
    instructions: buildQuestionReadPrompt(gameContext),
    outputModalities: ["audio"],
    metadata: { stage: "question_read" },
    maxOutputTokens: "inf",
  });

  console.log("[Realtime][Session1] question read response created", {
    responseId: questionResponse.responseId,
  });

  await waitForCompletedSpokenTurn(
    session,
    questionResponse.responseId,
    "question read"
  );

  console.log("[Realtime][Session1] question read completed cleanly", {
    responseId: questionResponse.responseId,
  });

  return {
    awaitVideoEnd: false,
    warmupReactionResponseId: null,
    questionResponseId: questionResponse.responseId,
  };
}

export async function finishVideoQuestionFlow({
  session,
  systemPrompt,
  gameContext,
}) {
  if (!session) {
    throw new Error(
      "finishVideoQuestionFlow requires an opened RealtimeSession"
    );
  }

  await session.setMonologueMode({
    tools: [],
    instructions: buildModeratorBaseInstructions(systemPrompt),
  });

  const response = await session.createResponse({
    instructions: buildTimeCuePrompt(gameContext),
    outputModalities: ["audio"],
    metadata: { stage: "video_question_time" },
    maxOutputTokens: TOKENS.WHEEL_OPENING,
  });

  console.log("[Realtime][Session1] video time cue response created", {
    responseId: response.responseId,
  });

  await waitForCompletedSpokenTurn(
    session,
    response.responseId,
    "video time cue"
  );

  return { responseId: response.responseId };
}

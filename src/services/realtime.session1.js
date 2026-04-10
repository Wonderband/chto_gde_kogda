import { delay } from "./realtime.shared.js";
import { TOKENS } from "../config.js";
import {
  buildModeratorBaseInstructions,
  buildWheelOpeningPrompt,
  buildWheelReactionPrompt,
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

/** Lenient wait for a spoken turn — doesn't throw on non-completed status. */
async function waitForSpokenTurn(session, responseId, label) {
  try {
    await session.waitForResponseDone(responseId, 20000);
    await session.waitForAudioStopped(responseId, 10000);
    await delay(300);
  } catch (err) {
    console.warn(`[Realtime][Spin] ${label} wait interrupted:`, err?.message);
  }
}

/**
 * Strict 3-step wheel dialogue:
 *   1. Opening phrase (personal address / question)
 *   2. Wait for player to respond
 *   3. One short reaction phrase
 *   Then silence — no further dialogue.
 */
export async function startWheelDialogue(session, systemPrompt, gameContext, {
  delayMs = 5500,
} = {}) {
  console.log("[Realtime][Spin] strict dialogue start", {
    round: gameContext?.round_number,
    delayMs,
  });

  // server_vad fires speech_stopped ~silenceDurationMs after the user goes quiet —
  // much faster than semantic_vad (which takes 3-5s to decide the turn is over).
  await session.setDialogueMode({
    tools: [],
    instructions: buildModeratorBaseInstructions(systemPrompt),
    silenceDurationMs: 700,
    interruptResponse: false,
    createResponse: false,
  });

  session.clearInputBuffer();
  session.setMicEnabled(false); // mute during delay — no VAD false triggers

  // ── Step 0: wait for music to settle and players to be ready ──
  await delay(delayMs);

  session.setMicEnabled(true);
  await session.primeAudioOutput(3000);
  console.log("[Realtime][Spin] audio primed, opening phrase starting");

  // ── Step 1: opening phrase ──
  const openingResponse = await session.createResponse({
    instructions: buildWheelOpeningPrompt(gameContext),
    outputModalities: ["audio"],
    maxOutputTokens: TOKENS.WHEEL_OPENING,
  });
  await waitForSpokenTurn(session, openingResponse.responseId, "opening");
  console.log("[Realtime][Spin] opening phrase done");

  // Discard any audio buffered while the moderator was speaking
  session.clearInputBuffer();

  // ── Step 2: wait for player response ──
  try {
    await session.waitForUserSpeechStart(8000);
    console.log("[Realtime][Spin] player started speaking");
    await session.waitForUserSpeechStop(20000);
    console.log("[Realtime][Spin] player finished speaking");
    await delay(500); // let server commit the audio buffer

    // ── Step 3: one reaction phrase ──
    const reactionResponse = await session.createResponse({
      instructions: buildWheelReactionPrompt(gameContext),
      outputModalities: ["audio"],
      maxOutputTokens: TOKENS.WHEEL_OPENING,
    });
    await waitForSpokenTurn(session, reactionResponse.responseId, "reaction");
    console.log("[Realtime][Spin] reaction phrase done");
  } catch {
    // Player didn't respond or timed out — skip reaction gracefully
    console.log("[Realtime][Spin] no player response — reaction skipped");
  }

  // ── Done: silence. Disable mic and VAD so nothing more is said. ──
  await session.setMonologueMode({ tools: [] });
  session.setMicEnabled(false);
  console.log("[Realtime][Spin] dialogue complete, session silenced");

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

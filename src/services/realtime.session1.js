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
      `${label} response did not complete cleanly (status=${status}${reason ? `, reason=${reason}` : ""})`
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

  // Prime the audio output track before speaking — prevents the first word being clipped
  await session.primeAudioOutput(8000);
  console.log("[Realtime][Spin] simplest dialogue mode armed + audio primed");

  // Fire the opening line — model speaks first, then VAD handles the dialogue
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

  // Blitz Q2/Q3: skip sector + character intro — already done for Q1
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
    console.log("[Realtime][Session1] blitz continuation — sector intro skipped", {
      blitzPos,
    });
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
    warmupReactionResponseId: null,
    questionResponseId: questionResponse.responseId,
  };
}

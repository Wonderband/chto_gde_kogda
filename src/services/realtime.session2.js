import {
  buildModeratorBaseInstructions,
  buildPostAnswerBaseInstructions,
  buildNameConfirmationPrompt,
  buildListeningCuePrompt,
  buildSegueCuePrompt,
  buildExplanationCuePrompt,
} from "./realtime.prompts.js";
import { TOKENS } from "../config.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRu(gameContext = {}) {
  return (gameContext.game_language || "uk") !== "uk";
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
      `${stage} did not complete cleanly (status=${status}, reason=${
        reason || ""
      })`
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
    maxOutputTokens: TOKENS.LISTENING_CUE,
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
  const cueText = session.getResponseTranscript(created.responseId);
  console.log("[DIALOGUE][Session2] ──────────────────────────────────────");
  console.log("[DIALOGUE][Session2] ВЕДУЧИЙ (cue):", cueText || "(no transcript)");

  // ── Name capture mini-dialogue ────────────────────────────────────────────
  // Captain names who will answer ("Відповідає Наталія").
  // Moderator echoes the name back in a fixed template ("Слухаємо вас, пані Наталю!").
  // Recording starts only after this exchange completes (or is skipped on timeout).
  await session.setDialogueMode({
    tools: [],
    instructions: buildModeratorBaseInstructions(systemPrompt),
    silenceDurationMs: 700,
    interruptResponse: false,
    createResponse: false,
  });
  session.clearInputBuffer();

  try {
    await session.waitForUserSpeechStart(6000);
    await session.waitForUserSpeechStop(10000);
    await delay(400);

    const transcript = await session.waitForInputTranscript(2000);
    console.log("[DIALOGUE][Session2] КАПІТАН:", transcript ?? "(не розпізнано)");

    const confirmResponse = await session.createResponse({
      instructions: buildNameConfirmationPrompt(gameContext, transcript),
      outputModalities: ["audio"],
      maxOutputTokens: TOKENS.NAME_CONFIRM,
    });
    await waitForCompletedSpokenTurn(session, confirmResponse.responseId, "name confirm", 15000);
    const confirmText = session.getResponseTranscript(confirmResponse.responseId);
    console.log("[DIALOGUE][Session2] ВЕДУЧИЙ (підтвердження):", confirmText || "(no transcript)");
    console.log("[DIALOGUE][Session2] ──────────────────────────────────────");
  } catch {
    console.log("[DIALOGUE][Session2] капітан не відповів — підтвердження пропущено");
  }

  // Disable mic before control returns — recording starts its own getUserMedia stream.
  await session.setMonologueMode({ tools: [] });
}

export async function playNeutralSegueCue({
  session,
  systemPrompt,
  gameContext,
}) {
  await session.setMonologueMode({
    tools: [],
    instructions: buildPostAnswerBaseInstructions(systemPrompt),
  });

  const created = await session.createResponse({
    instructions: buildSegueCuePrompt(gameContext),
    tools: [],
    outputModalities: ["audio"],
    metadata: { stage: "segue_cue" },
    maxOutputTokens: TOKENS.SEGUE_CUE,
  });

  console.log("[Realtime][Session2] segue cue created", {
    responseId: created.responseId,
  });

  await waitForCompletedSpokenTurn(
    session,
    created.responseId,
    "segue cue",
    20000
  );
  const segueText = session.getResponseTranscript(created.responseId);
  console.log("[DIALOGUE][Session2] ВЕДУЧИЙ (segue):", segueText || "(no transcript)");
}

export async function playExplanationCue({
  session,
  systemPrompt,
  evaluation,
  gameContext,
}) {
  const ru = isRu(gameContext);
  const fallback = ru
    ? `Правильный ответ: ${evaluation.correct_answer_reveal}.`
    : `Правильна відповідь: ${evaluation.correct_answer_reveal}.`;
  const text = (evaluation.explanation || fallback).trim();

  // Re-anchor persona before explanation. After segue cue the model can drift into
  // assistant mode without an explicit persona reset.
  await session.setMonologueMode({
    tools: [],
    instructions: buildPostAnswerBaseInstructions(systemPrompt),
  });

  const created = await session.createResponse({
    instructions: buildExplanationCuePrompt(text),
    tools: [],
    outputModalities: ["audio"],
    metadata: { stage: "explanation_cue" },
    maxOutputTokens: TOKENS.EXPLANATION_CUE,
  });

  console.log("[Realtime][Session2] explanation cue created", {
    responseId: created.responseId,
  });

  await waitForCompletedSpokenTurn(
    session,
    created.responseId,
    "explanation cue",
    60000
  );
  const explanationText = session.getResponseTranscript(created.responseId);
  console.log("[DIALOGUE][Session2] ВЕДУЧИЙ (пояснення):", explanationText || "(no transcript)");
  console.log("[DIALOGUE][Session2] ──────────────────────────────────────");
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
  const correctAnswerReveal =
    evaluation?.correct_answer_reveal ?? currentQuestion?.answer ?? "?";

  // Return only the judgment — explanation is built by the caller (useGamePhaseEffects.buildSpeechText)
  return {
    responseId,
    evaluation: {
      correct,
      correct_answer_reveal: correctAnswerReveal,
      no_answer: evaluation?.no_answer ?? false,
    },
  };
}

import {
  buildModeratorBaseInstructions,
  buildPostAnswerBaseInstructions,
  buildVerbatimBaseInstructions,
  buildNameConfirmationPrompt,
  buildListeningCuePrompt,
  buildSegueCuePrompt,
  buildExplanationCuePrompt,
} from "./realtime.prompts.js";
import { TOKENS } from "../config.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function _withRetry(label, fn, attempts = 2) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        console.warn(`[Realtime][Session2] ${label} attempt ${i} failed, retrying:`, err?.message);
        await delay(800);
      }
    }
  }
  throw lastErr;
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
  // Pre-register both waiters — output_audio_buffer.stopped can arrive before
  // response.done on the wire; registering after awaiting done risks missing it.
  const doneProm = session.waitForResponseDone(responseId, timeoutMs);
  const audioProm = session.waitForAudioStopped(responseId, timeoutMs);

  const done = await doneProm;
  const status = done?.response?.status || "";
  const reason = done?.response?.status_details?.reason || "";
  console.log(`[Realtime][Session2] ${stage} response.done`, {
    responseId,
    status,
    reason,
  });

  if (status !== "completed") {
    // Response failed — no audio produced. Silence the dangling promise.
    audioProm.catch(() => {});
    throw new Error(
      `${stage} did not complete cleanly (status=${status}, reason=${
        reason || ""
      })`
    );
  }

  await audioProm;
  console.log(`[Realtime][Session2] ${stage} output audio stopped`, {
    responseId,
    status,
    reason,
  });

  await delay(250);
  console.log(`[Realtime][Session2] ${stage} grace tail complete`, {
    responseId,
  });
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
    console.log("[DIALOGUE][Session2] капітан не відповів — вимовляємо fallback");
    // Players need an audible signal that recording is about to start.
    // Say "Слухаємо вас!" (same as the no-name path in buildNameConfirmationPrompt)
    // so they know to begin speaking their answer.
    try {
      await session.setMonologueMode({ tools: [] });
      const fallback = await session.createResponse({
        instructions: buildNameConfirmationPrompt(gameContext, null),
        outputModalities: ["audio"],
        maxOutputTokens: TOKENS.NAME_CONFIRM,
      });
      await waitForCompletedSpokenTurn(session, fallback.responseId, "name confirm fallback", 10000);
      console.log("[DIALOGUE][Session2] ВЕДУЧИЙ (підтвердження): Слухаємо вас!");
      console.log("[DIALOGUE][Session2] ──────────────────────────────────────");
    } catch (fallbackErr) {
      console.warn("[DIALOGUE][Session2] name confirm fallback failed:", fallbackErr?.message);
    }
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

  const created = await _withRetry("segue cue", async () => {
    const r = await session.createResponse({
      instructions: buildSegueCuePrompt(gameContext),
      tools: [],
      outputModalities: ["audio"],
      metadata: { stage: "segue_cue" },
      maxOutputTokens: TOKENS.SEGUE_CUE,
    });
    console.log("[Realtime][Session2] segue cue created", { responseId: r.responseId });
    await waitForCompletedSpokenTurn(session, r.responseId, "segue cue", 20000);
    return r;
  });
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
    instructions: buildVerbatimBaseInstructions(),
  });

  const created = await _withRetry("explanation cue", async () => {
    const r = await session.createResponse({
      instructions: buildExplanationCuePrompt(text),
      tools: [],
      outputModalities: ["audio"],
      metadata: { stage: "explanation_cue" },
      maxOutputTokens: TOKENS.EXPLANATION_CUE,
    });
    console.log("[Realtime][Session2] explanation cue created", { responseId: r.responseId });
    await waitForCompletedSpokenTurn(session, r.responseId, "explanation cue", 60000);
    return r;
  });
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

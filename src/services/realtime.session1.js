import { delay } from "./realtime.shared.js";
import { TOKENS } from "../config.js";
import {
  buildModeratorBaseInstructions,
  buildWheelOpeningPrompt,
  buildWheelReactionPrompt,
  buildCombinedIntroPrompt,
  buildWarmupReactionPrompt,
  buildWarmupReactionWithVideoCuePrompt,
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
  warmupTimeoutMs = 6000, // kept for API compatibility
}) {
  const isVideo = isVideoQuestion(gameContext);
  const hasFlavor = !!gameContext?.current_question?.intro_flavor;
  const blitzPos = gameContext?.current_question?.blitz_position || 1;
  const isBlitzContinuation =
    gameContext?.current_question?.round_type === "blitz" && blitzPos > 1;

  console.log("[Realtime][Session1] flow enter", {
    sector: gameContext?.sector_number,
    questionId: gameContext?.current_question?.id,
    character: gameContext?.current_question?.character,
    isVideo,
    hasFlavor,
    isBlitzContinuation,
  });

  if (!session) {
    throw new Error("runSessionOneFlow requires an opened RealtimeSession");
  }

  // ── Initial monologue setup ───────────────────────────────────────────────
  await session.setMonologueMode({
    tools: [],
    instructions: buildModeratorBaseInstructions(systemPrompt),
  });
  await session.primeAudioOutput(8000);
  console.log("[Realtime][Session1] read-session ready");

  // ── Non-blitz: combined intro monologue ───────────────────────────────────
  // One response covers: sector number + character + intro_flavor (if present).
  // Keeping everything in a single monologue pass ensures verbatim delivery with
  // no preamble and no conversation context bleeding into later phases.
  if (!isBlitzContinuation) {
    const introResponse = await session.createResponse({
      instructions: buildCombinedIntroPrompt(gameContext),
      outputModalities: ["audio"],
      metadata: { stage: "combined_intro" },
      maxOutputTokens: TOKENS.COMBINED_INTRO,
    });
    console.log("[Realtime][Session1] combined intro created", { responseId: introResponse.responseId });
    await waitForCompletedSpokenTurn(session, introResponse.responseId, "combined intro");

    // ── Warmup dialogue — only when intro_flavor exists ───────────────────
    if (hasFlavor) {
      console.log("[Realtime][Session1] warmup dialogue start");

      // Switch to dialogue mode: 1500ms silence threshold so players can pause
      // mid-thought without being cut off (700ms used in wheel banter is too short).
      await session.setDialogueMode({
        tools: [],
        instructions: buildModeratorBaseInstructions(systemPrompt),
        silenceDurationMs: 1500,
        interruptResponse: false,
        createResponse: false,
      });
      session.clearInputBuffer();

      let playerResponded = false;
      try {
        await session.waitForUserSpeechStart(8000);
        console.log("[Realtime][Session1] warmup player started speaking");
        await session.waitForUserSpeechStop(20000);
        console.log("[Realtime][Session1] warmup player finished speaking");
        await delay(500);
        playerResponded = true;

        // Reaction: for video questions, fold "Увага на екран!" into the reaction
        // so no separate video intro response is needed (avoids warmup context bleed).
        const reactionInstructions = isVideo
          ? buildWarmupReactionWithVideoCuePrompt(gameContext)
          : buildWarmupReactionPrompt(gameContext);
        const reactionResponse = await session.createResponse({
          instructions: reactionInstructions,
          outputModalities: ["audio"],
          maxOutputTokens: TOKENS.WARMUP_REACTION,
        });
        await waitForSpokenTurn(session, reactionResponse.responseId, "warmup reaction");
        console.log("[Realtime][Session1] warmup reaction done");
      } catch {
        console.log("[Realtime][Session1] warmup no player response — reaction skipped");
      }

      await session.setMonologueMode({ tools: [] });
      console.log("[Realtime][Session1] warmup dialogue complete");

      if (isVideo) {
        // Reaction already ended with "Увага на екран!" — video can show now.
        // If player didn't respond, we still need the cue.
        if (!playerResponded) {
          const cueResponse = await session.createResponse({
            instructions: buildWatchScreenPrompt(gameContext),
            outputModalities: ["audio"],
            maxOutputTokens: TOKENS.VIDEO_CUE,
          });
          await waitForSpokenTurn(session, cueResponse.responseId, "video cue");
        }
        return { awaitVideoEnd: true };
      }
      // Text question: fall through to question read below.
    }
  } else {
    console.log("[Realtime][Session1] blitz continuation — intro skipped", { blitzPos });
  }

  // ── Video question without warmup (no flavor, or blitz continuation) ──────
  // Clean context here — no warmup conversation history, so VIDEO_CUE budget
  // is sufficient and no risk of preamble.
  if (isVideo) {
    const screenResponse = await session.createResponse({
      instructions: buildWatchScreenPrompt(gameContext),
      outputModalities: ["audio"],
      metadata: { stage: "video_cue" },
      maxOutputTokens: TOKENS.VIDEO_CUE,
    });
    console.log("[Realtime][Session1] video cue created", { responseId: screenResponse.responseId });
    await waitForSpokenTurn(session, screenResponse.responseId, "video cue");
    return { awaitVideoEnd: true };
  }

  // ── Regular question read ─────────────────────────────────────────────────
  const questionResponse = await session.createResponse({
    instructions: buildQuestionReadPrompt(gameContext),
    outputModalities: ["audio"],
    metadata: { stage: "question_read" },
    maxOutputTokens: "inf",
  });
  console.log("[Realtime][Session1] question read created", { responseId: questionResponse.responseId });
  await waitForCompletedSpokenTurn(session, questionResponse.responseId, "question read");
  console.log("[Realtime][Session1] question read done", { responseId: questionResponse.responseId });

  return { awaitVideoEnd: false };
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

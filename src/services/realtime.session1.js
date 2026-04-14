import { delay } from "./realtime.shared.js";
import { TOKENS } from "../config.js";
import {
  buildModeratorBaseInstructions,
  buildVerbatimBaseInstructions,
  buildWheelOpeningPrompt,
  buildWheelReactionPrompt,
  buildCombinedIntroPrompt,
  buildBlackBoxWarmupOpeningPrompt,
  buildWarmupReactionPrompt,
  buildWarmupReactionWithVideoCuePrompt,
  buildAttentionCuePrompt,
  buildQuestionBodyPrompt,
  buildWatchScreenPrompt,
  buildTimeCuePrompt,
} from "./realtime.prompts.js";
import { playGong, playBlackBoxMusic } from "../utils/sounds.js";

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


async function waitForCompletedSpokenTurn(session, responseId, label) {
  // Register BOTH waiters upfront — output_audio_buffer.stopped can arrive
  // before response.done on the wire. If we only register waitForAudioStopped
  // after awaiting waitForResponseDone, the event may already be gone.
  const doneProm = session.waitForResponseDone(responseId, 60000);
  const audioProm = session.waitForAudioStopped(responseId, 60000);

  const doneEvent = await doneProm;
  const status = getResponseStatus(doneEvent);
  const reason = getStatusReason(doneEvent);

  console.log(`[Realtime][Session1] ${label} response.done`, {
    responseId,
    status,
    reason,
  });

  await audioProm;
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
    // Register BOTH waiters upfront — output_audio_buffer.stopped can arrive
    // before response.done. Sequential registration risks missing the audio event.
    const doneProm = session.waitForResponseDone(responseId, 20000);
    const audioProm = session.waitForAudioStopped(responseId, 30000);
    await doneProm;
    await audioProm;
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
  const openingText = session.getResponseTranscript(openingResponse.responseId);
  console.log("[DIALOGUE][Spin] ─────────────────────────────────────────");
  console.log("[DIALOGUE][Spin] ВЕДУЧИЙ:", openingText || "(no transcript)");

  // Discard any audio buffered while the moderator was speaking
  session.clearInputBuffer();

  // ── Step 2: wait for player response ──
  try {
    await session.waitForUserSpeechStart(8000);
    console.log("[DIALOGUE][Spin] ГРАВЕЦЬ: (говорить...)");
    await session.waitForUserSpeechStop(20000);
    await delay(500); // let server commit the audio buffer

    // Capture input transcript — non-blocking, 2s timeout.
    // Injected into the reaction prompt so the model references what was actually said.
    const transcript = await session.waitForInputTranscript(2000);

    if (!transcript) {
      // Empty/null transcript means STT got nothing useful.
      // Skip the reaction entirely — a contextless reaction produces random unrelated phrases.
      console.log("[DIALOGUE][Spin] ГРАВЕЦЬ: (транскрипт порожній — реакція пропущена)");
      console.log("[DIALOGUE][Spin] ─────────────────────────────────────────");
    } else {
      console.log("[DIALOGUE][Spin] ГРАВЕЦЬ:", transcript);
      // ── Step 3: one reaction phrase ──
      const reactionResponse = await session.createResponse({
        instructions: buildWheelReactionPrompt(gameContext, transcript),
        outputModalities: ["audio"],
        maxOutputTokens: TOKENS.WHEEL_OPENING,
      });
      await waitForSpokenTurn(session, reactionResponse.responseId, "reaction");
      const reactionText = session.getResponseTranscript(reactionResponse.responseId);
      console.log("[DIALOGUE][Spin] РЕАКЦІЯ: ", reactionText || "(no transcript)");
      console.log("[DIALOGUE][Spin] ─────────────────────────────────────────");
    }
  } catch {
    // Player didn't respond or timed out — skip reaction gracefully
    console.log("[DIALOGUE][Spin] ГРАВЕЦЬ: (не відповів — реакція пропущена)");
    console.log("[DIALOGUE][Spin] ─────────────────────────────────────────");
  }

  // ── Done: silence. Disable mic and VAD so nothing more is said. ──
  // Guard: READING effect may have already closed the session via closePreSession()
  // if SPIN_DONE fired while the reaction was still in flight. Swallow the timeout.
  try {
    await session.setMonologueMode({ tools: [] });
    session.setMicEnabled(false);
  } catch {
    // Session already closed — normal during fast SPIN_DONE transitions
  }
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
  const isBlackBox = gameContext?.current_question?.round_type === "black_box";
  // Skip warmup for black_box — music plays immediately after combined intro
  const hasFlavor = !!gameContext?.current_question?.intro_flavor && !isBlackBox;
  const blitzPos = gameContext?.current_question?.blitz_position || 1;
  const isBlitzContinuation =
    gameContext?.current_question?.round_type === "blitz" && blitzPos > 1;

  console.log("[Realtime][Session1] flow enter", {
    sector: gameContext?.sector_number,
    questionId: gameContext?.current_question?.id,
    character: gameContext?.current_question?.character,
    isVideo,
    isBlackBox,
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
  // For black_box: also ends with "Увага, чорний ящик!" — then music, then video.
  if (!isBlitzContinuation) {
    const introResponse = await session.createResponse({
      instructions: buildCombinedIntroPrompt(gameContext),
      outputModalities: ["audio"],
      metadata: { stage: "combined_intro" },
      maxOutputTokens: TOKENS.COMBINED_INTRO,
    });
    console.log("[Realtime][Session1] combined intro created", { responseId: introResponse.responseId });
    await waitForCompletedSpokenTurn(session, introResponse.responseId, "combined intro");
    const introText = session.getResponseTranscript(introResponse.responseId);
    console.log("[DIALOGUE][Session1] ──────────────────────────────────────");
    console.log("[DIALOGUE][Session1] ВЕДУЧИЙ (вступ):", introText || "(no transcript)");

    // ── Black box flow: music → warmup dialogue → "Увага на екран!" → gong → video
    if (isBlackBox) {
      // Step 1: music plays while box is brought to the studio
      console.log("[Realtime][Session1] black box: playing music");
      await playBlackBoxMusic();
      console.log("[Realtime][Session1] black box: music done, starting warmup");

      const blackBoxFlavor = gameContext?.current_question?.intro_flavor;

      if (blackBoxFlavor) {
        // Step 2: moderator asks the flavor question (verbatim) after music
        await session.setDialogueMode({
          tools: [],
          instructions: buildModeratorBaseInstructions(systemPrompt),
          silenceDurationMs: 1500,
          interruptResponse: false,
          createResponse: false,
        });
        session.clearInputBuffer();

        const openingResponse = await session.createResponse({
          instructions: buildBlackBoxWarmupOpeningPrompt(gameContext),
          outputModalities: ["audio"],
          metadata: { stage: "black_box_warmup_opening" },
          maxOutputTokens: TOKENS.COMBINED_INTRO,
        });
        console.log("[Realtime][Session1] black box warmup opening created", { responseId: openingResponse.responseId });
        await waitForSpokenTurn(session, openingResponse.responseId, "black box warmup opening");
        const openingText = session.getResponseTranscript(openingResponse.responseId);
        console.log("[DIALOGUE][Session1] ВЕДУЧИЙ (чорний ящик вступ):", openingText || "(no transcript)");

        // Step 3: wait for player response, then react with "Увага на екран!" ending
        let playerResponded = false;
        try {
          await session.waitForUserSpeechStart(8000);
          console.log("[DIALOGUE][Session1] ГРАВЕЦЬ: (говорить...)");
          await session.waitForUserSpeechStop(20000);
          await delay(500);
          playerResponded = true;

          const transcript = await session.waitForInputTranscript(2000);
          console.log("[DIALOGUE][Session1] ГРАВЕЦЬ:", transcript || "(транскрипт не отримано)");

          if (!transcript) {
            // Empty transcript = STT got nothing intelligible — skip personalised reaction,
            // fall through to the "Увага на екран!" cue below (playerResponded stays true
            // so we DON'T fire the duplicate cue path, but we do need to emit the cue now).
            playerResponded = false;
          } else {
          const reactionResponse = await session.createResponse({
            instructions: buildWarmupReactionWithVideoCuePrompt(gameContext, transcript),
            outputModalities: ["audio"],
            maxOutputTokens: TOKENS.WARMUP_REACTION,
          });
          await waitForSpokenTurn(session, reactionResponse.responseId, "black box warmup reaction");
          const reactionText = session.getResponseTranscript(reactionResponse.responseId);
          console.log("[DIALOGUE][Session1] РЕАКЦІЯ:", reactionText || "(no transcript)");
          console.log("[DIALOGUE][Session1] ──────────────────────────────────────");
          } // end else (transcript non-empty)
        } catch {
          console.log("[DIALOGUE][Session1] ГРАВЕЦЬ: (не відповів — реакція пропущена)");
          console.log("[DIALOGUE][Session1] ──────────────────────────────────────");
        }

        await session.setMonologueMode({ tools: [] });

        // If player didn't respond, still need explicit "Увага на екран!" cue
        if (!playerResponded) {
          const cueResponse = await session.createResponse({
            instructions: buildWatchScreenPrompt(gameContext),
            outputModalities: ["audio"],
            metadata: { stage: "black_box_video_cue" },
            maxOutputTokens: TOKENS.VIDEO_CUE,
          });
          await waitForSpokenTurn(session, cueResponse.responseId, "black box video cue fallback");
        }
      } else {
        // No flavor: just "Увага на екран!" after music
        const cueResponse = await session.createResponse({
          instructions: buildWatchScreenPrompt(gameContext),
          outputModalities: ["audio"],
          metadata: { stage: "black_box_video_cue" },
          maxOutputTokens: TOKENS.VIDEO_CUE,
        });
        console.log("[Realtime][Session1] black box video cue created", { responseId: cueResponse.responseId });
        await waitForSpokenTurn(session, cueResponse.responseId, "black box video cue");
      }

      // Gong after "Увага на екран!" — before video appears
      await playGong();
      return { awaitVideoEnd: true };
    }

    // ── Warmup dialogue — only when intro_flavor exists (non-black_box) ───
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
        console.log("[DIALOGUE][Session1] ГРАВЕЦЬ: (говорить...)");
        await session.waitForUserSpeechStop(20000);
        await delay(500);
        playerResponded = true;

        // Capture input transcript — non-blocking, 2s timeout.
        const transcript = await session.waitForInputTranscript(2000);

        if (!transcript) {
          // Empty/null transcript — STT got nothing useful.
          // Skip reaction to avoid the model producing random unrelated phrases.
          console.log("[DIALOGUE][Session1] ГРАВЕЦЬ: (транскрипт порожній — реакція пропущена)");
          console.log("[DIALOGUE][Session1] ──────────────────────────────────────");
        } else {
          console.log("[DIALOGUE][Session1] ГРАВЕЦЬ:", transcript);
          // Reaction: for video questions, fold "Увага на екран!" into the reaction
          // so no separate video intro response is needed (avoids warmup context bleed).
          const reactionInstructions = isVideo
            ? buildWarmupReactionWithVideoCuePrompt(gameContext, transcript)
            : buildWarmupReactionPrompt(gameContext, transcript);
          const reactionResponse = await session.createResponse({
            instructions: reactionInstructions,
            outputModalities: ["audio"],
            maxOutputTokens: TOKENS.WARMUP_REACTION,
          });
          await waitForSpokenTurn(session, reactionResponse.responseId, "warmup reaction");
          const reactionText = session.getResponseTranscript(reactionResponse.responseId);
          console.log("[DIALOGUE][Session1] РЕАКЦІЯ: ", reactionText || "(no transcript)");
          console.log("[DIALOGUE][Session1] ──────────────────────────────────────");
        }
      } catch {
        console.log("[DIALOGUE][Session1] ГРАВЕЦЬ: (не відповів — реакція пропущена)");
        console.log("[DIALOGUE][Session1] ──────────────────────────────────────");
      }

      await session.setMonologueMode({ tools: [] });
      console.log("[Realtime][Session1] warmup dialogue complete");

      if (isVideo) {
        // Reaction already ended with "Увага на екран!" — gong then video.
        // If player didn't respond, we still need the cue.
        if (!playerResponded) {
          const cueResponse = await session.createResponse({
            instructions: buildWatchScreenPrompt(gameContext),
            outputModalities: ["audio"],
            maxOutputTokens: TOKENS.VIDEO_CUE,
          });
          await waitForSpokenTurn(session, cueResponse.responseId, "video cue");
        }
        await playGong();
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
    await playGong();
    return { awaitVideoEnd: true };
  }

  // ── Regular question read: attention cue → gong → question body ───────────
  // No persona needed — model reads exact fixed text, character adds no value here.
  await session.setMonologueMode({
    tools: [],
    instructions: buildVerbatimBaseInstructions(),
  });

  const attentionResponse = await session.createResponse({
    instructions: buildAttentionCuePrompt(gameContext),
    outputModalities: ["audio"],
    metadata: { stage: "attention_cue" },
    maxOutputTokens: TOKENS.ATTENTION_CUE,
  });
  console.log("[Realtime][Session1] attention cue created", { responseId: attentionResponse.responseId });
  await waitForCompletedSpokenTurn(session, attentionResponse.responseId, "attention cue");
  const attentionText = session.getResponseTranscript(attentionResponse.responseId);
  console.log("[DIALOGUE][Session1] ВЕДУЧИЙ (увага):", attentionText || "(no transcript)");

  await playGong();

  const questionResponse = await session.createResponse({
    instructions: buildQuestionBodyPrompt(gameContext),
    outputModalities: ["audio"],
    metadata: { stage: "question_read" },
    maxOutputTokens: "inf",
  });
  console.log("[Realtime][Session1] question body created", { responseId: questionResponse.responseId });
  await waitForCompletedSpokenTurn(session, questionResponse.responseId, "question read");
  const questionText = session.getResponseTranscript(questionResponse.responseId);
  console.log("[DIALOGUE][Session1] ВЕДУЧИЙ (питання):", questionText || "(no transcript)");
  console.log("[DIALOGUE][Session1] ──────────────────────────────────────");

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

  // No persona needed — model reads exact fixed time cue, character adds no value here.
  await session.setMonologueMode({
    tools: [],
    instructions: buildVerbatimBaseInstructions(),
  });

  const response = await session.createResponse({
    instructions: buildTimeCuePrompt(gameContext),
    outputModalities: ["audio"],
    metadata: { stage: "video_question_time" },
    maxOutputTokens: TOKENS.VIDEO_CUE,
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

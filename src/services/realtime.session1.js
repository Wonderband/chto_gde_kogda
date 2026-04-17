import { delay } from "./realtime.shared.js";
import { TOKENS } from "../config.js";
import {
  buildModeratorBaseInstructions,
  buildVerbatimBaseInstructions,
  buildWheelOpeningPrompt,
  buildWheelReactionPrompt,
  buildBlackBoxWarmupOpeningPrompt,
  buildWarmupOpeningPrompt,
  buildWarmupReactionPrompt,
  buildTimeCuePrompt,
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

  if (status !== "completed") {
    // Response failed — no audio played, don't hang waiting for audio stopped
    throw new Error(
      `${label} response did not complete cleanly (status=${status}${
        reason ? `, reason=${reason}` : ""
      })`
    );
  }

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

  return doneEvent;
}

/** Lenient wait for a spoken turn — doesn't throw on non-completed status. */
async function waitForSpokenTurn(session, responseId, label) {
  try {
    const doneProm = session.waitForResponseDone(responseId, 20000);
    const audioProm = session.waitForAudioStopped(responseId, 30000);
    const doneEvent = await doneProm;
    // Short-circuit: if response failed no audio was sent, skip the audio wait
    if (getResponseStatus(doneEvent) !== "completed") {
      console.warn(`[Realtime][Spin] ${label} response non-completed`, { responseId, status: getResponseStatus(doneEvent) });
      return;
    }
    await audioProm;
    await delay(300);
  } catch (err) {
    console.warn(`[Realtime][Spin] ${label} wait interrupted:`, err?.message);
  }
}

function logMicState(session, label) {
  try {
    const tracks = session?._localStream?.getAudioTracks?.() || [];
    console.log(`[Realtime][Session1] ${label} mic state`, {
      micEnabled: !!session?.micEnabled,
      hasUsableMicTrack: !!session?.hasUsableMicTrack?.(),
      trackCount: tracks.length,
      tracks: tracks.map((t) => ({ enabled: t.enabled, readyState: t.readyState, muted: t.muted })),
    });
  } catch {}
}

async function collectPlayerTurn(session, {
  label,
  startTimeoutMs = 12000,
  stopTimeoutMs = 20000,
  transcriptTimeoutMs = 2500,
} = {}) {
  session.clearInputBuffer();
  try {
    await session.ensureMicReady?.();
  } catch (err) {
    console.warn(`[Realtime][Session1] ${label} ensureMicReady failed:`, err?.message);
  }
  session.setMicEnabled(true);
  logMicState(session, `${label} capture start`);
  await delay(120);

  let sawSpeechStart = false;
  try {
    await session.waitForUserSpeechStart(startTimeoutMs);
    sawSpeechStart = true;
    console.log(`[DIALOGUE][Session1] ГРАВЕЦЬ: (говорить...)`);
  } catch (err) {
    const lateTranscript = await session.waitForInputTranscript(3000);
    if (lateTranscript && String(lateTranscript).trim()) {
      console.log(`[Realtime][Session1] ${label} late transcript captured without speech_started`, {
        transcript: lateTranscript,
      });
      return String(lateTranscript).trim();
    }
    throw err;
  }

  try {
    await session.waitForUserSpeechStop(stopTimeoutMs);
  } catch (err) {
    console.warn(`[Realtime][Session1] ${label} speech stop wait interrupted:`, err?.message);
  }

  await delay(450);
  let transcript = await session.waitForInputTranscript(transcriptTimeoutMs);
  if ((!transcript || !String(transcript).trim()) && sawSpeechStart) {
    const recovered = await session.waitForInputTranscript(3000);
    if (recovered && String(recovered).trim()) {
      console.log(`[Realtime][Session1] ${label} transcript recovered after initial empty result`, {
        transcript: recovered,
      });
      transcript = recovered;
    }
  }

  return transcript && String(transcript).trim() ? String(transcript).trim() : null;
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
  session.setMicEnabled(false); // keep mic closed until the moderator finishes

  // ── Step 0: wait for music to settle and players to be ready ──
  await delay(delayMs);

  await session.primeAudioOutput(3000);
  session.clearInputBuffer(); // flush ambient audio accumulated during delay + priming
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

  // Discard any audio buffered while the moderator was speaking, then hand off to the player.
  session.clearInputBuffer();
  try {
    await session.ensureMicReady?.();
  } catch (err) {
    console.warn("[Realtime][Spin] ensureMicReady failed after opening:", err?.message);
  }
  session.setMicEnabled(true);
  logMicState(session, "spin after opening");
  await delay(120);

  // ── Step 2: wait for player response ──
  try {
    const transcript = await collectPlayerTurn(session, {
      label: "spin",
      startTimeoutMs: 12000,
      stopTimeoutMs: 20000,
      transcriptTimeoutMs: 3000,
    });

    if (!transcript) {
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

// Warmup mini-dialog — same structure as the spin dialog.
// TTS already spoke the sector+hero intro and any structural cues (black box, item).
// This function just runs: opening (intro_flavor verbatim) → player reply → reaction.
// Caller owns all deterministic speech before and after this (gong, question, video cue).
export async function runSessionOneFlow({
  session,
  systemPrompt,
  gameContext,
  warmupTimeoutMs = 6000,
}) {
  const isBlackBox = gameContext?.current_question?.round_type === "black_box";

  if (!session) {
    throw new Error("runSessionOneFlow requires an opened RealtimeSession");
  }

  await session.setMonologueMode({
    tools: [],
    instructions: buildModeratorBaseInstructions(systemPrompt),
  });
  await session.primeAudioOutput(8000);

  // Opening: read intro_flavor verbatim in monologue mode.
  // VAD must be off so ambient noise cannot cut the response before the model speaks.
  session.setMicEnabled(false);
  session.clearInputBuffer();

  const openingPrompt = isBlackBox
    ? buildBlackBoxWarmupOpeningPrompt(gameContext)
    : buildWarmupOpeningPrompt(gameContext);
  const openingResponse = await session.createResponse({
    instructions: openingPrompt,
    outputModalities: ["audio"],
    metadata: { stage: "warmup_opening" },
    maxOutputTokens: TOKENS.COMBINED_INTRO,
  });
  await waitForSpokenTurn(session, openingResponse.responseId, "warmup opening");
  const openingText = session.getResponseTranscript(openingResponse.responseId);
  console.log("[DIALOGUE][Session1] ──────────────────────────────────────");
  console.log("[DIALOGUE][Session1] ВЕДУЧИЙ (розминка):", openingText || "(no transcript)");

  // Switch to dialogue mode for player capture — VAD needed now.
  await session.setDialogueMode({
    tools: [],
    instructions: buildModeratorBaseInstructions(systemPrompt),
    silenceDurationMs: 700,
    interruptResponse: false,
    createResponse: false,
  });
  // Mirror the spin capture pattern: create track, enable, settle, clear ambient audio.
  // 300ms settle (vs spin's 120ms) — extra buffer after VAD-mode switch + TTS just ended.
  try { await session.ensureMicReady?.(); } catch (err) {
    console.warn("[Realtime][Session1] ensureMicReady failed before warmup capture:", err?.message);
  }
  session.setMicEnabled(true);
  await delay(300);
  session.clearInputBuffer();
  logMicState(session, "warmup after opening");

  // collectPlayerTurn does a second clearInputBuffer + ensureMicReady (no-op) + 120ms — same as spin
  try {
    const transcript = await collectPlayerTurn(session, {
      label: "warmup",
      startTimeoutMs: Math.max(12000, warmupTimeoutMs || 0),
      stopTimeoutMs: 20000,
      transcriptTimeoutMs: 3000,
    });

    if (!transcript) {
      console.log("[DIALOGUE][Session1] ГРАВЕЦЬ: (транскрипт порожній — реакція пропущена)");
      console.log("[DIALOGUE][Session1] ──────────────────────────────────────");
    } else {
      console.log("[DIALOGUE][Session1] ГРАВЕЦЬ:", transcript);
      const reactionResponse = await session.createResponse({
        instructions: buildWarmupReactionPrompt(gameContext, transcript),
        outputModalities: ["audio"],
        maxOutputTokens: TOKENS.WARMUP_REACTION,
      });
      await waitForSpokenTurn(session, reactionResponse.responseId, "warmup reaction");
      session.setMicEnabled(false);
      session.clearInputBuffer();
      const reactionText = session.getResponseTranscript(reactionResponse.responseId);
      console.log("[DIALOGUE][Session1] РЕАКЦІЯ:", reactionText || "(no transcript)");
      console.log("[DIALOGUE][Session1] ──────────────────────────────────────");
    }
  } catch {
    console.log("[DIALOGUE][Session1] ГРАВЕЦЬ: (не відповів — реакція пропущена)");
    console.log("[DIALOGUE][Session1] ──────────────────────────────────────");
  }
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

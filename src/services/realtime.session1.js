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

function shouldSkipWarmupForQuestion(question = {}) {
  return (
    question?.force_no_warmup === true ||
    question?.round_type === "blitz" ||
    question?.id === "bb_q11"
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
    // Response failed — no audio was produced. Silence the dangling audioProm so
    // it doesn't block or leave an unhandled rejection when it times out.
    audioProm.catch(() => {});
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
const PLAYER_TURN_START_TIMEOUT_MS = 8000;
const PLAYER_TURN_MAX_SPEECH_MS = 12000;
const PLAYER_TURN_TRANSCRIPT_TIMEOUT_MS = 2500;
const PLAYER_TURN_POST_STOP_DELAY_MS = 500;
const PLAYER_TURN_FORCE_CUTOFF_GRACE_MS = 1200;

async function waitForOptionalSpokenTurn(
  session,
  responseId,
  label,
  {
    doneTimeoutMs = 8000,
    audioTimeoutMs = 10000,
    graceMs = 300,
    logPrefix = "[Realtime][Session1]",
  } = {}
) {
  const doneProm = session.waitForResponseDone(responseId, doneTimeoutMs);
  const audioProm = session.waitForAudioStopped(responseId, audioTimeoutMs);

  try {
    const doneEvent = await doneProm;
    const status = getResponseStatus(doneEvent);
    const reason = getStatusReason(doneEvent);

    console.log(`${logPrefix} ${label} response.done`, {
      responseId,
      status,
      reason,
    });

    if (status !== "completed") {
      audioProm.catch(() => {});
      return { ok: false, responseId, status, reason };
    }

    await audioProm;
    console.log(`${logPrefix} ${label} output audio stopped`, {
      responseId,
      status,
      reason,
    });

    await delay(graceMs);
    return { ok: true, responseId, status, reason };
  } catch (err) {
    console.warn(`${logPrefix} ${label} wait interrupted:`, err?.message);
    audioProm.catch(() => {});
    return {
      ok: false,
      responseId,
      status: "timeout",
      reason: err?.message || "",
    };
  }
}

async function collectSinglePlayerTurn(
  session,
  dialogPrefix,
  {
    startTimeoutMs = PLAYER_TURN_START_TIMEOUT_MS,
    maxSpeechMs = PLAYER_TURN_MAX_SPEECH_MS,
    transcriptTimeoutMs = PLAYER_TURN_TRANSCRIPT_TIMEOUT_MS,
    postStopDelayMs = PLAYER_TURN_POST_STOP_DELAY_MS,
    forceCutoffGraceMs = PLAYER_TURN_FORCE_CUTOFF_GRACE_MS,
  } = {}
) {
  await session.waitForUserSpeechStart(startTimeoutMs);
  console.log(`${dialogPrefix} ГРАВЕЦЬ: (говорить...)`);

  let forcedCutoff = false;

  try {
    await session.waitForUserSpeechStop(maxSpeechMs);
    await delay(postStopDelayMs);
  } catch (err) {
    forcedCutoff = true;
    console.warn(
      `${dialogPrefix} player speech exceeded ${maxSpeechMs} ms — forcing cutoff`
    );

    // Stop feeding more audio into the turn and let server-side VAD settle.
    session.setMicEnabled(false);
    await delay(forceCutoffGraceMs);
  }

  const transcript = await session.waitForInputTranscript(transcriptTimeoutMs);
  return { transcript, forcedCutoff };
}

async function playOptionalReaction(
  session,
  {
    instructions,
    label,
    maxOutputTokens,
    dialogPrefix,
    realtimeLogPrefix = "[Realtime][Session1]",
  }
) {
  const response = await session.createResponse({
    instructions,
    outputModalities: ["audio"],
    maxOutputTokens,
  });

  const wait = await waitForOptionalSpokenTurn(
    session,
    response.responseId,
    label,
    {
      logPrefix: realtimeLogPrefix,
    }
  );

  const text = session.getResponseTranscript(response.responseId);

  if (wait.ok && text) {
    console.log(`${dialogPrefix} РЕАКЦІЯ:`, text);
    return { spoken: true, text, responseId: response.responseId };
  }

  console.warn(
    `${realtimeLogPrefix} ${label} was not confirmed as fully spoken`,
    {
      responseId: response.responseId,
      status: wait.status,
      reason: wait.reason,
      transcript: text || "",
    }
  );

  return {
    spoken: false,
    text: text || "",
    responseId: response.responseId,
    status: wait.status,
    reason: wait.reason,
  };
}

async function playMandatoryProtectedCue(
  session,
  {
    instructions,
    label,
    maxOutputTokens,
    dialogLabel,
    realtimeLogPrefix = "[Realtime][Session1]",
  }
) {
  session.setMicEnabled(false);
  session.clearInputBuffer();

  await session.setMonologueMode({
    tools: [],
    instructions: buildVerbatimBaseInstructions(),
  });

  const response = await _withRetry(label, async () => {
    const r = await session.createResponse({
      instructions,
      outputModalities: ["audio"],
      metadata: { stage: label },
      maxOutputTokens,
      conversation: "none",
    });

    console.log(`${realtimeLogPrefix} ${label} created`, {
      responseId: r.responseId,
    });

    await waitForCompletedSpokenTurn(session, r.responseId, label);
    return r;
  });

  const text = session.getResponseTranscript(response.responseId);
  console.log(dialogLabel, text || "(no transcript)");

  return { responseId: response.responseId, text: text || "" };
}

/**
 * Strict 3-step wheel dialogue:
 *   1. Opening phrase (personal address / question)
 *   2. Wait for player to respond
 *   3. One short reaction phrase
 *   Then silence — no further dialogue.
 */
export async function startWheelDialogue(
  session,
  systemPrompt,
  gameContext,
  { delayMs = 5500, abortSignal = null } = {}
) {
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
  await waitForCompletedSpokenTurn(
    session,
    openingResponse.responseId,
    "opening"
  );
  const openingText = session.getResponseTranscript(openingResponse.responseId);
  console.log("[DIALOGUE][Spin] ─────────────────────────────────────────");
  console.log("[DIALOGUE][Spin] ВЕДУЧИЙ:", openingText || "(no transcript)");

  // Discard any audio buffered while the moderator was speaking
  session.clearInputBuffer();

  // ── Step 2: wait for player response ──
  // Skip entirely if the wheel has already stopped (abort signal set by READING effect).
  if (abortSignal?.aborted) {
    console.log("[Realtime][Spin] aborted before player wait — wheel stopped");
    try {
      await session.setMonologueMode({ tools: [] });
      session.setMicEnabled(false);
    } catch {}
    return null;
  }

  try {
    // Race player speech against abort — if wheel stops mid-wait, skip reaction.
    const abortPoll = abortSignal
      ? new Promise((resolve) => {
          const iv = setInterval(() => {
            if (abortSignal.aborted) {
              clearInterval(iv);
              resolve("aborted");
            }
          }, 100);
        })
      : null;

    const speechRace = session.waitForUserSpeechStart(
      PLAYER_TURN_START_TIMEOUT_MS
    );
    const winner = abortPoll
      ? await Promise.race([speechRace.then(() => "speech"), abortPoll])
      : "speech";

    if (winner === "aborted") {
      console.log(
        "[Realtime][Spin] aborted while waiting for player speech — skipping reaction"
      );
      try {
        await session.setMonologueMode({ tools: [] });
        session.setMicEnabled(false);
        session.clearInputBuffer();
      } catch {}
      return null;
    }

    const { transcript, forcedCutoff } = await collectSinglePlayerTurn(
      session,
      "[DIALOGUE][Spin]"
    );

    // End player-turn capture before any moderator reaction.
    session.setMicEnabled(false);
    session.clearInputBuffer();

    if (!transcript) {
      console.log(
        forcedCutoff
          ? "[DIALOGUE][Spin] ГРАВЕЦЬ: (репліку примусово обірвано, транскрипт порожній — реакція пропущена)"
          : "[DIALOGUE][Spin] ГРАВЕЦЬ: (транскрипт порожній — реакція пропущена)"
      );
      console.log("[DIALOGUE][Spin] ─────────────────────────────────────────");
    } else {
      console.log("[DIALOGUE][Spin] ГРАВЕЦЬ:", transcript);

      await playOptionalReaction(session, {
        instructions: buildWheelReactionPrompt(gameContext, transcript),
        label: "spin reaction",
        maxOutputTokens: TOKENS.WHEEL_REACTION,
        dialogPrefix: "[DIALOGUE][Spin]",
        realtimeLogPrefix: "[Realtime][Spin]",
      });

      console.log("[DIALOGUE][Spin] ─────────────────────────────────────────");
    }
  } catch {
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

/**
 * Retry wrapper for response.create + waitForCompletedSpokenTurn.
 * On server error (status=failed), creates a fresh response and tries again.
 * fn must be async and return the response object; it should call
 * waitForCompletedSpokenTurn internally and throw on non-completed status.
 */
async function _withRetry(label, fn, attempts = 2) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        console.warn(
          `[Realtime][Session1] ${label} attempt ${i} failed, retrying:`,
          err?.message
        );
        await delay(800);
      }
    }
  }
  throw lastErr;
}

async function switchToCleanProtectedSession(currentSession, openReadSession, logReason = "protected phase") {
  if (!openReadSession) return currentSession;

  const cleanSession = await openReadSession();
  if (!cleanSession) return currentSession;

  try {
    cleanSession.setMicEnabled(false);
    try {
      await cleanSession.updateSession({ turn_detection: null });
    } catch {}
    cleanSession.clearInputBuffer();
  } catch {}

  try {
    currentSession?.close?.();
  } catch {}

  console.log(`[Realtime][Session1] switched to clean read session for ${logReason}`);
  return cleanSession;
}

function buildProtectedReadContext(gameContext = {}) {
  const q = gameContext?.current_question || {};
  return {
    game_language: gameContext?.game_language,
    current_question: {
      question_text: q.question_text || "",
      round_type: q.round_type,
      blitz_position: q.blitz_position,
      presentation_mode: q.presentation_mode,
    },
  };
}

/**
 * Attention cue → gong → question body on an already-configured session.
 * Extracted so both the normal path and the split-session warmup path share it.
 */
async function _runQuestionReadPhase(
  session,
  gameContext,
  baseInstructions = buildVerbatimBaseInstructions()
) {
  // Protected read must be a pure "read exactly this text" phase.
  // Do NOT inherit the moderator persona or warmup context here.
  await session.setMonologueMode({
    tools: [],
    instructions: baseInstructions,
  });

  const attentionResponse = await _withRetry("attention cue", async () => {
    const r = await session.createResponse({
      instructions: buildAttentionCuePrompt(gameContext),
      outputModalities: ["audio"],
      metadata: { stage: "attention_cue" },
      maxOutputTokens: TOKENS.ATTENTION_CUE,
      conversation: "none",
    });
    console.log("[Realtime][Session1] attention cue created", {
      responseId: r.responseId,
    });
    await waitForCompletedSpokenTurn(session, r.responseId, "attention cue");
    return r;
  });

  await playGong();

  const questionResponse = await _withRetry("question read", async () => {
    const r = await session.createResponse({
      instructions: buildQuestionBodyPrompt(gameContext),
      outputModalities: ["audio"],
      metadata: { stage: "question_read" },
      maxOutputTokens: "inf",
      conversation: "none",
    });
    console.log("[Realtime][Session1] question body created", {
      responseId: r.responseId,
    });
    await waitForCompletedSpokenTurn(session, r.responseId, "question read");
    return r;
  });
}

export async function runSessionOneFlow({
  session,
  systemPrompt,
  gameContext,
  warmupTimeoutMs = 6000, // kept for API compatibility
  openReadSession = null, // async () => RealtimeSession — opens a fresh session for the question read
}) {
  const isVideo = isVideoQuestion(gameContext);
  const isBlackBox = gameContext?.current_question?.round_type === "black_box";
  const isItemAnnounce = !!gameContext?.current_question?.item_to_announce;
  const skipWarmup = shouldSkipWarmupForQuestion(gameContext?.current_question);
  // Skip warmup for black_box/item_announce and high-risk reads — music/cue/question take over immediately.
  const hasFlavor =
    !!gameContext?.current_question?.intro_flavor &&
    !isBlackBox &&
    !isItemAnnounce &&
    !skipWarmup;
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
    skipWarmup,
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
    const introGameContext = skipWarmup
      ? {
          ...gameContext,
          current_question: {
            ...(gameContext?.current_question || {}),
            intro_flavor: "",
          },
        }
      : gameContext;

    const introResponse = await _withRetry("combined intro", async () => {
      const r = await session.createResponse({
        instructions: buildCombinedIntroPrompt(introGameContext),
        outputModalities: ["audio"],
        metadata: { stage: "combined_intro" },
        maxOutputTokens: TOKENS.COMBINED_INTRO,
      });
      console.log("[Realtime][Session1] combined intro created", {
        responseId: r.responseId,
      });
      await waitForCompletedSpokenTurn(session, r.responseId, "combined intro");
      return r;
    });
    const introText = session.getResponseTranscript(introResponse.responseId);
    console.log("[DIALOGUE][Session1] ──────────────────────────────────────");
    console.log(
      "[DIALOGUE][Session1] ВЕДУЧИЙ (вступ):",
      introText || "(no transcript)"
    );

    // ── Black box flow: music → warmup dialogue → "Увага на екран!" → gong → video
    if (isBlackBox) {
      // Step 1: music plays while box is brought to the studio
      console.log("[Realtime][Session1] black box: playing music");
      await playBlackBoxMusic();
      console.log(
        "[Realtime][Session1] black box: music done, starting warmup"
      );

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
        console.log("[Realtime][Session1] black box warmup opening created", {
          responseId: openingResponse.responseId,
        });
        await waitForCompletedSpokenTurn(
          session,
          openingResponse.responseId,
          "black box warmup opening"
        );
        const openingText = session.getResponseTranscript(
          openingResponse.responseId
        );
        console.log(
          "[DIALOGUE][Session1] ВЕДУЧИЙ (чорний ящик вступ):",
          openingText || "(no transcript)"
        );

        // Step 3: collect one bounded player turn, optionally react,
        // then ALWAYS play the protected bridge separately.
        try {
          const { transcript, forcedCutoff } = await collectSinglePlayerTurn(
            session,
            "[DIALOGUE][Session1]"
          );

          // End player-turn capture before any moderator reaction.
          session.setMicEnabled(false);
          session.clearInputBuffer();

          if (!transcript) {
            console.log(
              forcedCutoff
                ? "[DIALOGUE][Session1] ГРАВЕЦЬ: (репліку примусово обірвано, транскрипт порожній — реакція пропущена)"
                : "[DIALOGUE][Session1] ГРАВЕЦЬ: (транскрипт порожній — реакція пропущена)"
            );
            console.log(
              "[DIALOGUE][Session1] ──────────────────────────────────────"
            );
          } else {
            console.log("[DIALOGUE][Session1] ГРАВЕЦЬ:", transcript);

            await playOptionalReaction(session, {
              instructions: buildWarmupReactionPrompt(gameContext, transcript),
              label: "black box warmup reaction",
              maxOutputTokens: TOKENS.WARMUP_REACTION,
              dialogPrefix: "[DIALOGUE][Session1]",
              realtimeLogPrefix: "[Realtime][Session1]",
            });

            console.log(
              "[DIALOGUE][Session1] ──────────────────────────────────────"
            );
          }
        } catch {
          console.log(
            "[DIALOGUE][Session1] ГРАВЕЦЬ: (не відповів — реакція пропущена)"
          );
          console.log(
            "[DIALOGUE][Session1] ──────────────────────────────────────"
          );
        }

        try {
          await session.setMonologueMode({ tools: [] });
        } catch {}

        const protectedSession = await switchToCleanProtectedSession(
          session,
          openReadSession,
          "black box video cue"
        );
        await playMandatoryProtectedCue(protectedSession, {
          instructions: buildWatchScreenPrompt(gameContext),
          label: "black_box_video_cue",
          maxOutputTokens: TOKENS.VIDEO_CUE,
          dialogLabel: "[DIALOGUE][Session1] ВЕДУЧИЙ (на екран):",
          realtimeLogPrefix: "[Realtime][Session1]",
        });
        await playGong();
        return { awaitVideoEnd: true, activeSession: protectedSession };
      } else {
        const protectedSession = await switchToCleanProtectedSession(
          session,
          openReadSession,
          "black box video cue"
        );
        await playMandatoryProtectedCue(protectedSession, {
          instructions: buildWatchScreenPrompt(gameContext),
          label: "black_box_video_cue",
          maxOutputTokens: TOKENS.VIDEO_CUE,
          dialogLabel: "[DIALOGUE][Session1] ВЕДУЧИЙ (на екран):",
          realtimeLogPrefix: "[Realtime][Session1]",
        });
        await playGong();
        return { awaitVideoEnd: true, activeSession: protectedSession };
      }
    }

    // ── Item announce flow: music → warmup dialogue → "Увага на екран!" → gong → video ──
    // Triggered by item_to_announce field on the question (e.g. "Увага! Склянка з водою").
    // The combined intro already said the item cue; now music plays while the item is brought in.
    if (isItemAnnounce) {
      console.log("[Realtime][Session1] item announce: playing music");
      await playBlackBoxMusic();
      console.log(
        "[Realtime][Session1] item announce: music done, starting warmup"
      );

      const itemFlavor = gameContext?.current_question?.intro_flavor;

      if (itemFlavor) {
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
          metadata: { stage: "item_announce_warmup_opening" },
          maxOutputTokens: TOKENS.COMBINED_INTRO,
        });
        console.log(
          "[Realtime][Session1] item announce warmup opening created",
          { responseId: openingResponse.responseId }
        );
        await waitForCompletedSpokenTurn(
          session,
          openingResponse.responseId,
          "item announce warmup opening"
        );
        const openingText = session.getResponseTranscript(
          openingResponse.responseId
        );
        console.log(
          "[DIALOGUE][Session1] ВЕДУЧИЙ (item announce вступ):",
          openingText || "(no transcript)"
        );

        try {
          const { transcript, forcedCutoff } = await collectSinglePlayerTurn(
            session,
            "[DIALOGUE][Session1]"
          );

          // End player-turn capture before any moderator reaction.
          session.setMicEnabled(false);
          session.clearInputBuffer();

          if (!transcript) {
            console.log(
              forcedCutoff
                ? "[DIALOGUE][Session1] ГРАВЕЦЬ: (репліку примусово обірвано, транскрипт порожній — реакція пропущена)"
                : "[DIALOGUE][Session1] ГРАВЕЦЬ: (транскрипт порожній — реакція пропущена)"
            );
            console.log(
              "[DIALOGUE][Session1] ──────────────────────────────────────"
            );
          } else {
            console.log("[DIALOGUE][Session1] ГРАВЕЦЬ:", transcript);

            await playOptionalReaction(session, {
              instructions: buildWarmupReactionPrompt(gameContext, transcript),
              label: "item announce warmup reaction",
              maxOutputTokens: TOKENS.WARMUP_REACTION,
              dialogPrefix: "[DIALOGUE][Session1]",
              realtimeLogPrefix: "[Realtime][Session1]",
            });

            console.log(
              "[DIALOGUE][Session1] ──────────────────────────────────────"
            );
          }
        } catch {
          console.log(
            "[DIALOGUE][Session1] ГРАВЕЦЬ: (не відповів — реакція пропущена)"
          );
          console.log(
            "[DIALOGUE][Session1] ──────────────────────────────────────"
          );
        }

        try {
          await session.setMonologueMode({ tools: [] });
        } catch {}

        const protectedSession = await switchToCleanProtectedSession(
          session,
          openReadSession,
          "item announce video cue"
        );
        await playMandatoryProtectedCue(protectedSession, {
          instructions: buildWatchScreenPrompt(gameContext),
          label: "item_announce_video_cue",
          maxOutputTokens: TOKENS.VIDEO_CUE,
          dialogLabel: "[DIALOGUE][Session1] ВЕДУЧИЙ (на екран):",
          realtimeLogPrefix: "[Realtime][Session1]",
        });
        await playGong();
        return { awaitVideoEnd: true, activeSession: protectedSession };
      } else {
        const protectedSession = await switchToCleanProtectedSession(
          session,
          openReadSession,
          "item announce video cue"
        );
        await playMandatoryProtectedCue(protectedSession, {
          instructions: buildWatchScreenPrompt(gameContext),
          label: "item_announce_video_cue",
          maxOutputTokens: TOKENS.VIDEO_CUE,
          dialogLabel: "[DIALOGUE][Session1] ВЕДУЧИЙ (на екран):",
          realtimeLogPrefix: "[Realtime][Session1]",
        });
        await playGong();
        return { awaitVideoEnd: true, activeSession: protectedSession };
      }
    }

    // ── Warmup dialogue — only when intro_flavor exists (non-black_box, non-item_announce) ───
    if (hasFlavor) {
      console.log("[Realtime][Session1] warmup dialogue start");

      // Mirror the spinning dialogue cleanup pattern:
      // 1. Mute mic during mode switch so no ambient noise bleeds into VAD
      // 2. Use 700ms silence (same as spinning) — 1500ms captured too much ambient
      //    noise, which produced garbled transcripts and context-contaminated reactions
      // 3. Clear buffer, then unmute mic with a small server-settle delay
      session.setMicEnabled(false);
      await session.setDialogueMode({
        tools: [],
        instructions: buildModeratorBaseInstructions(systemPrompt),
        silenceDurationMs: 700,
        interruptResponse: false,
        createResponse: false,
      });
      session.clearInputBuffer();
      await delay(300); // let server process mode-switch before mic goes live
      session.setMicEnabled(true);

      // Pre-open a clean read session in parallel — hides connection latency behind
      // player speaking time (up to 8 s). The warmup conversation leaves topic-specific
      // history that causes verbatim prompts to fail on the same session; a fresh
      // session with no history always obeys verbatim instructions reliably.
      // Text questions only — video/black_box/item_announce handle their own transitions.
      let readSessionPromise = null;
      if (!isVideo && openReadSession) {
        readSessionPromise = (async () => {
          const s = await openReadSession();
          if (!s) return null;
          // Disable VAD immediately — this session is for reading only.
          // open() starts with semantic_vad active; while the player speaks
          // during warmup, that audio gets committed as a user conversation item
          // in the read session. The model then sees [user: warmup speech]
          // [assistant: attention cue] and responds in assistant mode instead of
          // reading the question verbatim. Disabling VAD prevents any audio from
          // being committed to this session's conversation history.
          s.setMicEnabled(false);
          try {
            await s.updateSession({ turn_detection: null });
          } catch {}
          s.clearInputBuffer();
          return s;
        })().catch((err) => {
          console.warn(
            "[Realtime][Session1] read session pre-open failed:",
            err?.message
          );
          return null;
        });
      }

      let playerResponded = false;

      try {
        const { transcript, forcedCutoff } = await collectSinglePlayerTurn(
          session,
          "[DIALOGUE][Session1]"
        );

        playerResponded = !!transcript;

        // End player-turn capture before any moderator reaction.
        session.setMicEnabled(false);
        session.clearInputBuffer();

        if (!transcript) {
          console.log(
            forcedCutoff
              ? "[DIALOGUE][Session1] ГРАВЕЦЬ: (репліку примусово обірвано, транскрипт порожній — реакція пропущена)"
              : "[DIALOGUE][Session1] ГРАВЕЦЬ: (транскрипт порожній — реакція пропущена)"
          );
          console.log(
            "[DIALOGUE][Session1] ──────────────────────────────────────"
          );
        } else {
          console.log("[DIALOGUE][Session1] ГРАВЕЦЬ:", transcript);

          await playOptionalReaction(session, {
            instructions: buildWarmupReactionPrompt(gameContext, transcript),
            label: "warmup reaction",
            maxOutputTokens: TOKENS.WARMUP_REACTION,
            dialogPrefix: "[DIALOGUE][Session1]",
            realtimeLogPrefix: "[Realtime][Session1]",
          });

          console.log(
            "[DIALOGUE][Session1] ──────────────────────────────────────"
          );
        }
      } catch {
        console.log(
          "[DIALOGUE][Session1] ГРАВЕЦЬ: (не відповів — реакція пропущена)"
        );
        console.log(
          "[DIALOGUE][Session1] ──────────────────────────────────────"
        );
      }

      try {
        await session.setMonologueMode({ tools: [] });
      } catch {}
      console.log("[Realtime][Session1] warmup dialogue complete");

      if (isVideo) {
        const protectedSession = await switchToCleanProtectedSession(
          session,
          openReadSession,
          "video cue after warmup"
        );
        await playMandatoryProtectedCue(protectedSession, {
          instructions: buildWatchScreenPrompt(gameContext),
          label: "video cue",
          maxOutputTokens: TOKENS.VIDEO_CUE,
          dialogLabel: "[DIALOGUE][Session1] ВЕДУЧИЙ (на екран):",
          realtimeLogPrefix: "[Realtime][Session1]",
        });

        await playGong();
        return { awaitVideoEnd: true, activeSession: protectedSession };
      }

      let protectedSession = null;
      if (readSessionPromise) {
        const readSession = await readSessionPromise;
        if (readSession) {
          try { session.close(); } catch {}
          console.log("[Realtime][Session1] switched to clean read session after warmup");
          protectedSession = readSession;
        }
      }
      if (!protectedSession) {
        protectedSession = await switchToCleanProtectedSession(
          session,
          openReadSession,
          "question read after warmup"
        );
      }

      try {
        await _runQuestionReadPhase(
          protectedSession,
          buildProtectedReadContext(gameContext),
          buildVerbatimBaseInstructions()
        );
      } finally {
        if (protectedSession !== session) {
          try { protectedSession.close(); } catch {}
        }
      }
      return { awaitVideoEnd: false };
    }

    if (skipWarmup) {
      console.log("[Realtime][Session1] warmup skipped for high-risk question", {
        questionId: gameContext?.current_question?.id,
        roundType: gameContext?.current_question?.round_type,
      });
    }
  } else {
    console.log("[Realtime][Session1] blitz continuation — intro skipped", {
      blitzPos,
    });
  }

  // ── Video question without warmup (no flavor, or blitz continuation) ──────
  // Clean context here — no warmup conversation history, so VIDEO_CUE budget
  // is sufficient and no risk of preamble.
  if (isVideo) {
    const protectedSession = await switchToCleanProtectedSession(
      session,
      openReadSession,
      "video cue"
    );
    await playMandatoryProtectedCue(protectedSession, {
      instructions: buildWatchScreenPrompt(gameContext),
      label: "video_cue",
      maxOutputTokens: TOKENS.VIDEO_CUE,
      dialogLabel: "[DIALOGUE][Session1] ВЕДУЧИЙ (на екран):",
      realtimeLogPrefix: "[Realtime][Session1]",
    });
    await playGong();
    return { awaitVideoEnd: true, activeSession: protectedSession };
  }

  const protectedSession = await switchToCleanProtectedSession(
    session,
    openReadSession,
    "question read"
  );
  try {
    await _runQuestionReadPhase(
      protectedSession,
      buildProtectedReadContext(gameContext),
      buildVerbatimBaseInstructions()
    );
  } finally {
    if (protectedSession !== session) {
      try { protectedSession.close(); } catch {}
    }
  }
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

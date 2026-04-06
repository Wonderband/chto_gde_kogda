import { useEffect, useRef, useState } from "react";
import { STATES, EVENTS } from "../game/gameStateMachine";
import {
  RealtimeSession,
  startWheelDialogue,
  runSessionOneFlow,
} from "../services/realtime";
import {
  playListeningCue,
  evaluateSessionTwo,
  playNeutralSegueCue,
  playExplanationCue,
} from "../services/realtime.session2";
import { speak } from "../services/tts";
import { startRecording } from "../services/recorder";
import {
  readQuestion,
  evaluateAnswer,
  buildListeningScript,
} from "../services/openai";

const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";

/**
 * Drives all game-phase side-effects (SPINNING → READING → LISTENING →
 * EVALUATING → SCORING).  Also owns the recording state and the ttsPlaying
 * indicator used by the ModeratorVoice component.
 *
 * Returns isRecording / setIsRecording so that useRecording can wire up
 * the stop-recording action, and ttsPlaying for the UI indicator.
 */
export function useGamePhaseEffects({
  gameState,
  send,
  state,
  currentQuestion,
  score,
  roundNumber,
  evaluation,
  blitzQueue,
  selectedSector,
  preSessionRef,
  postSessionRef,
  systemPromptRef,
  closePreSession,
  closePostSession,
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const recorderRef = useRef(null);

  // ── Helpers ──────────────────────────────────────────────────────────────

  async function tts(text) {
    setTtsPlaying(true);
    try {
      await speak(text);
    } finally {
      setTtsPlaying(false);
    }
  }

  function buildCtx(extra = {}) {
    return {
      round_number: roundNumber,
      score,
      current_question: currentQuestion
        ? {
            id: currentQuestion.id,
            character: currentQuestion.character,
            question_text:
              import.meta.env.VITE_GAME_LANGUAGE === "uk"
                ? currentQuestion.question_uk
                : currentQuestion.question_ru,
            correct_answer: currentQuestion.answer,
            answer_variants: currentQuestion.answer_variants,
            hint_for_evaluator: currentQuestion.hint_for_evaluator,
            round_type: currentQuestion.round_type,
            blitz_position: currentQuestion.blitz_position,
            blitz_group: currentQuestion.blitz_group,
          }
        : null,
      sector_number: (selectedSector ?? 0) + 1,
      blitz_queue_remaining: blitzQueue?.length ?? 0,
      game_language: import.meta.env.VITE_GAME_LANGUAGE || "ru",
      ...extra,
    };
  }

  // ── SPINNING: open one live bidirectional session for wheel small-talk ───

  useEffect(() => {
    if (gameState !== STATES.SPINNING || USE_MOCK) return;

    const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    if (!apiKey || !systemPromptRef.current) return;

    let cancelled = false;

    (async () => {
      try {
        console.log("[App][SPINNING effect:start]");
        closePreSession();

        const session = new RealtimeSession();
        session.onError = (err) =>
          console.error("[Moderator session error]", err.message);
        session.onTriggerPhrase = () => {
          session.setMonologueMode({ tools: [] }).catch((err) =>
            console.error("[Trigger phrase safety switch failed]", err)
          );
        };

        await session.open({
          apiKey,
          systemPrompt: systemPromptRef.current,
          voice: "echo",
          enableMic: true,
        });

        if (cancelled) {
          session.close();
          return;
        }

        preSessionRef.current = session;
        console.log("[App][Spin session ready]");

        await startWheelDialogue(session, systemPromptRef.current, {
          round_number: roundNumber + 1,
          score,
          game_language: import.meta.env.VITE_GAME_LANGUAGE || "ru",
        });
        console.log("[App][Spin first line requested]");
      } catch (err) {
        console.error("[Spin session open failed]", err);
        closePreSession();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [gameState, roundNumber, score.experts, score.viewers]);

  // ── READING: fresh protected Session 1, or TTS fallback in mock mode ─────

  useEffect(() => {
    if (gameState !== STATES.READING || !currentQuestion) return;

    console.log("[App][READING effect]", {
      selectedSector,
      hasQuestion: !!currentQuestion,
      currentQuestionId: currentQuestion?.id,
      hasPreSession: !!preSessionRef.current,
    });

    if (!USE_MOCK) {
      let cancelled = false;

      (async () => {
        const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
        if (!apiKey || !systemPromptRef.current) return;

        const openFreshReadSession = async () => {
          const readSession = new RealtimeSession();
          readSession.onError = (err) =>
            console.error("[Moderator session error]", err.message);
          await readSession.open({
            apiKey,
            systemPrompt: systemPromptRef.current,
            voice: "echo",
            enableMic: false,
          });
          return readSession;
        };

        try {
          closePreSession();
          let attempt = 0;
          let completed = false;
          let lastErr = null;

          while (!completed && attempt < 2 && !cancelled) {
            attempt += 1;
            let session = null;
            try {
              session = await openFreshReadSession();
              if (cancelled) {
                session.close();
                return;
              }
              preSessionRef.current = session;
              console.log("[App][Session1 start]", {
                sector: (selectedSector ?? 0) + 1,
                currentQuestionId: currentQuestion?.id,
                freshReadSession: true,
                attempt,
              });
              await runSessionOneFlow({
                session,
                systemPrompt: systemPromptRef.current,
                gameContext: buildCtx(),
                warmupTimeoutMs: 6000,
              });
              completed = true;
            } catch (e) {
              lastErr = e;
              console.error("[Session 1 flow failed]", { attempt, error: e });
            } finally {
              if (session) session.close();
              if (preSessionRef.current === session)
                preSessionRef.current = null;
            }
          }

          if (!completed) {
            throw lastErr || new Error("Session 1 read did not complete cleanly");
          }

          console.log("[App][Session1 done]");
          if (!cancelled) send(EVENTS.READING_DONE);
        } catch (e) {
          console.error("[Session 1 final failure]", e);
          closePreSession();
        }
      })();

      return () => {
        cancelled = true;
        closePreSession();
      };
    }

    // Mock / TTS fallback
    let cancelled = false;
    (async () => {
      try {
        const { text, responseId } = await readQuestion(
          buildCtx(),
          state.lastResponseId
        );
        if (cancelled) return;
        if (responseId) send("SET_LAST_RESPONSE_ID", responseId);
        await tts(text);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) send(EVENTS.READING_DONE);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gameState, currentQuestion]);

  // ── LISTENING: short protected cue → start recording ────────────────────

  useEffect(() => {
    if (gameState !== STATES.LISTENING) {
      setIsRecording(false);
      return;
    }

    if (!USE_MOCK) {
      const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
      let cancelled = false;

      (async () => {
        try {
          if (apiKey && systemPromptRef.current) {
            closePostSession();
            const session = new RealtimeSession();
            session.onError = (err) =>
              console.error("[Session2 cue error]", err.message);
            await session.open({
              apiKey,
              systemPrompt: systemPromptRef.current,
              voice: "echo",
              enableMic: false,
            });
            if (cancelled) {
              session.close();
              return;
            }
            postSessionRef.current = session;
            await playListeningCue({
              session,
              systemPrompt: systemPromptRef.current,
              gameContext: buildCtx(),
              earlyAnswer: state.earlyAnswer,
            });
          } else {
            const lang = import.meta.env.VITE_GAME_LANGUAGE || "ru";
            await tts(buildListeningScript(state.earlyAnswer, lang));
          }

          if (cancelled) return;
          setIsRecording(true);
          recorderRef.current = await startRecording();
        } catch (e) {
          console.error(e);
          if (!cancelled) send(EVENTS.RECORDING_DONE, "");
        } finally {
          closePostSession();
        }
      })();

      return () => {
        cancelled = true;
        closePostSession();
      };
    }

    // Mock mode
    (async () => {
      try {
        const lang = import.meta.env.VITE_GAME_LANGUAGE || "ru";
        await tts(buildListeningScript(state.earlyAnswer, lang));
        setIsRecording(true);
        recorderRef.current = await startRecording();
      } catch (e) {
        console.error(e);
        send(EVENTS.RECORDING_DONE, "");
      }
    })();
  }, [gameState]);

  // ── EVALUATING: text-only evaluator ──────────────────────────────────────

  useEffect(() => {
    if (gameState !== STATES.EVALUATING) return;

    if (!USE_MOCK) {
      let cancelled = false;

      (async () => {
        try {
          const { evaluation: result, responseId } = await evaluateSessionTwo({
            buildCtx,
            state,
            currentQuestion,
            evaluateAnswerFn: evaluateAnswer,
          });

          if (cancelled) return;
          if (responseId) send("SET_LAST_RESPONSE_ID", responseId);

          const correct = result.correct ?? false;
          send(EVENTS.EVALUATION_DONE, {
            ...result,
            correct,
            score_delta: result.score_delta ?? 1,
            who_scores: result.who_scores ?? (correct ? "experts" : "viewers"),
            moderator_phrase:
              result.moderator_phrase ||
              (correct
                ? "Ответ принят. Знатоки получают очко."
                : "Ответ не принят. Очко получает телезритель."),
            correct_answer_reveal:
              result.correct_answer_reveal ?? currentQuestion?.answer ?? "?",
          });
        } catch (err) {
          console.error("[Evaluation failed]", err);
          if (!cancelled) {
            send(EVENTS.EVALUATION_DONE, {
              correct: false,
              score_delta: 1,
              who_scores: "viewers",
              moderator_phrase: "Ответ не принят. Очко получает телезритель.",
              correct_answer_reveal: currentQuestion?.answer || "?",
            });
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }

    // Mock mode
    (async () => {
      try {
        const { evaluation: result, responseId } = await evaluateAnswer(
          buildCtx({ team_answer_transcript: state.transcript }),
          state.lastResponseId
        );
        if (responseId) send("SET_LAST_RESPONSE_ID", responseId);
        send(EVENTS.EVALUATION_DONE, result);
      } catch (e) {
        console.error(e);
        send(EVENTS.EVALUATION_DONE, {
          correct: false,
          score_delta: 1,
          who_scores: "viewers",
          moderator_phrase: "Відповідь не зараховано.",
          correct_answer_reveal: currentQuestion?.answer || "?",
        });
      }
    })();
  }, [gameState]);

  // ── SCORING: neutral segue cue only — session stays open for EXPLAINING ──

  useEffect(() => {
    if (gameState !== STATES.SCORING || !evaluation) return;

    if (!USE_MOCK) {
      const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
      let cancelled = false;

      (async () => {
        try {
          if (apiKey && systemPromptRef.current) {
            closePostSession();
            const session = new RealtimeSession();
            session.onError = (err) =>
              console.error("[Session2 segue error]", err.message);
            await session.open({
              apiKey,
              systemPrompt: systemPromptRef.current,
              voice: "echo",
              enableMic: false,
            });
            if (cancelled) {
              session.close();
              return;
            }
            // Keep session open — EXPLAINING will reuse it
            postSessionRef.current = session;
            await playNeutralSegueCue({
              session,
              systemPrompt: systemPromptRef.current,
              gameContext: buildCtx(),
            });
          }
          // No TTS fallback needed — segue is optional; EXPLAINING will speak the key content
        } catch (e) {
          console.error("[SCORING segue failed]", e);
        } finally {
          // Do NOT closePostSession() here — session must stay open for EXPLAINING
          if (!cancelled) send(EVENTS.SCORING_DONE);
        }
      })();

      return () => {
        cancelled = true;
      };
    }

    // Mock mode: skip segue cue, just advance immediately
    send(EVENTS.SCORING_DONE);
  }, [gameState, evaluation]);

  // ── EXPLAINING: full narrative — reasoning + answer + verdict + score ─────

  useEffect(() => {
    if (gameState !== STATES.EXPLAINING || !evaluation) return;

    if (!USE_MOCK) {
      const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
      let cancelled = false;

      (async () => {
        try {
          const session = postSessionRef.current;
          if (session && apiKey) {
            await playExplanationCue({
              session,
              systemPrompt: systemPromptRef.current || "",
              evaluation,
              gameContext: buildCtx(),
            });
          }
          // If no session (e.g. API key missing), silently skip audio and advance
        } catch (e) {
          console.error("[EXPLAINING effect]", e);
        } finally {
          closePostSession();
          if (!cancelled) send(EVENTS.EXPLAINING_DONE);
        }
      })();

      return () => {
        cancelled = true;
        closePostSession();
      };
    }

    // Mock mode: TTS is acceptable here (voice inconsistency only matters in real mode)
    (async () => {
      try {
        await tts(evaluation.explanation || evaluation.correct_answer_reveal || "");
      } catch (e) {
        console.error("[EXPLAINING mock]", e);
      } finally {
        send(EVENTS.EXPLAINING_DONE);
      }
    })();
  }, [gameState, evaluation]);

  return { isRecording, setIsRecording, ttsPlaying, recorderRef };
}

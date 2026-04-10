import { useEffect, useRef, useState } from "react";
import { STATES, EVENTS } from "../game/gameStateMachine";
import {
  RealtimeSession,
  startWheelDialogue,
  runSessionOneFlow,
  finishVideoQuestionFlow,
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
import { GAME_LANGUAGE, REALTIME_VOICE } from "../config.js";

const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";

function isVideoQuestion(question) {
  return question?.presentation_mode === "video" && !!question?.video_src;
}

function buildVideoFullIntroFallbackText(question, sectorNumber, lang) {
  const isRu = lang === "ru";
  const character = question?.character || "";
  const sector = sectorNumber ?? 1;
  const pos = question?.blitz_position || 1;

  // Blitz Q2/Q3: sector+character already announced for Q1 — skip intro
  if (question?.round_type === "blitz" && pos > 1) {
    const posLabel = isRu
      ? ["Первый", "Второй", "Третий"][pos - 1] || `${pos}-й`
      : ["Перше", "Друге", "Третє"][pos - 1] || `${pos}-е`;
    return isRu
      ? `Внимание на экран. ${posLabel} вопрос.`
      : `Увага на екран. ${posLabel} питання.`;
  }

  return isRu
    ? `Сектор ${sector}. Вопрос от ${character}. А теперь — внимание на экран.`
    : `Сектор ${sector}. Питання від ${character}. А тепер — увага на екран.`;
}

function buildVideoTimeCueFallbackText(question, lang) {
  const isRu = lang === "ru";
  return question?.round_type === "blitz"
    ? isRu
      ? "Время! Двадцать секунд!"
      : "Час! Двадцять секунд!"
    : isRu
    ? "Время! Минута обсуждения!"
    : "Час! Хвилина обговорення!";
}

/**
 * Builds the full spoken explanation text from hard-coded material — no AI generation.
 * Structure: hint_for_evaluator (verbatim) → verdict sentence → score sentence.
 */
function buildSpeechText(q, evaluation, score, blitzQueue, lang) {
  const isUk = lang !== "ru";
  const hint = q?.hint_for_evaluator || "";
  const correct = evaluation.correct;
  const isBlitzIntermediate = evaluation.blitz_intermediate;

  const verdictLine = correct
    ? isUk
      ? "І ваша відповідь правильна."
      : "И ваш ответ правильный."
    : isUk
    ? "На жаль, знавці помилилися."
    : "К сожалению, знатоки ошиблись.";

  let scoreLine;
  if (isBlitzIntermediate) {
    scoreLine = isUk ? "Продовжуємо бліц!" : "Продолжаем блиц!";
  } else {
    const newExperts = score.experts + (correct ? 1 : 0);
    const newViewers = score.viewers + (correct ? 0 : 1);
    scoreLine = isUk
      ? `Рахунок стає ${newExperts}:${newViewers}.`
      : `Счёт становится ${newExperts}:${newViewers}.`;
  }

  return [hint, verdictLine, scoreLine].filter(Boolean).join(" ");
}

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
  playersRef,
  closePreSession,
  closePostSession,
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const recorderRef = useRef(null);
  const awaitingVideoEndRef = useRef(false);
  const videoFinishInFlightRef = useRef(false);

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
              GAME_LANGUAGE === "uk"
                ? currentQuestion.question_uk
                : currentQuestion.question_ru,
            correct_answer: currentQuestion.answer,
            answer_variants: currentQuestion.answer_variants,
            hint_for_evaluator: currentQuestion.hint_for_evaluator,
            intro_flavor: currentQuestion.intro_flavor,
            round_type: currentQuestion.round_type,
            blitz_position: currentQuestion.blitz_position,
            blitz_group: currentQuestion.blitz_group,
            presentation_mode: currentQuestion.presentation_mode,
            video_src: currentQuestion.video_src,
            video_poster: currentQuestion.video_poster,
          }
        : null,
      sector_number: (selectedSector ?? 0) + 1,
      blitz_queue_remaining: blitzQueue?.length ?? 0,
      game_language: GAME_LANGUAGE,
      ...extra,
    };
  }

  async function handleQuestionVideoEnded() {
    if (gameState !== STATES.READING) return;
    if (!isVideoQuestion(currentQuestion)) return;
    if (!awaitingVideoEndRef.current) return;
    if (videoFinishInFlightRef.current) return;

    videoFinishInFlightRef.current = true;
    setVideoReady(false); // hide backdrop before speaking — video gone first, then cue
    await new Promise((r) => setTimeout(r, 350)); // brief pause to let backdrop exit

    try {
      if (!USE_MOCK && preSessionRef.current && systemPromptRef.current) {
        await finishVideoQuestionFlow({
          session: preSessionRef.current,
          systemPrompt: systemPromptRef.current,
          gameContext: buildCtx(),
        });
      } else {
        await tts(
          buildVideoTimeCueFallbackText(currentQuestion, GAME_LANGUAGE)
        );
      }
    } catch (err) {
      console.error("[Video question finish failed]", err);
    } finally {
      awaitingVideoEndRef.current = false;
      videoFinishInFlightRef.current = false;
      closePreSession();
      send(EVENTS.READING_DONE);
    }
  }

  useEffect(() => {
    if (gameState !== STATES.SPINNING) return;

    // Background music — plays even in mock mode; silently skipped if file absent
    const music = new Audio("/sounds/wheel-music.mp3");
    music.loop = true;
    music.volume = 0.35;
    music.play().catch(() => {});

    if (
      USE_MOCK ||
      !import.meta.env.VITE_OPENAI_API_KEY ||
      !systemPromptRef.current
    ) {
      return () => {
        music.pause();
        music.src = "";
      };
    }

    const WHEEL_DELAY_MS = 4000;

    let cancelled = false;

    (async () => {
      try {
        console.log("[App][SPINNING effect:start]");
        closePreSession();

        const session = new RealtimeSession();
        session.onError = (err) =>
          console.error("[Moderator session error]", err.message);
        // NOTE: onTriggerPhrase intentionally NOT set here — trigger phrases
        // like "увага питання" must not interrupt the spinning dialogue.

        await session.open({
          apiKey: import.meta.env.VITE_OPENAI_API_KEY,
          systemPrompt: systemPromptRef.current,
          voice: REALTIME_VOICE,
          enableMic: true,
        });

        if (cancelled) {
          session.close();
          return;
        }

        preSessionRef.current = session;
        console.log("[App][Spin session ready]");

        await startWheelDialogue(
          session,
          systemPromptRef.current,
          {
            round_number: roundNumber + 1,
            score,
            game_language: GAME_LANGUAGE,
            players: playersRef?.current || [],
          },
          { delayMs: WHEEL_DELAY_MS }
        );

        if (cancelled) return;
        console.log("[App][Spin dialogue started]");
      } catch (err) {
        console.error("[Spin session open failed]", err);
        closePreSession();
      }
    })();

    return () => {
      cancelled = true;
      music.pause();
      music.src = "";
    };
  }, [gameState, roundNumber, score.experts, score.viewers]);

  useEffect(() => {
    if (gameState !== STATES.READING || !currentQuestion) {
      awaitingVideoEndRef.current = false;
      videoFinishInFlightRef.current = false;
      setVideoReady(false);
      return;
    }

    console.log("[App][READING effect]", {
      selectedSector,
      hasQuestion: !!currentQuestion,
      currentQuestionId: currentQuestion?.id,
      hasPreSession: !!preSessionRef.current,
      videoMode: isVideoQuestion(currentQuestion),
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
            voice: REALTIME_VOICE,
            enableMic: false,
          });
          return readSession;
        };

        try {
          closePreSession();
          let attempt = 0;
          let completed = false;
          let lastErr = null;
          let waitingForVideoEnd = false;

          while (!completed && attempt < 2 && !cancelled) {
            attempt += 1;
            let session = null;
            let keepSessionOpen = false;

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

              const result = await runSessionOneFlow({
                session,
                systemPrompt: systemPromptRef.current,
                gameContext: buildCtx(),
                warmupTimeoutMs: 6000,
              });

              waitingForVideoEnd = !!result?.awaitVideoEnd;
              keepSessionOpen = waitingForVideoEnd;
              completed = true;
            } catch (e) {
              lastErr = e;
              console.error("[Session 1 flow failed]", { attempt, error: e });
            } finally {
              if (!keepSessionOpen && session) session.close();
              if (!keepSessionOpen && preSessionRef.current === session) {
                preSessionRef.current = null;
              }
            }
          }

          if (!completed) {
            throw (
              lastErr || new Error("Session 1 read did not complete cleanly")
            );
          }

          if (waitingForVideoEnd) {
            awaitingVideoEndRef.current = true;
            setVideoReady(true);
            console.log("[App][Session1 waiting for video end]");
            return;
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
        if (!awaitingVideoEndRef.current) {
          closePreSession();
        }
      };
    }

    let cancelled = false;
    (async () => {
      try {
        if (isVideoQuestion(currentQuestion)) {
          await tts(
            buildVideoFullIntroFallbackText(
              currentQuestion,
              (selectedSector ?? 0) + 1,
              GAME_LANGUAGE
            )
          );
          if (!cancelled) {
            awaitingVideoEndRef.current = true;
            setVideoReady(true);
          }
          return;
        }

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
        if (!cancelled && !isVideoQuestion(currentQuestion)) {
          send(EVENTS.READING_DONE);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gameState, currentQuestion]);

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
              voice: REALTIME_VOICE,
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
            await tts(buildListeningScript(state.earlyAnswer, GAME_LANGUAGE));
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

    (async () => {
      try {
        await tts(buildListeningScript(state.earlyAnswer, GAME_LANGUAGE));
        setIsRecording(true);
        recorderRef.current = await startRecording();
      } catch (e) {
        console.error(e);
        send(EVENTS.RECORDING_DONE, "");
      }
    })();
  }, [gameState]);

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
          const correctAnswerReveal =
            result.correct_answer_reveal ?? currentQuestion?.answer ?? "?";
          const isBlitzIntermediate =
            (blitzQueue?.length ?? 0) > 0 && correct === true;
          const partialEval = {
            correct,
            blitz_intermediate: isBlitzIntermediate,
            correct_answer_reveal: correctAnswerReveal,
          };
          const explanation = buildSpeechText(
            currentQuestion,
            partialEval,
            score,
            blitzQueue,
            GAME_LANGUAGE
          );
          send(EVENTS.EVALUATION_DONE, {
            correct,
            who_scores: correct ? "experts" : "viewers",
            correct_answer_reveal: correctAnswerReveal,
            blitz_intermediate: isBlitzIntermediate,
            explanation,
          });
        } catch (err) {
          console.error("[Evaluation failed]", err);
          if (!cancelled) {
            const fallbackEval = {
              correct: false,
              blitz_intermediate: false,
              correct_answer_reveal: currentQuestion?.answer || "?",
            };
            send(EVENTS.EVALUATION_DONE, {
              correct: false,
              who_scores: "viewers",
              correct_answer_reveal: currentQuestion?.answer || "?",
              blitz_intermediate: false,
              explanation: buildSpeechText(
                currentQuestion,
                fallbackEval,
                score,
                blitzQueue,
                GAME_LANGUAGE
              ),
            });
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const { evaluation: result, responseId } = await evaluateAnswer(
          buildCtx({ team_answer_transcript: state.transcript }),
          state.lastResponseId
        );
        if (responseId) send("SET_LAST_RESPONSE_ID", responseId);
        const correct = result.correct ?? false;
        const correctAnswerReveal =
          result.correct_answer_reveal ?? currentQuestion?.answer ?? "?";
        const isBlitzIntermediate =
          (blitzQueue?.length ?? 0) > 0 && correct === true;
        const partialEval = {
          correct,
          blitz_intermediate: isBlitzIntermediate,
          correct_answer_reveal: correctAnswerReveal,
        };
        const explanation = buildSpeechText(
          currentQuestion,
          partialEval,
          score,
          blitzQueue,
          GAME_LANGUAGE
        );
        send(EVENTS.EVALUATION_DONE, {
          correct,
          who_scores: correct ? "experts" : "viewers",
          correct_answer_reveal: correctAnswerReveal,
          blitz_intermediate: isBlitzIntermediate,
          explanation,
        });
      } catch (e) {
        console.error(e);
        const fallbackEval = {
          correct: false,
          blitz_intermediate: false,
          correct_answer_reveal: currentQuestion?.answer || "?",
        };
        send(EVENTS.EVALUATION_DONE, {
          correct: false,
          who_scores: "viewers",
          correct_answer_reveal: currentQuestion?.answer || "?",
          blitz_intermediate: false,
          explanation: buildSpeechText(
            currentQuestion,
            fallbackEval,
            score,
            blitzQueue,
            GAME_LANGUAGE
          ),
        });
      }
    })();
  }, [gameState]);

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
              voice: REALTIME_VOICE,
              enableMic: false,
            });
            if (cancelled) {
              session.close();
              return;
            }
            postSessionRef.current = session;
            await playNeutralSegueCue({
              session,
              systemPrompt: systemPromptRef.current,
              gameContext: buildCtx(),
            });
          }
        } catch (e) {
          console.error("[SCORING segue failed]", e);
        } finally {
          if (!cancelled) send(EVENTS.SCORING_DONE);
        }
      })();

      return () => {
        cancelled = true;
      };
    }

    send(EVENTS.SCORING_DONE);
  }, [gameState, evaluation]);

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

    (async () => {
      try {
        await tts(
          evaluation.explanation || evaluation.correct_answer_reveal || ""
        );
      } catch (e) {
        console.error("[EXPLAINING mock]", e);
      } finally {
        send(EVENTS.EXPLAINING_DONE);
      }
    })();
  }, [gameState, evaluation]);

  return {
    isRecording,
    setIsRecording,
    ttsPlaying,
    recorderRef,
    handleQuestionVideoEnded,
    videoReady,
  };
}

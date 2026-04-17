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
} from "../services/realtime.session2";
import { speak } from "../services/tts";
import { startRecording } from "../services/recorder";
import {
  readQuestion,
  evaluateAnswer,
} from "../services/openai";
import {
  GAME_LANGUAGE,
  REALTIME_VOICE,
  WHEEL_DIALOGUE_DELAY_MS,
  VIDEO_TO_SPEECH_DELAY_MS,
  SOUND_VOLUMES,
  SPIN_DURATION_MS,
} from "../config.js";
import { playGong, playBlackBoxMusic, playLooped } from "../utils/sounds.js";
import { timeLine, blitzPositionLabel } from "../game/gameText.js";
import { getCharacterIntro } from "../data/characters.js";

const ORDINALS_UK = [
  "Перший", "Другий", "Третій", "Четвертий", "П'ятий",
  "Шостий", "Сьомий", "Восьмий", "Дев'ятий", "Десятий",
];
const ORDINALS_RU = [
  "Первый", "Второй", "Третий", "Четвёртый", "Пятый",
  "Шестой", "Седьмой", "Восьмой", "Девятый", "Десятый",
];

function buildRoundAnnouncementText(roundNumber, lang) {
  const n = roundNumber; // roundNumber is incremented on SPIN_DONE, so here it's the upcoming round
  const ordinals = lang === "ru" ? ORDINALS_RU : ORDINALS_UK;
  const ordinal = ordinals[n - 1] || `${n}-й`;
  return lang === "ru"
    ? `Внимание! Мы начинаем ${ordinal} раунд!`
    : `Увага! Ми починаємо ${ordinal} раунд!`;
}

const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";

function isVideoQuestion(question) {
  return question?.presentation_mode === "video" && !!question?.video_src;
}

function buildSectorIntroText(question, sectorNumber, lang) {
  const isRu = lang === "ru";
  const sector = sectorNumber ?? 1;
  const { displayName, intro } = getCharacterIntro(question?.character || "", lang);
  const heroName = displayName || question?.character || (isRu ? "неизвестный герой" : "невідомий герой");
  const vsLine = isRu
    ? `Против знатоков играет ${heroName}.`
    : `Проти знавців грає ${heroName}.`;
  return [isRu ? `Сектор ${sector}.` : `Сектор ${sector}.`, vsLine, intro].filter(Boolean).join(" ");
}

function buildAttentionCueText(question, lang) {
  const isRu = lang === "ru";
  if (question?.round_type !== "blitz") {
    return isRu ? "Внимание! Вопрос!" : "Увага! Питання!";
  }
  const label = blitzPositionLabel(question?.blitz_position || 1, lang);
  return isRu ? `Внимание! ${label} вопрос!` : `Увага! ${label} питання!`;
}

function buildQuestionBodyText(question, lang) {
  return lang === "ru" ? (question?.question_ru || "") : (question?.question_uk || "");
}

function buildTextQuestionIntroText(question, sectorNumber, lang) {
  const isRu = lang === "ru";
  const pos = question?.blitz_position || 1;
  if (question?.round_type === "blitz" && pos > 1) {
    return "";
  }
  if (question?.round_type === "blitz") {
    const rules = isRu
      ? `Сектор ${sectorNumber ?? 1}. Сектор Блиц! Три вопроса. Двадцать секунд на каждый.`
      : `Сектор ${sectorNumber ?? 1}. Сектор Бліц! Три питання. Двадцять секунд на кожне.`;
    const heroIntro = buildSectorIntroText(question, sectorNumber, lang)
      .replace(/^Сектор \d+\.\s*/, "")
      .trim();
    return [rules, heroIntro].filter(Boolean).join(" ");
  }
  return buildSectorIntroText(question, sectorNumber, lang);
}

function buildVideoFullIntroFallbackText(question, sectorNumber, lang) {
  const isRu = lang === "ru";
  const pos = question?.blitz_position || 1;

  if (question?.round_type === "blitz" && pos > 1) {
    const posLabel = isRu
      ? ["Первый", "Второй", "Третий"][pos - 1] || `${pos}-й`
      : ["Перше", "Друге", "Третє"][pos - 1] || `${pos}-е`;
    return isRu
      ? `Внимание на экран. ${posLabel} вопрос.`
      : `Увага на екран. ${posLabel} питання.`;
  }

  return buildSectorIntroText(question, sectorNumber, lang);
}

function buildVideoTimeCueFallbackText(question, lang) {
  return timeLine(question, lang);
}

function buildListeningCueFallbackText(earlyAnswer, lang) {
  const isRu = lang === "ru";
  if (earlyAnswer) {
    return isRu
      ? "Досрочный ответ. Тишина в студии! Кто будет отвечать?"
      : "Дострокова відповідь. Тиша в студії! Хто відповідатиме?";
  }
  return isRu
    ? "Время! Тишина в студии! Кто будет отвечать?"
    : "Час! Тиша в студії! Хто відповідатиме?";
}

function buildExplanationBodyText(q, evaluation, lang) {
  const isUk = lang !== "ru";
  const hint = (q?.hint_for_evaluator || "").trim();
  const correct = !!evaluation?.correct;

  const verdictLine = correct
    ? isUk
      ? "І ваша відповідь правильна."
      : "И ваш ответ правильный."
    : isUk
    ? "На жаль, знавці помилилися."
    : "К сожалению, знатоки ошиблись.";

  return [hint, verdictLine].filter(Boolean).join(" ").trim();
}

function buildScoreAnnouncementText(evaluation, score, lang) {
  const isUk = lang !== "ru";
  const isBlitzIntermediate = !!evaluation?.blitz_intermediate;

  if (isBlitzIntermediate) {
    return isUk ? "Продовжуємо бліц!" : "Продолжаем блиц!";
  }

  const correct = !!evaluation?.correct;
  const newExperts = score.experts + (correct ? 1 : 0);
  const newViewers = score.viewers + (correct ? 0 : 1);
  return isUk
    ? `Рахунок стає ${newExperts}:${newViewers}.`
    : `Счёт становится ${newExperts}:${newViewers}.`;
}

function buildSpeechText(q, evaluation, score, blitzQueue, lang) {
  return [
    buildExplanationBodyText(q, evaluation, lang),
    buildScoreAnnouncementText(evaluation, score, lang),
  ].filter(Boolean).join(" ");
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

  async function tts(text, options = {}) {
    setTtsPlaying(true);
    try {
      await speak(text, options);
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
            item_to_announce: currentQuestion.item_to_announce,
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
      retry_attempt: state.retryCount ?? 0,
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
    await new Promise((r) => setTimeout(r, VIDEO_TO_SPEECH_DELAY_MS)); // brief pause to let backdrop exit

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

  // ── ANNOUNCING: TTS announces round number, then triggers SPINNING ──────────
  useEffect(() => {
    if (gameState !== STATES.ANNOUNCING) return;

    let cancelled = false;
    const announcementText = buildRoundAnnouncementText(roundNumber + 1, GAME_LANGUAGE);

    (async () => {
      try {
        await tts(announcementText, {
          voice: REALTIME_VOICE,
          // Enforce Ukrainian pronunciation — gpt-4o-mini-tts honours this;
          // tts-1 ignores it silently (no harm done).
          instructions: GAME_LANGUAGE === "ru"
            ? "Говори на русском языке. Произноси все слова как носитель русского языка."
            : "Говори українською мовою. Вимовляй усі слова як носій української мови.",
        });
      } catch (e) {
        console.error("[ANNOUNCING] TTS failed", e);
      } finally {
        if (!cancelled) send(EVENTS.ANNOUNCING_DONE);
      }
    })();

    return () => { cancelled = true; };
  }, [gameState]);

  useEffect(() => {
    if (gameState !== STATES.SPINNING) return;

    // Background music — plays even in mock mode; silently skipped if file absent
    const music = new Audio("/sounds/wheel-music.mp3");
    music.loop = true;
    music.volume = SOUND_VOLUMES.wheel;
    music.play().catch(() => {});

    if (
      USE_MOCK ||
      !import.meta.env.VITE_OPENAI_API_KEY ||
      !systemPromptRef.current
    ) {
      return () => {
        music.pause();
      };
    }

    let cancelled = false;

    const spinEffectStartedAt = Date.now();

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
          enableMic: false,
        });

        if (cancelled) {
          session.close();
          return;
        }

        preSessionRef.current = session;
        console.log("[App][Spin session ready]");

        const spinDeadlineAt = spinEffectStartedAt + SPIN_DURATION_MS - 1200;

        await startWheelDialogue(
          session,
          systemPromptRef.current,
          {
            round_number: roundNumber + 1,
            score,
            game_language: GAME_LANGUAGE,
            players: playersRef?.current || [],
          },
          {
            delayMs: WHEEL_DIALOGUE_DELAY_MS,
            deadlineAt: spinDeadlineAt,
          }
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
      closePreSession();
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

    closePreSession();

    let cancelled = false;
    (async () => {
      try {
        const isBlackBox = currentQuestion?.round_type === "black_box";
        const isItemAnnounce = !!currentQuestion?.item_to_announce;
        const isVideo = isVideoQuestion(currentQuestion);
        const sector = (selectedSector ?? 0) + 1;
        const isRu = GAME_LANGUAGE === "ru";
        const watchScreenCue = isRu ? "Внимание на экран!" : "Увага на екран!";
        const blackBoxCue = isRu ? "Внимание, чёрный ящик!" : "Увага, чорний ящик!";
        const itemCue = currentQuestion?.item_to_announce || "";
        const introLine = isVideo
          ? buildVideoFullIntroFallbackText(currentQuestion, sector, GAME_LANGUAGE)
          : buildTextQuestionIntroText(currentQuestion, sector, GAME_LANGUAGE);
        const shouldWarmup = !!currentQuestion?.intro_flavor && !(currentQuestion?.round_type === "blitz" && (currentQuestion?.blitz_position || 1) > 1);

        if (introLine && !cancelled) {
          await tts(introLine, { voice: REALTIME_VOICE });
        }

        if (!cancelled && !USE_MOCK && shouldWarmup) {
          const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
          if (apiKey && systemPromptRef.current) {
            let warmupSession = null;
            try {
              warmupSession = new RealtimeSession();
              warmupSession.onError = (err) =>
                console.error("[Warmup session error]", err.message);
              await warmupSession.open({
                apiKey,
                systemPrompt: systemPromptRef.current,
                voice: REALTIME_VOICE,
                enableMic: false,
              });
              if (!cancelled) {
                await runSessionOneFlow({
                  session: warmupSession,
                  systemPrompt: systemPromptRef.current,
                  gameContext: buildCtx(),
                  warmupTimeoutMs: 6000,
                });
              }
            } catch (err) {
              console.error("[Warmup dialogue failed — continuing to protected read]", err);
            } finally {
              try {
                warmupSession?.close();
              } catch {}
            }
          }
        }

        if (cancelled) return;

        if (isVideo) {
          if (isBlackBox) {
            await tts(blackBoxCue, { voice: REALTIME_VOICE });
            if (!cancelled) {
              await playBlackBoxMusic();
            }
            if (!cancelled) {
              await tts(watchScreenCue, { voice: REALTIME_VOICE });
            }
          } else if (isItemAnnounce) {
            if (!cancelled) {
              await playBlackBoxMusic();
            }
            if (!cancelled && itemCue) {
              await tts(itemCue, { voice: REALTIME_VOICE });
            }
            if (!cancelled) {
              await tts(watchScreenCue, { voice: REALTIME_VOICE });
            }
          } else {
            await tts(watchScreenCue, { voice: REALTIME_VOICE });
          }

          if (!cancelled) {
            await playGong();
            awaitingVideoEndRef.current = true;
            setVideoReady(true);
          }
          return;
        }

        const attentionLine = buildAttentionCueText(currentQuestion, GAME_LANGUAGE);
        const questionBody = buildQuestionBodyText(currentQuestion, GAME_LANGUAGE);
        const discussionLine = timeLine(currentQuestion, GAME_LANGUAGE);

        if (attentionLine && !cancelled) {
          await tts(attentionLine, { voice: REALTIME_VOICE });
        }
        if (!cancelled) {
          await playGong();
        }
        if (questionBody && !cancelled) {
          await tts(questionBody, { voice: REALTIME_VOICE });
        }
        if (discussionLine && !cancelled) {
          await tts(discussionLine, { voice: REALTIME_VOICE });
        }

        if (!cancelled) send(EVENTS.READING_DONE);
      } catch (e) {
        console.error("[READING deterministic flow failed]", e);
      }
    })();

    return () => {
      cancelled = true;
      closePreSession();
    };
  }, [gameState, currentQuestion]);

  // ── DISCUSSING: pre-open Session 2 in the background ────────────────────────
  // Session 2 open() is a WebRTC handshake (~3-5 s). Starting it here, while the
  // team is discussing, means it's ready the instant TIMER_DONE fires so the
  // moderator can speak without delay.
  useEffect(() => {
    if (gameState !== STATES.DISCUSSING) return;
    if (USE_MOCK) return;

    const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    if (!apiKey || !systemPromptRef.current) return;

    let cancelled = false;

    (async () => {
      try {
        closePostSession();
        const session = new RealtimeSession();
        session.onError = (err) =>
          console.error("[Session2 pre-open error]", err.message);
        await session.open({
          apiKey,
          systemPrompt: systemPromptRef.current,
          voice: REALTIME_VOICE,
          enableMic: false,
        });
        if (cancelled) { session.close(); return; }
        postSessionRef.current = session;
        console.log("[App][DISCUSSING] Session 2 pre-opened and ready");
      } catch (err) {
        console.error("[App][DISCUSSING] Session 2 pre-open failed — will open fresh in LISTENING", err);
      }
    })();

    return () => { cancelled = true; };
  }, [gameState]);

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
          if (state.retryCount === 0) {
            if (apiKey && systemPromptRef.current) {
              // Reuse pre-opened session from DISCUSSING if ready; otherwise open fresh.
              let session = postSessionRef.current;
              if (!session) {
                session = new RealtimeSession();
                session.onError = (err) =>
                  console.error("[Session2 cue error]", err.message);
                await session.open({
                  apiKey,
                  systemPrompt: systemPromptRef.current,
                  voice: REALTIME_VOICE,
                  enableMic: false,
                });
                if (cancelled) { session.close(); return; }
                postSessionRef.current = session;
              }
              await playListeningCue({
                session,
                systemPrompt: systemPromptRef.current,
                gameContext: buildCtx(),
                earlyAnswer: state.earlyAnswer,
              });
            } else {
              await tts(buildListeningCueFallbackText(state.earlyAnswer, GAME_LANGUAGE));
            }
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
        if (state.retryCount === 0) {
          await tts(buildListeningCueFallbackText(state.earlyAnswer, GAME_LANGUAGE));
        }
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

          // Clarification retry: if evaluator says transcript is unintelligible and
          // this is the first attempt, play an apology and go back to LISTENING.
          if (result.no_answer && state.retryCount === 0) {
            const apology = GAME_LANGUAGE === "ru"
              ? "Не расслышал ответ. Пожалуйста, повторите громче."
              : "Не розібрав відповідь. Будь ласка, повторіть голосніше.";
            await speak(apology, { voice: "echo" });
            if (!cancelled) send(EVENTS.CLARIFICATION_NEEDED);
            return;
          }

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

    let cancelled = false;

    (async () => {
      try {
        const segueText = GAME_LANGUAGE === "ru"
          ? "А теперь — правильный ответ."
          : "А тепер — правильна відповідь.";
        await tts(segueText, { voice: REALTIME_VOICE });
      } catch (e) {
        console.error("[SCORING segue failed]", e);
      } finally {
        closePostSession();
        if (!cancelled) send(EVENTS.SCORING_DONE);
      }
    })();

    return () => {
      cancelled = true;
      closePostSession();
    };
  }, [gameState, evaluation]);

  useEffect(() => {
    if (gameState !== STATES.EXPLAINING || !evaluation) return;

    let cancelled = false;

    (async () => {
      try {
        await playGong();

        const explanationBody = buildExplanationBodyText(
          currentQuestion,
          evaluation,
          GAME_LANGUAGE
        ) || (
          GAME_LANGUAGE === "ru"
            ? `Правильный ответ: ${evaluation.correct_answer_reveal || currentQuestion?.answer || "?"}.`
            : `Правильна відповідь: ${evaluation.correct_answer_reveal || currentQuestion?.answer || "?"}.`
        );

        const scoreLine = buildScoreAnnouncementText(
          evaluation,
          score,
          GAME_LANGUAGE
        );

        await tts(explanationBody, { voice: REALTIME_VOICE });
        if (!cancelled && scoreLine) {
          await tts(scoreLine, { voice: REALTIME_VOICE });
        }
      } catch (e) {
        console.error("[EXPLAINING effect]", e);
        try {
          const fallbackAnswer = GAME_LANGUAGE === "ru"
            ? `Правильный ответ: ${evaluation.correct_answer_reveal || currentQuestion?.answer || "?"}.`
            : `Правильна відповідь: ${evaluation.correct_answer_reveal || currentQuestion?.answer || "?"}.`;
          if (!cancelled) {
            await tts(fallbackAnswer, { voice: REALTIME_VOICE });
          }
        } catch (fallbackErr) {
          console.error("[EXPLAINING fallback failed]", fallbackErr);
        }
      } finally {
        closePostSession();
        if (!cancelled) send(EVENTS.EXPLAINING_DONE);
      }
    })();

    return () => {
      cancelled = true;
      closePostSession();
    };
  }, [gameState, evaluation, currentQuestion, score]);

  // ── READY: loop pause music while waiting for next round ────────────────────
  useEffect(() => {
    if (gameState !== STATES.READY) return;
    const { stop } = playLooped("/sounds/pause.mp3", { volume: SOUND_VOLUMES.pause });
    return stop;
  }, [gameState]);

  // ── GAME_OVER: loop final music until restart ────────────────────────────────
  useEffect(() => {
    if (gameState !== STATES.GAME_OVER) return;
    const { stop } = playLooped("/sounds/final.mp3", { volume: SOUND_VOLUMES.final });
    return stop;
  }, [gameState]);

  return {
    isRecording,
    setIsRecording,
    ttsPlaying,
    recorderRef,
    handleQuestionVideoEnded,
    videoReady,
  };
}

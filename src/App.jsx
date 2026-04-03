import { useCallback, useEffect, useRef, useState } from "react";
import { GameProvider, useGame } from "./game/GameContext";
import { STATES, EVENTS } from "./game/gameStateMachine";
import Scoreboard from "./components/Scoreboard";
import Roulette from "./components/Roulette";
import Timer from "./components/Timer";
import QuestionCard from "./components/QuestionCard";
import ModeratorVoice from "./components/ModeratorVoice";
import Controls from "./components/Controls";
import {
  readQuestion,
  evaluateAnswer,
  buildListeningScript,
} from "./services/openai";
import {
  RealtimeSession,
  startWheelDialogue,
  runSessionOneFlow,
  runPostAnswerFlow,
} from "./services/realtime";
import { speak } from "./services/tts";
import { startRecording, stopRecording } from "./services/recorder";
import { transcribeAudio } from "./services/transcribe";

const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";

// ─── State labels for UI ──────────────────────────────────────────────────────
const STATE_LABELS = {
  [STATES.IDLE]: null,
  [STATES.SPINNING]: "Крутимо волчок...",
  [STATES.READING]: "Ведучий читає питання",
  [STATES.DISCUSSING]: "Хвилина обговорення!",
  [STATES.LISTENING]: "Мікрофон увімкнено — відповідайте!",
  [STATES.EVALUATING]: "Оцінюємо відповідь...",
  [STATES.SCORING]: null,
  [STATES.READY]: null,
  [STATES.GAME_OVER]: null,
};

function Game() {
  const { state, send } = useGame();
  const {
    gameState,
    currentQuestion,
    score,
    roundNumber,
    evaluation,
    lastResponseId,
    blitzQueue,
  } = state;

  const timerDuration = currentQuestion?.round_type === "blitz" ? 20 : 60;
  const [timerSec, setTimerSec] = useState(60);
  const [paused, setPaused] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [selectedSector, setSelectedSector] = useState(null);

  // Reset selectedSector (and thus Roulette openedSectors) on new game
  useEffect(() => {
    if (gameState === STATES.IDLE) setSelectedSector(null);
  }, [gameState]);

  const timerRef = useRef(null);
  const recorderRef = useRef(null);
  const preSessionRef = useRef(null); // Realtime pre-question session
  const postSessionRef = useRef(null); // Realtime post-answer session
  const systemPromptRef = useRef(null); // cached system-prompt.txt text
  const selectedSectorRef = useRef(null);

  // Keep selectedSectorRef in sync (needed inside onTarget callback)
  useEffect(() => {
    selectedSectorRef.current = selectedSector;
  }, [selectedSector]);

  // Load system prompt once on mount
  useEffect(() => {
    fetch("/system-prompt.txt")
      .then((r) => (r.ok ? r.text() : ""))
      .then((t) => {
        systemPromptRef.current = t;
      })
      .catch(() => {
        systemPromptRef.current = "";
      });
  }, []);

  // ─── Timer ────────────────────────────────────────────────────────
  useEffect(() => {
    clearInterval(timerRef.current);
    if (gameState === STATES.DISCUSSING && !paused) {
      timerRef.current = setInterval(() => {
        setTimerSec((s) => {
          if (s <= 1) {
            clearInterval(timerRef.current);
            send(EVENTS.TIMER_DONE);
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [gameState, paused]);

  useEffect(() => {
    if (gameState === STATES.DISCUSSING) {
      setTimerSec(timerDuration);
      setPaused(false);
    }
  }, [gameState]);

  // ─── TTS helper ───────────────────────────────────────────────────
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

  // ─── Realtime helpers ─────────────────────────────────────────────

  function closePreSession() {
    preSessionRef.current?.close();
    preSessionRef.current = null;
  }

  function closePostSession() {
    postSessionRef.current?.close();
    postSessionRef.current = null;
  }

  /**
   * We no longer start the pre-question script from Roulette.onTarget.
   * Session 1 now opens when SPINNING begins and the wheel-stop phase is
   * orchestrated deterministically inside the READING effect.
   */
  const handleRouletteTarget = useCallback((sector) => {
    console.log("[App][Roulette target]", { sector });
  }, []);

  const handleRouletteStop = useCallback(
    (sector) => {
      console.log("[App][Roulette stop]", {
        sector,
        gameStateBeforeSend: gameStateRef.current,
      });
      setSelectedSector(sector);
      send(EVENTS.SPIN_DONE);
    },
    [send]
  );

  // SPINNING: open one live bidirectional Realtime session for wheel small talk.
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
        session.onError = (err) => {
          console.error("[Moderator session error]", err.message);
        };
        session.onTriggerPhrase = () => {
          // Safety net: if the phrase is ever detected while we are still in
          // dialogue mode, cut listening immediately.
          session.setMonologueMode({ tools: [] }).catch((err) => {
            console.error("[Trigger phrase safety switch failed]", err);
          });
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

  // ─── State side-effects ───────────────────────────────────────────

  // READING:
  //   real mode — run an explicit stage sequence inside Session 1
  //   mock mode — existing TTS fallback
  useEffect(() => {
    if (gameState === STATES.READING && currentQuestion) {
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
          if (!apiKey || !systemPromptRef.current) {
            if (!cancelled) send(EVENTS.READING_DONE);
            return;
          }

          let session = preSessionRef.current;

          try {
            // If the wheel-chat session failed earlier, recreate it on demand.
            if (!session) {
              session = new RealtimeSession();
              session.onError = (err) =>
                console.error("[Moderator session error]", err.message);
              session.onTriggerPhrase = () => {
                session.setMonologueMode({ tools: [] }).catch((err) => {
                  console.error("[Trigger phrase safety switch failed]", err);
                });
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
            }

            console.log("[App][Session1 start]", {
              sector: (selectedSector ?? 0) + 1,
              currentQuestionId: currentQuestion?.id,
            });
            await runSessionOneFlow({
              session,
              systemPrompt: systemPromptRef.current,
              gameContext: buildCtx(),
              warmupTimeoutMs: 9000,
            });

            console.log("[App][Session1 done]");
            closePreSession();
            if (!cancelled) send(EVENTS.READING_DONE);
            return;
          } catch (e) {
            console.error("[Session 1 flow failed]", e);
            closePreSession();

            // Deterministic fallback: read the question with the existing text path
            // instead of skipping straight into the timer.
            try {
              const { text, responseId } = await readQuestion(
                buildCtx(),
                lastResponseId
              );
              if (!cancelled && responseId)
                send("SET_LAST_RESPONSE_ID", responseId);
              if (!cancelled) await tts(text);
            } catch (fallbackErr) {
              console.error("[Session 1 fallback read failed]", fallbackErr);
            }

            if (!cancelled) send(EVENTS.READING_DONE);
          }
        })();

        return () => {
          cancelled = true;
        };
      }

      // Mock / TTS fallback
      let cancelled = false;
      (async () => {
        try {
          const { text, responseId } = await readQuestion(
            buildCtx(),
            lastResponseId
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
    }
  }, [gameState, currentQuestion]);

  // LISTENING: real mode — open post-answer Realtime session after STT
  // mock mode — existing TTS + recorder flow
  useEffect(() => {
    if (gameState === STATES.LISTENING) {
      if (!USE_MOCK) {
        // In real mode we still need to capture the team's spoken answer via STT,
        // then feed it to the post-answer Realtime session.
        // Announce stop/early-answer via TTS first, then record.
        (async () => {
          try {
            const lang = import.meta.env.VITE_GAME_LANGUAGE || "ru";
            const script = buildListeningScript(state.earlyAnswer, lang);
            await tts(script);
            setIsRecording(true);
            recorderRef.current = await startRecording();
          } catch (e) {
            console.error(e);
            send(EVENTS.RECORDING_DONE, "");
          }
        })();
      } else {
        // Mock mode
        (async () => {
          try {
            const lang = import.meta.env.VITE_GAME_LANGUAGE || "ru";
            const script = buildListeningScript(state.earlyAnswer, lang);
            await tts(script);
            setIsRecording(true);
            recorderRef.current = await startRecording();
          } catch (e) {
            console.error(e);
            send(EVENTS.RECORDING_DONE, "");
          }
        })();
      }
    } else {
      setIsRecording(false);
    }
  }, [gameState]);

  // EVALUATING:
  //   real mode — open post-answer Realtime session; it handles evaluation + scoring
  //   mock mode — call evaluateAnswer() API (mock)
  useEffect(() => {
    if (gameState === STATES.EVALUATING) {
      if (!USE_MOCK) {
        const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
        if (!apiKey || !systemPromptRef.current) {
          send(EVENTS.EVALUATION_DONE, {
            correct: false,
            score_delta: 1,
            who_scores: "viewers",
            moderator_phrase: "",
            correct_answer_reveal: currentQuestion?.answer || "?",
          });
          return;
        }

        const postCtx = {
          ...buildCtx({ team_answer_transcript: state.transcript }),
          early_answer: state.earlyAnswer,
        };

        let cancelled = false;

        (async () => {
          try {
            closePostSession();
            const session = new RealtimeSession();
            session.onError = (err) =>
              console.error("[Post-session error]", err.message);

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

            const result = await runPostAnswerFlow({
              session,
              systemPrompt: systemPromptRef.current,
              gameContext: postCtx,
            });

            if (cancelled) return;

            closePostSession();
            const correct = result.correct ?? false;
            send(EVENTS.EVALUATION_DONE, {
              correct,
              score_delta: 1,
              who_scores: correct ? "experts" : "viewers",
              moderator_phrase: "",
              correct_answer_reveal:
                result.correct_answer_reveal ?? currentQuestion?.answer ?? "?",
            });
          } catch (err) {
            console.error("[Post-session flow failed]", err);
            closePostSession();
            if (!cancelled) {
              send(EVENTS.EVALUATION_DONE, {
                correct: false,
                score_delta: 1,
                who_scores: "viewers",
                moderator_phrase: "",
                correct_answer_reveal: currentQuestion?.answer || "?",
              });
            }
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
          const { evaluation: result, responseId } = await evaluateAnswer(
            buildCtx({ team_answer_transcript: state.transcript }),
            lastResponseId
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
    }
  }, [gameState]);

  // SCORING:
  //   real mode — Realtime already spoke verdict; skip TTS, just advance
  //   mock mode — play moderator_phrase via TTS then advance
  useEffect(() => {
    if (gameState === STATES.SCORING && evaluation) {
      if (!USE_MOCK) {
        // Realtime session handled speech; advance immediately
        send(EVENTS.SCORING_DONE);
        return;
      }

      // Mock mode
      (async () => {
        try {
          await tts(evaluation.moderator_phrase);
        } catch (e) {
          console.error(e);
        } finally {
          send(EVENTS.SCORING_DONE);
        }
      })();
    }
  }, [gameState, evaluation]);

  // Clean up both Realtime sessions when game goes back to IDLE
  useEffect(() => {
    if (gameState === STATES.IDLE) {
      closePreSession();
      closePostSession();
    }
  }, [gameState]);

  // ─── Stop recording helper ────────────────────────────────────────
  const doStopRecording = useCallback(async () => {
    if (!isRecording) return;
    setIsRecording(false);
    try {
      const blob = await stopRecording(recorderRef.current);
      recorderRef.current = null;
      const transcript = await transcribeAudio(blob);
      send(EVENTS.RECORDING_DONE, transcript);
    } catch (e) {
      console.error(e);
      send(EVENTS.RECORDING_DONE, "");
    }
  }, [isRecording, send]);

  // ─── Global keyboard handler ──────────────────────────────────────
  const gameStateRef = useRef(gameState);
  const isRecordingRef = useRef(isRecording);
  const doStopRef = useRef(doStopRecording);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    console.log("[App][State]", {
      gameState,
      selectedSector,
      roundNumber,
      hasQuestion: !!currentQuestion,
      currentQuestionId: currentQuestion?.id || null,
    });
  }, [gameState, selectedSector, roundNumber, currentQuestion]);
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);
  useEffect(() => {
    doStopRef.current = doStopRecording;
  }, [doStopRecording]);

  useEffect(() => {
    function onKey(e) {
      if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName))
        return;

      const gs = gameStateRef.current;

      switch (e.code) {
        case "Space":
          e.preventDefault();
          if (gs === STATES.IDLE) send(EVENTS.START);
          if (gs === STATES.READY) send(EVENTS.NEXT_ROUND);
          break;

        case "KeyE":
          if (gs === STATES.DISCUSSING) send(EVENTS.EARLY_ANSWER);
          break;

        case "KeyP":
          e.preventDefault();
          if (gs === STATES.DISCUSSING) setPaused((p) => !p);
          break;

        case "Enter":
          e.preventDefault();
          if (gs === STATES.LISTENING && isRecordingRef.current) {
            doStopRef.current();
          }
          break;

        case "KeyR":
          if (gs === STATES.GAME_OVER) send(EVENTS.RESTART);
          break;

        default:
          break;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send]);

  // ─── Derived state for layout ─────────────────────────────────────
  const showRoulette =
    gameState === STATES.IDLE ||
    gameState === STATES.SPINNING ||
    gameState === STATES.READY;
  const showQuestion = [
    STATES.READING,
    STATES.DISCUSSING,
    STATES.LISTENING,
    STATES.EVALUATING,
    STATES.SCORING,
  ].includes(gameState);
  const showTimer = gameState === STATES.DISCUSSING;
  const stateLabel = STATE_LABELS[gameState];

  return (
    <div className="app">
      <Scoreboard />
      <div className="gold-line" />

      <div className="game-area felt-bg">
        {/* Top status strip */}
        <div className="status-strip">
          <div className="status-left">
            <ModeratorVoice playing={ttsPlaying} />
            {isRecording && (
              <div className="rec-badge">
                <span className="rec-dot rec-blink">●</span> Запис...
              </div>
            )}
          </div>
          {paused ? (
            <div className="state-tag pause-tag">⏸ ПАУЗА</div>
          ) : (
            stateLabel && (
              <div className="state-tag slide-down">{stateLabel}</div>
            )
          )}
          <div className="status-right">
            {roundNumber > 0 && (
              <div className="round-counter">Раунд {roundNumber}</div>
            )}
          </div>
        </div>

        {/* ── Single Roulette instance ── */}
        <div
          style={{
            display: showRoulette ? "flex" : "none",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            flex: showRoulette ? 1 : 0,
          }}
        >
          {gameState === STATES.IDLE && (
            <div className="roulette-overlay-label fade-in">
              <div className="idle-title title-glow">ЩО? ДЕ? КОЛИ?</div>
              <div className="idle-subtitle">Breaking Bad Edition</div>
              <div className="idle-hint-key">
                Натисніть <kbd>Пробіл</kbd> щоб почати
              </div>
            </div>
          )}
          {gameState === STATES.SPINNING && (
            <div className="spin-label fade-in">Крутимо волчок!</div>
          )}
          {gameState === STATES.READY && (
            <div className="ready-label fade-in">
              Натисніть <kbd>Пробіл</kbd> — наступний раунд
            </div>
          )}

          <Roulette
            spinning={gameState === STATES.SPINNING}
            onTarget={handleRouletteTarget}
            onStop={handleRouletteStop}
            selectedSector={selectedSector}
          />
        </div>

        {/* ── QUESTION screens ── */}
        {showQuestion && (
          <div className="screen-question fade-in">
            <div className="question-layout">
              <QuestionCard
                question={currentQuestion}
                evaluation={gameState === STATES.SCORING ? evaluation : null}
                hideText={gameState === STATES.READING}
              />
              {showTimer && (
                <div className="timer-column">
                  <Timer
                    seconds={timerSec}
                    maxSeconds={timerDuration}
                    paused={paused}
                  />
                  {gameState === STATES.LISTENING && (
                    <div className="listen-hint">Говоріть відповідь</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── GAME OVER ── */}
        {gameState === STATES.GAME_OVER && (
          <div className="screen-gameover fade-in-scale">
            <div
              className={`gameover-title victory-pulse ${
                state.winner === "experts" ? "experts-color" : "viewers-color"
              }`}
            >
              {state.winner === "experts"
                ? "ЗНАТОКИ ПЕРЕМОГЛИ!"
                : "ТЕЛЕГЛЯДАЧІ ПЕРЕМОГЛИ!"}
            </div>
            <div className="gameover-score">
              <span className="go-e">{score.experts}</span>
              <span className="go-sep"> : </span>
              <span className="go-v">{score.viewers}</span>
            </div>
            <div className="gameover-motto">Що наше життя? Гра!</div>
            <div className="gameover-hint">
              Натисніть <kbd>R</kbd> для нової гри
            </div>
          </div>
        )}
      </div>

      <Controls gameState={gameState} paused={paused} />
      <div className="state-label">{gameState}</div>

      <style>{`
        .game-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          position: relative;
        }

        /* Status strip */
        .status-strip {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.55rem 1.5rem;
          border-bottom: 1px solid rgba(201,168,76,0.1);
          min-height: 3rem;
          flex-shrink: 0;
        }
        .status-left, .status-right {
          display: flex;
          align-items: center;
          gap: 0.8rem;
          min-width: 180px;
        }
        .status-right { justify-content: flex-end; }
        .rec-badge {
          display: flex;
          align-items: center;
          gap: 0.3rem;
          font-size: 0.85rem;
          color: var(--timer-warning);
          letter-spacing: 0.05em;
        }
        .rec-dot { font-size: 0.7rem; }
        .state-tag {
          font-size: 0.85rem;
          letter-spacing: 0.15em;
          color: var(--accent-gold);
          text-transform: uppercase;
          opacity: 0.9;
        }
        .pause-tag {
          font-size: 1rem;
          letter-spacing: 0.2em;
          color: var(--timer-warning);
          text-transform: uppercase;
          animation: rec-blink 1.2s ease-in-out infinite;
        }
        .round-counter {
          font-size: 0.8rem;
          color: var(--text-dim);
          letter-spacing: 0.1em;
        }

        /* ── IDLE ── */
        .roulette-overlay-label {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.4rem;
          margin-bottom: 1rem;
          text-align: center;
        }
        .idle-title {
          font-size: var(--font-display);
          color: var(--accent-gold);
          font-family: Georgia, serif;
          letter-spacing: 0.25em;
          font-weight: normal;
        }
        .idle-subtitle {
          font-size: var(--font-label);
          color: var(--text-secondary);
          letter-spacing: 0.1em;
        }
        .idle-hint-key {
          font-size: 0.88rem;
          color: var(--text-secondary);
          letter-spacing: 0.08em;
          margin-top: 0.3rem;
        }
        .idle-hint-key kbd {
          display: inline-block;
          padding: 0.1rem 0.5rem;
          border: 1px solid var(--border-gold-strong);
          border-radius: 4px;
          background: rgba(201,168,76,0.08);
          color: var(--accent-gold);
          font-family: monospace;
          font-size: 0.9em;
        }
        .ready-label {
          font-size: 0.95rem;
          color: var(--accent-gold);
          letter-spacing: 0.12em;
          margin-bottom: 1rem;
          opacity: 0.85;
        }
        .ready-label kbd {
          display: inline-block;
          padding: 0.1rem 0.5rem;
          border: 1px solid var(--border-gold-strong);
          border-radius: 4px;
          background: rgba(201,168,76,0.1);
          color: var(--accent-gold);
          font-family: monospace;
          font-size: 0.9em;
        }

        /* ── SPINNING ── */
        .spin-label {
          font-size: var(--font-title);
          color: var(--accent-gold);
          font-family: Georgia, serif;
          letter-spacing: 0.15em;
        }

        /* ── QUESTION ── */
        .screen-question {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1.5rem 2rem;
          overflow: hidden;
        }
        .question-layout {
          display: flex;
          gap: 2rem;
          align-items: flex-start;
          max-width: 1100px;
          width: 100%;
        }
        .timer-column {
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.8rem;
          padding-top: 1.5rem;
        }
        .listen-hint {
          font-size: var(--font-label);
          color: var(--timer-warning);
          letter-spacing: 0.08em;
          text-align: center;
          animation: rec-blink 1s ease-in-out infinite;
        }

        /* ── GAME OVER ── */
        .screen-gameover {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1.5rem;
          text-align: center;
          padding: 2rem;
        }
        .gameover-title {
          font-size: var(--font-display);
          font-family: Georgia, serif;
          letter-spacing: 0.15em;
        }
        .experts-color { color: var(--score-experts); text-shadow: 0 0 40px rgba(90,184,90,0.5); }
        .viewers-color { color: var(--score-viewers); text-shadow: 0 0 40px rgba(184,90,90,0.5); }
        .gameover-score {
          font-size: clamp(4rem, 8vw, 8rem);
          font-family: Georgia, serif;
          font-weight: bold;
          line-height: 1;
        }
        .go-e { color: var(--score-experts); }
        .go-sep { color: var(--accent-gold); }
        .go-v { color: var(--score-viewers); }
        .gameover-motto {
          font-size: var(--font-title);
          color: var(--accent-gold);
          font-style: italic;
          opacity: 0.8;
        }
        .gameover-hint {
          font-size: var(--font-label);
          color: var(--text-dim);
          letter-spacing: 0.1em;
        }
        .gameover-hint kbd {
          padding: 0.1rem 0.5rem;
          border: 1px solid var(--border-gold);
          border-radius: 4px;
          background: rgba(201,168,76,0.08);
          color: var(--accent-gold);
          font-family: monospace;
        }
      `}</style>
    </div>
  );
}

export default function App() {
  return (
    <GameProvider>
      <Game />
    </GameProvider>
  );
}

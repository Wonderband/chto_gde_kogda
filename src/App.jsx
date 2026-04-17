import { useState, useRef, useEffect } from "react";
import { GameProvider, useGame } from "./game/GameContext";
import { STATES } from "./game/gameStateMachine";
import { DISCUSSION_SEC, BLITZ_SEC, GAME_LANGUAGE } from "./config.js";
import Scoreboard from "./components/Scoreboard";
import Roulette from "./components/Roulette";
import Timer from "./components/Timer";
import QuestionCard from "./components/QuestionCard";
import QuestionVideoPlayer from "./components/QuestionVideoPlayer";
import ModeratorVoice from "./components/ModeratorVoice";
import Controls from "./components/Controls";
import { useTimer } from "./hooks/useTimer";
import { useRealtimeSessions } from "./hooks/useRealtimeSessions";
import { useRoulette } from "./hooks/useRoulette";
import { useGamePhaseEffects } from "./hooks/useGamePhaseEffects";
import { useRecording } from "./hooks/useRecording";
import { useKeyboardControls } from "./hooks/useKeyboardControls";
import "./styles/game.css";

const STATE_LABELS = {
  [STATES.IDLE]: null,
  [STATES.ANNOUNCING]: "Починаємо раунд...",
  [STATES.SPINNING]: "Крутимо волчок...",
  [STATES.READING]: "Ведучий читає питання",
  [STATES.DISCUSSING]: "Хвилина обговорення!",
  [STATES.LISTENING]: "Мікрофон увімкнено — відповідайте!",
  [STATES.EVALUATING]: "Оцінюємо відповідь...",
  [STATES.SCORING]: null,
  [STATES.EXPLAINING]: "Ведучий пояснює відповідь...",
  [STATES.READY]: null,
  [STATES.GAME_OVER]: null,
};

function isVideoQuestion(question) {
  return question?.presentation_mode === "video" && !!question?.video_src;
}

// Confetti animation (experts win)
const CONFETTI_COLORS = ["#5ab85a", "#c9a84c", "#e2c06a", "#4de84d", "#fff8e0", "#38a338"];
function Confetti() {
  const pieces = Array.from({ length: 32 }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    dur: `${2.2 + Math.random() * 1.8}s`,
    delay: `${Math.random() * 2.5}s`,
    rotate: Math.random() > 0.5 ? "2px" : "10px",
    isRect: Math.random() > 0.4,
  }));
  return (
    <>
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={{
            left: p.left,
            "--cf-dur": p.dur,
            "--cf-delay": p.delay,
            background: p.color,
            width: p.isRect ? "10px" : "8px",
            height: p.isRect ? "6px" : "8px",
            borderRadius: p.isRect ? "1px" : "50%",
            animationDelay: p.delay,
          }}
        />
      ))}
    </>
  );
}

// Fireworks (experts win)
function Fireworks() {
  const fws = [
    { top: "20%", left: "18%", color: "#5ab85a", dur: "1.8s", delay: "0s" },
    { top: "15%", left: "75%", color: "#c9a84c", dur: "2.1s", delay: "0.7s" },
    { top: "35%", left: "50%", color: "#4de84d", dur: "1.6s", delay: "1.3s" },
  ];
  return (
    <>
      {fws.map((fw, i) => (
        <span
          key={i}
          className="firework"
          style={{
            top: fw.top,
            left: fw.left,
            "--fw-color": fw.color,
            "--fw-dur": fw.dur,
            "--fw-delay": fw.delay,
          }}
        />
      ))}
    </>
  );
}

// Rain (viewers win)
function Rain() {
  const drops = Array.from({ length: 24 }, (_, i) => ({
    id: i,
    left: `${(i / 24) * 100 + Math.random() * 4}%`,
    dur: `${0.75 + Math.random() * 0.7}s`,
    delay: `${Math.random() * 1.5}s`,
    height: `${18 + Math.random() * 14}px`,
    opacity: 0.35 + Math.random() * 0.3,
  }));
  return (
    <>
      {drops.map((d) => (
        <span
          key={d.id}
          className="rain-drop"
          style={{
            left: d.left,
            "--rd-dur": d.dur,
            "--rd-delay": d.delay,
            height: d.height,
            opacity: d.opacity,
          }}
        />
      ))}
    </>
  );
}

function Game() {
  const { state, send } = useGame();
  const {
    gameState,
    currentQuestion,
    score,
    roundNumber,
    evaluation,
    blitzQueue,
  } = state;

  const [musicPausePlaying, setMusicPausePlaying] = useState(false);

  const timerDuration =
    currentQuestion?.round_type === "blitz" ? BLITZ_SEC : DISCUSSION_SEC;

  const { timerSec, paused, setPaused } = useTimer(
    gameState,
    send,
    timerDuration
  );

  const {
    preSessionRef,
    postSessionRef,
    systemPromptRef,
    playersRef,
    closePreSession,
    graceClosePreSession,
    closePostSession,
  } = useRealtimeSessions(gameState);

  const { selectedSector, handleRouletteTarget, handleRouletteStop } =
    useRoulette(gameState, send, graceClosePreSession);

  const {
    isRecording,
    setIsRecording,
    ttsPlaying,
    recorderRef,
    handleQuestionVideoEnded,
    videoReady,
  } = useGamePhaseEffects({
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
    musicPausePlaying,
  });

  // Keep a live ref to currentQuestion so useRecording can pass it to STT
  // without stale-closure issues (doStopRecording is a useCallback).
  const currentQuestionRef = useRef(currentQuestion);
  useEffect(() => { currentQuestionRef.current = currentQuestion; }, [currentQuestion]);

  const { doStopRef } = useRecording(
    isRecording,
    setIsRecording,
    recorderRef,
    send,
    currentQuestionRef
  );

  useKeyboardControls({
    gameState,
    send,
    setPaused,
    isRecording,
    doStopRef,
    selectedSector,
    roundNumber,
    currentQuestion,
    onMusicPause: () => setMusicPausePlaying(true),
  });

  // Compute which sectors have blitz questions.
  // state.questions is a 12-slot sparse array (nulls for played sectors) — use optional chaining.
  const blitzSectors = new Set(
    (state.questions || [])
      .map((q, i) => (q?.blitz_position === 1 ? i : -1))
      .filter((i) => i !== -1)
  );

  const showRoulette =
    gameState === STATES.IDLE ||
    gameState === STATES.ANNOUNCING ||
    gameState === STATES.SPINNING;

  const showQuestion = [
    STATES.READING,
    STATES.DISCUSSING,
    STATES.LISTENING,
    STATES.EVALUATING,
    STATES.SCORING,
    STATES.EXPLAINING,
    STATES.READY,
  ].includes(gameState);

  const showTimer = gameState === STATES.DISCUSSING;
  const stateLabel = videoReady
    ? GAME_LANGUAGE === "ru"
      ? "Смотрите на экран"
      : "Дивіться на екран"
    : STATE_LABELS[gameState];

  return (
    <div className="app">
      <Scoreboard />
      <div className="gold-line" />

      <div className="game-area felt-bg">
        <div className="status-strip">
          <div className="status-left">
            <ModeratorVoice playing={ttsPlaying} />
            {isRecording && (
              <div className="rec-badge">
                <span className="rec-dot rec-blink">●</span> Запис...
              </div>
            )}
            {paused ? (
              <div className="state-tag pause-tag">⏸ ПАУЗА</div>
            ) : (
              stateLabel && (
                <div className="state-tag slide-down">{stateLabel}</div>
              )
            )}
          </div>

          <div className="status-center" />

          <div className="status-right">
            {roundNumber > 0 && (
              <div className="round-counter">Раунд {roundNumber}</div>
            )}
          </div>
        </div>

        <div
          style={{
            display: showRoulette ? "flex" : "none",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            flex: showRoulette ? 1 : 0,
          }}
        >
          <Roulette
            spinning={gameState === STATES.SPINNING}
            onTarget={handleRouletteTarget}
            onStop={handleRouletteStop}
            selectedSector={selectedSector}
            blitzSectors={blitzSectors}
          />
        </div>

        {showQuestion && (
          <div className="screen-question fade-in">
            <div className="question-layout">
              <QuestionCard
                question={currentQuestion}
                evaluation={gameState === STATES.READY ? evaluation : null}
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

        {/* ── Video backdrop — fixed overlay, appears only after moderator intro ── */}
        {videoReady && (
          <div className="video-backdrop">
            <QuestionVideoPlayer
              key={currentQuestion?.id}
              question={currentQuestion}
              onEnded={handleQuestionVideoEnded}
            />
          </div>
        )}

        {gameState === STATES.GAME_OVER && (
          <div className={`screen-gameover fade-in-scale ${state.winner === "experts" ? "gameover-win" : "gameover-loss gameover-loss-bg"}`}>
            {state.winner === "experts" ? <Confetti /> : <Rain />}
            {state.winner === "experts" && <Fireworks />}
            <div
              className={`gameover-title victory-pulse ${
                state.winner === "experts" ? "experts-color" : "viewers-color"
              }`}
            >
              {state.winner === "experts"
                ? "ЗНАТОКИ ПЕРЕМОГЛИ!"
                : "ГЕРОЇ СЕРІАЛУ ПЕРЕМОГЛИ!"}
            </div>
            <div className="gameover-score">
              <span className="go-e">{score.experts}</span>
              <span className="go-sep"> : </span>
              <span className="go-v">{score.viewers}</span>
            </div>
            <div className="gameover-motto">
              {state.winner === "experts"
                ? "Я зробив це. Тільки я."
                : "Що наше життя? Гра!"}
            </div>
            <div className="gameover-hint">
              Натисніть <kbd>R</kbd> для нової гри
            </div>
          </div>
        )}
      </div>

      <Controls gameState={gameState} paused={paused} />
      <div className="state-label">{gameState}</div>

      {musicPausePlaying && (
        <video
          key="music-pause"
          src="/videos/music_pause.mp4"
          autoPlay
          onEnded={() => setMusicPausePlaying(false)}
          style={{
            position: "fixed",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            zIndex: 900,
            background: "#000",
          }}
        />
      )}
    </div>
  );
}

export default function App() {
  const [introPlaying, setIntroPlaying] = useState(true);

  return (
    <>
      {introPlaying && (
        <>
          <video
            src="/sounds/intro.mp4"
            autoPlay
            onEnded={() => setIntroPlaying(false)}
            style={{ display: "none" }}
          />
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 999,
              background: "#000",
            }}
          >
            <img
              src="/intro_img.jpg"
              alt=""
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
              }}
            />
          </div>
        </>
      )}
      <GameProvider>
        <Game />
      </GameProvider>
    </>
  );
}

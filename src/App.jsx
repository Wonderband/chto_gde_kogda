import { GameProvider, useGame } from "./game/GameContext";
import { STATES } from "./game/gameStateMachine";
import Scoreboard from "./components/Scoreboard";
import Roulette from "./components/Roulette";
import Timer from "./components/Timer";
import QuestionCard from "./components/QuestionCard";
import ModeratorVoice from "./components/ModeratorVoice";
import Controls from "./components/Controls";
import { useTimer } from "./hooks/useTimer";
import { useRealtimeSessions } from "./hooks/useRealtimeSessions";
import { useRoulette } from "./hooks/useRoulette";
import { useGamePhaseEffects } from "./hooks/useGamePhaseEffects";
import { useRecording } from "./hooks/useRecording";
import { useKeyboardControls } from "./hooks/useKeyboardControls";
import "./styles/game.css";

// ─── State labels shown in the status strip ────────────────────────────────
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
    blitzQueue,
  } = state;

  const timerDuration = currentQuestion?.round_type === "blitz" ? 20 : 60;

  // ── Hooks ────────────────────────────────────────────────────────────────
  const { timerSec, paused, setPaused } = useTimer(gameState, send, timerDuration);

  const {
    preSessionRef,
    postSessionRef,
    systemPromptRef,
    closePreSession,
    closePostSession,
  } = useRealtimeSessions(gameState);

  const { selectedSector, handleRouletteTarget, handleRouletteStop } =
    useRoulette(gameState, send, closePreSession);

  const { isRecording, setIsRecording, ttsPlaying, recorderRef } =
    useGamePhaseEffects({
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
    });

  const { doStopRef } = useRecording(isRecording, setIsRecording, recorderRef, send);

  useKeyboardControls({
    gameState,
    send,
    setPaused,
    isRecording,
    doStopRef,
    selectedSector,
    roundNumber,
    currentQuestion,
  });

  // ── Derived layout flags ──────────────────────────────────────────────────
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      <Scoreboard />
      <div className="gold-line" />

      <div className="game-area felt-bg">
        {/* ── Status strip ── */}
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

        {/* ── Roulette area (IDLE / SPINNING / READY) ── */}
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

        {/* ── Question screens (READING → SCORING) ── */}
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

        {/* ── Game over ── */}
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

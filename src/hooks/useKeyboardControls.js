import { useEffect, useRef } from "react";
import { STATES, EVENTS } from "../game/gameStateMachine";

/**
 * Registers the global keydown listener that drives keyboard controls.
 * Uses refs for gameState and isRecording to avoid stale closures in the
 * persistent event listener.
 *
 * Also logs state transitions to the console for debugging.
 */
export function useKeyboardControls({
  gameState,
  send,
  setPaused,
  isRecording,
  doStopRef,
  selectedSector,
  roundNumber,
  currentQuestion,
}) {
  const gameStateRef = useRef(gameState);
  const isRecordingRef = useRef(isRecording);

  // Keep refs in sync.
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  // Debug: log every state transition.
  useEffect(() => {
    console.log("[App][State]", {
      gameState,
      selectedSector,
      roundNumber,
      hasQuestion: !!currentQuestion,
      currentQuestionId: currentQuestion?.id || null,
    });
  }, [gameState, selectedSector, roundNumber, currentQuestion]);

  // Global keyboard handler — registered once, reads state via refs.
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
            doStopRef.current?.();
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
}

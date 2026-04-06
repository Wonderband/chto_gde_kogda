import { useEffect, useRef, useState } from "react";
import { STATES, EVENTS } from "../game/gameStateMachine";

/**
 * Manages the discussion-phase countdown timer.
 * Owns: timerSec, paused state + the interval ref.
 */
export function useTimer(gameState, send, timerDuration) {
  const [timerSec, setTimerSec] = useState(60);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef(null);

  // Start / stop the interval whenever DISCUSSING state or pause flag changes.
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

  // Reset to full duration every time we enter DISCUSSING.
  useEffect(() => {
    if (gameState === STATES.DISCUSSING) {
      setTimerSec(timerDuration);
      setPaused(false);
    }
  }, [gameState]);

  return { timerSec, paused, setPaused };
}

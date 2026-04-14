import { useEffect, useRef, useState } from "react";
import { STATES, EVENTS } from "../game/gameStateMachine";
import { playTimerStartBeep, playTimerEndBeep } from "../utils/sounds";

/**
 * Manages the discussion-phase countdown timer.
 * Owns: timerSec, paused state + the interval ref.
 */
export function useTimer(gameState, send, timerDuration) {
  const [timerSec, setTimerSec] = useState(60);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef(null);
  // Tracks remaining seconds without going through React state to avoid
  // calling send() inside a setState updater (which runs during render).
  const timerSecRef = useRef(timerDuration);

  // Start / stop the interval whenever DISCUSSING state or pause flag changes.
  useEffect(() => {
    clearInterval(timerRef.current);
    if (gameState === STATES.DISCUSSING && !paused) {
      timerRef.current = setInterval(() => {
        timerSecRef.current -= 1;
        const next = timerSecRef.current;
        setTimerSec(next);
        if (next <= 0) {
          clearInterval(timerRef.current);
          playTimerEndBeep();
          send(EVENTS.TIMER_DONE);
        }
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [gameState, paused]);

  // Reset to full duration every time we enter DISCUSSING.
  useEffect(() => {
    if (gameState === STATES.DISCUSSING) {
      timerSecRef.current = timerDuration;
      setTimerSec(timerDuration);
      setPaused(false);
      playTimerStartBeep();
    }
  }, [gameState]);

  return { timerSec, paused, setPaused };
}

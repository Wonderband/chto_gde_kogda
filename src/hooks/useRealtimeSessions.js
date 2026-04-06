import { useCallback, useEffect, useRef } from "react";
import { STATES } from "../game/gameStateMachine";

/**
 * Manages the two Realtime WebRTC session refs (pre-question + post-answer)
 * and loads the system prompt once on mount.
 *
 * Does NOT import RealtimeSession — callers create sessions themselves and
 * store references via preSessionRef / postSessionRef.
 */
export function useRealtimeSessions(gameState) {
  const preSessionRef = useRef(null);   // Session 1: wheel spin → question read
  const postSessionRef = useRef(null);  // Session 2: listening cue → verdict
  const systemPromptRef = useRef(null); // Cached /system-prompt.txt content

  // Load system prompt once on mount.
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

  const closePreSession = useCallback(() => {
    preSessionRef.current?.close();
    preSessionRef.current = null;
  }, []);

  const closePostSession = useCallback(() => {
    postSessionRef.current?.close();
    postSessionRef.current = null;
  }, []);

  // Clean up both sessions when the game returns to IDLE.
  useEffect(() => {
    if (gameState === STATES.IDLE) {
      closePreSession();
      closePostSession();
    }
  }, [gameState]);

  return {
    preSessionRef,
    postSessionRef,
    systemPromptRef,
    closePreSession,
    closePostSession,
  };
}

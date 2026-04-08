import { useCallback, useEffect, useRef } from "react";
import { EVENTS } from "../game/gameStateMachine";
import { stopRecording } from "../services/recorder";
import { transcribeAudio } from "../services/transcribe";

/**
 * Provides the stop-recording action and keeps a stable ref to it so the
 * keyboard handler can call it without stale-closure issues.
 *
 * setIsRecording is owned by useGamePhaseEffects and passed in here so this
 * hook can clear the flag before awaiting the transcription.
 */
export function useRecording(isRecording, setIsRecording, recorderRef, send) {
  const doStopRef = useRef(null);

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
  }, [isRecording, setIsRecording, recorderRef, send]);

  // Keep ref fresh so keyboard handler always calls the latest version.
  useEffect(() => {
    doStopRef.current = doStopRecording;
  }, [doStopRecording]);

  return { doStopRecording, doStopRef };
}

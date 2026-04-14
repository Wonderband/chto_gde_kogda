import { useCallback, useEffect, useRef } from "react";
import { EVENTS } from "../game/gameStateMachine";
import { stopRecording } from "../services/recorder";
import { transcribeAudio } from "../services/transcribe";

/**
 * Provides the stop-recording action and keeps a stable ref to it so the
 * keyboard handler can call it without stale-closure issues.
 *
 * currentQuestionRef — a React ref whose .current always holds the live
 *   question object. Passed to transcribeAudio so the STT prompt includes
 *   the expected answer vocabulary (prevents hallucinations like "надвасерій").
 */
export function useRecording(isRecording, setIsRecording, recorderRef, send, currentQuestionRef) {
  const doStopRef = useRef(null);

  const doStopRecording = useCallback(async () => {
    if (!isRecording) return;
    setIsRecording(false);
    try {
      const blob = await stopRecording(recorderRef.current);
      recorderRef.current = null;
      const question = currentQuestionRef?.current ?? null;
      const transcript = (await transcribeAudio(blob, { question })).trim();
      console.log("[Transcribe][final]", { transcript, blobSize: blob?.size });
      send(EVENTS.RECORDING_DONE, transcript);
    } catch (e) {
      console.error(e);
      send(EVENTS.RECORDING_DONE, "");
    }
  }, [isRecording, setIsRecording, recorderRef, send, currentQuestionRef]);

  // Keep ref fresh so keyboard handler always calls the latest version.
  useEffect(() => {
    doStopRef.current = doStopRecording;
  }, [doStopRecording]);

  return { doStopRecording, doStopRef };
}

// Always uses real MediaRecorder (actual mic). Mock flag only affects transcription.

let stream = null;

/**
 * Request mic access and start recording.
 * @returns {Promise<MediaRecorder>}
 */
export async function startRecording() {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });

  const mimeType = getSupportedMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  const chunks = [];

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  recorder._chunks = chunks;
  recorder.start(100); // collect in 100ms chunks
  return recorder;
}

/**
 * Stop recording and return the audio Blob.
 * @param {MediaRecorder} recorder
 * @returns {Promise<Blob>}
 */
export function stopRecording(recorder) {
  return new Promise((resolve) => {
    if (!recorder || recorder._mock) {
      resolve(new Blob([], { type: "audio/webm" }));
      return;
    }
    recorder.onstop = () => {
      const mimeType = recorder.mimeType || "audio/webm";
      const blob = new Blob(recorder._chunks, { type: mimeType });
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
      resolve(blob);
    };
    if (recorder.state !== "inactive") {
      recorder.stop();
    } else {
      resolve(new Blob(recorder._chunks || [], { type: "audio/webm" }));
    }
  });
}

function getSupportedMimeType() {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

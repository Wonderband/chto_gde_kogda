import {
  DEFAULT_MODEL,
  DEFAULT_TRIGGER_PHRASES,
  DEFAULT_VOICE,
  delay,
  makeDeferred,
  normalizeText,
  safeJsonParse,
  uid,
  withTimeout,
} from "./realtime.shared.js";
import { buildModeratorBaseInstructions } from "./realtime.prompts.js";

const DEBUG_REALTIME =
  typeof import.meta !== "undefined" &&
  import.meta?.env?.VITE_REALTIME_DEBUG === "1";

export class RealtimeSession {
  constructor() {
    this._pc = null;
    this._dc = null;
    this._audioEl = null;
    this._localStream = null;
    this._ownsLocalStream = false;
    this._closed = false;
    this._remoteTrackDeferred = makeDeferred();
    this._remoteTrackResolved = false;

    this._sessionUpdatedWaiters = [];
    this._responseCreatedFallbackWaiters = [];
    this._responseCreatedByKey = new Map();
    this._responseCreatedWaiters = [];
    this._responseDoneWaiters = new Map();
    this._audioStoppedWaiters = new Map();
    this._transcriptMatchWaiters = new Map();
    this._toolWaiters = [];

    this._responseMetaById = new Map();
    this._assistantItemByResponseId = new Map();
    this._transcriptByResponseId = new Map();
    this._triggerFiredByResponseId = new Set();
    this._lastResponseId = null;
    this._activeResponseIds = new Set();

    this._assistantSpeaking = false;
    this._userSpeaking = false;
    this._lastAssistantStopAt = Date.now();
    this._lastUserStopAt = Date.now();
    this._lastAssistantStartAt = 0;
    this._lastUserStartAt = 0;

    this.onError = null;
    this.onSessionUpdated = null;
    this.onResponseCreated = null;
    this.onResponseDone = null;
    this.onOutputAudioStopped = null;
    this.onToolCall = null;
    this.onOutputTranscriptDelta = null;
    this.onTriggerPhrase = null;
    this.onUserSpeechStarted = null;
    this.onUserSpeechStopped = null;
    this.onRemoteTrack = null;
  }

  _debugLog(...args) {
    if (DEBUG_REALTIME) console.log(...args);
  }

  async open({
    apiKey,
    systemPrompt = "",
    voice = DEFAULT_VOICE,
    model = DEFAULT_MODEL,
    localStream = null,
    enableMic = true,
  } = {}) {
    if (this._closed) throw new Error("RealtimeSession is already closed");
    if (!apiKey) {
      throw new Error("OpenAI API key is required for RealtimeSession.open()");
    }

    this._pc = new RTCPeerConnection();

    this._audioEl = document.createElement("audio");
    this._audioEl.autoplay = true;
    this._audioEl.playsInline = true;
    this._audioEl.style.display = "none";
    document.body.appendChild(this._audioEl);
    this._pc.ontrack = (event) => {
      if (event.streams?.[0]) {
        this._audioEl.srcObject = event.streams[0];
      }
      if (!this._remoteTrackResolved) {
        this._remoteTrackResolved = true;
        this._remoteTrackDeferred.resolve(event);
      }
      try {
        const playPromise = this._audioEl?.play?.();
        if (playPromise?.catch) {
          playPromise.catch(() => null);
        }
      } catch {}
      if (typeof this.onRemoteTrack === "function") {
        this.onRemoteTrack(event);
      }
    };

    if (localStream) {
      this._localStream = localStream;
      this._ownsLocalStream = false;
    } else if (enableMic) {
      this._localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this._ownsLocalStream = true;
    }

    if (this._localStream) {
      for (const track of this._localStream.getAudioTracks()) {
        this._pc.addTrack(track, this._localStream);
      }
    } else {
      this._pc.addTransceiver("audio", { direction: "recvonly" });
    }

    const dcReady = makeDeferred();
    this._dc = this._pc.createDataChannel("oai-events");
    this._dc.onopen = () => dcReady.resolve();
    this._dc.onerror = () =>
      this._handleError(new Error("Realtime data channel error"));
    this._dc.onmessage = (e) => {
      try {
        this._onEvent(JSON.parse(e.data));
      } catch (err) {
        console.error("[RealtimeSession] failed to parse event", err);
      }
    };

    const offer = await this._pc.createOffer();
    await this._pc.setLocalDescription(offer);

    const res = await fetch(
      `https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      }
    );

    if (!res.ok) {
      throw new Error(`Realtime SDP failed: ${res.status} ${await res.text()}`);
    }

    const answerSdp = await res.text();
    await this._pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    await withTimeout(dcReady.promise, 15000, "WebRTC data channel open");

    await this.updateSession(
      {
        voice,
        instructions: buildModeratorBaseInstructions(systemPrompt),
        tools: [],
        tool_choice: "auto",
        turn_detection: {
          type: "semantic_vad",
          eagerness: "low",
          create_response: false,
          interrupt_response: false,
        },
      },
      15000
    );

    return this;
  }

  get audioElement() {
    return this._audioEl;
  }

  get micEnabled() {
    return !!this._localStream?.getAudioTracks?.().some((t) => t.enabled);
  }

  async waitForRemoteTrack(timeoutMs = 8000) {
    return withTimeout(
      this._remoteTrackDeferred.promise,
      timeoutMs,
      "remote audio track"
    );
  }

  async primeAudioOutput(timeoutMs = 8000) {
    await this.waitForRemoteTrack(timeoutMs).catch(() => null);
    try {
      const playPromise = this._audioEl?.play?.();
      if (playPromise?.catch) {
        await playPromise.catch(() => null);
      }
    } catch {}
    await delay(120);
  }

  hasActiveResponse() {
    return this._activeResponseIds.size > 0;
  }

  isAssistantSpeaking() {
    return this._assistantSpeaking;
  }

  isUserSpeaking() {
    return this._userSpeaking;
  }

  isIdle() {
    return !this._assistantSpeaking && !this._userSpeaking;
  }

  getSpeakingState() {
    return {
      assistantSpeaking: this._assistantSpeaking,
      userSpeaking: this._userSpeaking,
      lastAssistantStartAt: this._lastAssistantStartAt,
      lastAssistantStopAt: this._lastAssistantStopAt,
      lastUserStartAt: this._lastUserStartAt,
      lastUserStopAt: this._lastUserStopAt,
    };
  }

  setMicEnabled(enabled) {
    if (!this._localStream) return;
    for (const track of this._localStream.getAudioTracks()) {
      track.enabled = !!enabled;
    }
    if (!enabled) {
      this._userSpeaking = false;
      this._lastUserStopAt = Date.now();
    }
  }

  async updateSession(sessionPatch, timeoutMs = 10000) {
    const deferred = makeDeferred();
    this._sessionUpdatedWaiters.push(deferred);
    this._send({ type: "session.update", session: sessionPatch });
    return withTimeout(deferred.promise, timeoutMs, "session.update");
  }

  async setDialogueMode({
    tools = [],
    instructions = null,
    eagerness = "low",
    interruptResponse = true,
    createResponse = true,
    silenceDurationMs = null, // if set, uses server_vad instead of semantic_vad
  } = {}) {
    this.setMicEnabled(true);
    const turn_detection = silenceDurationMs != null
      ? {
          type: "server_vad",
          silence_duration_ms: silenceDurationMs,
          prefix_padding_ms: 300,
          threshold: 0.5,
          create_response: createResponse,
          interrupt_response: interruptResponse,
        }
      : {
          type: "semantic_vad",
          eagerness,
          create_response: createResponse,
          interrupt_response: interruptResponse,
        };
    const patch = { tools, tool_choice: "auto", turn_detection };
    if (instructions != null) patch.instructions = instructions;
    await this.updateSession(patch);
  }

  async setMonologueMode({ tools = [], instructions = null } = {}) {
    this.setMicEnabled(false);
    const patch = {
      tools,
      tool_choice: "auto",
      turn_detection: null,
    };
    if (instructions != null) patch.instructions = instructions;
    await this.updateSession(patch);
    this.clearInputBuffer();
  }

  clearInputBuffer() {
    this._send({ type: "input_audio_buffer.clear" });
    this._userSpeaking = false;
    this._lastUserStopAt = Date.now();
  }

  async waitForIdle({ quietMs = 500, timeoutMs = 5000 } = {}) {
    const startAt = Date.now();
    const pollMs = 50;

    this._debugLog("[Realtime][Boundary] wait start", {
      quietMs,
      timeoutMs,
      state: this.getSpeakingState(),
    });

    while (Date.now() - startAt < timeoutMs) {
      if (this.isIdle()) {
        const lastStopAt = Math.max(
          this._lastAssistantStopAt,
          this._lastUserStopAt
        );
        const quietForMs = Date.now() - lastStopAt;
        if (quietForMs >= quietMs) {
          const result = {
            quietForMs,
            forced: false,
            state: this.getSpeakingState(),
          };
          this._debugLog("[Realtime][Boundary] idle reached", result);
          return result;
        }
      }
      await delay(pollMs);
    }

    const err = new Error(
      `idle boundary timed out after ${timeoutMs} ms (assistantSpeaking=${this._assistantSpeaking}, userSpeaking=${this._userSpeaking})`
    );
    console.warn("[Realtime][Boundary] idle timeout", {
      quietMs,
      timeoutMs,
      state: this.getSpeakingState(),
      reason: err.message,
    });
    throw err;
  }

  async waitForUserSpeechStart(timeoutMs = 5000) {
    const startAt = Date.now();
    const pollMs = 50;

    while (Date.now() - startAt < timeoutMs) {
      if (this._userSpeaking) {
        return {
          startedAt: this._lastUserStartAt || Date.now(),
          state: this.getSpeakingState(),
        };
      }
      await delay(pollMs);
    }

    throw new Error(`user speech did not start within ${timeoutMs} ms`);
  }

  async waitForUserSpeechStop(timeoutMs = 5000) {
    const startAt = Date.now();
    const pollMs = 50;

    while (Date.now() - startAt < timeoutMs) {
      if (!this._userSpeaking) {
        return {
          stoppedAt: this._lastUserStopAt || Date.now(),
          state: this.getSpeakingState(),
        };
      }
      await delay(pollMs);
    }

    throw new Error(`user speech did not stop within ${timeoutMs} ms`);
  }

  async waitForAssistantSpeechStop(timeoutMs = 5000) {
    const startAt = Date.now();
    const pollMs = 50;

    while (Date.now() - startAt < timeoutMs) {
      if (!this._assistantSpeaking) {
        return {
          stoppedAt: this._lastAssistantStopAt || Date.now(),
          state: this.getSpeakingState(),
        };
      }
      await delay(pollMs);
    }

    throw new Error(`assistant speech did not stop within ${timeoutMs} ms`);
  }

  async waitForGracefulIdleOrCancel({ quietMs = 500, timeoutMs = 2500 } = {}) {
    try {
      const result = await this.waitForIdle({ quietMs, timeoutMs });
      this._debugLog("[Realtime][Boundary] graceful path used", result);
      return result;
    } catch (err) {
      console.warn("[Realtime][Boundary] timeout -> fallback cancel", {
        quietMs,
        timeoutMs,
        reason: err?.message || String(err),
        state: this.getSpeakingState(),
      });
      await this.cancelCurrentResponsePlayback().catch(() => null);
      const settleResult = await this.waitForIdle({
        quietMs: Math.min(quietMs, 150),
        timeoutMs: 1500,
      }).catch(() => ({
        quietForMs: 0,
        forced: true,
        reason: "cancel fallback did not reach idle in time",
        state: this.getSpeakingState(),
      }));
      const result = {
        ...settleResult,
        forced: true,
        reason: err?.message || String(err),
        state: this.getSpeakingState(),
      };
      console.warn("[Realtime][Boundary] fallback cancel complete", result);
      return result;
    }
  }

  async cancelCurrentResponsePlayback() {
    const responseId = this._lastResponseId;
    const hasActiveResponse =
      !!responseId && this._activeResponseIds.has(responseId);

    if (hasActiveResponse || this._assistantSpeaking) {
      this._debugLog("[Realtime][Boundary] sending response.cancel", {
        responseId,
        hasActiveResponse,
        state: this.getSpeakingState(),
      });
      this._send({ type: "response.cancel" });
      await delay(40);
      this._debugLog("[Realtime][Boundary] sending output_audio_buffer.clear", {
        responseId,
        state: this.getSpeakingState(),
      });
      this._send({ type: "output_audio_buffer.clear" });
    }

    this._assistantSpeaking = false;
    this._lastAssistantStopAt = Date.now();
    this.clearInputBuffer();
    await delay(80);
  }

  async cancelAndTruncateCurrentResponse() {
    return this.cancelCurrentResponsePlayback();
  }

  async createResponse({
    instructions,
    tools = [],
    outputModalities = ["audio"],
    metadata = {},
    maxOutputTokens = 800,
    input = undefined,
    conversation = undefined,
    timeoutMs = 10000,
  } = {}) {
    const requestKey = metadata.request_key || uid("response");
    const deferred = makeDeferred();
    this._responseCreatedByKey.set(requestKey, deferred);
    this._responseCreatedFallbackWaiters.push({ requestKey, deferred });

    const modalities =
      Array.isArray(outputModalities) &&
      outputModalities.length === 1 &&
      outputModalities[0] === "audio"
        ? ["audio", "text"]
        : outputModalities;

    this._send({
      type: "response.create",
      response: {
        instructions,
        tools,
        tool_choice: "auto",
        modalities,
        max_output_tokens: maxOutputTokens,
        metadata: { ...metadata, request_key: requestKey },
        ...(conversation ? { conversation } : {}),
        ...(input ? { input } : {}),
      },
    });

    return withTimeout(
      deferred.promise,
      timeoutMs,
      `response.create(${requestKey})`
    );
  }

  waitForNextResponseCreated(predicate = null, timeoutMs = 15000) {
    const deferred = makeDeferred();
    this._responseCreatedWaiters.push({ predicate, deferred });
    return withTimeout(deferred.promise, timeoutMs, "response.created");
  }

  waitForToolCall(name, timeoutMs = 45000, predicate = null) {
    const deferred = makeDeferred();
    this._toolWaiters.push({ name, predicate, deferred });
    return withTimeout(deferred.promise, timeoutMs, `tool:${name}`);
  }

  waitForResponseDone(responseId, timeoutMs = 30000) {
    const deferred = makeDeferred();
    const list = this._responseDoneWaiters.get(responseId) || [];
    list.push(deferred);
    this._responseDoneWaiters.set(responseId, list);
    return withTimeout(
      deferred.promise,
      timeoutMs,
      `response.done:${responseId}`
    );
  }

  waitForAudioStopped(responseId, timeoutMs = 30000) {
    const deferred = makeDeferred();
    const list = this._audioStoppedWaiters.get(responseId) || [];
    list.push(deferred);
    this._audioStoppedWaiters.set(responseId, list);
    return withTimeout(
      deferred.promise,
      timeoutMs,
      `output_audio_buffer.stopped:${responseId}`
    );
  }

  waitForTranscriptMatch(responseId, predicate, timeoutMs = 45000) {
    const current = this._transcriptByResponseId.get(responseId) || "";
    if (!predicate || predicate(current)) {
      return Promise.resolve({ responseId, transcript: current });
    }

    const deferred = makeDeferred();
    const list = this._transcriptMatchWaiters.get(responseId) || [];
    list.push({ predicate, deferred });
    this._transcriptMatchWaiters.set(responseId, list);
    return withTimeout(
      deferred.promise,
      timeoutMs,
      `transcript.match:${responseId}`
    );
  }

  getResponseTranscript(responseId) {
    return this._transcriptByResponseId.get(responseId) || "";
  }

  _send(payload) {
    if (this._closed) return;
    if (this._dc?.readyState !== "open") return;
    this._dc.send(JSON.stringify(payload));
  }

  _resolveSessionUpdated(event) {
    const waiter = this._sessionUpdatedWaiters.shift();
    if (waiter) waiter.resolve(event);
  }

  _resolveResponseCreated(event) {
    const payload = {
      responseId: event.response.id,
      metadata: event.response.metadata || {},
      raw: event,
    };

    const remaining = [];
    for (const waiter of this._responseCreatedWaiters) {
      const matches = waiter.predicate ? waiter.predicate(payload) : true;
      if (matches) {
        waiter.deferred.resolve(payload);
      } else {
        remaining.push(waiter);
      }
    }
    this._responseCreatedWaiters = remaining;

    const key = event.response?.metadata?.request_key;
    if (key && this._responseCreatedByKey.has(key)) {
      const waiter = this._responseCreatedByKey.get(key);
      this._responseCreatedByKey.delete(key);
      this._responseCreatedFallbackWaiters =
        this._responseCreatedFallbackWaiters.filter(
          (w) => w.requestKey !== key
        );
      waiter.resolve(payload);
      return;
    }

    const fallback = this._responseCreatedFallbackWaiters.shift();
    if (fallback) {
      this._responseCreatedByKey.delete(fallback.requestKey);
      fallback.deferred.resolve(payload);
    }
  }

  _resolveResponseDone(event) {
    const list = this._responseDoneWaiters.get(event.response.id) || [];
    this._responseDoneWaiters.delete(event.response.id);
    for (const deferred of list) deferred.resolve(event);
  }

  _resolveAudioStopped(event) {
    const list = this._audioStoppedWaiters.get(event.response_id) || [];
    this._audioStoppedWaiters.delete(event.response_id);
    for (const deferred of list) deferred.resolve(event);
  }

  _appendTranscript(responseId, delta = "") {
    const prev = this._transcriptByResponseId.get(responseId) || "";
    const next = prev + (delta || "");
    this._transcriptByResponseId.set(responseId, next);
    return next;
  }

  _resolveTranscriptMatch(responseId, transcript) {
    const list = this._transcriptMatchWaiters.get(responseId) || [];
    if (!list.length) return;

    const remaining = [];
    for (const waiter of list) {
      let matched = false;
      try {
        matched = waiter.predicate ? waiter.predicate(transcript) : true;
      } catch {}
      if (matched) {
        waiter.deferred.resolve({ responseId, transcript });
      } else {
        remaining.push(waiter);
      }
    }

    if (remaining.length) {
      this._transcriptMatchWaiters.set(responseId, remaining);
    } else {
      this._transcriptMatchWaiters.delete(responseId);
    }
  }

  _resolveToolCall(toolEvent) {
    const remaining = [];
    for (const waiter of this._toolWaiters) {
      const nameMatches = waiter.name === toolEvent.name;
      const predicateMatches = waiter.predicate
        ? waiter.predicate(toolEvent)
        : true;
      if (nameMatches && predicateMatches) {
        waiter.deferred.resolve(toolEvent);
      } else {
        remaining.push(waiter);
      }
    }
    this._toolWaiters = remaining;
  }

  _maybeFireTriggerPhrase(event) {
    const responseId = event.response_id;
    const next = event.transcript ?? this._transcriptByResponseId.get(responseId) ?? "";

    const normalized = normalizeText(next);
    if (this._triggerFiredByResponseId.has(responseId)) return;

    for (const phrase of DEFAULT_TRIGGER_PHRASES) {
      if (normalized.includes(phrase)) {
        this._triggerFiredByResponseId.add(responseId);
        if (typeof this.onTriggerPhrase === "function") {
          this.onTriggerPhrase({
            phrase,
            responseId,
            transcript: next,
          });
        }
        break;
      }
    }
  }

  _markAssistantStarted() {
    const wasSpeaking = this._assistantSpeaking;
    this._assistantSpeaking = true;
    this._lastAssistantStartAt = Date.now();
    if (!wasSpeaking) {
      this._debugLog("[Realtime][Speech] assistant started", this.getSpeakingState());
    }
  }

  _markAssistantStopped() {
    const wasSpeaking = this._assistantSpeaking;
    this._assistantSpeaking = false;
    this._lastAssistantStopAt = Date.now();
    if (wasSpeaking) {
      this._debugLog("[Realtime][Speech] assistant stopped", this.getSpeakingState());
    }
  }

  _markUserStarted() {
    const wasSpeaking = this._userSpeaking;
    this._userSpeaking = true;
    this._lastUserStartAt = Date.now();
    if (!wasSpeaking) {
      this._debugLog("[Realtime][Speech] user started", this.getSpeakingState());
    }
  }

  _markUserStopped() {
    const wasSpeaking = this._userSpeaking;
    this._userSpeaking = false;
    this._lastUserStopAt = Date.now();
    if (wasSpeaking) {
      this._debugLog("[Realtime][Speech] user stopped", this.getSpeakingState());
    }
  }

  _onEvent(event) {
    if (this._closed) return;

    switch (event.type) {
      case "session.updated":
        this._resolveSessionUpdated(event);
        if (typeof this.onSessionUpdated === "function") {
          this.onSessionUpdated(event);
        }
        break;

      case "input_audio_buffer.speech_started":
        this._markUserStarted();
        if (typeof this.onUserSpeechStarted === "function") {
          this.onUserSpeechStarted(event);
        }
        break;

      case "input_audio_buffer.speech_stopped":
        this._markUserStopped();
        if (typeof this.onUserSpeechStopped === "function") {
          this.onUserSpeechStopped(event);
        }
        break;

      case "response.created":
        this._lastResponseId = event.response.id;
        this._activeResponseIds.add(event.response.id);
        this._responseMetaById.set(
          event.response.id,
          event.response.metadata || {}
        );
        this._resolveResponseCreated(event);
        if (typeof this.onResponseCreated === "function") {
          this.onResponseCreated(event);
        }
        break;

      case "response.output_item.added":
      case "response.output_item.created":
        if (
          event.item?.type === "message" &&
          event.item?.role === "assistant"
        ) {
          this._assistantItemByResponseId.set(event.response_id, event.item.id);
        }
        break;

      case "response.output_audio.delta":
      case "response.audio.delta":
      case "output_audio_buffer.started":
        this._lastResponseId = event.response_id || this._lastResponseId;
        this._markAssistantStarted();
        if (
          event.item_id &&
          !this._assistantItemByResponseId.get(event.response_id)
        ) {
          this._assistantItemByResponseId.set(event.response_id, event.item_id);
        }
        break;

      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta": {
        if (typeof this.onOutputTranscriptDelta === "function") {
          this.onOutputTranscriptDelta(event);
        }
        const nextTranscript = this._appendTranscript(
          event.response_id,
          event.delta || ""
        );
        this._resolveTranscriptMatch(event.response_id, nextTranscript);
        this._maybeFireTriggerPhrase({
          ...event,
          transcript: nextTranscript,
        });
        break;
      }

      case "response.function_call_arguments.done": {
        const toolEvent = {
          name: event.name,
          args: safeJsonParse(event.arguments),
          responseId: event.response_id,
          itemId: event.item_id,
          callId: event.call_id,
          raw: event,
        };

        this._send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: event.call_id,
            output: JSON.stringify({ ok: true }),
          },
        });

        this._resolveToolCall(toolEvent);
        if (typeof this.onToolCall === "function") this.onToolCall(toolEvent);
        break;
      }

      case "response.audio.done":
      case "response.output_audio.done":
        this._markAssistantStopped();
        this._debugLog("[Realtime][Speech] assistant audio done", {
          responseId: event.response_id,
          state: this.getSpeakingState(),
        });
        break;

      case "response.done":
        this._activeResponseIds.delete(event.response.id);
        this._responseMetaById.set(
          event.response.id,
          event.response.metadata || {}
        );
        this._resolveResponseDone(event);
        if (typeof this.onResponseDone === "function") {
          this.onResponseDone(event);
        }
        break;

      case "output_audio_buffer.cleared":
      case "output_audio_buffer.stopped":
        this._markAssistantStopped();
        if (event.type === "output_audio_buffer.stopped") {
          this._resolveAudioStopped(event);
        }
        if (typeof this.onOutputAudioStopped === "function") {
          this.onOutputAudioStopped(event);
        }
        break;

      case "error":
        this._handleError(
          new Error(event.error?.message || "Realtime API error")
        );
        break;

      default:
        break;
    }
  }

  _handleError(err) {
    if (typeof this.onError === "function") {
      this.onError(err);
    } else {
      console.error("[RealtimeSession]", err);
    }
  }

  close() {
    if (this._closed) return;
    this._closed = true;

    try {
      this._dc?.close();
    } catch {}
    try {
      this._pc?.close();
    } catch {}

    if (this._ownsLocalStream && this._localStream) {
      for (const track of this._localStream.getTracks()) {
        try {
          track.stop();
        } catch {}
      }
    }

    if (this._audioEl?.parentNode) {
      this._audioEl.parentNode.removeChild(this._audioEl);
    }

    this._sessionUpdatedWaiters = [];
    this._responseCreatedFallbackWaiters = [];
    this._responseCreatedByKey.clear();
    this._responseCreatedWaiters = [];
    this._responseDoneWaiters.clear();
    this._audioStoppedWaiters.clear();
    this._transcriptMatchWaiters.clear();
    this._toolWaiters = [];
  }
}

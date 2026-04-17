import { mockSpeak, mockStopSpeaking, mockIsSpeaking } from './mock'
import { TTS_MODEL, TTS_VOICE, TTS_OUTPUT_GAIN } from '../config.js'

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

const API_URL = 'https://api.openai.com/v1/audio/speech'

let currentAudio = null
let currentAudioUrl = null
let audioContext = null
let currentSource = null
let currentGainNode = null

function ensureAudioContext() {
  if (typeof window === 'undefined') return null
  if (!audioContext) {
    const Ctor = window.AudioContext || window.webkitAudioContext
    if (!Ctor) return null
    audioContext = new Ctor()
  }
  return audioContext
}

async function attachPlaybackGain(audio) {
  const ctx = ensureAudioContext()
  if (!ctx) {
    audio.volume = Math.min(1, Math.max(0, TTS_OUTPUT_GAIN))
    return
  }

  if (ctx.state === 'suspended') {
    try {
      await ctx.resume()
    } catch {}
  }

  try {
    currentSource = ctx.createMediaElementSource(audio)
    currentGainNode = ctx.createGain()
    currentGainNode.gain.value = Math.max(0, TTS_OUTPUT_GAIN)
    currentSource.connect(currentGainNode)
    currentGainNode.connect(ctx.destination)
  } catch (err) {
    console.warn('[TTS] gain boost unavailable, falling back to element volume', err)
    currentSource = null
    currentGainNode = null
    audio.volume = Math.min(1, Math.max(0, TTS_OUTPUT_GAIN))
  }
}

function cleanupAudioGraph() {
  try { currentSource?.disconnect() } catch {}
  try { currentGainNode?.disconnect() } catch {}
  currentSource = null
  currentGainNode = null
}

export async function speak(text, { onStart, onEnd, voice, instructions } = {}) {
  if (USE_MOCK) return mockSpeak(text, { onStart, onEnd })

  const apiKey = import.meta.env.VITE_OPENAI_API_KEY
  if (!apiKey) throw new Error('VITE_OPENAI_API_KEY not set in .env')

  stopSpeaking()

  const body = { model: TTS_MODEL, voice: voice ?? TTS_VOICE, input: text }
  // `instructions` is supported by gpt-4o-mini-tts and newer models.
  // Used to enforce Ukrainian pronunciation — tts-1 ignores it silently.
  if (instructions) body.instructions = instructions

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`TTS API error ${response.status}: ${err}`)
  }

  const audioBlob = await response.blob()
  const audioUrl = URL.createObjectURL(audioBlob)
  const audio = new Audio(audioUrl)
  currentAudio = audio
  currentAudioUrl = audioUrl
  await attachPlaybackGain(audio)

  return new Promise((resolve, reject) => {
    audio.onplay = () => onStart?.()
    audio.onended = () => {
      cleanupAudioGraph()
      if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl)
      currentAudio = null
      currentAudioUrl = null
      onEnd?.()
      resolve()
    }
    audio.onerror = (e) => {
      cleanupAudioGraph()
      if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl)
      currentAudio = null
      currentAudioUrl = null
      reject(e)
    }
    audio.play().catch(reject)
  })
}

export function stopSpeaking() {
  if (USE_MOCK) return mockStopSpeaking()
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.currentTime = 0
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl)
    currentAudio = null
    currentAudioUrl = null
    cleanupAudioGraph()
  }
}

export function isSpeaking() {
  if (USE_MOCK) return mockIsSpeaking()
  return currentAudio !== null && !currentAudio.paused
}

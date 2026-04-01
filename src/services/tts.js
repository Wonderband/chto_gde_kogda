import { mockSpeak, mockStopSpeaking, mockIsSpeaking } from './mock'

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

const API_URL = 'https://api.openai.com/v1/audio/speech'

let currentAudio = null

export async function speak(text, { onStart, onEnd } = {}) {
  if (USE_MOCK) return mockSpeak(text, { onStart, onEnd })

  const apiKey = import.meta.env.VITE_OPENAI_API_KEY
  if (!apiKey) throw new Error('VITE_OPENAI_API_KEY not set in .env')

  stopSpeaking()

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: 'tts-1', voice: 'onyx', input: text }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`TTS API error ${response.status}: ${err}`)
  }

  const audioBlob = await response.blob()
  const audioUrl = URL.createObjectURL(audioBlob)
  const audio = new Audio(audioUrl)
  currentAudio = audio

  return new Promise((resolve, reject) => {
    audio.onplay = () => onStart?.()
    audio.onended = () => {
      URL.revokeObjectURL(audioUrl)
      currentAudio = null
      onEnd?.()
      resolve()
    }
    audio.onerror = (e) => {
      URL.revokeObjectURL(audioUrl)
      currentAudio = null
      reject(e)
    }
    audio.play().catch(reject)
  })
}

export function stopSpeaking() {
  if (USE_MOCK) return mockStopSpeaking()
  if (currentAudio) {
    currentAudio.pause()
    currentAudio = null
  }
}

export function isSpeaking() {
  if (USE_MOCK) return mockIsSpeaking()
  return currentAudio !== null && !currentAudio.paused
}

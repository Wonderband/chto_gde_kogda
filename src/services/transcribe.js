/**
 * Speech-to-Text — gpt-4o-mini-transcribe (NOT whisper-1)
 *
 * POST https://api.openai.com/v1/audio/transcriptions
 * model: gpt-4o-mini-transcribe  — 2x cheaper than whisper-1, better Slavic accuracy
 */

import { mockTranscribeAudio } from './mock'

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'
const API_URL  = 'https://api.openai.com/v1/audio/transcriptions'

/**
 * Transcribe recorded audio blob to text.
 * @param {Blob} audioBlob - from MediaRecorder
 * @returns {Promise<string>} transcript
 */
export async function transcribeAudio(audioBlob) {
  if (USE_MOCK) return mockTranscribeAudio(audioBlob)

  const apiKey = import.meta.env.VITE_OPENAI_API_KEY
  if (!apiKey) throw new Error('VITE_OPENAI_API_KEY not set in .env')

  const lang = import.meta.env.VITE_GAME_LANGUAGE || 'ru'

  const formData = new FormData()
  formData.append('file', audioBlob, 'answer.webm')
  formData.append('model', 'gpt-4o-mini-transcribe')
  formData.append('language', lang)

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Transcribe API error ${response.status}: ${err}`)
  }

  const data = await response.json()
  return data.text ?? ''
}

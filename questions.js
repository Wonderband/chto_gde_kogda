import allQuestions from '../data/questions.json'

export function shuffleQuestions(questions) {
  const arr = [...questions]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function loadQuestions() {
  return shuffleQuestions(allQuestions)
}

export function getQuestionById(id) {
  return allQuestions.find((q) => q.id === id) ?? null
}

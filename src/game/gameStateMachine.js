export const STATES = {
  IDLE: 'IDLE',
  SPINNING: 'SPINNING',
  READING: 'READING',
  DISCUSSING: 'DISCUSSING',
  LISTENING: 'LISTENING',
  EVALUATING: 'EVALUATING',
  SCORING: 'SCORING',
  READY: 'READY',       // ← between rounds: waiting for Space to spin again
  GAME_OVER: 'GAME_OVER',
}

export const EVENTS = {
  START: 'START',
  SPIN_DONE: 'SPIN_DONE',
  READING_DONE: 'READING_DONE',
  EARLY_ANSWER: 'EARLY_ANSWER',
  TIMER_DONE: 'TIMER_DONE',
  RECORDING_DONE: 'RECORDING_DONE',
  EVALUATION_DONE: 'EVALUATION_DONE',
  SCORING_DONE: 'SCORING_DONE',
  NEXT_ROUND: 'NEXT_ROUND',  // ← Space after scoring
  GAME_OVER: 'GAME_OVER',
  RESTART: 'RESTART',
}

const transitions = {
  [STATES.IDLE]: {
    [EVENTS.START]: STATES.SPINNING,
  },
  [STATES.SPINNING]: {
    [EVENTS.SPIN_DONE]: STATES.READING,
  },
  [STATES.READING]: {
    [EVENTS.READING_DONE]: STATES.DISCUSSING,
    // EARLY_ANSWER not allowed here — wait for timer to start
  },
  [STATES.DISCUSSING]: {
    [EVENTS.TIMER_DONE]: STATES.LISTENING,
    [EVENTS.EARLY_ANSWER]: STATES.LISTENING,
  },
  [STATES.LISTENING]: {
    [EVENTS.RECORDING_DONE]: STATES.EVALUATING,
  },
  [STATES.EVALUATING]: {
    [EVENTS.EVALUATION_DONE]: STATES.SCORING,
  },
  [STATES.SCORING]: {
    [EVENTS.SCORING_DONE]: STATES.READY,   // ← goes to READY, not SPINNING
    [EVENTS.GAME_OVER]: STATES.GAME_OVER,
  },
  [STATES.READY]: {
    [EVENTS.NEXT_ROUND]: STATES.SPINNING,  // ← Space triggers this
  },
  [STATES.GAME_OVER]: {
    [EVENTS.RESTART]: STATES.IDLE,
  },
}

export function getNextState(currentState, event) {
  const stateTransitions = transitions[currentState]
  if (!stateTransitions) return currentState
  return stateTransitions[event] ?? currentState
}

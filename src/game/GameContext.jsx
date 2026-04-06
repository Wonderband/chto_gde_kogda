import { createContext, useContext, useReducer, useCallback } from "react";
import { STATES, EVENTS } from "./gameStateMachine";
import { loadQuestions } from "./questions";

const WINNING_SCORE = 6;

const initialState = {
  gameState: STATES.IDLE,
  score: { experts: 0, viewers: 0 },
  currentQuestion: null,
  questions: [],
  blitzQueue: [], // remaining blitz sub-questions for the current blitz round
  roundNumber: 0,
  transcript: "",
  evaluation: null,
  isRecording: false,
  ttsPlaying: false,
  earlyAnswer: false,
  winner: null, // 'experts' | 'viewers'
  lastResponseId: null, // OpenAI Responses API — stateful game continuity
};

function reducer(state, action) {
  console.log("[GameContext][Reducer]", {
    from: state.gameState,
    action: action.type,
    payload: action.payload,
  });
  switch (action.type) {
    case EVENTS.START: {
      const questions = loadQuestions();
      return {
        ...initialState,
        gameState: STATES.SPINNING,
        questions,
      };
    }

    case "SET_LAST_RESPONSE_ID":
      return { ...state, lastResponseId: action.payload };

    case EVENTS.RESTART:
      return { ...initialState };

    case EVENTS.SPIN_DONE: {
      const [first, ...remaining] = state.questions;

      // Blitz: collect all sub-questions from the same group, sorted by position
      if (first?.round_type === "blitz") {
        const group = first.blitz_group;
        const sameGroup = remaining.filter((q) => q.blitz_group === group);
        const blitzAll = [first, ...sameGroup].sort(
          (a, b) => (a.blitz_position || 0) - (b.blitz_position || 0)
        );
        const blitzQueue = blitzAll.slice(1);
        const questionsLeft = remaining.filter((q) => q.blitz_group !== group);

        return {
          ...state,
          gameState: STATES.READING,
          currentQuestion: blitzAll[0],
          blitzQueue,
          questions: questionsLeft,
          roundNumber: state.roundNumber + 1,
          transcript: "",
          evaluation: null,
          earlyAnswer: false,
        };
      }

      // Standard question
      return {
        ...state,
        gameState: STATES.READING,
        currentQuestion: first,
        blitzQueue: [],
        questions: remaining,
        roundNumber: state.roundNumber + 1,
        transcript: "",
        evaluation: null,
        earlyAnswer: false,
      };
    }

    case EVENTS.READING_DONE:
      if (state.gameState !== STATES.READING) return state;
      return { ...state, gameState: STATES.DISCUSSING };

    case EVENTS.EARLY_ANSWER:
      return {
        ...state,
        gameState: STATES.LISTENING,
        earlyAnswer: true,
      };

    case EVENTS.TIMER_DONE:
      return { ...state, gameState: STATES.LISTENING };

    case "SET_RECORDING":
      return { ...state, isRecording: action.payload };

    case EVENTS.RECORDING_DONE:
      return {
        ...state,
        gameState: STATES.EVALUATING,
        transcript: action.payload,
        isRecording: false,
      };

    case "SET_TTS_PLAYING":
      return { ...state, ttsPlaying: action.payload };

    case EVENTS.EVALUATION_DONE:
      return {
        ...state,
        gameState: STATES.SCORING,
        evaluation: action.payload,
      };

    case EVENTS.SCORING_DONE: {
      const { who_scores } = state.evaluation;

      // Blitz continuation: more sub-questions remain AND last answer was correct
      // EXPLAINING is skipped for blitz — go straight to next question
      if (state.blitzQueue.length > 0 && who_scores === "experts") {
        const [nextQ, ...blitzRemaining] = state.blitzQueue;
        return {
          ...state,
          gameState: STATES.READING,
          currentQuestion: nextQ,
          blitzQueue: blitzRemaining,
          roundNumber: state.roundNumber + 1,
          transcript: "",
          evaluation: null,
          earlyAnswer: false,
        };
      }

      // Non-blitz: go to EXPLAINING — score NOT applied yet (deferred to EXPLAINING_DONE)
      return {
        ...state,
        blitzQueue: [],
        gameState: STATES.EXPLAINING,
      };
    }

    case EVENTS.EXPLAINING_DONE: {
      // Score is applied here, after the moderator has finished narrating
      const { who_scores } = state.evaluation;
      const newScore = {
        experts: state.score.experts + (who_scores === "experts" ? 1 : 0),
        viewers: state.score.viewers + (who_scores === "viewers" ? 1 : 0),
      };
      const expertWon = newScore.experts >= WINNING_SCORE;
      const viewerWon = newScore.viewers >= WINNING_SCORE;
      const isOver = expertWon || viewerWon;
      return {
        ...state,
        score: newScore,
        gameState: isOver ? STATES.GAME_OVER : STATES.READY,
        winner: expertWon ? "experts" : viewerWon ? "viewers" : null,
      };
    }

    case EVENTS.NEXT_ROUND:
      return { ...state, gameState: STATES.SPINNING };

    default:
      return state;
  }
}

const GameContext = createContext(null);

export function GameProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const send = useCallback((event, payload) => {
    console.log("[GameContext][send]", { event, payload });
    dispatch({ type: event, payload });
  }, []);

  return (
    <GameContext.Provider value={{ state, send }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used inside GameProvider");
  return ctx;
}

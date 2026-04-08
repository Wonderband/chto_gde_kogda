import { useEffect, useRef, useState } from 'react'
import { useGame } from '../game/GameContext'

// Animate digit flip when score changes
function ScoreDigit({ value, color }) {
  const [flip, setFlip] = useState(false)
  const prev = useRef(value)

  useEffect(() => {
    if (value !== prev.current) {
      setFlip(true)
      prev.current = value
      const t = setTimeout(() => setFlip(false), 500)
      return () => clearTimeout(t)
    }
  }, [value])

  return (
    <div className={`score-digit-box ${flip ? 'digit-flip' : ''}`} style={{ '--dcolor': color }}>
      <span className="score-digit-val">{value}</span>
    </div>
  )
}

export default function Scoreboard() {
  const { state } = useGame()
  const { score } = state

  return (
    <div className="scoreboard">

      {/* ── ЗНАТОКИ (left) ── */}
      <div className="team-panel experts-panel">
        <div className="team-label">ЗНАВЦІ</div>
        <div className="team-scores">
          <ScoreDigit value={score.experts} color="var(--score-experts)" />
        </div>
      </div>

      {/* ── Centre title ── */}
      <div className="sb-center">
        <div className="sb-title-ru">ЧТО? ГДЕ? КОГДА?</div>
        <div className="sb-title-uk">ЩО? ДЕ? КОЛИ?</div>
        <div className="sb-colon">:</div>
      </div>

      {/* ── ТЕЛЕЗРИТЕЛИ (right) ── */}
      <div className="team-panel viewers-panel">
        <div className="team-scores">
          <ScoreDigit value={score.viewers} color="var(--score-viewers)" />
        </div>
        <div className="team-label">ТЕЛЕГЛЯДАЧІ</div>
      </div>

      <style>{`
        .scoreboard {
          display: flex;
          align-items: stretch;
          justify-content: space-between;
          background: linear-gradient(180deg, #0a0d0a 0%, #060806 100%);
          border-bottom: 3px solid #c9a84c;
          box-shadow:
            0 4px 32px rgba(0,0,0,0.9),
            inset 0 1px 0 rgba(201,168,76,0.15);
          flex-shrink: 0;
          height: 90px;
        }

        /* ── Team panel ── */
        .team-panel {
          display: flex;
          align-items: center;
          gap: 0;
          padding: 0 2.4rem;
          min-width: 320px;
          position: relative;
        }
        .experts-panel {
          justify-content: flex-start;
          border-right: 1px solid rgba(201,168,76,0.12);
        }
        .viewers-panel {
          justify-content: flex-end;
          border-left: 1px solid rgba(201,168,76,0.12);
        }

        /* Side gold accent line */
        .experts-panel::before,
        .viewers-panel::before {
          content: '';
          position: absolute;
          top: 10px; bottom: 10px;
          width: 2px;
          background: linear-gradient(180deg,
            transparent 0%, #c9a84c 30%, #c9a84c 70%, transparent 100%);
          opacity: 0.5;
        }
        .experts-panel::before { left: 1.2rem; }
        .viewers-panel::before { right: 1.2rem; }

        .team-label {
          font-family: Georgia, 'Times New Roman', serif;
          font-size: 0.8rem;
          letter-spacing: 0.22em;
          color: rgba(201,168,76,0.7);
          text-transform: uppercase;
          writing-mode: horizontal-tb;
          padding: 0 1.2rem;
          white-space: nowrap;
        }

        .team-scores {
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }

        /* ── Individual score digit box (like flip board) ── */
        .score-digit-box {
          width: 56px;
          height: 66px;
          background: linear-gradient(180deg, #111611 0%, #0a0e0a 52%, #0d120d 52%, #111611 100%);
          border: 1px solid rgba(201,168,76,0.25);
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          box-shadow:
            inset 0 1px 3px rgba(0,0,0,0.8),
            inset 0 -1px 3px rgba(0,0,0,0.5),
            0 2px 8px rgba(0,0,0,0.6);
          overflow: hidden;
        }
        /* Flip-board centre split line */
        .score-digit-box::after {
          content: '';
          position: absolute;
          left: 0; right: 0;
          top: 50%;
          height: 1px;
          background: rgba(0,0,0,0.8);
          z-index: 2;
        }
        .score-digit-val {
          font-family: 'Georgia', serif;
          font-size: 2.8rem;
          font-weight: bold;
          line-height: 1;
          color: var(--dcolor);
          text-shadow:
            0 0 20px var(--dcolor),
            0 2px 4px rgba(0,0,0,0.9);
          position: relative;
          z-index: 3;
        }
        .digit-flip {
          animation: digitFlip 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }
        @keyframes digitFlip {
          0%   { transform: scaleY(1); }
          40%  { transform: scaleY(0); }
          41%  { transform: scaleY(0); }
          100% { transform: scaleY(1); }
        }

        /* ── Centre ── */
        .sb-center {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          flex: 1;
          position: relative;
          gap: 0;
          padding: 0 1rem;
        }
        .sb-title-ru {
          font-family: Georgia, serif;
          font-size: 0.75rem;
          letter-spacing: 0.35em;
          color: rgba(201,168,76,0.5);
          text-transform: uppercase;
          white-space: nowrap;
        }
        .sb-title-uk {
          font-family: Georgia, serif;
          font-size: 0.88rem;
          letter-spacing: 0.3em;
          color: rgba(201,168,76,0.85);
          text-transform: uppercase;
          white-space: nowrap;
        }
        .sb-colon {
          font-family: Georgia, serif;
          font-size: 2.4rem;
          font-weight: bold;
          color: rgba(201,168,76,0.6);
          line-height: 1;
          margin-top: 0.1rem;
        }
      `}</style>
    </div>
  )
}

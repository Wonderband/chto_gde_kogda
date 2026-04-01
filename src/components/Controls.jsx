import { STATES } from '../game/gameStateMachine'

// Controls is now purely a visual hints component.
// All keyboard logic lives in App.jsx useKeyboard hook.
export default function Controls({ gameState, paused }) {
  return (
    <div className="controls-bar">
      {gameState === STATES.IDLE && (
        <Hint items={[['Пробіл', 'Почати гру']]} />
      )}
      {gameState === STATES.READY && (
        <Hint items={[['Пробіл', 'Наступний раунд']]} highlight />
      )}
      {gameState === STATES.SPINNING && (
        <Hint items={[['—', 'Крутимо...']]} dim />
      )}
      {gameState === STATES.READING && (
        <Hint items={[['—', 'Ведучий читає питання']]} dim />
      )}
      {gameState === STATES.DISCUSSING && (
        <Hint items={[
          ['E', 'Дострокова відповідь'],
          ['P', paused ? 'Продовжити' : 'Пауза'],
        ]} />
      )}
      {gameState === STATES.LISTENING && (
        <Hint items={[['Enter', 'Зупинити запис']]} highlight />
      )}
      {gameState === STATES.EVALUATING && (
        <Hint items={[['—', 'Оцінюємо...']]} dim />
      )}
      {gameState === STATES.SCORING && (
        <Hint items={[['—', 'Зараховуємо...']]} dim />
      )}
      {gameState === STATES.GAME_OVER && (
        <Hint items={[['R', 'Нова гра']]} />
      )}

      <style>{`
        .controls-bar {
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 0.5rem 1.5rem;
          min-height: 2.8rem;
          border-top: 1px solid rgba(201,168,76,0.1);
          background: rgba(0,0,0,0.3);
          flex-shrink: 0;
        }
        .hint-row {
          display: flex;
          gap: 2rem;
          align-items: center;
        }
        .hint-row.hint-dim { opacity: 0.35; }
        .hint-item {
          display: flex;
          align-items: center;
          gap: 0.45rem;
          font-size: 0.82rem;
          color: var(--text-secondary);
          letter-spacing: 0.03em;
        }
        .hint-row.hint-highlight .hint-item {
          color: var(--timer-warning);
        }
        .key-cap {
          display: inline-block;
          padding: 0.1rem 0.55rem;
          background: rgba(201,168,76,0.08);
          border: 1px solid rgba(201,168,76,0.35);
          border-bottom: 2px solid rgba(201,168,76,0.5);
          border-radius: 4px;
          font-family: monospace;
          font-size: 0.78rem;
          color: var(--accent-gold);
          min-width: 1.8rem;
          text-align: center;
        }
        .hint-row.hint-highlight .key-cap {
          border-color: var(--timer-warning);
          color: var(--timer-warning);
          background: rgba(232,93,36,0.08);
        }
      `}</style>
    </div>
  )
}

function Hint({ items, dim, highlight }) {
  return (
    <div className={`hint-row ${dim ? 'hint-dim' : ''} ${highlight ? 'hint-highlight' : ''}`}>
      {items.map(([key, label]) => (
        <div key={key} className="hint-item">
          <span className="key-cap">{key}</span>
          <span>{label}</span>
        </div>
      ))}
    </div>
  )
}

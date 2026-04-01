export default function ModeratorVoice({ playing }) {
  if (!playing) return null

  return (
    <div className="mod-voice">
      <div className="mod-mic">🎙</div>
      <div className="mod-bars">
        <div className="mod-bar vb-1" />
        <div className="mod-bar vb-2" />
        <div className="mod-bar vb-3" />
        <div className="mod-bar vb-4" />
        <div className="mod-bar vb-5" />
      </div>
      <span className="mod-label">Ведучий</span>

      <style>{`
        .mod-voice {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          padding: 0.4rem 0.9rem;
          border: 1px solid rgba(201,168,76,0.35);
          border-radius: 24px;
          background: rgba(201,168,76,0.06);
        }
        .mod-mic { font-size: 1rem; line-height: 1; }
        .mod-bars {
          display: flex;
          align-items: center;
          gap: 2px;
          height: 22px;
        }
        .mod-bar {
          width: 3px;
          height: 100%;
          border-radius: 2px;
          background: var(--accent-gold);
          transform-origin: center;
        }
        .mod-label {
          font-size: 0.75rem;
          letter-spacing: 0.12em;
          color: var(--text-secondary);
          text-transform: uppercase;
        }
      `}</style>
    </div>
  )
}

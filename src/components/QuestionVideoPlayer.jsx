import { useEffect, useRef, useState } from "react";
import { GAME_LANGUAGE } from "../config.js";

export default function QuestionVideoPlayer({ question, onEnded }) {
  const videoRef = useRef(null);
  const [playBlocked, setPlayBlocked] = useState(false);

  const src = question?.video_src || "";
  const poster = question?.video_poster || "";
  const title =
    GAME_LANGUAGE === "ru"
      ? `Видеовопрос от ${question?.character || "Героя сериала"}`
      : `Відеозапитання від ${question?.character || "Героя серіалу"}`;
  const hint =
    GAME_LANGUAGE === "ru"
      ? "Вопрос прозвучит с экрана. После ролика начнётся обсуждение."
      : "Питання пролунає з екрана. Після ролика почнеться обговорення.";
  const blockedLabel =
    GAME_LANGUAGE === "ru"
      ? "Нажмите, чтобы включить видео"
      : "Натисніть, щоб увімкнути відео";

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    let cancelled = false;
    setPlayBlocked(false);
    video.currentTime = 0;

    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        if (!cancelled) setPlayBlocked(true);
      });
    }

    return () => {
      cancelled = true;
      video.pause();
      video.currentTime = 0;
    };
  }, [src]);

  const handleManualPlay = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
      setPlayBlocked(false);
    } catch (err) {
      console.error("[QuestionVideoPlayer] play failed", err);
      setPlayBlocked(true);
    }
  };

  return (
    <div className="qvideo fade-in-up">
      <div className="qvideo-head">
        <div className="qvideo-title">{title}</div>
        <div className="qvideo-subtitle">{hint}</div>
      </div>

      <div className="qvideo-frame">
        <video
          ref={videoRef}
          key={src}
          className="qvideo-media"
          src={src}
          poster={poster || undefined}
          playsInline
          preload="auto"
          controls
          autoPlay
          onEnded={onEnded}
          onError={() => setPlayBlocked(true)}
        />

        {playBlocked && (
          <button
            className="qvideo-overlay"
            type="button"
            onClick={handleManualPlay}
          >
            {blockedLabel}
          </button>
        )}
      </div>

      <style>{`
        .qvideo {
          width: min(100%, 980px);
          background: linear-gradient(160deg, #0e1e0e 0%, #09120a 100%);
          border: 1px solid var(--border-gold-strong);
          border-radius: 14px;
          overflow: hidden;
          box-shadow: 0 8px 40px rgba(0,0,0,0.7), var(--shadow-gold);
        }
        .qvideo-head {
          padding: 1.25rem 1.5rem;
          border-bottom: 1px solid rgba(201, 168, 76, 0.18);
          background: rgba(0,0,0,0.28);
        }
        .qvideo-title {
          font-size: clamp(1.15rem, 2vw, 1.6rem);
          color: var(--accent-gold);
          font-family: Georgia, serif;
        }
        .qvideo-subtitle {
          margin-top: 0.35rem;
          font-size: 0.92rem;
          color: var(--text-secondary);
          letter-spacing: 0.04em;
        }
        .qvideo-frame {
          position: relative;
          background: #000;
          aspect-ratio: 16 / 9;
        }
        .qvideo-media {
          display: block;
          width: 100%;
          height: 100%;
          object-fit: contain;
          background: #000;
        }
        .qvideo-overlay {
          position: absolute;
          inset: 0;
          border: none;
          background: rgba(0, 0, 0, 0.45);
          color: #fff;
          font-size: 1.05rem;
          letter-spacing: 0.05em;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

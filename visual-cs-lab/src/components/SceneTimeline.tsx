import { useState } from 'react';

import type { Scene } from '../api';

type Props = {
  lessonId: string;
  scenes: Scene[];
  stamp: number;
  busy: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
  onDuplicate: (sceneId: string) => void;
};

/**
 * The storyboard as a sequence of real frames. Each card can play the actual
 * motion of that scene (a short MP4 rendered by the same engine as the export),
 * and scenes can be reordered or duplicated before the timeline is saved.
 */
export default function SceneTimeline({ lessonId, scenes, stamp, busy, onMove, onDuplicate }: Props) {
  const [playing, setPlaying] = useState<string | null>(null);

  return (
    <div className="storyboard">
      {scenes.map((scene, index) => (
        <div className="scene-card" key={scene.id}>
          {playing === scene.id ? (
            <video
              src={`/api/lessons/${lessonId}/scene/${index}/clip.mp4?v=${stamp}`}
              controls
              autoPlay
              loop
              muted
              playsInline
              className="scene-video"
            />
          ) : (
            <button
              type="button"
              className="scene-thumb"
              onClick={() => setPlaying(scene.id)}
              title="Play this scene"
              aria-label={`Play scene ${index + 1}`}
            >
              <img
                src={`/api/lessons/${lessonId}/scene/${index}.png?v=${stamp}`}
                alt={`${scene.type} scene preview`}
                loading="lazy"
              />
              <span className="play">▶</span>
            </button>
          )}
          <div className="body">
            <span className="type">
              {index + 1} · {scene.type} · {(scene.durationMs / 1000).toFixed(1)}s
            </span>
            <span style={{ fontSize: 12.5 }}>{scene.title}</span>
            <span className="cap">{scene.caption || scene.subtitle}</span>
            <div className="row" style={{ gap: 6, marginTop: 2 }}>
              <button
                className="btn ghost"
                style={{ padding: '2px 7px', fontSize: 11 }}
                onClick={() => onMove(index, -1)}
                disabled={busy || index === 0}
                aria-label={`Move scene ${index + 1} earlier`}
              >
                ←
              </button>
              <button
                className="btn ghost"
                style={{ padding: '2px 7px', fontSize: 11 }}
                onClick={() => onMove(index, 1)}
                disabled={busy || index === scenes.length - 1}
                aria-label={`Move scene ${index + 1} later`}
              >
                →
              </button>
              <button
                className="btn ghost"
                style={{ padding: '2px 7px', fontSize: 11 }}
                onClick={() => onDuplicate(scene.id)}
                disabled={busy}
                aria-label={`Duplicate scene ${index + 1}`}
              >
                Dup
              </button>
              {playing === scene.id && (
                <button
                  className="btn ghost"
                  style={{ padding: '2px 7px', fontSize: 11 }}
                  onClick={() => setPlaying(null)}
                >
                  Still
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

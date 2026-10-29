/**
 * The demonstration video, which closes the lesson.
 *
 * It is a companion to what the learner has just read, never the lesson itself:
 * it sits after the explanation, the code and the practice questions, does not
 * autoplay, and is silent unless the learner picks another audio variant.
 * A lesson without a verified asset renders nothing at all here.
 */

import { useEffect, useState } from 'react';

import type { LearnedLesson } from '../../learn';

const AUDIO_LABEL: Record<string, string> = {
  silent: 'Silent',
  music: 'Background music',
  voiceover: 'With narration'
};

export default function VisualDemonstration({ lesson }: { lesson: LearnedLesson }) {
  const video = lesson.video;
  const [assetId, setAssetId] = useState(video?.id || '');

  useEffect(() => {
    setAssetId(video?.id || '');
  }, [video?.id]);

  if (!video) return null;

  const variants = video.variants.filter((variant) => variant.id);
  const src = `/api/learn/videos/${assetId}`;

  return (
    <div className="p-demo">
      <div className="p-demo-media">
        <video
          key={src}
          src={src}
          poster={lesson.thumbnailUrl || undefined}
          controls
          playsInline
          preload="metadata"
        />
      </div>
      <div className="p-demo-copy">
        <p>
          A short visual companion to this lesson. It replays the trace you just read — the same steps, the same
          values — so you can watch the order of events instead of following it line by line.
        </p>
        {lesson.lesson.hook && <p className="p-demo-hook">“{lesson.lesson.hook}”</p>}
        {variants.length > 1 && (
          <div className="p-demo-audio">
            <span className="p-eyebrow">Audio</span>
            {variants.map((variant) => (
              <button
                key={variant.id}
                type="button"
                className={`p-btn p-btn-sm${variant.id === assetId ? ' p-btn-primary' : ''}`}
                onClick={() => setAssetId(variant.id)}
              >
                {AUDIO_LABEL[variant.audioMode] || variant.audioMode}
              </button>
            ))}
          </div>
        )}
        {lesson.derived.videos.stale && (
          <p className="p-demo-note">
            This animation was rendered from an earlier version of the lesson. The algorithm on screen is unchanged;
            the written lesson has been edited since.
          </p>
        )}
      </div>
    </div>
  );
}

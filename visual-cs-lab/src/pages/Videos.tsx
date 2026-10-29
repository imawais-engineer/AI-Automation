import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, formatBytes, thumbnailUrl, type Lesson, type RenderJob } from '../api';
import VoiceoverPanel from '../components/VoiceoverPanel';
import { isActive, parseChecks } from '../useRenderJob';

type LessonRow = Lesson & { concept_name?: string; concept_slug?: string };

const ACTIVE_STATES = ['queued', 'rendering', 'encoding', 'validating'];

const badgeFor = (job?: RenderJob) => {
  if (!job) return { className: 'badge', label: 'no render' };
  if (job.state === 'done') return { className: 'badge good', label: 'rendered' };
  if (job.state === 'error') return { className: 'badge bad', label: 'render failed' };
  if (job.state === 'cancelled') return { className: 'badge warn', label: 'cancelled' };
  return { className: 'badge accent', label: `${job.state} ${Math.round(job.progress)}%` };
};

export default function Videos() {
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [renders, setRenders] = useState<RenderJob[]>([]);
  const [error, setError] = useState('');
  const [busyLesson, setBusyLesson] = useState<string | null>(null);
  const [scriptFor, setScriptFor] = useState<string | null>(null);
  const [thumbVersion, setThumbVersion] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    try {
      const [lessonData, renderData] = await Promise.all([
        api<{ lessons: LessonRow[] }>('/api/lessons'),
        api<{ renders: RenderJob[] }>('/api/renders')
      ]);
      setLessons(lessonData.lessons);
      setRenders(renderData.renders);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!renders.some((job) => ACTIVE_STATES.includes(job.state))) return;
    const timer = setInterval(() => void load(), 2500);
    return () => clearInterval(timer);
  }, [renders, load]);

  const latestFor = (lessonId: string, preset?: 'hd' | 'preview') =>
    renders.find((job) => job.lesson_id === lessonId && (preset ? job.preset === preset : true));

  const render = async (lessonId: string, preset: 'preview' | 'hd') => {
    setError('');
    setBusyLesson(lessonId);
    try {
      await api<{ job: RenderJob }>('/api/renders', {
        method: 'POST',
        body: JSON.stringify({ lessonId, preset })
      });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusyLesson(null);
    }
  };

  const thumbnailFor = (lesson: LessonRow) =>
    thumbnailUrl(lesson.id, `${lesson.updated_at}-${thumbVersion[lesson.id] ?? 0}`);

  /** Replaces the poster image only — the video itself is untouched. */
  const replaceThumbnail = async (lessonId: string, file: File) => {
    setError('');
    try {
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('That image could not be read.'));
        reader.readAsDataURL(file);
      });
      await api(`/api/lessons/${lessonId}/thumbnail`, {
        method: 'POST',
        body: JSON.stringify({ image })
      });
      setThumbVersion((current) => ({ ...current, [lessonId]: (current[lessonId] ?? 0) + 1 }));
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  /** Rebuilds the storyboard on the current branding and recuts the thumbnail. */
  const rebrand = async (lessonId: string) => {
    setError('');
    setBusyLesson(lessonId);
    try {
      await api('/api/brand/regenerate', { method: 'POST', body: JSON.stringify({ lessonId }) });
      setThumbVersion((current) => ({ ...current, [lessonId]: (current[lessonId] ?? 0) + 1 }));
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusyLesson(null);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Videos</h1>
          <div className="sub">Preview, export and download the silent vertical shorts.</div>
        </div>
        <Link className="btn primary" to="/admin/create">
          + New video
        </Link>
      </div>

      {error && <div className="notice bad" style={{ marginBottom: 16 }}>{error}</div>}

      {lessons.length === 0 && (
        <div className="empty">
          <strong>No videos yet</strong>
          <span>Create your first animation to see it here.</span>
        </div>
      )}

      <div className="grid two">
        {lessons.map((lesson) => {
          const latest = latestFor(lesson.id);
          const hd = latestFor(lesson.id, 'hd');
          const badge = badgeFor(latest);
          const playable = latest && latest.state === 'done' ? latest : hd && hd.state === 'done' ? hd : null;
          const checks = parseChecks(playable?.validation);
          return (
            <div className="card" key={lesson.id}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{lesson.title}</div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {lesson.concept_name || lesson.concept_slug} · {lesson.duration_seconds}s
                  </div>
                </div>
                <span className={badge.className}>{badge.label}</span>
              </div>

              {playable ? (
                <video
                  key={playable.id}
                  src={`/api/renders/${playable.id}/stream`}
                  poster={thumbnailFor(lesson)}
                  controls
                  loop
                  muted
                  playsInline
                  style={{ width: '100%', borderRadius: 12, marginBottom: 10, background: '#000' }}
                />
              ) : (
                <div className="thumb-frame">
                  <img
                    src={thumbnailFor(lesson)}
                    alt={`${lesson.title} thumbnail`}
                    onError={(event) => {
                      event.currentTarget.style.visibility = 'hidden';
                    }}
                  />
                  <span className="thumb-caption">
                    {latest && ACTIVE_STATES.includes(latest.state)
                      ? `${latest.state} ${Math.round(latest.progress)}%`
                      : 'no finished render'}
                  </span>
                </div>
              )}

              {playable?.state === 'error' && <div className="notice bad">{playable.error}</div>}

              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => void render(lesson.id, 'preview')}
                  disabled={busyLesson === lesson.id}
                >
                  Preview
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void render(lesson.id, 'hd')}
                  disabled={busyLesson === lesson.id || isActive(hd ?? null)}
                >
                  Export HD
                </button>
                {hd && hd.state === 'done' && (
                  <a className="btn" href={`/api/renders/${hd.id}/video`}>
                    Download
                  </a>
                )}
                <label className="btn ghost" style={{ cursor: 'pointer' }}>
                  Replace thumbnail
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    style={{ display: 'none' }}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void replaceThumbnail(lesson.id, file);
                      event.target.value = '';
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => void rebrand(lesson.id)}
                  disabled={busyLesson === lesson.id}
                >
                  Rebrand
                </button>
                <button
                  type="button"
                  className={`btn ${scriptFor === lesson.id ? 'primary' : 'ghost'}`}
                  onClick={() => setScriptFor(scriptFor === lesson.id ? null : lesson.id)}
                >
                  Voice-over Script
                </button>
                <Link className="btn ghost" to={`/admin/lessons/${lesson.id}`}>
                  Edit
                </Link>
              </div>

              {scriptFor === lesson.id && (
                <div style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 12 }}>
                  <VoiceoverPanel lessonId={lesson.id} />
                </div>
              )}

              {playable && (
                <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
                  {formatBytes(playable.bytes)} · {playable.duration_seconds.toFixed(2)}s ·{' '}
                  {playable.width}×{playable.height} · {playable.fps} fps · {playable.frames} frames
                  {checks.length > 0 && (
                    <>
                      {' '}
                      · {checks.filter((check) => check.ok).length}/{checks.length} checks passed
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

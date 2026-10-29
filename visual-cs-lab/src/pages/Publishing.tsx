import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  api,
  thumbnailUrl,
  type Lesson,
  type Pipeline,
  type PublishJob,
  type RenderJob,
  type RenderValidation
} from '../api';

function qualityOf(job: RenderJob): RenderValidation | null {
  if (!job.validation) return null;
  try {
    const parsed = JSON.parse(job.validation) as RenderValidation;
    return Array.isArray(parsed.checks) ? parsed : null;
  } catch {
    return null;
  }
}

const PLATFORMS = [
  { key: 'instagram', label: 'Instagram Reels' },
  { key: 'facebook', label: 'Facebook Reels' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'youtube', label: 'YouTube Shorts' }
];

const STATUS_TONE: Record<string, string> = {
  published: 'good',
  ready: 'accent',
  scheduled: 'warn',
  failed: 'bad'
};

export default function Publishing() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [rows, setRows] = useState<PublishJob[]>([]);
  const [lessonId, setLessonId] = useState('');
  const [renders, setRenders] = useState<RenderJob[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [edits, setEdits] = useState<Record<string, Partial<PublishJob>>>({});
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);

  const load = useCallback(async () => {
    try {
      const [lessonData, publishData] = await Promise.all([
        api<{ lessons: Lesson[] }>('/api/lessons'),
        api<{ publishes: PublishJob[] }>('/api/publishes')
      ]);
      setLessons(lessonData.lessons);
      setRows(publishData.publishes);
      setLessonId((current) => current || lessonData.lessons[0]?.id || '');
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!lessonId) return;
    api<{ renders: RenderJob[] }>(`/api/renders?lessonId=${lessonId}`)
      .then((data) => setRenders(data.renders.filter((job) => job.state === 'done')))
      .catch(() => setRenders([]));
    api<{ pipeline: Pipeline }>(`/api/lessons/${lessonId}`)
      .then((data) => setPipeline(data.pipeline))
      .catch(() => setPipeline(null));
  }, [lessonId]);

  const lesson = lessons.find((item) => item.id === lessonId);
  const lessonRows = rows.filter((row) => row.lesson_id === lessonId);

  async function draft(platform: string) {
    if (!lesson) return;
    setError('');
    try {
      const caption = [lesson.hook, lesson.narration, lesson.key_takeaway]
        .filter(Boolean)
        .join(' ')
        .slice(0, 600);
      await api('/api/publishes', {
        method: 'POST',
        body: JSON.stringify({
          lessonId: lesson.id,
          platform,
          title: lesson.title,
          caption,
          hashtags: '#dsa #computerscience #codinginterview #visualcslab',
          cta: lesson.cta
        })
      });
      await load();
      setNotice(`${platform} entry drafted. Copy the caption, upload the MP4, then paste the post URL.`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function save(row: PublishJob) {
    setError('');
    setNotice('');
    const patch = edits[row.id] || {};
    try {
      await api(`/api/publishes/${row.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      setEdits((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      await load();
      setNotice('Publishing entry saved.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function value(row: PublishJob, key: keyof PublishJob): string {
    const edit = edits[row.id]?.[key];
    return String((edit ?? row[key] ?? '') as string);
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Publishing queue</h1>
          <p className="sub">
            Automated posting needs platform app review and account authorisation, none of which is
            configured here. This is the manual workflow: draft the copy, download the validated MP4,
            publish by hand, then record the real URL.
          </p>
        </div>
        <Link className="btn" to="/admin/renders">
          Render manager
        </Link>
      </header>

      {error && <div className="notice bad">{error}</div>}
      {notice && <div className="notice good">{notice}</div>}

      <div className="row">
        <select
          className="select"
          style={{ maxWidth: 340 }}
          value={lessonId}
          onChange={(event) => setLessonId(event.target.value)}
          aria-label="Lesson to publish"
        >
          {lessons.length === 0 && <option value="">No lessons yet</option>}
          {lessons.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
        {lesson && (
          <img
            className="publish-thumb"
            src={thumbnailUrl(lesson.id, lesson.updated_at)}
            alt={`${lesson.title} thumbnail`}
          />
        )}
        {lesson && (
          <Link className="btn ghost" to={`/admin/lessons/${lesson.id}`}>
            Open lesson
          </Link>
        )}
      </div>

      <div className="card tight">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3>Rendered files</h3>
          <span className={`badge ${pipeline?.readyToPublish ? 'good' : 'warn'}`}>
            {pipeline ? pipeline.label : 'no render'}
          </span>
        </div>
        {renders.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>
            This lesson has no finished MP4 yet — render it before publishing.
          </p>
        ) : (
          <div className="row">
            {renders.map((job) => {
              const quality = qualityOf(job);
              return (
                <a
                  key={job.id}
                  className="btn ghost"
                  href={`/api/renders/${job.id}/video`}
                  title={quality?.ok ? 'Automated quality checks passed' : 'Not quality checked'}
                >
                  Download {job.preset} ({job.width}×{job.height})
                  {quality?.ok ? ' ✓' : ' —'}
                </a>
              );
            })}
          </div>
        )}
        {pipeline && !pipeline.readyToPublish && (
          <p className="hint" style={{ margin: 0 }}>
            A video is only marked ready to publish when its file passes every automated check and the
            lesson review status is approved.
          </p>
        )}
      </div>

      {pipeline && (
        <div className="card tight">
          <h3>Publication checklist</h3>
          <ul className="check-list">
            {pipeline.checklist.map((item) => (
              <li key={item.key} className={item.ok === null ? '' : item.ok ? 'ok' : 'bad'}>
                <span className="mark">{item.ok === null ? '○' : item.ok ? '✓' : '✕'}</span>
                <span>
                  <strong>
                    {item.label}
                    {item.kind === 'manual' ? ' — needs your review' : ''}
                  </strong>
                  <em>{item.detail}</em>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid two">
        {PLATFORMS.map((platform) => {
          const row = lessonRows.find((item) => item.platform === platform.key);
          return (
            <div className="card" key={platform.key}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2>{platform.label}</h2>
                {row ? (
                  <span className={`badge ${STATUS_TONE[row.status] || ''}`}>{row.status}</span>
                ) : (
                  <span className="badge">not drafted</span>
                )}
              </div>

              {!row ? (
                <>
                  <p style={{ color: 'var(--muted)' }}>
                    Draft platform-specific copy from this lesson. Publishing stays manual until an
                    official integration is authorised.
                  </p>
                  <button className="btn" onClick={() => draft(platform.key)} disabled={!lesson}>
                    Draft entry
                  </button>
                </>
              ) : (
                <>
                  <div className="field">
                    <label htmlFor={`${row.id}-title`}>Title</label>
                    <input
                      id={`${row.id}-title`}
                      className="input"
                      value={value(row, 'title')}
                      onChange={(event) =>
                        setEdits({ ...edits, [row.id]: { ...edits[row.id], title: event.target.value } })
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`${row.id}-caption`}>Caption</label>
                    <textarea
                      id={`${row.id}-caption`}
                      className="textarea"
                      value={value(row, 'caption')}
                      onChange={(event) =>
                        setEdits({ ...edits, [row.id]: { ...edits[row.id], caption: event.target.value } })
                      }
                    />
                    <button
                      className="btn ghost"
                      onClick={() => navigator.clipboard?.writeText(`${value(row, 'title')}\n\n${value(row, 'caption')}\n\n${value(row, 'hashtags')}`)}
                    >
                      Copy caption
                    </button>
                  </div>
                  <div className="field">
                    <label htmlFor={`${row.id}-hashtags`}>Hashtags</label>
                    <input
                      id={`${row.id}-hashtags`}
                      className="input"
                      value={value(row, 'hashtags')}
                      onChange={(event) =>
                        setEdits({ ...edits, [row.id]: { ...edits[row.id], hashtags: event.target.value } })
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`${row.id}-url`}>Published URL</label>
                    <input
                      id={`${row.id}-url`}
                      className="input"
                      placeholder="https://…"
                      value={value(row, 'published_url')}
                      onChange={(event) =>
                        setEdits({ ...edits, [row.id]: { ...edits[row.id], published_url: event.target.value } })
                      }
                    />
                    <span className="hint">Required before a video can be marked published.</span>
                  </div>
                  <div className="row">
                    <select
                      className="select"
                      style={{ width: 160 }}
                      value={String(edits[row.id]?.status ?? row.status)}
                      onChange={(event) =>
                        setEdits({ ...edits, [row.id]: { ...edits[row.id], status: event.target.value } })
                      }
                      aria-label={`${platform.label} status`}
                    >
                      <option value="drafted">Drafted</option>
                      <option value="ready">Ready</option>
                      <option value="scheduled">Scheduled</option>
                      <option value="published">Published</option>
                      <option value="failed">Failed</option>
                    </select>
                    <button className="btn primary" onClick={() => save(row)}>
                      Save entry
                    </button>
                    {row.published_url && (
                      <a className="btn ghost" href={row.published_url} target="_blank" rel="noreferrer">
                        Open post
                      </a>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

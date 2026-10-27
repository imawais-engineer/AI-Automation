import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  api,
  formatBytes,
  type Brand,
  type Concept,
  type Lesson,
  type Pipeline,
  type PublishJob,
  type RenderJob,
  type Scene
} from '../api';
import PipelineStrip from '../components/PipelineStrip';
import RenderQuality from '../components/RenderQuality';
import SceneTimeline from '../components/SceneTimeline';

type Detail = {
  lesson: Lesson;
  concept: Concept;
  issues: string[];
  scenes: Scene[];
  renders: RenderJob[];
  publishes: PublishJob[];
  pipeline: Pipeline;
};

const DURATIONS = [10, 20, 30, 45, 60];
const PRESETS: { key: 'preview' | 'hd' | '4k'; label: string; note: string }[] = [
  { key: 'preview', label: 'Preview', note: '540×960 · 30 fps · fast iteration' },
  { key: 'hd', label: 'HD', note: '1080×1920 · 30 fps · default publication output' },
  { key: '4k', label: '4K', note: '2160×3840 · 30 fps · optional master, slow' }
];

const ACTIVE = ['queued', 'rendering', 'encoding', 'validating'];

type SceneDraft = { duration: string; caption: string };

function sceneDraftMap(scenes: Scene[]): Record<string, SceneDraft> {
  const map: Record<string, SceneDraft> = {};
  for (const scene of scenes) {
    map[scene.id] = { duration: (scene.durationMs / 1000).toFixed(2), caption: scene.caption || '' };
  }
  return map;
}

const FIELDS = [
  { key: 'hook', label: 'Hook', rows: 2, hint: 'First line on screen — no intro, start with the idea.' },
  { key: 'narration', label: 'Narration', rows: 4, hint: 'Spoken script. Captions are generated from the scene data.' },
  { key: 'on_screen_text', label: 'On-screen text', rows: 2, hint: 'Short lines that must survive a 5-inch screen.' },
  { key: 'key_takeaway', label: 'Key takeaway', rows: 2, hint: '' },
  { key: 'cta', label: 'Call to action', rows: 2, hint: '' },
  { key: 'sources', label: 'Sources / references', rows: 2, hint: '' }
] as const;

export default function LessonEditor() {
  const { id } = useParams();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [renders, setRenders] = useState<RenderJob[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [preset, setPreset] = useState<'preview' | 'hd' | '4k'>('preview');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [stamp, setStamp] = useState(Date.now());
  const [brand, setBrand] = useState<Brand | null>(null);
  const [sceneDrafts, setSceneDrafts] = useState<Record<string, SceneDraft>>({});
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<Detail>(`/api/lessons/${id}`);
      setDetail(data);
      setScenes(data.scenes);
      setSceneDrafts(sceneDraftMap(data.scenes));
      setRenders(data.renders);
      setIssues(data.issues);
      setPipeline(data.pipeline);
      setDraft({
        title: data.lesson.title,
        audience: data.lesson.audience,
        objective: data.lesson.objective,
        duration_seconds: String(data.lesson.duration_seconds),
        hook: data.lesson.hook,
        narration: data.lesson.narration,
        on_screen_text: data.lesson.on_screen_text,
        key_takeaway: data.lesson.key_takeaway,
        cta: data.lesson.cta,
        sources: data.lesson.sources,
        review_status: data.lesson.review_status
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
    api<{ brand: Brand }>('/api/brand').then((data) => setBrand(data.brand)).catch(() => undefined);
  }, [load]);

  const hasActive = renders.some((job) => ACTIVE.includes(job.state));

  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(async () => {
      try {
        const data = await api<{ renders: RenderJob[] }>(`/api/renders?lessonId=${id}`);
        setRenders(data.renders);
      } catch {
        /* keep the last known state */
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [hasActive, id]);

  async function save() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/api/lessons/${id}`, { method: 'PATCH', body: JSON.stringify(draft) });
      setNotice('Lesson saved.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function generateStoryboard() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const data = await api<{ scenes: Scene[]; issues: string[]; renderable: boolean }>(
        `/api/lessons/${id}/storyboard`,
        { method: 'POST' }
      );
      setScenes(data.scenes);
      setSceneDrafts(sceneDraftMap(data.scenes));
      setIssues(data.issues);
      setStamp(Date.now());
      setNotice(
        data.renderable
          ? `Storyboard built: ${data.scenes.length} scenes from the verified trace.`
          : 'Storyboard built, but the lesson still has blocking issues.'
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveSceneEdits() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = scenes.map((scene) => {
        const edited = sceneDrafts[scene.id];
        const seconds = Number(edited?.duration ?? scene.durationMs / 1000);
        return {
          id: scene.id,
          durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : scene.durationMs,
          caption: edited?.caption ?? scene.caption
        };
      });
      const data = await api<{ scenes: Scene[]; issues: string[] }>(`/api/lessons/${id}/scenes`, {
        method: 'PATCH',
        body: JSON.stringify({ scenes: payload })
      });
      setScenes(data.scenes);
      setSceneDrafts(sceneDraftMap(data.scenes));
      setIssues(data.issues);
      setStamp(Date.now());
      setNotice('Scene timings and narration saved.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function persistOrder(order: string[]) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/lessons/${id}/scenes`, { method: 'PATCH', body: JSON.stringify({ order }) });
      await load();
      setStamp(Date.now());
      setNotice('Scene order saved.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function moveScene(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= scenes.length) return;
    const next = [...scenes];
    [next[index], next[target]] = [next[target], next[index]];
    void persistOrder(next.map((scene) => scene.id));
  }

  async function duplicateScene(sceneId: string) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/lessons/${id}/scenes/${sceneId}/duplicate`, { method: 'POST' });
      await load();
      setStamp(Date.now());
      setNotice('Scene duplicated. Adjust the timings so the total matches the lesson duration.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function startRender() {
    setError('');
    setNotice('');
    try {
      const data = await api<{ job: RenderJob }>('/api/renders', {
        method: 'POST',
        body: JSON.stringify({ lessonId: id, preset })
      });
      setRenders((current) => [data.job, ...current]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function cancel(jobId: string) {
    try {
      await api(`/api/renders/${jobId}/cancel`, { method: 'POST' });
      const data = await api<{ renders: RenderJob[] }>(`/api/renders?lessonId=${id}`);
      setRenders(data.renders);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function retry(jobId: string) {
    try {
      await api(`/api/renders/${jobId}/retry`, { method: 'POST' });
      const data = await api<{ renders: RenderJob[] }>(`/api/renders?lessonId=${id}`);
      setRenders(data.renders);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const totalMs = useMemo(() => scenes.reduce((sum, scene) => sum + scene.durationMs, 0), [scenes]);
  const latestDone = useMemo(() => renders.find((job) => job.state === 'done') || null, [renders]);

  const draftTotalMs = useMemo(
    () =>
      scenes.reduce((sum, scene) => {
        const edited = sceneDrafts[scene.id];
        const seconds = Number(edited?.duration ?? scene.durationMs / 1000);
        return sum + (Number.isFinite(seconds) ? seconds * 1000 : 0);
      }, 0),
    [scenes, sceneDrafts]
  );

  if (error && !detail) return <div className="notice bad">{error}</div>;
  if (!detail) return <div className="notice">Loading lesson…</div>;

  const blocking = issues;

  return (
    <>
      <header className="page-head">
        <div>
          <div className="row" style={{ marginBottom: 6 }}>
            <Link to="/lessons" style={{ fontSize: 12 }}>
              ← Lessons
            </Link>
            <Link to={`/concepts/${detail.concept.id}`} className="badge">
              {detail.concept.name}
            </Link>
            <span className="badge">{draft.review_status?.replace('_', ' ')}</span>
          </div>
          <h1>{draft.title || 'Untitled lesson'}</h1>
          <p className="sub">
            {(totalMs / 1000).toFixed(1)}s storyboard across {scenes.length} scenes ·{' '}
            {brand ? `${brand.name} template` : 'brand template'}
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={generateStoryboard} disabled={busy}>
            {scenes.length ? 'Rebuild storyboard' : 'Generate storyboard'}
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save lesson'}
          </button>
        </div>
      </header>

      {error && <div className="notice bad">{error}</div>}
      {notice && <div className="notice good">{notice}</div>}

      {pipeline && <PipelineStrip pipeline={pipeline} />}

      {blocking.length > 0 && (
        <div className="notice bad">
          <strong>Not ready to render:</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {blocking.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="split">
        <section className="card">
          <h2>Script</h2>
          <div className="grid two">
            <div className="field">
              <label htmlFor="title">Title</label>
              <input
                id="title"
                className="input"
                value={draft.title || ''}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="audience">Target audience</label>
              <input
                id="audience"
                className="input"
                value={draft.audience || ''}
                onChange={(event) => setDraft({ ...draft, audience: event.target.value })}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="objective">Learning objective</label>
            <input
              id="objective"
              className="input"
              value={draft.objective || ''}
              onChange={(event) => setDraft({ ...draft, objective: event.target.value })}
            />
          </div>

          <div className="field">
            <label>Video duration</label>
            <div className="chips">
              {DURATIONS.map((seconds) => (
                <button
                  key={seconds}
                  className={`chip ${Number(draft.duration_seconds) === seconds ? 'on' : ''}`}
                  onClick={() => setDraft({ ...draft, duration_seconds: String(seconds) })}
                >
                  {seconds}s
                </button>
              ))}
              <input
                className="input"
                style={{ width: 90 }}
                value={draft.duration_seconds || ''}
                onChange={(event) => setDraft({ ...draft, duration_seconds: event.target.value })}
                aria-label="Custom duration in seconds"
                inputMode="numeric"
              />
            </div>
            <span className="hint">Custom durations are clamped to 10–60 seconds.</span>
          </div>

          {FIELDS.map((field) => (
            <div className="field" key={field.key}>
              <label htmlFor={field.key}>{field.label}</label>
              <textarea
                id={field.key}
                className="textarea"
                style={{ minHeight: field.rows * 28 }}
                value={draft[field.key] || ''}
                onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
              />
              {field.hint && <span className="hint">{field.hint}</span>}
            </div>
          ))}

          <div className="field">
            <label htmlFor="review_status">Review status</label>
            <select
              id="review_status"
              className="select"
              value={draft.review_status || 'draft'}
              onChange={(event) => setDraft({ ...draft, review_status: event.target.value })}
            >
              <option value="draft">Draft</option>
              <option value="in_review">In review</option>
              <option value="approved">Approved</option>
            </select>
            <span className="hint">
              AI-assisted or generated content stays a draft until you review the explanation, the trace
              and the storyboard yourself.
            </span>
          </div>
        </section>

        <aside style={{ display: 'grid', gap: 16 }}>
          <div className="card tight">
            <h2>Render</h2>
            <div className="chips">
              {PRESETS.map((item) => (
                <button
                  key={item.key}
                  className={`chip ${preset === item.key ? 'on' : ''}`}
                  onClick={() => setPreset(item.key)}
                  title={item.note}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 12 }}>
              {PRESETS.find((item) => item.key === preset)?.note}
            </p>
            <button
              className="btn primary"
              onClick={startRender}
              disabled={blocking.length > 0 || hasActive}
              title={blocking.length ? 'Resolve the blocking issues first' : undefined}
            >
              {hasActive ? 'Render in progress…' : 'Render MP4'}
            </button>
            {latestDone && (
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                <RenderQuality job={latestDone} />
              </div>
            )}
          </div>

          <div className="card tight">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3>Render jobs</h3>
              <Link to="/renders" style={{ fontSize: 12 }}>
                Manager
              </Link>
            </div>
            {renders.length === 0 && <p style={{ color: 'var(--muted)' }}>No renders yet.</p>}
            {renders.slice(0, 5).map((job) => (
              <div key={job.id} style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="mono" style={{ fontSize: 12 }}>
                    {job.preset} · {job.width}×{job.height}
                  </span>
                  <span className={`badge ${job.state === 'done' ? 'good' : job.state === 'error' ? 'bad' : 'accent'}`}>
                    {job.state}
                  </span>
                </div>
                <div className="progress">
                  <span style={{ width: `${Math.min(100, job.progress)}%` }} />
                </div>
                {job.state === 'done' && (
                  <div className="row">
                    <a className="btn ghost" href={`/api/renders/${job.id}/video`}>
                      Download MP4
                    </a>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {formatBytes(job.bytes)} · {job.duration_seconds.toFixed(1)}s
                    </span>
                  </div>
                )}
                {ACTIVE.includes(job.state) && (
                  <div className="row">
                    <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {job.frames}/{job.expected_frames || '—'} frames
                    </span>
                    <button className="btn ghost" onClick={() => cancel(job.id)}>
                      Cancel
                    </button>
                  </div>
                )}
                {job.state === 'error' && (
                  <>
                    <p style={{ color: 'var(--bad)', fontSize: 12.5 }}>{job.error}</p>
                    <button className="btn" onClick={() => retry(job.id)}>
                      Retry
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </aside>
      </div>

      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Storyboard</h2>
          {scenes.length > 0 && (
            <span className="badge accent">{(totalMs / 1000).toFixed(1)}s</span>
          )}
        </div>
        {scenes.length === 0 ? (
          <div className="empty">
            <strong>No storyboard yet</strong>
            <span>The storyboard is generated from the concept trace, then stored with the lesson.</span>
            <button className="btn primary" onClick={generateStoryboard} disabled={busy}>
              Generate storyboard
            </button>
          </div>
        ) : (
          <SceneTimeline
            lessonId={id as string}
            scenes={scenes}
            stamp={stamp}
            busy={busy}
            onMove={moveScene}
            onDuplicate={duplicateScene}
          />
        )}
      </section>

      {scenes.length > 0 && (
        <section className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Scene timing &amp; narration</h2>
            <span
              className={`badge ${
                Math.abs(draftTotalMs - Number(draft.duration_seconds) * 1000) > 50 ? 'warn' : 'good'
              }`}
            >
              {(draftTotalMs / 1000).toFixed(2)}s / {Number(draft.duration_seconds || 0).toFixed(0)}s
            </span>
          </div>
          <p className="hint">
            Durations and captions are stored with the storyboard and used by the renderer, so the total has
            to match the lesson duration.
          </p>
          <table>
            <thead>
              <tr>
                <th style={{ width: 150 }}>Scene</th>
                <th style={{ width: 130 }}>Duration (s)</th>
                <th>Narration / caption</th>
              </tr>
            </thead>
            <tbody>
              {scenes.map((scene, index) => (
                <tr key={scene.id}>
                  <td>
                    <span className="mono" style={{ fontSize: 12 }}>
                      {index + 1} · {scene.type}
                    </span>
                  </td>
                  <td>
                    <input
                      className="input"
                      inputMode="decimal"
                      aria-label={`Scene ${index + 1} duration in seconds`}
                      value={sceneDrafts[scene.id]?.duration ?? (scene.durationMs / 1000).toFixed(2)}
                      onChange={(event) =>
                        setSceneDrafts({
                          ...sceneDrafts,
                          [scene.id]: {
                            duration: event.target.value,
                            caption: sceneDrafts[scene.id]?.caption ?? scene.caption
                          }
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      aria-label={`Scene ${index + 1} caption`}
                      value={sceneDrafts[scene.id]?.caption ?? scene.caption}
                      onChange={(event) =>
                        setSceneDrafts({
                          ...sceneDrafts,
                          [scene.id]: {
                            duration: sceneDrafts[scene.id]?.duration ?? (scene.durationMs / 1000).toFixed(2),
                            caption: event.target.value
                          }
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <button className="btn primary" onClick={saveSceneEdits} disabled={busy}>
              Save scene edits
            </button>
            <button className="btn" onClick={() => setSceneDrafts(sceneDraftMap(scenes))} disabled={busy}>
              Reset
            </button>
          </div>
        </section>
      )}
    </>
  );
}

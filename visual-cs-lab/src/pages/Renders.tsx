import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, type RenderJob, type RenderValidation, type Pipeline } from '../api';
import RenderQuality from '../components/RenderQuality';

const ACTIVE = ['queued', 'rendering', 'encoding', 'validating'];

function qualityOf(job: RenderJob): RenderValidation | null {
  if (!job.validation) return null;
  try {
    const parsed = JSON.parse(job.validation) as RenderValidation;
    return Array.isArray(parsed.checks) ? parsed : null;
  } catch {
    return null;
  }
}

export default function Renders() {
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ renders: RenderJob[] }>('/api/renders');
      setJobs(data.renders);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasActive = jobs.some((job) => ACTIVE.includes(job.state));

  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(load, 1200);
    return () => window.clearInterval(timer);
  }, [hasActive, load]);

  async function act(id: string, action: 'retry' | 'cancel') {
    try {
      await api(`/api/renders/${id}/${action}`, { method: 'POST' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const focused = jobs.find((job) => job.id === selected) || null;
  const checked = useMemo(() => jobs.filter((job) => qualityOf(job)?.ok).length, [jobs]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Created videos</h1>
          <p className="sub">
            Every job is a real ffmpeg encode of frames drawn from the stored storyboard. A job only
            becomes <strong>done</strong> after the encoded file passes its checks: MP4 container, H.264,
            yuv420p, resolution, duration to the frame, decoded frame count, and sampled frames that are
            neither blank nor a repeated still.
          </p>
        </div>
        <div className="row">
          <span className="badge good">{checked} quality checked</span>
          <button className="btn" onClick={load}>
            Refresh
          </button>
        </div>
      </header>

      {error && <div className="notice bad">{error}</div>}

      <div className="card">
        {jobs.length === 0 ? (
          <div className="empty">
            <strong>No renders yet</strong>
            <span>Open a lesson, build its storyboard, then render an MP4.</span>
            <Link className="btn primary" to="/admin/content">
              Go to projected work
            </Link>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Lesson</th>
                <th>Profile</th>
                <th>State</th>
                <th>Quality</th>
                <th>Progress</th>
                <th>Output</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const quality = qualityOf(job);
                return (
                  <tr key={job.id}>
                    <td>{job.lesson_title || job.lesson_id}</td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {job.preset}
                      <div style={{ color: 'var(--muted)' }}>
                        {job.width}×{job.height} · {job.fps}fps
                      </div>
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          job.state === 'done' ? 'good' : job.state === 'error' ? 'bad' : job.state === 'cancelled' ? 'warn' : 'accent'
                        }`}
                      >
                        {job.state}
                      </span>
                    </td>
                    <td>
                      {quality ? (
                        <span className={`badge ${quality.ok ? 'good' : 'bad'}`}>
                          {quality.ok ? 'passed' : 'failed'}
                        </span>
                      ) : (
                        <span className="badge">—</span>
                      )}
                    </td>
                    <td style={{ width: 130 }}>
                      <div className="progress">
                        <span style={{ width: `${Math.min(100, job.progress)}%` }} />
                      </div>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {Math.round(job.progress)}%
                      </span>
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {job.state === 'done'
                        ? `${(job.bytes / 1048576).toFixed(2)} MB · ${job.duration_seconds.toFixed(2)}s`
                        : '—'}
                    </td>
                    <td>
                      <div className="row">
                        <button className="btn ghost" onClick={() => setSelected(job.id === selected ? null : job.id)}>
                          {job.id === selected ? 'Hide' : 'Inspect'}
                        </button>
                        {job.state === 'done' && (
                          <a className="btn ghost" href={`/api/renders/${job.id}/video`}>
                            Download
                          </a>
                        )}
                        {(job.state === 'error' || job.state === 'cancelled') && (
                          <button className="btn" onClick={() => act(job.id, 'retry')}>
                            Retry
                          </button>
                        )}
                        {ACTIVE.includes(job.state) && (
                          <button className="btn ghost" onClick={() => act(job.id, 'cancel')}>
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {focused && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Job {focused.id.slice(0, 8)}</h2>
            <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
              {focused.frames} / {focused.expected_frames || '—'} frames · {focused.fps} fps · snapshot{' '}
              {(focused.storyboard_hash || '').slice(0, 8) || '—'}
            </span>
          </div>
          {focused.error && <div className="notice bad">{focused.error}</div>}
          <div className="grid two">
            <RenderQuality job={focused} />
            <div>
              <h3>Worker log</h3>
              <div className="log">{focused.log || 'No log lines recorded yet.'}</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, formatBytes, type RenderJob } from '../api';

const ACTIVE = ['queued', 'rendering', 'encoding', 'validating'];

export default function Renders() {
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ renders: RenderJob[] }>('/api/renders');
      setJobs(data.renders);
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

  async function retry(id: string) {
    try {
      await api(`/api/renders/${id}/retry`, { method: 'POST' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const focused = jobs.find((job) => job.id === selected) || null;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Render &amp; export</h1>
          <p className="sub">
            Every job is a real ffmpeg encode of frames drawn from the lesson storyboard. A job is only
            marked done after the file's resolution and duration are validated.
          </p>
        </div>
        <button className="btn" onClick={load}>
          Refresh
        </button>
      </header>

      {error && <div className="notice bad">{error}</div>}

      <div className="card">
        {jobs.length === 0 ? (
          <div className="empty">
            <strong>No renders yet</strong>
            <span>Open a lesson, build its storyboard, then render an MP4.</span>
            <Link className="btn primary" to="/lessons">
              Go to lessons
            </Link>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Lesson</th>
                <th>Preset</th>
                <th>State</th>
                <th>Progress</th>
                <th>Output</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>{job.lesson_title || job.lesson_id}</td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {job.preset}
                    <div style={{ color: 'var(--muted)' }}>
                      {job.width}×{job.height}
                    </div>
                  </td>
                  <td>
                    <span
                      className={`badge ${job.state === 'done' ? 'good' : job.state === 'error' ? 'bad' : 'accent'}`}
                    >
                      {job.state}
                    </span>
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
                    {job.state === 'done' ? `${formatBytes(job.bytes)} · ${job.duration_seconds.toFixed(1)}s` : '—'}
                  </td>
                  <td>
                    <div className="row">
                      <button className="btn ghost" onClick={() => setSelected(job.id === selected ? null : job.id)}>
                        {job.id === selected ? 'Hide log' : 'Log'}
                      </button>
                      {job.state === 'done' && (
                        <a className="btn ghost" href={`/api/renders/${job.id}/video`}>
                          Download
                        </a>
                      )}
                      {job.state === 'error' && (
                        <button className="btn" onClick={() => retry(job.id)}>
                          Retry
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {focused && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Job {focused.id.slice(0, 8)}</h2>
            <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
              {focused.frames} frames · {focused.fps} fps
            </span>
          </div>
          {focused.error && <div className="notice bad">{focused.error}</div>}
          <div className="log">{focused.log || 'No log lines recorded yet.'}</div>
        </div>
      )}
    </>
  );
}

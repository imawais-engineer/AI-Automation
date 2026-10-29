import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../api';

type Overview = {
  concepts: number;
  lessons: number;
  lessonsInProgress: number;
  rendersDone: number;
  rendersFailed: number;
  rendersActive: number;
  awaitingReview: number;
  readyToPublish: number;
  published: number;
  recentLessons: { id: string; title: string; review_status: string; updated_at: string; concept: string }[];
  recentJobs: { id: string; state: string; preset: string; progress: number; created_at: string; title: string }[];
  environment: { renderer: string; presets: { key: string; label: string }[] };
};

const STATUS_TONE: Record<string, string> = {
  done: 'good',
  error: 'bad',
  rendering: 'accent',
  queued: 'warn',
  encoding: 'accent',
  validating: 'accent'
};

export default function Dashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Overview>('/api/overview')
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <div className="notice bad">{error}</div>;
  if (!data) return <div className="notice">Loading workspace…</div>;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="sub">
            Concept → verified trace → storyboard → branded MP4. Every number below comes from stored
            project data; nothing is seeded or estimated.
          </p>
        </div>
        <div className="row">
          <Link className="btn" to="/admin/concepts">
            Visualize an algorithm
          </Link>
          <Link className="btn primary" to="/admin/lessons">
            Create a lesson
          </Link>
        </div>
      </header>

      <section className="grid stats">
        {[
          { label: 'Concepts', value: data.concepts, hint: 'active in the library' },
          { label: 'Lessons', value: data.lessons, hint: `${data.lessonsInProgress} in progress` },
          { label: 'Videos rendered', value: data.rendersDone, hint: `${data.rendersActive} rendering now` },
          { label: 'Awaiting review', value: data.awaitingReview, hint: 'lessons marked in review' },
          { label: 'Ready to publish', value: data.readyToPublish, hint: 'approved with a finished MP4' },
          { label: 'Published', value: data.published, hint: 'confirmed publications only' }
        ].map((stat) => (
          <div className="stat" key={stat.label}>
            <div className="label">{stat.label}</div>
            <div className="value">{stat.value}</div>
            <div className="hint">{stat.hint}</div>
          </div>
        ))}
      </section>

      <section className="grid two">
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Recent lessons</h2>
            <Link to="/admin/lessons">All lessons</Link>
          </div>
          {data.recentLessons.length === 0 ? (
            <div className="empty">
              <strong>No lessons yet</strong>
              <span>Open a concept and create your first lesson.</span>
              <Link className="btn primary" to="/admin/concepts">
                Browse concepts
              </Link>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Lesson</th>
                  <th>Concept</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {data.recentLessons.map((lesson) => (
                  <tr key={lesson.id}>
                    <td>
                      <Link to={`/admin/lessons/${lesson.id}`}>{lesson.title}</Link>
                    </td>
                    <td>{lesson.concept}</td>
                    <td>
                      <span className="badge">{lesson.review_status.replace('_', ' ')}</span>
                    </td>
                    <td className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {new Date(lesson.updated_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Recent render jobs</h2>
            <Link to="/admin/renders">Render manager</Link>
          </div>
          {data.recentJobs.length === 0 ? (
            <div className="empty">
              <strong>No renders yet</strong>
              <span>A render job appears here once a lesson is exported.</span>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Lesson</th>
                  <th>Preset</th>
                  <th>State</th>
                  <th>Progress</th>
                </tr>
              </thead>
              <tbody>
                {data.recentJobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.title}</td>
                    <td className="mono">{job.preset}</td>
                    <td>
                      <span className={`badge ${STATUS_TONE[job.state] || ''}`}>{job.state}</span>
                    </td>
                    <td className="mono">{Math.round(job.progress)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data.rendersFailed > 0 && (
            <div className="notice bad">
              {data.rendersFailed} render{data.rendersFailed > 1 ? 's' : ''} failed. Open the render
              manager to read the error and retry.
            </div>
          )}
        </div>
      </section>

      <section className="card tight">
        <h2>Rendering environment</h2>
        <p style={{ color: 'var(--muted)' }}>
          {data.environment.renderer}. Presets: {data.environment.presets.map((preset) => preset.label).join(' · ')}.
        </p>
      </section>
    </>
  );
}

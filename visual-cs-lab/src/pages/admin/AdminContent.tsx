import { useEffect, useState } from 'react';

import { api } from '../../api';
import LessonRoadmap, { type RoadmapRow } from '../../components/LessonRoadmap';

const STATUSES = ['', 'draft', 'in_review', 'approved', 'published', 'archived'];

export default function AdminContent() {
  const [rows, setRows] = useState<RoadmapRow[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const query = new URLSearchParams();
    if (q) query.set('q', q);
    if (status) query.set('status', status);
    api<{ lessons: RoadmapRow[] }>(`/api/admin/lessons?${query.toString()}`)
      .then((data) => {
        setRows(data.lessons);
        setError('');
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [q, status]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Projected work</h1>
          <p className="sub">
            Lessons are laid out as the roadmap learners follow. Every lesson is one record, and the badges show which of
            its slides, video and narration are current.
          </p>
        </div>
        <div className="row">
          <select className="select" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
            {STATUSES.map((item) => (
              <option key={item || 'all'} value={item}>
                {item ? item.replace('_', ' ') : 'All statuses'}
              </option>
            ))}
          </select>
          <input
            className="input"
            style={{ width: 240 }}
            placeholder="Search lessons…"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            aria-label="Search lessons"
          />
        </div>
      </header>

      {error && <div className="notice bad">{error}</div>}

      {loading && rows.length === 0 ? (
        <div className="card">
          <div className="empty">
            <strong>Loading…</strong>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="card">
          <div className="empty">
            <strong>Nothing matches</strong>
            <span>Try another search or status.</span>
          </div>
        </div>
      ) : (
        <LessonRoadmap rows={rows} />
      )}
    </>
  );
}

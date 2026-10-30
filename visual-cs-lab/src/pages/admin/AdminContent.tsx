import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../../api';

type Row = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  content_status: string;
  version: number;
  difficulty: string;
  theme_id: string;
  estimated_minutes: number;
  updated_at: string;
  published_at: string | null;
  concept: string;
  category: string;
  derived: {
    deck: { present: boolean; stale: boolean; slides: number };
    videos: { present: boolean; stale: boolean; ready: number };
    narration: { present: boolean; stale: boolean };
  };
};

const STATUSES = ['', 'draft', 'in_review', 'approved', 'published', 'archived'];

export default function AdminContent() {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const query = new URLSearchParams();
    if (q) query.set('q', q);
    if (status) query.set('status', status);
    api<{ lessons: Row[] }>(`/api/admin/lessons?${query.toString()}`)
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
            Every lesson is one record. Its slides, video and narration are derived from it, and the badges show which of
            those are current.
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

      <div className="card">
        {loading && rows.length === 0 ? (
          <div className="empty">
            <strong>Loading…</strong>
          </div>
        ) : rows.length === 0 ? (
          <div className="empty">
            <strong>Nothing matches</strong>
            <span>Try another search or status.</span>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Lesson</th>
                <th>Status</th>
                <th>Slides</th>
                <th>Video</th>
                <th>Theme</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link to={`/admin/content/${row.id}`}>{row.title}</Link>
                    <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                      /{row.slug} · {row.concept}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${row.content_status === 'published' ? 'ok' : ''}`}>
                      {row.content_status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {row.derived.deck.present ? (
                      <span style={{ color: row.derived.deck.stale ? 'var(--warn)' : 'var(--good)' }}>
                        {row.derived.deck.slides} {row.derived.deck.stale ? '· stale' : ''}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--muted)' }}>none</span>
                    )}
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {row.derived.videos.ready > 0 ? (
                      <span style={{ color: row.derived.videos.stale ? 'var(--warn)' : 'var(--good)' }}>
                        {row.derived.videos.ready} {row.derived.videos.stale ? '· stale' : ''}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--muted)' }}>none</span>
                    )}
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {row.theme_id}
                  </td>
                  <td className="mono" style={{ fontSize: 10.5 }}>
                    {new Date(row.updated_at).toLocaleDateString()}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Link className="btn ghost" to={`/admin/content/${row.id}`} style={{ padding: '4px 9px', fontSize: 11 }}>
                        Edit
                      </Link>
                      <Link className="btn ghost" to={`/admin/lessons/${row.id}`} style={{ padding: '4px 9px', fontSize: 11 }}>
                        Storyboard
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

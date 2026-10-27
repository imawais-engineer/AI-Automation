import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { api, type Concept, type Lesson } from '../api';

export default function Lessons() {
  const navigate = useNavigate();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [conceptId, setConceptId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ lessons: Lesson[] }>('/api/lessons')
      .then((data) => setLessons(data.lessons))
      .catch((err: Error) => setError(err.message));
    api<{ concepts: Concept[] }>('/api/concepts')
      .then((data) => {
        setConcepts(data.concepts);
        setConceptId(data.concepts[0]?.id || '');
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function createLesson() {
    if (!conceptId) return;
    setBusy(true);
    try {
      const data = await api<{ lesson: { id: string } }>('/api/lessons', {
        method: 'POST',
        body: JSON.stringify({ conceptId })
      });
      navigate(`/lessons/${data.lesson.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Lessons</h1>
          <p className="sub">
            A lesson is the script and storyboard for one short: hook, narration, key takeaway and the
            scenes generated from a verified trace.
          </p>
        </div>
        <div className="row">
          <select className="select" style={{ width: 220 }} value={conceptId} onChange={(event) => setConceptId(event.target.value)} aria-label="Concept for the new lesson">
            {concepts.map((concept) => (
              <option key={concept.id} value={concept.id}>
                {concept.name}
              </option>
            ))}
          </select>
          <button className="btn primary" onClick={createLesson} disabled={busy || !conceptId}>
            {busy ? 'Creating…' : 'New lesson'}
          </button>
        </div>
      </header>

      {error && <div className="notice bad">{error}</div>}

      <div className="card">
        {lessons.length === 0 ? (
          <div className="empty">
            <strong>No lessons yet</strong>
            <span>Pick a concept above to create the first lesson.</span>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Lesson</th>
                <th>Concept</th>
                <th>Duration</th>
                <th>Review</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {lessons.map((lesson) => (
                <tr key={lesson.id}>
                  <td>
                    <Link to={`/lessons/${lesson.id}`}>{lesson.title}</Link>
                  </td>
                  <td>{lesson.concept_name || '—'}</td>
                  <td className="mono">{lesson.duration_seconds}s</td>
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
    </>
  );
}

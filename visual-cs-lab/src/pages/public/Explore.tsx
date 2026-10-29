import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { api } from '../../api';
import { difficultyLabel, type LessonCard } from '../../learn';

type Payload = {
  lessons: LessonCard[];
  topics: string[];
  difficulties: string[];
  total: number;
};

export default function Explore() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState(params.get('q') || '');

  const topic = params.get('topic') || '';
  const difficulty = params.get('difficulty') || '';

  useEffect(() => {
    setLoading(true);
    const query = new URLSearchParams();
    if (q) query.set('q', q);
    if (topic) query.set('topic', topic);
    if (difficulty) query.set('difficulty', difficulty);
    api<Payload>(`/api/learn/concepts?${query.toString()}`)
      .then((payload) => {
        setData(payload);
        setError('');
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [q, topic, difficulty]);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const topics = data?.topics || [];
  const summary = useMemo(() => {
    if (!data) return '';
    return `${data.total} published ${data.total === 1 ? 'lesson' : 'lessons'}`;
  }, [data]);

  return (
    <div className="p-container">
      <header style={{ paddingTop: 40 }}>
        <span className="p-eyebrow">Concept library</span>
        <h1 className="p-h1" style={{ fontSize: 'clamp(28px, 3.6vw, 40px)' }}>
          Explore every published concept
        </h1>
        <p className="p-lede" style={{ marginTop: 12 }}>
          Search by name, filter by topic or difficulty, then open a lesson to read the explanation, follow a worked
          example and study the code.
        </p>
      </header>

      <div className="p-filter-bar">
        <input
          className="p-input"
          placeholder="Search concepts, topics or keywords…"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          aria-label="Search concepts"
        />
        <select className="p-select" value={topic} onChange={(event) => update('topic', event.target.value)} aria-label="Filter by topic">
          <option value="">All topics</option>
          {topics.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          className="p-select"
          value={difficulty}
          onChange={(event) => update('difficulty', event.target.value)}
          aria-label="Filter by difficulty"
        >
          <option value="">Any difficulty</option>
          {(data?.difficulties || ['beginner', 'intermediate', 'advanced']).map((item) => (
            <option key={item} value={item}>
              {difficultyLabel(item)}
            </option>
          ))}
        </select>
        {(q || topic || difficulty) && (
          <button
            className="p-btn p-btn-sm"
            onClick={() => {
              setQ('');
              setParams(new URLSearchParams(), { replace: true });
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="p-between" style={{ marginBottom: 16 }}>
        <span className="p-mono p-muted">{loading ? 'Searching…' : summary}</span>
      </div>

      {error && <div className="p-error">{error}</div>}

      {!error && loading && !data && (
        <div className="p-lesson-grid">
          {[0, 1, 2, 3, 4, 5].map((key) => (
            <div className="p-card" key={key} style={{ minHeight: 150, opacity: 0.55 }}>
              <div style={{ height: 10, width: '45%', background: 'var(--p-line)', borderRadius: 6 }} />
            </div>
          ))}
        </div>
      )}

      {!error && data && data.lessons.length === 0 && (
        <div className="p-empty">
          <strong>Nothing matches those filters</strong>
          <span>Try a different topic, or clear the search.</span>
        </div>
      )}

      <div className="p-lesson-grid">
        {(data?.lessons || []).map((lesson) => (
          <Link className="p-lesson-card" key={lesson.slug} to={`/learn/${lesson.slug}`}>
            <span className="p-badge">{lesson.category}</span>
            <h3>{lesson.title}</h3>
            <p>{lesson.summary}</p>
            <div className="p-card-foot">
              <span>{difficultyLabel(lesson.difficulty)}</span>
              {lesson.complexity && <span className="p-mono">{lesson.complexity}</span>}
              {lesson.hasVideo && <span className="p-demo-mark">Visual demonstration</span>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

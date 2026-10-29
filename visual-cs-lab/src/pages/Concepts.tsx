import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { api, type Concept } from '../api';

const CATEGORIES = ['Data Structures', 'Algorithms', 'Complexity Analysis'];

export default function Concepts() {
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', category: CATEGORIES[0], summary: '' });

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (category) params.set('category', category);
      const data = await api<{ concepts: Concept[] }>(`/api/concepts?${params.toString()}`);
      setConcepts(data.concepts);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
  }, [query, category]);

  useEffect(() => {
    const timer = setTimeout(load, 150);
    return () => clearTimeout(timer);
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, Concept[]>();
    for (const concept of concepts) {
      const list = map.get(concept.category) || [];
      list.push(concept);
      map.set(concept.category, list);
    }
    return [...map.entries()];
  }, [concepts]);

  async function createConcept(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const data = await api<{ concept: Concept }>('/api/concepts', {
        method: 'POST',
        body: JSON.stringify(form)
      });
      setForm({ name: '', category: form.category, summary: '' });
      window.location.href = `/admin/concepts/${data.concept.id}`;
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
          <h1>Concept library</h1>
          <p className="sub">
            Curated DSA concepts with explanations, complexity and — where implemented — a trusted
            animation configuration that produces a verifiable trace.
          </p>
        </div>
      </header>

      {error && <div className="notice bad">{error}</div>}

      <div className="row">
        <input
          className="input"
          style={{ maxWidth: 320 }}
          placeholder="Search concepts, pseudocode…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search concepts"
        />
        <div className="chips">
          <button className={`chip ${category === '' ? 'on' : ''}`} onClick={() => setCategory('')}>
            All
          </button>
          {CATEGORIES.map((item) => (
            <button
              key={item}
              className={`chip ${category === item ? 'on' : ''}`}
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="split">
        <section style={{ display: 'grid', gap: 16 }}>
          {grouped.length === 0 && (
            <div className="empty">
              <strong>No concepts match</strong>
              <span>Try a different search or add a new concept.</span>
            </div>
          )}
          {grouped.map(([name, items]) => (
            <div className="card" key={name}>
              <h2>{name}</h2>
              <table>
                <thead>
                  <tr>
                    <th>Concept</th>
                    <th>Summary</th>
                    <th>Complexity</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((concept) => (
                    <tr key={concept.id}>
                      <td>
                        <Link to={`/admin/concepts/${concept.id}`}>{concept.name}</Link>
                      </td>
                      <td style={{ color: 'var(--muted)', maxWidth: 380 }}>{concept.summary}</td>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {concept.complexity_time || '—'}
                      </td>
                      <td>
                        <Link className="btn ghost" to={`/admin/concepts/${concept.id}`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>

        <form className="card" onSubmit={createConcept}>
          <h2>Add a concept</h2>
          <div className="field">
            <label htmlFor="concept-name">Name</label>
            <input
              id="concept-name"
              className="input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="e.g. Tries"
            />
          </div>
          <div className="field">
            <label htmlFor="concept-category">Category</label>
            <select
              id="concept-category"
              className="select"
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value })}
            >
              {CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="concept-summary">One-line summary</label>
            <textarea
              id="concept-summary"
              className="textarea"
              style={{ minHeight: 70 }}
              value={form.summary}
              onChange={(event) => setForm({ ...form, summary: event.target.value })}
            />
          </div>
          <button className="btn primary" disabled={busy || !form.name.trim()}>
            {busy ? 'Creating…' : 'Create concept'}
          </button>
          <p className="hint" style={{ color: 'var(--muted)', fontSize: 12 }}>
            New concepts start as drafts with no animation configuration. Add pseudocode and code, then
            a trusted trace, before a lesson can render.
          </p>
        </form>
      </div>
    </>
  );
}

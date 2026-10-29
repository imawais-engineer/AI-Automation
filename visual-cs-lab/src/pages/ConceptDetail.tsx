import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { api, type BinarySearchStep, type Concept } from '../api';
import StackVisualizer from '../components/StackVisualizer';

type Detail = {
  concept: Concept;
  lessons: { id: string; title: string; review_status: string; duration_seconds: number }[];
  animation: {
    supported: boolean;
    kind: 'stack' | 'binary-search' | 'none';
    validation: { ok: boolean; failures: string[] };
    eventCount: number;
  };
  trace: { steps: BinarySearchStep[]; foundIndex: number | null; summary: string; errors: string[] };
};

const EDITABLE: { key: string; label: string; rows: number; mono?: boolean }[] = [
  { key: 'summary', label: 'One-line summary', rows: 2 },
  { key: 'objectives', label: 'Learning objectives', rows: 2 },
  { key: 'prerequisites', label: 'Prerequisites', rows: 1 },
  { key: 'plain_explanation', label: 'Plain-language explanation', rows: 4 },
  { key: 'technical_explanation', label: 'Technical explanation', rows: 4 },
  { key: 'pseudocode', label: 'Pseudocode', rows: 6, mono: true },
  { key: 'reference_code', label: 'Reference implementation', rows: 10, mono: true },
  { key: 'example_input', label: 'Example input', rows: 2 },
  { key: 'expected_output', label: 'Expected output', rows: 2 }
];

export default function ConceptDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<Detail>(`/api/concepts/${id}`);
      setDetail(data);
      const next: Record<string, string> = {};
      for (const field of EDITABLE) next[field.key] = String((data.concept as never)[field.key] ?? '');
      next.reference_language = data.concept.reference_language;
      next.complexity_time = data.concept.complexity_time;
      next.complexity_space = data.concept.complexity_space;
      setDraft(next);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setError('');
    setSaved('');
    try {
      await api(`/api/concepts/${id}`, { method: 'PATCH', body: JSON.stringify(draft) });
      setSaved('Concept saved.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createLesson() {
    try {
      const data = await api<{ lesson: { id: string } }>('/api/lessons', {
        method: 'POST',
        body: JSON.stringify({ conceptId: id })
      });
      navigate(`/admin/lessons/${data.lesson.id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (error && !detail) return <div className="notice bad">{error}</div>;
  if (!detail) return <div className="notice">Loading concept…</div>;

  const config = (() => {
    try {
      return JSON.parse(detail.concept.animation_config || '{}') as {
        ops?: { op: string; value?: number }[];
        expect?: Record<string, unknown>;
      };
    } catch {
      return {};
    }
  })();
  const initialOps = (config.ops || [])
    .map((item) => (item.op === 'push' ? { op: 'push' as const, value: Number(item.value) } : ({ op: item.op } as never)))
    .filter(Boolean);

  return (
    <>
      <header className="page-head">
        <div>
          <div className="row" style={{ marginBottom: 6 }}>
            <Link to="/admin/concepts" style={{ fontSize: 12 }}>
              ← Concept library
            </Link>
            <span className="badge">{detail.concept.category}</span>
            <span className={`badge ${detail.animation.supported ? (detail.animation.validation.ok ? 'good' : 'warn') : ''}`}>
              {detail.animation.supported
                ? detail.animation.validation.ok
                  ? `${detail.animation.eventCount} verified ${
                      detail.animation.kind === 'binary-search' ? 'steps' : 'events'
                    }`
                  : 'trace not verified'
                : 'no animation config'}
            </span>
          </div>
          <h1>{detail.concept.name}</h1>
          <p className="sub">{detail.concept.summary}</p>
        </div>
        <div className="row">
          <button className="btn primary" onClick={createLesson}>
            Create lesson
          </button>
        </div>
      </header>

      {error && <div className="notice bad">{error}</div>}
      {saved && <div className="notice good">{saved}</div>}

      {detail.animation.supported && detail.concept.slug === 'stacks' && (
        <section className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Interactive visualizer</h2>
            <span className="badge accent">event-driven</span>
          </div>
          <StackVisualizer conceptId={detail.concept.id} initialOps={initialOps} />
        </section>
      )}

      {detail.animation.kind === 'binary-search' && detail.trace.steps.length > 0 && (
        <section className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Verified trace</h2>
            <span className={`badge ${detail.animation.validation.ok ? 'good' : 'bad'}`}>
              {detail.animation.validation.ok
                ? detail.trace.foundIndex === null
                  ? 'not in array'
                  : `found at index ${detail.trace.foundIndex}`
                : 'not verified'}
            </span>
          </div>
          <p className="hint">
            Trusted implementation: inclusive low/high, mid = floor((low + high) / 2). Requires a sorted
            input.
          </p>
          <table>
            <thead>
              <tr>
                <th>Step</th>
                <th>low</th>
                <th>high</th>
                <th>mid</th>
                <th>a[mid]</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {detail.trace.steps.map((step) => (
                <tr key={step.n}>
                  <td className="mono">{step.n}</td>
                  <td className="mono">{step.low}</td>
                  <td className="mono">{step.high}</td>
                  <td className="mono">{step.mid}</td>
                  <td className="mono">{step.midValue}</td>
                  <td>{step.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">{detail.trace.summary}</p>
        </section>
      )}

      <div className="split">
        <section className="card">
          <h2>Content</h2>
          {EDITABLE.map((field) => (
            <div className="field" key={field.key}>
              <label htmlFor={field.key}>{field.label}</label>
              <textarea
                id={field.key}
                className="textarea"
                style={{ minHeight: field.rows * 28, fontFamily: field.mono ? 'var(--mono)' : undefined }}
                value={draft[field.key] ?? ''}
                onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
              />
            </div>
          ))}
          <div className="grid two">
            <div className="field">
              <label htmlFor="complexity_time">Time complexity</label>
              <input
                id="complexity_time"
                className="input"
                value={draft.complexity_time ?? ''}
                onChange={(event) => setDraft({ ...draft, complexity_time: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="complexity_space">Space complexity</label>
              <input
                id="complexity_space"
                className="input"
                value={draft.complexity_space ?? ''}
                onChange={(event) => setDraft({ ...draft, complexity_space: event.target.value })}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="reference_language">Reference language</label>
            <input
              id="reference_language"
              className="input"
              value={draft.reference_language ?? ''}
              onChange={(event) => setDraft({ ...draft, reference_language: event.target.value })}
            />
          </div>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save concept'}
          </button>
        </section>

        <aside style={{ display: 'grid', gap: 16 }}>
          <div className="card tight">
            <h3>Verification</h3>
            <p style={{ color: 'var(--muted)' }}>
              {detail.animation.supported
                ? 'Lessons built on this concept are rendered from this trace only after the expected results match.'
                : 'No animation configuration is attached, so lessons from this concept cannot be rendered yet.'}
            </p>
            {detail.animation.supported && (
              <div className={`badge ${detail.animation.validation.ok ? 'good' : 'bad'}`}>
                {detail.animation.validation.ok ? 'expected results match' : 'expectation mismatch'}
              </div>
            )}
            {detail.animation.validation.failures.map((failure) => (
              <div className="notice bad" key={failure}>
                {failure}
              </div>
            ))}
            {config.expect && (
              <pre className="code" style={{ marginTop: 6 }}>{JSON.stringify(config.expect, null, 2)}</pre>
            )}
          </div>

          <div className="card tight">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3>Lessons</h3>
              <Link to="/admin/lessons" style={{ fontSize: 12 }}>
                All
              </Link>
            </div>
            {detail.lessons.length === 0 ? (
              <p style={{ color: 'var(--muted)' }}>No lessons yet for this concept.</p>
            ) : (
              <table>
                <tbody>
                  {detail.lessons.map((lesson) => (
                    <tr key={lesson.id}>
                      <td>
                        <Link to={`/admin/lessons/${lesson.id}`}>{lesson.title}</Link>
                      </td>
                      <td>
                        <span className="badge">{lesson.review_status.replace('_', ' ')}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

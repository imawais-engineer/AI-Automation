import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { api } from '../../api';
import { useSession } from '../../session';

type Check = { key: string; label: string; ok: boolean; detail: string };
type Section = { id: string; heading: string; body: string; kind: string };
type CodeExample = { id: string; language: string; label: string; code: string; expected_output: string; notes: string };
type Quiz = { id: string; prompt: string; options: string[]; answer_index: number; explanation: string };

type Payload = {
  lesson: {
    id: string;
    slug: string;
    title: string;
    summary: string;
    difficulty: string;
    estimated_minutes: number;
    prerequisites: string;
    objectives: string[];
    topics: string[];
    content_status: string;
    version: number;
    theme_id: string;
    scenes: string;
    concept_id: string;
  };
  concept: { id: string; name: string; complexity_time: string; complexity_space: string; category: string };
  sections: Section[];
  code: CodeExample[];
  quiz: Quiz[];
  slides: { deck: { id: string; lesson_version: number; slide_count: number; updated_at: string }; items: { id: string; title: string }[] } | null;
  assets: { id: string; audio_mode: string; status: string; validation_ok: number; available: boolean; created_at: string }[];
  derived: {
    deck: { present: boolean; stale: boolean; slides: number };
    videos: { present: boolean; stale: boolean; ready: number };
    narration: { present: boolean; stale: boolean };
  };
  checks: Check[];
  reviews: { id: string; lesson_version: number; reviewer: string; decision: string; created_at: string }[];
  themes: { id: string; name: string }[];
};

const SECTION_KINDS = ['concept', 'example', 'complexity', 'edge', 'recap'];

export default function AdminLessonContent() {
  const { id = '' } = useParams();
  const { user } = useSession();
  const canReview = user?.role === 'reviewer' || user?.role === 'admin';
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  const [meta, setMeta] = useState({
    title: '',
    summary: '',
    slug: '',
    difficulty: 'beginner',
    estimated_minutes: 8,
    prerequisites: '',
    objectives: '',
    topics: ''
  });
  const [sections, setSections] = useState<Section[]>([]);
  const [code, setCode] = useState<CodeExample[]>([]);
  const [quiz, setQuiz] = useState<Quiz[]>([]);

  const load = () => {
    api<Payload>(`/api/admin/lessons/${id}`)
      .then((payload) => {
        setData(payload);
        setMeta({
          title: payload.lesson.title,
          summary: payload.lesson.summary,
          slug: payload.lesson.slug,
          difficulty: payload.lesson.difficulty,
          estimated_minutes: payload.lesson.estimated_minutes,
          prerequisites: payload.lesson.prerequisites,
          objectives: (payload.lesson.objectives || []).join('\n'),
          topics: payload.lesson.topics.join(', ')
        });
        setSections(payload.sections);
        setCode(payload.code);
        setQuiz(payload.quiz);
        setError('');
      })
      .catch((err: Error) => setError(err.message));
  };

  useEffect(load, [id]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  };

  const passing = useMemo(() => (data?.checks || []).filter((check) => check.ok).length, [data]);

  if (error && !data) {
    return (
      <>
        <header className="page-head">
          <div>
            <h1>Lesson</h1>
            <p className="sub">The lesson could not be loaded.</p>
          </div>
        </header>
        <div className="notice bad">{error}</div>
      </>
    );
  }

  if (!data) {
    return (
      <div className="empty" style={{ padding: 50 }}>
        <strong>Loading lesson…</strong>
      </div>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <Link to="/admin/content" style={{ fontSize: 12 }}>
            ← Projected work
          </Link>
          <h1 style={{ marginTop: 6 }}>{data.lesson.title}</h1>
          <p className="sub">
            {data.concept.name} · {data.concept.category} · version {data.lesson.version} ·{' '}
            <span className="mono">/{data.lesson.slug}</span>
          </p>
        </div>
        <div className="row">
          {data.lesson.content_status === 'published' && (
            <Link className="btn ghost" to={`/learn/${data.lesson.slug}`} target="_blank">
              View as learner
            </Link>
          )}
          <Link className="btn" to={`/admin/lessons/${data.lesson.id}`}>
            Trace & storyboard
          </Link>
        </div>
      </header>

      {error && <div className="notice bad">{error}</div>}
      {notice && <div className="notice good">{notice}</div>}

      <div className="split">
        <div className="card">
          <strong>Publish readiness</strong>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', display: 'block', marginTop: 4 }}>
            {passing}/{data.checks.length} checks passing
          </span>
          <ul className="check-list" style={{ marginTop: 12 }}>
            {data.checks.map((check) => (
              <li key={check.key} className={check.ok ? 'ok' : 'bad'}>
                <span>
                  <strong>{check.label}</strong>
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                    {check.detail}
                  </div>
                </span>
              </li>
            ))}
          </ul>

          <div className="row" style={{ marginTop: 14, gap: 8 }}>
            {canReview ? (
              <>
                <button
                  className="btn primary"
                  disabled={busy === 'publish'}
                  onClick={() =>
                    run('publish', async () => {
                      await api(`/api/admin/lessons/${id}/publish`, { method: 'POST', body: JSON.stringify({}) });
                      setNotice('Published. The public lesson now shows this version.');
                      load();
                    })
                  }
                >
                  {busy === 'publish' ? 'Publishing…' : 'Publish version'}
                </button>
                {data.lesson.content_status === 'published' && (
                  <button
                    className="btn danger"
                    disabled={busy === 'unpublish'}
                    onClick={() =>
                      run('unpublish', async () => {
                        await api(`/api/admin/lessons/${id}/unpublish`, { method: 'POST', body: JSON.stringify({}) });
                        setNotice('Unpublished. It is no longer reachable publicly.');
                        load();
                      })
                    }
                  >
                    Unpublish
                  </button>
                )}
              </>
            ) : (
              <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                A reviewer or admin publishes this lesson.
              </span>
            )}
          </div>

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
            <strong style={{ fontSize: 13 }}>Derived assets</strong>
            <div className="mono" style={{ fontSize: 11, marginTop: 6, color: 'var(--muted)' }}>
              slides: {data.derived.deck.present ? `${data.derived.deck.slides}${data.derived.deck.stale ? ' (stale)' : ''}` : 'none'}
              <br />
              video: {data.derived.videos.ready} ready{data.derived.videos.stale ? ' (stale)' : ''}
              <br />
              narration: {data.derived.narration.present ? (data.derived.narration.stale ? 'stale' : 'current') : 'none'}
            </div>
            <div className="row" style={{ marginTop: 10, gap: 8 }}>
              <button
                className="btn"
                disabled={busy === 'slides'}
                onClick={() =>
                  run('slides', async () => {
                    await api(`/api/admin/lessons/${id}/slides`, { method: 'POST', body: JSON.stringify({}) });
                    setNotice('Slides regenerated from the verified storyboard.');
                    load();
                  })
                }
              >
                {busy === 'slides' ? 'Building…' : 'Generate slides'}
              </button>
            </div>
            <div className="row" style={{ marginTop: 10, gap: 8 }}>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                Theme
              </span>
              <select
                className="select"
                value={data.lesson.theme_id}
                onChange={(event) =>
                  run('theme', async () => {
                    await api(`/api/admin/lessons/${id}/theme`, {
                      method: 'POST',
                      body: JSON.stringify({ themeId: event.target.value })
                    });
                    setNotice('Theme updated. Existing renders are now marked stale.');
                    load();
                  })
                }
              >
                {data.themes.map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {theme.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
            <strong style={{ fontSize: 13 }}>Review history</strong>
            {data.reviews.length === 0 ? (
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', display: 'block', marginTop: 6 }}>
                No review recorded yet.
              </span>
            ) : (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.reviews.map((review) => (
                  <div key={review.id} className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                    {review.decision} · v{review.lesson_version} · {review.reviewer}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>Metadata</strong>
              <span className="badge">{data.lesson.content_status.replace('_', ' ')}</span>
            </div>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              <div className="field">
                <label>Title</label>
                <input className="input" value={meta.title} onChange={(event) => setMeta({ ...meta, title: event.target.value })} />
              </div>
              <div className="field">
                <label>Slug</label>
                <input className="input mono" value={meta.slug} onChange={(event) => setMeta({ ...meta, slug: event.target.value })} />
              </div>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label>Summary</label>
                <input className="input" value={meta.summary} onChange={(event) => setMeta({ ...meta, summary: event.target.value })} />
              </div>
              <div className="field">
                <label>Difficulty</label>
                <select className="select" value={meta.difficulty} onChange={(event) => setMeta({ ...meta, difficulty: event.target.value })}>
                  {['beginner', 'intermediate', 'advanced'].map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Estimated minutes</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={meta.estimated_minutes}
                  onChange={(event) => setMeta({ ...meta, estimated_minutes: Number(event.target.value) })}
                />
              </div>
              <div className="field">
                <label>Prerequisites</label>
                <input className="input" value={meta.prerequisites} onChange={(event) => setMeta({ ...meta, prerequisites: event.target.value })} />
              </div>
              <div className="field">
                <label>Topics (comma separated)</label>
                <input className="input" value={meta.topics} onChange={(event) => setMeta({ ...meta, topics: event.target.value })} />
              </div>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label>Learning objectives (one per line)</label>
                <textarea
                  className="textarea"
                  rows={4}
                  value={meta.objectives}
                  onChange={(event) => setMeta({ ...meta, objectives: event.target.value })}
                />
              </div>
            </div>
            <div className="row" style={{ marginTop: 12, gap: 8 }}>
              <button
                className="btn primary"
                disabled={busy === 'meta'}
                onClick={() =>
                  run('meta', async () => {
                    await api(`/api/admin/lessons/${id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({
                        title: meta.title,
                        slug: meta.slug,
                        summary: meta.summary,
                        difficulty: meta.difficulty,
                        estimated_minutes: meta.estimated_minutes,
                        prerequisites: meta.prerequisites,
                        topics: meta.topics.split(',').map((item) => item.trim()).filter(Boolean),
                        objectives: meta.objectives.split('\n').map((item) => item.trim()).filter(Boolean)
                      })
                    });
                    setNotice('Metadata saved. The lesson version moved, so derived assets now show as stale.');
                    load();
                  })
                }
              >
                {busy === 'meta' ? 'Saving…' : 'Save metadata'}
              </button>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                Complexity comes from the concept: {data.concept.complexity_time || '—'}
              </span>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>Lesson sections</strong>
              <button
                className="btn ghost"
                onClick={() => setSections([...sections, { id: `new-${Date.now()}`, heading: '', body: '', kind: 'concept' }])}
              >
                Add section
              </button>
            </div>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {sections.map((section, index) => (
                <div key={section.id} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <input
                      className="input"
                      style={{ flex: 1 }}
                      placeholder="Heading"
                      value={section.heading}
                      onChange={(event) => {
                        const next = [...sections];
                        next[index] = { ...section, heading: event.target.value };
                        setSections(next);
                      }}
                    />
                    <select
                      className="select"
                      style={{ width: 130 }}
                      value={section.kind}
                      onChange={(event) => {
                        const next = [...sections];
                        next[index] = { ...section, kind: event.target.value };
                        setSections(next);
                      }}
                    >
                      {SECTION_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind}
                        </option>
                      ))}
                    </select>
                    <button className="btn ghost" onClick={() => setSections(sections.filter((item) => item.id !== section.id))}>
                      Remove
                    </button>
                  </div>
                  <textarea
                    className="textarea"
                    rows={4}
                    style={{ marginTop: 8 }}
                    placeholder="Explanation"
                    value={section.body}
                    onChange={(event) => {
                      const next = [...sections];
                      next[index] = { ...section, body: event.target.value };
                      setSections(next);
                    }}
                  />
                </div>
              ))}
            </div>
            <button
              className="btn primary"
              style={{ marginTop: 12 }}
              disabled={busy === 'sections'}
              onClick={() =>
                run('sections', async () => {
                  await api(`/api/admin/lessons/${id}/sections`, {
                    method: 'PUT',
                    body: JSON.stringify({ sections })
                  });
                  setNotice('Sections saved.');
                  load();
                })
              }
            >
              {busy === 'sections' ? 'Saving…' : 'Save sections'}
            </button>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>Code examples</strong>
              <button
                className="btn ghost"
                onClick={() =>
                  setCode([
                    ...code,
                    { id: `new-${Date.now()}`, language: 'python', label: '', code: '', expected_output: '', notes: '' }
                  ])
                }
              >
                Add example
              </button>
            </div>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {code.map((example, index) => (
                <div key={example.id} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <select
                      className="select"
                      style={{ width: 140 }}
                      value={example.language}
                      onChange={(event) => {
                        const next = [...code];
                        next[index] = { ...example, language: event.target.value };
                        setCode(next);
                      }}
                    >
                      {['python', 'cpp', 'c', 'javascript', 'typescript', 'java', 'go', 'pseudo'].map((language) => (
                        <option key={language} value={language}>
                          {language}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input"
                      style={{ flex: 1 }}
                      placeholder="Label"
                      value={example.label}
                      onChange={(event) => {
                        const next = [...code];
                        next[index] = { ...example, label: event.target.value };
                        setCode(next);
                      }}
                    />
                    <button className="btn ghost" onClick={() => setCode(code.filter((item) => item.id !== example.id))}>
                      Remove
                    </button>
                  </div>
                  <textarea
                    className="textarea mono"
                    rows={7}
                    style={{ marginTop: 8 }}
                    placeholder="Source code"
                    value={example.code}
                    onChange={(event) => {
                      const next = [...code];
                      next[index] = { ...example, code: event.target.value };
                      setCode(next);
                    }}
                  />
                  <div className="row" style={{ marginTop: 8, gap: 8 }}>
                    <input
                      className="input"
                      placeholder="Expected output"
                      value={example.expected_output}
                      onChange={(event) => {
                        const next = [...code];
                        next[index] = { ...example, expected_output: event.target.value };
                        setCode(next);
                      }}
                    />
                    <input
                      className="input"
                      placeholder="Notes"
                      value={example.notes}
                      onChange={(event) => {
                        const next = [...code];
                        next[index] = { ...example, notes: event.target.value };
                        setCode(next);
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <button
              className="btn primary"
              style={{ marginTop: 12 }}
              disabled={busy === 'code'}
              onClick={() =>
                run('code', async () => {
                  await api(`/api/admin/lessons/${id}/code`, {
                    method: 'PUT',
                    body: JSON.stringify({ examples: code })
                  });
                  setNotice('Code examples saved.');
                  load();
                })
              }
            >
              {busy === 'code' ? 'Saving…' : 'Save code examples'}
            </button>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>Knowledge check</strong>
              <button
                className="btn ghost"
                onClick={() =>
                  setQuiz([...quiz, { id: `new-${Date.now()}`, prompt: '', options: ['', ''], answer_index: 0, explanation: '' }])
                }
              >
                Add question
              </button>
            </div>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {quiz.map((question, index) => (
                <div key={question.id} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <input
                      className="input"
                      style={{ flex: 1 }}
                      placeholder="Question"
                      value={question.prompt}
                      onChange={(event) => {
                        const next = [...quiz];
                        next[index] = { ...question, prompt: event.target.value };
                        setQuiz(next);
                      }}
                    />
                    <button className="btn ghost" onClick={() => setQuiz(quiz.filter((item) => item.id !== question.id))}>
                      Remove
                    </button>
                  </div>
                  <textarea
                    className="textarea"
                    rows={3}
                    style={{ marginTop: 8 }}
                    placeholder="One option per line"
                    value={question.options.join('\n')}
                    onChange={(event) => {
                      const next = [...quiz];
                      next[index] = { ...question, options: event.target.value.split('\n') };
                      setQuiz(next);
                    }}
                  />
                  <div className="row" style={{ marginTop: 8, gap: 8 }}>
                    <label className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                      Correct option (1-based)
                    </label>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      style={{ width: 90 }}
                      value={question.answer_index + 1}
                      onChange={(event) => {
                        const next = [...quiz];
                        next[index] = { ...question, answer_index: Math.max(0, Number(event.target.value) - 1) };
                        setQuiz(next);
                      }}
                    />
                    <input
                      className="input"
                      placeholder="Explanation"
                      value={question.explanation}
                      onChange={(event) => {
                        const next = [...quiz];
                        next[index] = { ...question, explanation: event.target.value };
                        setQuiz(next);
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <button
              className="btn primary"
              style={{ marginTop: 12 }}
              disabled={busy === 'quiz'}
              onClick={() =>
                run('quiz', async () => {
                  await api(`/api/admin/lessons/${id}/quiz`, {
                    method: 'PUT',
                    body: JSON.stringify({ questions: quiz })
                  });
                  setNotice('Knowledge check saved.');
                  load();
                })
              }
            >
              {busy === 'quiz' ? 'Saving…' : 'Save knowledge check'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

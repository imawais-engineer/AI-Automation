import { useEffect, useState } from 'react';

import { api, type Brand } from '../api';

const OPENING_STYLES = [
  { key: 'cinematic', label: 'Cinematic' },
  { key: 'minimal', label: 'Minimal' },
  { key: 'bold', label: 'Bold' }
];

const COLORS = [
  { key: 'accent', label: 'Accent' },
  { key: 'background', label: 'Background' },
  { key: 'panel', label: 'Panel' },
  { key: 'ink', label: 'Text ink' }
] as const;

export default function BrandPage() {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [draft, setDraft] = useState<Brand | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    api<{ brand: Brand }>('/api/brand')
      .then((data) => {
        setBrand(data.brand);
        setDraft(data.brand);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  async function save() {
    if (!draft) return;
    setError('');
    setNotice('');
    try {
      const data = await api<{ brand: Brand }>('/api/brand', {
        method: 'PATCH',
        body: JSON.stringify({
          ...draft,
          caption_style: typeof draft.caption_style === 'string' ? draft.caption_style : JSON.stringify(draft.caption_style),
          code_style: typeof draft.code_style === 'string' ? draft.code_style : JSON.stringify(draft.code_style)
        })
      });
      setBrand(data.brand);
      setDraft(data.brand);
      setNotice('Brand template saved — the next rendered storyboard uses it.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  /** Applies the saved branding to every existing video. */
  async function applyToExisting() {
    setError('');
    setNotice('');
    setApplying(true);
    try {
      const data = await api<{ rebuilt: number; thumbnails: number; failures: { error: string }[] }>(
        '/api/brand/regenerate',
        { method: 'POST', body: JSON.stringify({}) }
      );
      setNotice(
        `Rebuilt ${data.rebuilt} video${data.rebuilt === 1 ? '' : 's'} and recut ${data.thumbnails} thumbnail${
          data.thumbnails === 1 ? '' : 's'
        }${data.failures.length ? ` · ${data.failures.length} could not be rebuilt` : ''}.`
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApplying(false);
    }
  }

  if (error && !draft) return <div className="notice bad">{error}</div>;
  if (!draft) return <div className="notice">Loading brand…</div>;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Brand &amp; templates</h1>
          <p className="sub">
            One visual identity for every short: palette, type, watermark and caption style are read by
            the renderer, so storyboard thumbnails and final MP4s stay consistent.
          </p>
        </div>
        <button className="btn primary" onClick={save}>
          Save template
        </button>
      </header>

      {error && <div className="notice bad">{error}</div>}
      {notice && <div className="notice good">{notice}</div>}

      <div className="split">
        <section className="card">
          <h2>Identity</h2>
          <div className="grid two">
            <div className="field">
              <label htmlFor="brand-name">Brand name</label>
              <input
                id="brand-name"
                className="input"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="brand-watermark">Watermark</label>
              <input
                id="brand-watermark"
                className="input"
                value={draft.watermark}
                onChange={(event) => setDraft({ ...draft, watermark: event.target.value })}
              />
            </div>
          </div>

          <div className="grid two">
            {COLORS.map((color) => (
              <div className="field" key={color.key}>
                <label htmlFor={color.key}>{color.label}</label>
                <div className="row">
                  <input
                    id={color.key}
                    type="color"
                    value={draft[color.key]}
                    onChange={(event) => setDraft({ ...draft, [color.key]: event.target.value })}
                    style={{ width: 46, height: 34, background: 'transparent', border: 'none' }}
                  />
                  <input
                    className="input"
                    value={draft[color.key]}
                    onChange={(event) => setDraft({ ...draft, [color.key]: event.target.value })}
                    aria-label={`${color.label} hex value`}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="grid two">
            <div className="field">
              <label htmlFor="font">Typography</label>
              <input
                id="font"
                className="input"
                value={draft.font_family}
                onChange={(event) => setDraft({ ...draft, font_family: event.target.value })}
              />
              <span className="hint">Font stack used for titles and body copy.</span>
            </div>
            <div className="field">
              <label htmlFor="caption-style">Caption style (JSON)</label>
              <textarea
                id="caption-style"
                className="textarea"
                style={{ minHeight: 74, fontFamily: 'var(--mono)' }}
                value={typeof draft.caption_style === 'string' ? draft.caption_style : JSON.stringify(draft.caption_style)}
                onChange={(event) => setDraft({ ...draft, caption_style: event.target.value as never })}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="code-style">Code panel style (JSON)</label>
            <textarea
              id="code-style"
              className="textarea"
              style={{ minHeight: 74, fontFamily: 'var(--mono)' }}
              value={typeof draft.code_style === 'string' ? draft.code_style : JSON.stringify(draft.code_style)}
              onChange={(event) => setDraft({ ...draft, code_style: event.target.value as never })}
            />
          </div>

          <div className="grid two">
            <div className="field">
              <label htmlFor="default-duration">Default duration (s)</label>
              <input
                id="default-duration"
                className="input"
                value={String(draft.default_duration)}
                onChange={(event) => setDraft({ ...draft, default_duration: Number(event.target.value) || 20 })}
              />
            </div>
            <div className="field">
              <label htmlFor="default-resolution">Default resolution</label>
              <select
                id="default-resolution"
                className="select"
                value={draft.default_resolution}
                onChange={(event) => setDraft({ ...draft, default_resolution: event.target.value })}
              >
                <option value="1080x1920">1080 × 1920</option>
                <option value="2160x3840">2160 × 3840 (4K)</option>
              </select>
            </div>
          </div>

          <div className="grid two">
            <div className="field">
              <label htmlFor="intro">Intro line</label>
              <input
                id="intro"
                className="input"
                value={draft.intro}
                onChange={(event) => setDraft({ ...draft, intro: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="outro">Outro line</label>
              <input
                id="outro"
                className="input"
                value={draft.outro}
                onChange={(event) => setDraft({ ...draft, outro: event.target.value })}
              />
            </div>
          </div>

          <h2 style={{ marginTop: 24 }}>Personal branding</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            Every video opens on this identity — the lesson title, then the presenter credit — and closes on
            it. The opening title is derived from the lesson's own topic.
          </p>

          <div className="grid two">
            <div className="field">
              <label htmlFor="presenter">Presenter name</label>
              <input
                id="presenter"
                className="input"
                value={draft.presenter}
                onChange={(event) => setDraft({ ...draft, presenter: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="role">Professional title</label>
              <input
                id="role"
                className="input"
                value={draft.role}
                onChange={(event) => setDraft({ ...draft, role: event.target.value })}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="closing">Closing line</label>
            <input
              id="closing"
              className="input"
              value={draft.closing_line}
              onChange={(event) => setDraft({ ...draft, closing_line: event.target.value })}
            />
          </div>

          <div className="grid two">
            <div className="field">
              <label htmlFor="opening-seconds">Opening duration (s)</label>
              <input
                id="opening-seconds"
                className="input"
                type="number"
                min={2}
                max={3}
                step={0.5}
                value={(draft.opening_ms / 1000).toFixed(1)}
                onChange={(event) =>
                  setDraft({ ...draft, opening_ms: Math.round(Number(event.target.value) * 1000) })
                }
              />
              <span className="hint">2–3 seconds, taken from the total duration first.</span>
            </div>
            <div className="field">
              <label htmlFor="ending-seconds">Ending duration (s)</label>
              <input
                id="ending-seconds"
                className="input"
                type="number"
                min={2}
                max={3}
                step={0.5}
                value={(draft.ending_ms / 1000).toFixed(1)}
                onChange={(event) =>
                  setDraft({ ...draft, ending_ms: Math.round(Number(event.target.value) * 1000) })
                }
              />
              <span className="hint">2–3 seconds, also allocated before the lesson.</span>
            </div>
          </div>

          <div className="grid two">
            <div className="field">
              <label htmlFor="opening-style">Opening title style</label>
              <select
                id="opening-style"
                className="select"
                value={draft.opening_style}
                onChange={(event) => setDraft({ ...draft, opening_style: event.target.value })}
              >
                {OPENING_STYLES.map((style) => (
                  <option key={style.key} value={style.key}>
                    {style.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="auto-thumbnail">Thumbnail</label>
              <label className="row" style={{ gap: 8, alignItems: 'center', fontSize: 13 }}>
                <input
                  id="auto-thumbnail"
                  type="checkbox"
                  checked={Boolean(draft.auto_thumbnail)}
                  onChange={(event) => setDraft({ ...draft, auto_thumbnail: event.target.checked ? 1 : 0 })}
                />
                <span>Generate automatically from the opening frame</span>
              </label>
              <span className="hint">Cut once the title and credit are fully visible.</span>
            </div>
          </div>

          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn" onClick={applyToExisting} disabled={applying}>
              {applying ? 'Applying…' : 'Apply to existing videos'}
            </button>
            <span className="hint" style={{ margin: 0 }}>
              Rebuilds each storyboard on these settings and recuts its thumbnail.
            </span>
          </div>
        </section>

        <aside style={{ display: 'grid', gap: 16 }}>
          <div className="card tight">
            <h2>Preview</h2>
            <div
              style={{
                aspectRatio: '9 / 16',
                borderRadius: 16,
                border: '1px solid var(--line)',
                background: `radial-gradient(circle at 30% 10%, ${draft.accent}22, transparent 55%), ${draft.background}`,
                color: draft.ink,
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
            >
              <div className="mono" style={{ fontSize: 10, opacity: 0.6 }}>
                {draft.watermark}
              </div>
              <div>
                <div style={{ fontSize: 11, color: draft.accent, fontFamily: 'var(--mono)' }}>CONCEPT</div>
                <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.25, marginTop: 6 }}>
                  Stacks
                </div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 8 }}>
                  A LIFO container: the last value pushed is the first popped.
                </div>
              </div>
              <div>
                <div style={{ height: 4, background: draft.accent, borderRadius: 4, width: '48%', marginBottom: 10 }} />
                <div style={{ fontSize: 9, letterSpacing: 1.4, opacity: 0.55, fontFamily: 'var(--mono)' }}>
                  PRESENTED BY
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 3 }}>
                  {draft.presenter || 'Presenter name'}
                </div>
                <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>{draft.role}</div>
              </div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>
              Approximate preview. Rendered opening frames, thumbnails and MP4 frames use these values exactly.
            </p>
          </div>
          <div className="card tight">
            <h3>Current template</h3>
            {brand && (
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--muted)', fontSize: 12.5 }}>
                <li>{brand.name}</li>
                <li>
                  accent <span className="mono">{brand.accent}</span>
                </li>
                <li>
                  default {brand.default_resolution.replace('x', ' × ')} · {brand.default_duration}s
                </li>
              </ul>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

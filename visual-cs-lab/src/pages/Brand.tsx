import { useEffect, useState } from 'react';

import { api, type Brand } from '../api';

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
              <div style={{ height: 4, background: draft.accent, borderRadius: 4, width: '60%' }} />
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>
              Approximate preview. Rendered storyboard thumbnails and MP4 frames use these values exactly.
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

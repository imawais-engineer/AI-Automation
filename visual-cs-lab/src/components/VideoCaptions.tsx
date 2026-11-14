/**
 * The Video Captions tab of one finished video.
 *
 * YouTube, Facebook, Instagram and TikTok are laid out as buttons; picking one
 * opens that platform's title and description, everything else stays collapsed.
 * Saving writes the words to this video only, so re-rendering the same lesson or
 * uploading another cut never overwrites them.
 */

import { useEffect, useState } from 'react';

import { api } from '../api';

export type Caption = {
  platform: string;
  label: string;
  titleLimit: number;
  descriptionLimit: number;
  title: string;
  description: string;
  saved: boolean;
  updatedAt: string | null;
};

export default function VideoCaptions({ renderId }: { renderId: string }) {
  const [captions, setCaptions] = useState<Caption[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setCaptions(null);
    setError(null);
    api<{ captions: Caption[] }>(`/api/renders/${renderId}/captions`)
      .then((result) => live && setCaptions(result.captions))
      .catch((failure: Error) => live && setError(failure.message));
    return () => {
      live = false;
    };
  }, [renderId]);

  const current = captions?.find((item) => item.platform === active) || null;

  function edit(field: 'title' | 'description', value: string) {
    setNotice(null);
    setCaptions((list) =>
      list ? list.map((item) => (item.platform === active ? { ...item, [field]: value } : item)) : list
    );
  }

  async function save() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ captions: Caption[] }>(`/api/renders/${renderId}/captions/${current.platform}`, {
        method: 'PUT',
        body: JSON.stringify({ title: current.title, description: current.description })
      });
      setCaptions(result.captions);
      setNotice(`${current.label} captions saved for this video.`);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="chips" style={{ marginBottom: 6 }}>
        {(captions || []).map((item) => (
          <button
            key={item.platform}
            className={`chip ${item.platform === active ? 'on' : ''}`}
            onClick={() => {
              setNotice(null);
              setActive(item.platform === active ? null : item.platform);
            }}
          >
            {item.label}
            {item.saved ? ' ·saved' : ''}
          </button>
        ))}
      </div>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 12.5 }}>
        {active
          ? 'Edit the title and description this upload will use.'
          : 'Pick a platform to open its title and description.'}
      </p>

      {error && <div className="notice bad">{error}</div>}
      {!captions && !error && <div className="empty">Loading captions…</div>}

      {current && (
        <div className="grid" style={{ gap: 14 }}>
          <div className="field">
            <label htmlFor={`caption-title-${current.platform}`}>
              Title · {current.title.length}/{current.titleLimit}
            </label>
            <input
              id={`caption-title-${current.platform}`}
              className="input"
              value={current.title}
              maxLength={current.titleLimit}
              onChange={(event) => edit('title', event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`caption-description-${current.platform}`}>
              Description · {current.description.length}/{current.descriptionLimit}
            </label>
            <textarea
              id={`caption-description-${current.platform}`}
              className="textarea"
              rows={9}
              value={current.description}
              maxLength={current.descriptionLimit}
              onChange={(event) => edit('description', event.target.value)}
            />
          </div>
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <button className="btn primary" onClick={() => void save()} disabled={busy}>
              {busy ? 'Saving…' : 'Save captions'}
            </button>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {current.saved ? 'Saved for this video.' : 'Drafted from the lesson — not saved yet.'}
            </span>
          </div>
          {notice && <div className="notice good">{notice}</div>}
        </div>
      )}
    </div>
  );
}

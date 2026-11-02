/**
 * The publish step of a finished video.
 *
 * One tab per destination — Facebook, Instagram, LinkedIn, X and YouTube Shorts —
 * each showing the copy in that platform's own format with a single copy button,
 * plus the two media downloads the upload needs: the highest-quality MP4 and the
 * thumbnail as JPEG (and PNG). The text comes from the server so it is generated
 * from the same lesson data the video was rendered from.
 */

import { useEffect, useMemo, useState } from 'react';

import { api } from '../api';

export type PublishField = { name: string; value: string };

export type PlatformCopy = {
  platform: string;
  label: string;
  hint: string;
  fields: PublishField[];
  text: string;
  limit?: number;
  used?: number;
};

export default function PublishPanel({ lessonId, renderId }: { lessonId: string; renderId: string }) {
  const [copy, setCopy] = useState<PlatformCopy[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState('instagram');
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setCopy(null);
    setError(null);
    api<{ copy: PlatformCopy[] }>(`/api/lessons/${lessonId}/publish-copy`)
      .then((result) => {
        if (!live) return;
        setCopy(result.copy);
        if (result.copy.length > 0) setActive(result.copy[0].platform);
      })
      .catch((failure: Error) => live && setError(failure.message));
    return () => {
      live = false;
    };
  }, [lessonId]);

  const current = useMemo(() => copy?.find((item) => item.platform === active) || copy?.[0] || null, [copy, active]);

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setError('The browser blocked clipboard access — select the text and copy it manually.');
    }
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>Publish</h2>
        <div className="row" style={{ gap: 8 }}>
          <a className="btn primary" href={`/api/renders/${renderId}/video`}>
            Download video (MP4)
          </a>
          <a className="btn" href={`/api/lessons/${lessonId}/thumbnail.jpg`}>
            Thumbnail JPG
          </a>
          <a className="btn ghost" href={`/api/lessons/${lessonId}/thumbnail.png`}>
            PNG
          </a>
        </div>
      </div>

      {error && <div className="notice bad">{error}</div>}

      {!copy && !error && <div className="empty">Writing the platform copy…</div>}

      {copy && current && (
        <>
          <div className="chips" style={{ margin: '16px 0 6px' }}>
            {copy.map((item) => (
              <button
                key={item.platform}
                className={`chip ${item.platform === current.platform ? 'on' : ''}`}
                onClick={() => setActive(item.platform)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="muted" style={{ margin: '4px 0 12px', fontSize: 12.5 }}>
            {current.hint}
            {current.limit ? ` · ${current.used}/${current.limit} characters` : ''}
          </p>

          {current.fields.map((field) => (
            <div key={field.name} style={{ marginBottom: 14 }}>
              <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.06em' }}>
                {field.name.toUpperCase()}
              </div>
              <div
                style={{
                  whiteSpace: 'pre-wrap',
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  background: 'var(--panel-2, rgba(255,255,255,0.03))',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  marginTop: 4
                }}
              >
                {field.value}
              </div>
            </div>
          ))}

          <button className="btn primary" onClick={() => void copyText(current.text)}>
            {copied === current.text ? 'Copied' : `Copy ${current.label} post`}
          </button>
        </>
      )}
    </div>
  );
}

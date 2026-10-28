import { useCallback, useEffect, useState } from 'react';

import { api, formatTimestamp, type VoiceoverStatus } from '../api';

type Props = {
  lessonId: string;
  /** Status loaded with the lesson, so the panel opens without a second wait. */
  initial?: VoiceoverStatus | null;
  onStatus?: (status: VoiceoverStatus) => void;
};

type Payload = { voiceover: VoiceoverStatus; markdown: string };

/**
 * The voice-over script for one video: timestamped table, editable wording, the
 * continuous narration and a copy action. It is a text artifact — the video stays
 * silent — and regenerating it never requires a re-render.
 */
export default function VoiceoverPanel({ lessonId, initial, onStatus }: Props) {
  const [status, setStatus] = useState<VoiceoverStatus | null>(initial ?? null);
  const [markdown, setMarkdown] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const apply = useCallback(
    (payload: Payload) => {
      setStatus(payload.voiceover);
      setMarkdown(payload.markdown);
      const next: Record<string, string> = {};
      payload.voiceover.script?.segments.forEach((segment) => {
        next[segment.id] = segment.text;
      });
      setDrafts(next);
      onStatus?.(payload.voiceover);
    },
    [onStatus]
  );

  // The parent's snapshot paints immediately; the formatted copy always comes
  // from the endpoint, so "Copy script" copies the timestamped document.
  useEffect(() => {
    if (initial) setStatus(initial);
    let alive = true;
    api<Payload>(`/api/lessons/${lessonId}/voiceover`)
      .then((payload) => alive && apply(payload))
      .catch((cause) => {
        if (alive && !initial) setError((cause as Error).message);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  async function generate() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = await api<Payload>(`/api/lessons/${lessonId}/voiceover`, { method: 'POST' });
      apply(payload);
      setNotice('Voice-over script generated from the verified trace.');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!status?.script) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const segments = status.script.segments.map((segment) => ({
        id: segment.id,
        text: drafts[segment.id] ?? segment.text
      }));
      const payload = await api<Payload>(`/api/lessons/${lessonId}/voiceover`, {
        method: 'PATCH',
        body: JSON.stringify({ segments })
      });
      apply(payload);
      setNotice('Voice-over script saved.');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    const text = markdown || status?.script?.script || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setNotice('Script copied to the clipboard.');
    } catch {
      setError('The browser blocked clipboard access — select the script text and copy it manually.');
    }
  }

  const script = status?.script ?? null;
  const checks = status?.checks ?? [];
  const dirty =
    Boolean(script) &&
    script!.segments.some((segment) => (drafts[segment.id] ?? segment.text) !== segment.text);

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
            {script ? `${script.durationSeconds.toFixed(1)}s · ${script.segments.length} segments` : 'no script yet'}
          </span>
          {status?.outdated && <span className="badge warn">outdated</span>}
          {status?.present && !status.outdated && <span className="badge good">current</span>}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn ghost" onClick={generate} disabled={busy}>
            {status?.present ? 'Regenerate' : 'Generate script'}
          </button>
          {script && (
            <button className="btn ghost" onClick={copy} disabled={busy}>
              Copy script
            </button>
          )}
          {script && (
            <button className="btn primary" onClick={save} disabled={busy || !dirty}>
              Save wording
            </button>
          )}
        </div>
      </div>

      {error && <div className="notice bad">{error}</div>}
      {notice && <div className="notice good">{notice}</div>}

      {checks.length > 0 && (
        <ul className="check-list">
          {checks.map((check) => (
            <li key={check.id} className={check.ok ? 'ok' : 'bad'}>
              <span className="mark">{check.ok ? '✓' : '✕'}</span>
              <span>
                <strong>{check.label}</strong>
                <em>{check.detail}</em>
              </span>
            </li>
          ))}
        </ul>
      )}

      {!script && (
        <p className="hint" style={{ margin: 0 }}>
          The script is written from the verified trace and the scene timeline — one line per scene, with the
          timestamps of that scene. The video itself stays silent.
        </p>
      )}

      {script && (
        <>
          <div style={{ display: 'grid', gap: 8 }}>
            {script.segments.map((segment) => (
              <div
                key={segment.id}
                style={{
                  display: 'grid',
                  gap: 4,
                  padding: '8px 10px',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  background: 'var(--bg-soft)'
                }}
              >
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                    {formatTimestamp(segment.startMs)}–{formatTimestamp(segment.endMs)}
                  </span>
                  <span style={{ fontSize: 12 }}>{segment.scene}</span>
                </div>
                <textarea
                  className="textarea"
                  style={{ minHeight: 50 }}
                  aria-label={`Narration for ${segment.scene}`}
                  value={drafts[segment.id] ?? segment.text}
                  onChange={(event) => setDrafts({ ...drafts, [segment.id]: event.target.value })}
                />
              </div>
            ))}
          </div>

          <div className="field" style={{ margin: 0 }}>
            <label htmlFor={`voiceover-script-${lessonId}`}>Continuous script</label>
            <textarea
              id={`voiceover-script-${lessonId}`}
              className="textarea"
              readOnly
              style={{ minHeight: 120, fontSize: 13 }}
              value={script.script}
            />
            <span className="hint">Built from the scenes above — edit a line to change the narration.</span>
          </div>
        </>
      )}
    </div>
  );
}

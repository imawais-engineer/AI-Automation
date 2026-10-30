import { useCallback, useEffect, useState } from 'react';

import { api } from '../api';

type Provider = { id: string; label: string; configured: boolean; model: string };

type Take = {
  id: string;
  title: string;
  provider: string;
  model: string;
  status: string;
  file_path: string;
  available: boolean;
  created_at: string;
};

type Status = { providers: Provider[]; script_ready: boolean; takes: Take[] };

type Props = { lessonId: string };

/**
 * Speaks the voice-over script and exports the narration under the silent master.
 *
 * The script stays the source of truth: this only turns the current text into an
 * audio take, which then joins the audio library like any other track.
 */
export default function NarrationPanel({ lessonId }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [provider, setProvider] = useState('deepgram');
  const [model, setModel] = useState('');
  const [speed, setSpeed] = useState('1');
  const [expressivity, setExpressivity] = useState('0');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    api<Status>(`/api/lessons/${lessonId}/narration`)
      .then((data) => {
        setStatus(data);
        const chosen = data.providers.find((item) => item.id === provider) || data.providers[0];
        if (chosen) {
          setProvider(chosen.id);
          setModel((current) => current || chosen.model);
        }
      })
      .catch((cause: Error) => setError(cause.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  useEffect(load, [load]);

  async function generate() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = await api<{ durationSeconds: number; narration: Status }>(
        `/api/lessons/${lessonId}/narration`,
        {
          method: 'POST',
          body: JSON.stringify({
            provider,
            model,
            speed: Number(speed),
            expressivity: Number(expressivity)
          })
        }
      );
      setStatus(payload.narration);
      setNotice(`Narration recorded — ${payload.durationSeconds.toFixed(1)}s of audio in the library.`);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function exportTake(take: Take) {
    setExporting(take.id);
    setError('');
    setNotice('');
    try {
      const payload = await api<{ asset: { file_path: string }; warning: string | null }>(
        `/api/lessons/${lessonId}/narration/export`,
        { method: 'POST', body: JSON.stringify({ trackId: take.id }) }
      );
      setNotice(
        payload.warning
          ? payload.warning
          : `Voice-over short exported to ${payload.asset.file_path}`
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setExporting(null);
    }
  }

  const current = status?.providers.find((item) => item.id === provider) || null;
  const ready = Boolean(status?.script_ready) && Boolean(current?.configured);

  return (
    <div style={{ display: 'grid', gap: 10, marginTop: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
            {status ? `${status.takes.length} take${status.takes.length === 1 ? '' : 's'}` : 'loading…'}
          </span>
          {current && !current.configured && <span className="badge warn">provider not configured</span>}
          {status && !status.script_ready && <span className="badge warn">script needed</span>}
        </div>
      </div>

      {error && <div className="notice bad">{error}</div>}
      {notice && <div className="notice good">{notice}</div>}

      <div className="grid" style={{ gridTemplateColumns: '1.2fr 1.6fr 0.7fr 0.9fr auto', gap: 10, alignItems: 'end' }}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor={`narration-provider-${lessonId}`}>Voice provider</label>
          <select
            id={`narration-provider-${lessonId}`}
            className="input"
            value={provider}
            onChange={(event) => {
              const next = event.target.value;
              setProvider(next);
              const found = status?.providers.find((item) => item.id === next);
              if (found) setModel(found.model);
            }}
          >
            {(status?.providers || [{ id: 'deepgram', label: 'Deepgram', configured: false, model: '' }]).map(
              (item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              )
            )}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor={`narration-model-${lessonId}`}>Voice model</label>
          <input
            id={`narration-model-${lessonId}`}
            className="input mono"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="flux-naveen-en"
          />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor={`narration-speed-${lessonId}`}>Speed</label>
          <input
            id={`narration-speed-${lessonId}`}
            className="input"
            type="number"
            step="0.05"
            min="0.5"
            max="2"
            value={speed}
            onChange={(event) => setSpeed(event.target.value)}
          />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor={`narration-expressivity-${lessonId}`}>Expressivity</label>
          <input
            id={`narration-expressivity-${lessonId}`}
            className="input"
            type="number"
            step="0.1"
            min="0"
            max="1"
            value={expressivity}
            onChange={(event) => setExpressivity(event.target.value)}
          />
        </div>
        <button className="btn primary" onClick={generate} disabled={busy || !ready}>
          {busy ? 'Recording…' : 'Generate narration'}
        </button>
      </div>

      {!status?.script_ready && (
        <p className="hint" style={{ margin: 0 }}>
          Generate the voice-over script first — the narration speaks that exact text.
        </p>
      )}

      {status && status.takes.length > 0 && (
        <div style={{ display: 'grid', gap: 6 }}>
          {status.takes.map((take) => (
            <div
              key={take.id}
              className="row"
              style={{
                justifyContent: 'space-between',
                gap: 10,
                padding: '8px 10px',
                border: '1px solid var(--line)',
                borderRadius: 10,
                background: 'var(--bg-soft)'
              }}
            >
              <div style={{ display: 'grid', gap: 2 }}>
                <span className="mono" style={{ fontSize: 11.5 }}>
                  {new Date(take.created_at).toLocaleString()}
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  {take.provider}
                  {take.model ? ` · ${take.model}` : ''} ·{' '}
                  {take.available ? 'file on disk' : <span style={{ color: 'var(--warn)' }}>file missing</span>}
                </span>
              </div>
              <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                <span className="badge">{take.status}</span>
                <button
                  className="btn ghost"
                  style={{ padding: '4px 9px', fontSize: 11 }}
                  onClick={() => void exportTake(take)}
                  disabled={!take.available || exporting === take.id}
                >
                  {exporting === take.id ? 'Mixing…' : 'Build voice-over export'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

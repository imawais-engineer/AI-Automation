import { useEffect, useMemo, useState } from 'react';

import { api, formatBytes, type AlgorithmInfo, type CreateResult, type RenderJob } from '../api';
import { isActive, parseChecks, useRenderJob } from '../useRenderJob';

type StackOp = { op: 'push' | 'pop' | 'top'; value?: number };

const DEFAULT_OPS: StackOp[] = [
  { op: 'push', value: 10 },
  { op: 'push', value: 20 },
  { op: 'push', value: 30 },
  { op: 'top' },
  { op: 'pop' },
  { op: 'pop' },
  { op: 'push', value: 40 }
];

const PRESET_LABEL: Record<string, string> = {
  preview: 'Preview 540×960',
  hd: 'HD 1080×1920',
  '4k': '4K 2160×3840'
};

export default function Create() {
  const [algorithms, setAlgorithms] = useState<AlgorithmInfo[]>([]);
  const [algorithm, setAlgorithm] = useState<'stacks' | 'binary-search'>('stacks');
  const [ops, setOps] = useState<StackOp[]>(DEFAULT_OPS);
  const [arrayText, setArrayText] = useState('1, 3, 5, 7, 9');
  const [target, setTarget] = useState('7');
  const [duration, setDuration] = useState(45);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CreateResult | null>(null);
  const [preview, setPreview] = useRenderJob(null);
  const [exportJob, setExportJob] = useRenderJob(null);

  useEffect(() => {
    void api<{ algorithms: AlgorithmInfo[]; defaultSeconds: number }>('/api/algorithms')
      .then((data) => {
        setAlgorithms(data.algorithms);
        setDuration(data.defaultSeconds || 45);
      })
      .catch((cause: Error) => setError(cause.message));
  }, []);

  const array = useMemo(
    () =>
      arrayText
        .split(/[\s,]+/)
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value)),
    [arrayText]
  );

  const selected = algorithms.find((item) => item.kind === algorithm);
  const previewChecks = parseChecks(preview?.validation);
  const exportChecks = parseChecks(exportJob?.validation);

  const setOp = (index: number, patch: Partial<StackOp>) => {
    setOps((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const generate = async () => {
    setError('');
    setResult(null);
    setPreview(null);
    setExportJob(null);
    setBusy(true);
    try {
      const payload =
        algorithm === 'stacks'
          ? { algorithm, ops, duration }
          : { algorithm, array, target: Number(target), duration };
      const created = await api<CreateResult>('/api/create', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      setResult(created);
      if (created.issues.length > 0) {
        setError(created.issues.join(' '));
        return;
      }
      const job = await api<{ job: RenderJob }>('/api/renders', {
        method: 'POST',
        body: JSON.stringify({ lessonId: created.lesson.id, preset: 'preview' })
      });
      setPreview(job.job);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const exportHd = async () => {
    if (!result) return;
    setError('');
    try {
      const job = await api<{ job: RenderJob }>('/api/renders', {
        method: 'POST',
        body: JSON.stringify({ lessonId: result.lesson.id, preset: 'hd' })
      });
      setExportJob(job.job);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const working = busy || isActive(preview) || isActive(exportJob);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Create</h1>
          <div className="sub">
            Choose an algorithm, set its input, and generate a silent vertical short. Every frame comes
            from the verified trace.
          </div>
        </div>
      </div>

      {error && <div className="notice bad" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="field">
          <label>1 · Algorithm</label>
          <div className="grid two" style={{ gap: 12 }}>
            {(algorithms.length === 0
              ? [
                  { kind: 'stacks', name: 'Stack', summary: 'LIFO on one vertical tower.' },
                  { kind: 'binary-search', name: 'Binary Search', summary: 'Halve a sorted range.' }
                ]
              : algorithms
            ).map((item) => {
              const active = item.kind === algorithm;
              return (
                <button
                  key={item.kind}
                  type="button"
                  onClick={() => setAlgorithm(item.kind as 'stacks' | 'binary-search')}
                  className="card tight"
                  style={{
                    textAlign: 'left',
                    cursor: 'pointer',
                    borderColor: active ? 'var(--accent)' : 'var(--line)',
                    background: active ? 'var(--accent-soft)' : 'var(--panel-2)'
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{item.name}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{item.summary}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="field" style={{ marginTop: 18 }}>
          <label>2 · Input</label>
          {algorithm === 'stacks' ? (
            <div>
              <div className="hint" style={{ marginBottom: 10 }}>
                PUSH adds a value on top, PEEK reads the top, POP removes it. The trusted stack runs these
                in order and the video shows exactly that trace.
              </div>
              {ops.map((item, index) => (
                <div className="row" key={index} style={{ marginBottom: 8, gap: 8 }}>
                  <select
                    className="select"
                    style={{ width: 130 }}
                    value={item.op}
                    onChange={(event) => {
                      const next = event.target.value as StackOp['op'];
                      setOp(index, { op: next, value: next === 'push' ? item.value ?? 10 : item.value });
                    }}
                  >
                    <option value="push">PUSH</option>
                    <option value="top">PEEK</option>
                    <option value="pop">POP</option>
                  </select>
                  {item.op === 'push' ? (
                    <input
                      className="input"
                      style={{ width: 110 }}
                      type="number"
                      value={item.value ?? 0}
                      onChange={(event) => setOp(index, { value: Number(event.target.value) })}
                    />
                  ) : (
                    <span className="mono" style={{ fontSize: 12, color: 'var(--muted)', width: 110 }}>
                      no value
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => setOps((current) => current.filter((_, i) => i !== index))}
                    disabled={ops.length <= 1}
                    aria-label={`Remove operation ${index + 1}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div className="row" style={{ gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setOps((current) => [...current, { op: 'push', value: 50 }])}
                >
                  + PUSH
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setOps((current) => [...current, { op: 'top' }])}
                >
                  + PEEK
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setOps((current) => [...current, { op: 'pop' }])}
                >
                  + POP
                </button>
              </div>
            </div>
          ) : (
            <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: 1 }}>
                <label style={{ fontSize: 11 }}>Sorted array</label>
                <input
                  className="input"
                  value={arrayText}
                  onChange={(event) => setArrayText(event.target.value)}
                  placeholder="1, 3, 5, 7, 9"
                />
                <div className="hint">
                  {array.length} values {array.length > 1 && array.every((v, i) => i === 0 || array[i - 1] <= v) ? '· sorted' : '· must be sorted'}
                </div>
              </div>
              <div className="field" style={{ width: 130 }}>
                <label style={{ fontSize: 11 }}>Target</label>
                <input
                  className="input"
                  type="number"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <div className="field" style={{ marginTop: 18 }}>
          <button type="button" className="btn ghost" onClick={() => setAdvanced((value) => !value)}>
            {advanced ? 'Hide advanced' : 'Advanced'}
          </button>
          {advanced && (
            <div className="grid two" style={{ marginTop: 12, gap: 12 }}>
              <div className="field">
                <label>Length</label>
                <select
                  className="select"
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value))}
                >
                  {[30, 45, 60].map((value) => (
                    <option key={value} value={value}>
                      {value} seconds
                    </option>
                  ))}
                </select>
                <div className="hint">45 seconds is the default for the demo shorts.</div>
              </div>
              <div className="field">
                <label>Export</label>
                <div className="hint">
                  Preview renders at 540×960 first. Export renders 1080×1920 at 30 fps, H.264, no audio.
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="row" style={{ marginTop: 20, gap: 10 }}>
          <button type="button" className="btn primary" onClick={generate} disabled={working}>
            {busy ? 'Verifying…' : 'Generate animation'}
          </button>
          {selected && <span className="badge accent">{selected.name}</span>}
          <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
            no audio · 9:16 · verified trace
          </span>
        </div>
      </div>

      {result && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Verified</div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--good)' }}>
                {result.summary}
              </div>
            </div>
            <a className="btn ghost" href={`/lessons/${result.lesson.id}`}>
              Open editor
            </a>
          </div>
        </div>
      )}

      {preview && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontWeight: 700 }}>Preview</div>
            <span className="badge">{PRESET_LABEL[preview.preset] || preview.preset}</span>
          </div>
          {isActive(preview) && (
            <div>
              <div className="progress">
                <span style={{ width: `${Math.max(4, Math.round(preview.progress))}%` }} />
              </div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                {preview.state} · {Math.round(preview.progress)}%
              </div>
            </div>
          )}
          {preview.state === 'error' && <div className="notice bad">{preview.error}</div>}
          {preview.state === 'done' && (
            <div>
              <video
                src={`/api/renders/${preview.id}/stream`}
                controls
                loop
                muted
                playsInline
                style={{ width: '100%', maxWidth: 320, borderRadius: 12, display: 'block', marginBottom: 12 }}
              />
              <div className="row" style={{ gap: 10 }}>
                <button type="button" className="btn primary" onClick={exportHd} disabled={isActive(exportJob)}>
                  Export HD MP4
                </button>
                <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {formatBytes(preview.bytes)} · {preview.duration_seconds.toFixed(1)}s · {preview.frames} frames
                </span>
              </div>
              {previewChecks.length > 0 && (
                <div className="mono" style={{ fontSize: 11, color: 'var(--good)', marginTop: 8 }}>
                  {previewChecks.filter((check) => check.ok).length}/{previewChecks.length} quality checks
                  passed
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {exportJob && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontWeight: 700 }}>HD export</div>
            <span className="badge accent">{PRESET_LABEL[exportJob.preset] || exportJob.preset}</span>
          </div>
          {isActive(exportJob) && (
            <div>
              <div className="progress">
                <span style={{ width: `${Math.max(4, Math.round(exportJob.progress))}%` }} />
              </div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                {exportJob.state} · {Math.round(exportJob.progress)}%
              </div>
            </div>
          )}
          {exportJob.state === 'error' && <div className="notice bad">{exportJob.error}</div>}
          {exportJob.state === 'done' && (
            <div>
              <video
                src={`/api/renders/${exportJob.id}/stream`}
                controls
                loop
                muted
                playsInline
                style={{ width: '100%', maxWidth: 320, borderRadius: 12, display: 'block', marginBottom: 12 }}
              />
              <div className="row" style={{ gap: 10 }}>
                <a className="btn primary" href={`/api/renders/${exportJob.id}/video`}>
                  Download MP4
                </a>
                <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {formatBytes(exportJob.bytes)} · {exportJob.duration_seconds.toFixed(2)}s ·{' '}
                  {exportJob.width}×{exportJob.height} · {exportJob.frames} frames
                </span>
              </div>
              {exportChecks.length > 0 && (
                <div className="mono" style={{ fontSize: 11, color: 'var(--good)', marginTop: 8 }}>
                  {exportChecks.filter((check) => check.ok).length}/{exportChecks.length} quality checks
                  passed
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

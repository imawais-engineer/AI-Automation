import { useMemo } from 'react';

import { formatBytes, type RenderJob, type RenderValidation } from '../api';

function parseValidation(raw: string | null): RenderValidation | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RenderValidation;
    return Array.isArray(parsed.checks) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * What the encoded file actually is: playable preview, download, stream metadata
 * and the real checks the worker ran on the output.
 */
export default function RenderQuality({ job }: { job: RenderJob }) {
  const validation = useMemo(() => parseValidation(job.validation), [job.validation]);
  const media = validation?.media;
  const failed = validation?.checks.filter((check) => !check.ok) || [];

  return (
    <div className="render-quality">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className={`badge ${job.state === 'done' ? 'good' : job.state === 'error' ? 'bad' : 'accent'}`}>
          {job.state}
        </span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
          {job.width}×{job.height} · {job.fps} fps · {job.expected_frames || job.frames} frames
        </span>
      </div>

      {job.state === 'done' && (
        <>
          <video className="player" src={`/api/renders/${job.id}/stream`} controls playsInline preload="metadata" />
          <div className="row">
            <a className="btn primary" href={`/api/renders/${job.id}/video`}>
              Download MP4
            </a>
            <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
              {formatBytes(job.bytes)} · {job.duration_seconds.toFixed(2)}s · {media?.codec || 'h264'}
            </span>
          </div>
        </>
      )}

      {validation && (
        <>
          <div className={`notice ${validation.ok ? 'good' : 'bad'}`} style={{ margin: 0 }}>
            {validation.ok
              ? `Quality checked: ${validation.checks.length} automated checks passed.`
              : `Quality checks failed: ${failed.map((check) => check.label).join(', ')}`}
          </div>
          <ul className="check-list">
            {validation.checks.map((check) => (
              <li key={check.id} className={check.ok ? 'ok' : 'bad'}>
                <span className="mark">{check.ok ? '✓' : '✕'}</span>
                <span>
                  <strong>{check.label}</strong>
                  <em>{check.detail}</em>
                </span>
              </li>
            ))}
          </ul>
          <p className="hint" style={{ marginBottom: 0 }}>
            Human review still required: {validation.humanReview[0].toLowerCase()}
          </p>
        </>
      )}

      {!validation && job.state !== 'done' && job.error && (
        <p style={{ color: 'var(--bad)', fontSize: 12.5, margin: 0 }}>{job.error}</p>
      )}
    </div>
  );
}

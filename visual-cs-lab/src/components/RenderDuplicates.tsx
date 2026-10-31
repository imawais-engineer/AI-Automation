import { useState } from 'react';

import { api, formatBytes } from '../api';

type DuplicateEntry = {
  id: string;
  lesson_id: string;
  lesson_title: string;
  preset: string;
  state: string;
  created_at: string;
  bytes: number;
  file: string | null;
};

type DuplicatePlan = {
  remove: DuplicateEntry[];
  keep: DuplicateEntry[];
  lessons: { lesson_id: string; lesson_title: string; remove: number; keep: number }[];
  files: number;
  bytes: number;
};

type DedupeResult = {
  removed: { id: string; lesson_title: string; bytes: number }[];
  failed: { id: string; lesson_title: string; error: string }[];
  freedBytes: number;
  kept: number;
};

/**
 * Duplicate clean-up: of every lesson and profile pair only the newest render
 * stays. Older copies of the same profile are listed before anything is deleted,
 * and a file a published lesson still plays is never removed.
 */
export default function RenderDuplicates({ onCleaned }: { onCleaned: () => void }) {
  const [plan, setPlan] = useState<DuplicatePlan | null>(null);
  const [result, setResult] = useState<DedupeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function review() {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const data = await api<{ plan: DuplicatePlan }>('/api/renders/duplicates');
      setPlan(data.plan);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!plan) return;
    setBusy(true);
    setError('');
    try {
      const data = await api<{ result: DedupeResult }>('/api/renders/duplicates', {
        method: 'POST',
        body: JSON.stringify({ ids: plan.remove.map((item) => item.id) })
      });
      setResult(data.result);
      setPlan(null);
      onCleaned();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 14 }}>
        <button className="btn ghost" onClick={review} disabled={busy}>
          Remove duplicates
        </button>
      </div>

      {error && <div className="notice bad">{error}</div>}

      {result && (
        <div className={`notice ${result.failed.length > 0 ? 'bad' : 'good'}`}>
          {result.removed.length > 0
            ? `Removed ${result.removed.length} duplicate renders and freed ${formatBytes(result.freedBytes)}. ${result.kept} kept.`
            : 'No duplicates left — every lesson keeps one render per profile.'}
          {result.failed.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {result.failed.map((item) => (
                <li key={item.id}>
                  {item.lesson_title} · {item.id.slice(0, 8)}: {item.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {plan && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Remove duplicate renders</h2>
            <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
              newest per lesson and profile kept
            </span>
          </div>

          {plan.remove.length === 0 ? (
            <p className="sub">No duplicates — every lesson already has a single render per profile.</p>
          ) : (
            <>
              <p className="sub">
                Delete <strong>{plan.remove.length}</strong> older duplicate renders ({plan.files} files,{' '}
                {formatBytes(plan.bytes)}) and keep the newest copy of each lesson and profile.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Lesson</th>
                    <th>Profile</th>
                    <th>Duplicate</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.remove.map((item) => (
                    <tr key={item.id}>
                      <td>{item.lesson_title}</td>
                      <td className="mono">{item.preset}</td>
                      <td className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {item.id.slice(0, 8)}
                      </td>
                      <td>
                        <span className="badge">{item.state}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row">
                <button className="btn danger" onClick={confirm} disabled={busy}>
                  Delete {plan.remove.length} duplicates
                </button>
                <button className="btn ghost" onClick={() => setPlan(null)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

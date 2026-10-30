import { useState } from 'react';

import { api, formatBytes } from '../api';

type CleanupEntry = {
  id: string;
  lesson_id: string;
  lesson_title: string;
  preset: string;
  state: string;
  created_at: string;
  bytes: number;
  file: string | null;
};

type CleanupPlan = {
  keepPerLesson: number;
  remove: CleanupEntry[];
  keep: CleanupEntry[];
  lessons: { lesson_id: string; lesson_title: string; remove: number; keep: number }[];
  files: number;
  bytes: number;
};

type CleanupResult = {
  removed: { id: string; lesson_title: string; bytes: number }[];
  failed: { id: string; lesson_title: string; error: string }[];
  freedBytes: number;
  kept: number;
};

/**
 * Memory clean-up for the render store: keeps the newest two renders of every
 * lesson and deletes the older jobs together with their MP4 files. The counts are
 * shown before anything is deleted, and the report after it is per job.
 */
export default function RenderCleanup({ onCleaned }: { onCleaned: () => void }) {
  const [plan, setPlan] = useState<CleanupPlan | null>(null);
  const [result, setResult] = useState<CleanupResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function review() {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const data = await api<{ plan: CleanupPlan }>('/api/renders/cleanup');
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
      const data = await api<{ result: CleanupResult }>('/api/renders/cleanup', {
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
          Clean up old videos
        </button>
      </div>

      {error && <div className="notice bad">{error}</div>}

      {result && (
        <div className={`notice ${result.failed.length > 0 ? 'bad' : 'good'}`}>
          {result.removed.length > 0
            ? `Removed ${result.removed.length} renders and freed ${formatBytes(result.freedBytes)}. ${result.kept} kept.`
            : 'Nothing was removed.'}
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
            <h2>Clean up old videos</h2>
            <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
              newest {plan.keepPerLesson} per lesson kept
            </span>
          </div>

          {plan.remove.length === 0 ? (
            <p className="sub">Nothing to remove — every lesson already keeps at most {plan.keepPerLesson} renders.</p>
          ) : (
            <>
              <p className="sub">
                Delete <strong>{plan.remove.length}</strong> older renders ({plan.files} files,{' '}
                {formatBytes(plan.bytes)}) across <strong>{plan.lessons.length}</strong> lessons. The newest{' '}
                {plan.keepPerLesson} renders of each lesson, anything still rendering, and any file a lesson still plays
                stay.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Lesson</th>
                    <th>Delete</th>
                    <th>Keep</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.lessons.map((lesson) => (
                    <tr key={lesson.lesson_id}>
                      <td>{lesson.lesson_title}</td>
                      <td className="mono">{lesson.remove}</td>
                      <td className="mono">{lesson.keep}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row">
                <button className="btn danger" onClick={confirm} disabled={busy}>
                  Delete {plan.remove.length} renders
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

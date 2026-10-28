import { useEffect, useState } from 'react';

import { api, type RenderJob } from './api';

const ACTIVE: RenderJob['state'][] = ['queued', 'rendering', 'encoding', 'validating'];

/**
 * Tracks one render job: polls while it is active and stops as soon as it
 * finishes, fails or is cancelled.
 */
export function useRenderJob(initial: RenderJob | null) {
  const [job, setJob] = useState<RenderJob | null>(initial);

  useEffect(() => {
    setJob(initial);
  }, [initial?.id]);

  useEffect(() => {
    if (!job || !ACTIVE.includes(job.state)) return;
    const id = job.id;
    const timer = setInterval(() => {
      void api<{ job: RenderJob }>(`/api/renders/${id}`)
        .then((result) => setJob((current) => (current && current.id === id ? result.job : current)))
        .catch(() => undefined);
    }, 1500);
    return () => clearInterval(timer);
  }, [job?.id, job?.state]);

  return [job, setJob] as const;
}

export function parseChecks(raw: string | null | undefined): { label: string; ok: boolean; detail: string }[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { checks?: { label: string; ok: boolean; detail: string }[] };
    return Array.isArray(parsed?.checks) ? parsed.checks : [];
  } catch {
    return [];
  }
}

export function isActive(job: RenderJob | null): boolean {
  return Boolean(job && ACTIVE.includes(job.state));
}

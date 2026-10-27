export type Concept = {
  id: string;
  slug: string;
  name: string;
  category: string;
  summary: string;
  objectives: string;
  prerequisites: string;
  plain_explanation: string;
  technical_explanation: string;
  pseudocode: string;
  reference_language: string;
  reference_code: string;
  complexity_time: string;
  complexity_space: string;
  example_input: string;
  expected_output: string;
  animation_config: string;
  status: string;
  archived: number;
  updated_at: string;
};

export type StackVisual = {
  kind: 'stack';
  items: number[];
  top: number | null;
  op: string | null;
  value: number | null;
  returned: number | null;
  step: number;
  total: number;
};

export type BinarySearchStep = {
  n: number;
  low: number;
  high: number;
  mid: number;
  midValue: number;
  target: number;
  comparison: 'less' | 'greater' | 'equal';
  nextLow: number;
  nextHigh: number;
  eliminated: number[];
  foundIndex: number | null;
  message: string;
};

export type BinarySearchVisual = {
  kind: 'binary-search';
  array: number[];
  target: number;
  foundIndex: number | null;
  mode: 'setup' | 'trace';
  steps: BinarySearchStep[];
};

export type Scene = {
  id: string;
  type: string;
  durationMs: number;
  title: string;
  subtitle: string;
  caption: string;
  code?: { language: string; lines: string[]; highlight: number };
  visual?: StackVisual | BinarySearchVisual;
  facts?: { label: string; value: string }[];
};

export type Lesson = {
  id: string;
  concept_id: string;
  title: string;
  audience: string;
  objective: string;
  duration_seconds: number;
  hook: string;
  narration: string;
  on_screen_text: string;
  key_takeaway: string;
  cta: string;
  sources: string;
  review_status: string;
  scenes: Scene[];
  updated_at: string;
  concept_name?: string;
  concept_slug?: string;
};

export type RenderState =
  | 'queued'
  | 'rendering'
  | 'encoding'
  | 'validating'
  | 'done'
  | 'error'
  | 'cancelled';

export type RenderJob = {
  id: string;
  lesson_id: string;
  preset: 'preview' | 'hd' | '4k';
  width: number;
  height: number;
  fps: number;
  state: RenderState;
  progress: number;
  log: string;
  error: string | null;
  bytes: number;
  duration_seconds: number;
  frames: number;
  expected_frames: number;
  expected_seconds: number;
  storyboard_hash: string;
  validation: string | null;
  created_at: string;
  finished_at: string | null;
  lesson_title?: string;
};

export type MediaInfo = {
  container: string;
  codec: string;
  pixelFormat: string;
  width: number;
  height: number;
  durationSeconds: number;
  hasAudio: boolean;
};

export type RenderCheck = { id: string; label: string; ok: boolean; detail: string };

export type RenderValidation = {
  ok: boolean;
  media: MediaInfo | null;
  checks: RenderCheck[];
  humanReview: string[];
  validatedAt: string;
};

export type PipelineStage =
  | 'draft'
  | 'trace_verified'
  | 'storyboard_ready'
  | 'rendered'
  | 'quality_checked'
  | 'ready_to_publish';

export type Pipeline = {
  stage: PipelineStage;
  label: string;
  steps: { key: PipelineStage; label: string; status: 'done' | 'current' | 'blocked'; detail: string }[];
  render: (RenderJob & { parsed: RenderValidation | null }) | null;
  checklist: { key: string; label: string; kind: 'auto' | 'manual'; ok: boolean | null; detail: string }[];
  readyToPublish: boolean;
};

export type Brand = {
  name: string;
  accent: string;
  background: string;
  panel: string;
  ink: string;
  font_family: string;
  watermark: string;
  caption_style: string;
  code_style: string;
  default_duration: number;
  default_resolution: string;
  intro: string;
  outro: string;
};

export type StackEvent = {
  n: number;
  op: 'push' | 'pop' | 'top';
  value: number | null;
  returned: number | null;
  items: number[];
  top: number | null;
  message: string;
};

export type PublishJob = {
  id: string;
  lesson_id: string;
  platform: string;
  title: string;
  caption: string;
  hashtags: string;
  cta: string;
  status: string;
  scheduled_at: string | null;
  published_url: string | null;
  error: string | null;
  updated_at: string;
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}

export function formatSeconds(value: number): string {
  return `${value.toFixed(1)}s`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

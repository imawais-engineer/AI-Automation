/**
 * The lesson pipeline: the single place that answers "how far is this lesson
 * from a publishable Short?".
 *
 * The UI and the render enqueue both read this, so a lesson can never be shown
 * as ready to publish while its verified trace, storyboard timings, rendered
 * file or automated quality checks are missing.
 */

import { parseValidation, type RenderValidation } from './render/quality.ts';
import { runConcept, type ConceptInput, type LessonInput, type Scene } from './scenes.ts';

export type PipelineStage =
  | 'draft'
  | 'trace_verified'
  | 'storyboard_ready'
  | 'rendered'
  | 'quality_checked'
  | 'ready_to_publish';

export type PipelineStep = {
  key: PipelineStage;
  label: string;
  status: 'done' | 'current' | 'blocked';
  detail: string;
};

export type PublicationCheck = {
  key: string;
  label: string;
  kind: 'auto' | 'manual';
  ok: boolean | null;
  detail: string;
};

export type RenderRef = {
  id: string;
  preset: string;
  state: string;
  width: number;
  height: number;
  fps: number;
  bytes: number;
  duration_seconds: number;
  validation: string | null;
  finished_at: string | null;
};

export type Pipeline = {
  stage: PipelineStage;
  label: string;
  steps: PipelineStep[];
  render: (RenderRef & { parsed: RenderValidation | null }) | null;
  checklist: PublicationCheck[];
  readyToPublish: boolean;
};

const STAGE_LABEL: Record<PipelineStage, string> = {
  draft: 'Draft',
  trace_verified: 'Trace verified',
  storyboard_ready: 'Storyboard ready',
  rendered: 'Rendered',
  quality_checked: 'Quality checked',
  ready_to_publish: 'Ready to publish'
};

const ORDER: PipelineStage[] = [
  'draft',
  'trace_verified',
  'storyboard_ready',
  'rendered',
  'quality_checked',
  'ready_to_publish'
];

/** The most useful finished render: a quality-checked one wins over an older pass. */
export function bestRender(renders: RenderRef[]): (RenderRef & { parsed: RenderValidation | null }) | null {
  const finished = renders
    .filter((job) => job.state === 'done')
    .map((job) => ({ ...job, parsed: parseValidation(job.validation) }))
    .sort((a, b) => String(b.finished_at || '').localeCompare(String(a.finished_at || '')));
  return finished.find((job) => job.parsed?.ok) || finished[0] || null;
}

export type VoiceoverRef = {
  present: boolean;
  outdated: boolean;
  ok: boolean;
  checks: { id: string; label: string; ok: boolean; detail: string }[];
};

export function lessonPipeline(args: {
  lesson: LessonInput;
  concept: ConceptInput;
  scenes: Scene[];
  issues: string[];
  renders: RenderRef[];
  voiceover?: VoiceoverRef;
}): Pipeline {
  const { lesson, concept, scenes, issues, renders, voiceover } = args;
  const run = runConcept(concept);
  const render = bestRender(renders);

  const traceVerified = run.supported && run.validation.ok && run.errors.length === 0;
  const totalMs = scenes.reduce((sum, scene) => sum + (Number(scene.durationMs) || 0), 0);
  const storyboardReady = traceVerified && scenes.length > 0 && issues.length === 0;
  const rendered = storyboardReady && Boolean(render);
  const qualityChecked = rendered && Boolean(render?.parsed?.ok);
  const voiceoverOk = Boolean(voiceover?.ok);
  const readyToPublish = qualityChecked && lesson.review_status === 'approved' && voiceoverOk;

  const stage: PipelineStage = readyToPublish
    ? 'ready_to_publish'
    : qualityChecked
      ? 'quality_checked'
      : rendered
        ? 'rendered'
        : storyboardReady
          ? 'storyboard_ready'
          : traceVerified
            ? 'trace_verified'
            : 'draft';

  const currentIndex = ORDER.indexOf(stage);
  const steps: PipelineStep[] = [
    {
      key: 'draft',
      label: 'Script',
      status: String(lesson.hook || '').trim() && String(lesson.key_takeaway || '').trim() ? 'done' : 'current',
      detail: String(lesson.hook || '').trim() ? lesson.hook : 'Add a hook and a key takeaway.'
    },
    {
      key: 'trace_verified',
      label: 'Trace verified',
      status: traceVerified ? 'done' : currentIndex <= 0 ? 'current' : 'blocked',
      detail: traceVerified
        ? run.summary || `${run.eventCount} verified steps`
        : run.validation.failures[0] || 'The concept has no verified trace yet.'
    },
    {
      key: 'storyboard_ready',
      label: 'Storyboard ready',
      status: storyboardReady ? 'done' : traceVerified ? 'current' : 'blocked',
      detail: storyboardReady
        ? `${scenes.length} scenes · ${(totalMs / 1000).toFixed(2)}s`
        : issues[0] || 'Build the storyboard from the verified trace.'
    },
    {
      key: 'rendered',
      label: 'Rendered',
      status: rendered ? 'done' : storyboardReady ? 'current' : 'blocked',
      detail: render
        ? `${render.preset} · ${render.width}×${render.height} · ${render.duration_seconds.toFixed(2)}s`
        : 'Render an MP4 from the stored storyboard.'
    },
    {
      key: 'quality_checked',
      label: 'Quality checked',
      status: qualityChecked ? 'done' : rendered ? 'current' : 'blocked',
      detail: render?.parsed
        ? render.parsed.ok
          ? 'Codec, resolution, duration, frame count and animation all passed.'
          : render.parsed.checks.find((check) => !check.ok)?.detail || 'A quality check did not pass.'
        : 'Automated checks run on the encoded file.'
    },
    {
      key: 'ready_to_publish',
      label: 'Ready to publish',
      status: readyToPublish ? 'done' : qualityChecked ? 'current' : 'blocked',
      detail: readyToPublish
        ? 'Marked approved after human review, with a current voice-over script.'
        : lesson.review_status === 'approved'
          ? qualityChecked && !voiceoverOk
            ? 'A current voice-over script is still missing.'
            : 'A quality-checked render is still missing.'
          : 'Set the review status to approved once you have watched the render.'
    }
  ];

  const media = render?.parsed?.media || null;
  const openingScene = scenes.find((scene) => scene.type === 'open');
  const closingScene = scenes.find((scene) => scene.type === 'brand');
  const ratio = media ? media.width / media.height : 0;
  const vertical = Boolean(media && Math.abs(ratio - 9 / 16) < 0.01);
  const durationSeconds = totalMs / 1000;

  const checklist: PublicationCheck[] = [
    ...steps.slice(0, 5).map((step) => ({
      key: step.key,
      label: step.label,
      kind: 'auto' as const,
      ok: step.status === 'done',
      detail: step.detail
    })),
    {
      key: 'framing',
      label: 'Vertical 9:16 framing',
      kind: 'auto',
      ok: media ? vertical : false,
      detail: media ? `${media.width}×${media.height}` : 'No validated render yet.'
    },
    {
      key: 'duration',
      label: 'Duration inside 10–60 seconds',
      kind: 'auto',
      ok: durationSeconds >= 10 && durationSeconds <= 60,
      detail: `${durationSeconds.toFixed(2)}s storyboard`
    },
    {
      key: 'brand',
      label: 'Personal brand opening and closing',
      kind: 'auto',
      ok: Boolean(openingScene && closingScene),
      detail:
        openingScene && closingScene
          ? `Opening ${(openingScene.durationMs / 1000).toFixed(1)}s · closing ${(closingScene.durationMs / 1000).toFixed(1)}s`
          : 'Regenerate branding to add the branded opening and closing.'
    },
    {
      key: 'voiceover',
      label: 'Voice-over script',
      kind: 'auto',
      ok: voiceover ? voiceover.present && !voiceover.outdated : false,
      detail: !voiceover || !voiceover.present
        ? 'Generate the voice-over script for this video.'
        : voiceover.outdated
          ? 'The script is out of date — regenerate it after the lesson changed.'
          : 'Timestamped script aligned with the scene timeline.'
    },
    {
      key: 'narration',
      label: 'Narration matches the scenes',
      kind: 'auto',
      ok: voiceover ? voiceover.checks.every((check) => check.ok) : false,
      detail: voiceover
        ? voiceover.checks.find((check) => !check.ok)?.detail || 'Timestamps, pace and stated results all check out.'
        : 'No script to check yet.'
    },
    {
      key: 'legibility',
      label: 'On-screen text is legible at phone size',
      kind: 'manual',
      ok: null,
      detail: 'Watch the render on a phone, or step through the scene previews.'
    },
    {
      key: 'accuracy',
      label: 'Explanation matches the verified trace',
      kind: 'manual',
      ok: null,
      detail: 'Read the on-screen copy against the trace scene.'
    },
    {
      key: 'platform',
      label: 'Safe margins and caption fit the destination app',
      kind: 'manual',
      ok: null,
      detail: 'Check the 9:16 safe area in the target app before posting.'
    }
  ];

  return {
    stage,
    label: STAGE_LABEL[stage],
    steps,
    render,
    checklist,
    readyToPublish
  };
}

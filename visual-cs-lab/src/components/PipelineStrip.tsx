import type { Pipeline } from '../api';

/**
 * The lesson pipeline as a compact strip: draft → trace → storyboard → rendered
 * → quality checked → ready to publish. The detail of the current step is shown
 * underneath so a blocked stage says exactly what is missing.
 */
export default function PipelineStrip({ pipeline }: { pipeline: Pipeline }) {
  const current = pipeline.steps.find((step) => step.status === 'current');
  const tone =
    pipeline.stage === 'ready_to_publish'
      ? 'good'
      : pipeline.stage === 'quality_checked'
        ? 'accent'
        : pipeline.stage === 'rendered'
          ? 'warn'
          : '';

  return (
    <div className="pipeline-card">
      <div className="pipeline">
        {pipeline.steps.map((step) => (
          <div key={step.key} className={`pipeline-step ${step.status}`} title={step.detail}>
            <span className="dot" />
            <span>{step.label}</span>
          </div>
        ))}
        <span className={`badge ${tone}`}>{pipeline.label}</span>
      </div>
      {current && <p className="hint">Next: {current.detail}</p>}
      {pipeline.stage === 'ready_to_publish' && (
        <p className="hint">Automated checks passed and the lesson is approved for publishing.</p>
      )}
    </div>
  );
}

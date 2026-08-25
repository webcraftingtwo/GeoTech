import { nextBestAction, type QualityScore } from '@geotech/core';

/**
 * Data-quality meter (§35).
 *
 * Shown as one number and one suggestion. It measures completeness of the
 * record, never the competence of the technician — and it says so, because a
 * score that feels like a grade changes what people record.
 */
export function QualityMeter({ score, showHint = true }: { score: QualityScore; showHint?: boolean }) {
  const hint = nextBestAction(score);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="label">Data quality</span>
      <div className="quality">
        <span className="quality-score">{score.score}%</span>
        <div className="quality-track">
          <div className="quality-fill" data-band={score.band} style={{ width: `${score.score}%` }} />
        </div>
        <span className="small muted">{score.band}</span>
      </div>
      {showHint && hint && <div className="small muted">Next most useful: {hint}</div>}
    </div>
  );
}

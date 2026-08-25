import type { ValidationIssue } from '@geotech/core';

/**
 * Validation feedback (§18, §42).
 *
 * Errors and warnings are visually and textually distinct, and warnings are
 * shown as information rather than obstruction — geology is uncertain, and a
 * technician who cannot save an unusual observation will stop recording
 * unusual observations.
 */
export function IssueList({ issues }: { issues: ValidationIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {issues.map((issue, i) => (
        <div key={`${issue.code}-${i}`} className="issue" data-severity={issue.severity}>
          <span className="issue-tag">{issue.severity === 'ERROR' ? 'FIX' : 'CHECK'}</span>
          <span>{issue.message}</span>
        </div>
      ))}
    </div>
  );
}

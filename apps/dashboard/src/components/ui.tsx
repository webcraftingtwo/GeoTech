import type { ReactNode } from 'react';
import { buildOffsetDiagram, type OffsetGeometryInput } from '@geotech/core';

export function Tile({ label, value, tone }: { label: string; value: ReactNode; tone?: 'danger' | 'warn' }) {
  return (
    <div className="tile" data-tone={tone}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
    </div>
  );
}

export function Panel({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <span className="panel-title">{title}</span>
        <div className="spacer" />
        {actions}
      </header>
      {children}
    </section>
  );
}

/** Status is always a word as well as a colour (§33). */
export function Pill({ status, confidence }: { status?: string | null; confidence?: string | null }) {
  const text = status ?? confidence;
  if (!text) return <span className="muted">—</span>;
  return (
    <span className="pill" data-status={status ?? undefined} data-confidence={confidence ?? undefined}>
      {text.replace(/_/g, ' ')}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/**
 * The observed / interpreted pair (§13).
 *
 * These are rendered as two separate blocks with two separate colours, never as
 * one value with a footnote. A geologist glancing at a record must be able to
 * see instantly which number a technician measured and which number somebody
 * concluded.
 */
export function ProvenancePair({
  observedLabel,
  observedValue,
  observedMeta,
  interpretedLabel,
  interpretedValue,
  interpretedMeta,
  emptyInterpretation,
}: {
  observedLabel: string;
  observedValue: ReactNode;
  observedMeta: ReactNode;
  interpretedLabel: string;
  interpretedValue: ReactNode;
  interpretedMeta: ReactNode;
  emptyInterpretation?: ReactNode;
}) {
  return (
    <div className="provenance">
      <div className="prov-block" data-kind="observed">
        <div className="prov-kind">Observed · technician</div>
        <div className="small muted">{observedLabel}</div>
        <div className="prov-value">{observedValue}</div>
        <div className="prov-meta">{observedMeta}</div>
      </div>
      <div className="prov-block" data-kind="interpreted">
        <div className="prov-kind">Interpreted · geologist</div>
        {interpretedValue !== null && interpretedValue !== undefined ? (
          <>
            <div className="small muted">{interpretedLabel}</div>
            <div className="prov-value">{interpretedValue}</div>
            <div className="prov-meta">{interpretedMeta}</div>
          </>
        ) : (
          <div className="prov-meta" style={{ marginTop: 10 }}>
            {emptyInterpretation ?? 'No interpretation recorded yet. The observation stands on its own.'}
          </div>
        )}
      </div>
    </div>
  );
}

/** The same generated section the technician confirmed at the face (§12). */
export function OffsetDiagram({ input }: { input: OffsetGeometryInput }) {
  const diagram = buildOffsetDiagram(input);
  return (
    <figure style={{ margin: 0 }}>
      <svg className="diagram" viewBox="0 0 100 100" role="img" aria-label={diagram.caption}>
        {diagram.elements.map((el) => {
          if (el.kind === 'MARKER') {
            const far = el.side === 'FAR';
            return (
              <g key={el.id}>
                <line x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
                <text
                  x={far ? el.x2 - 1 : el.x1 + 2}
                  y={far ? el.y1 + 8 : el.y1 - 4}
                  fontSize="6"
                  fill="var(--muted)"
                  fontFamily="var(--mono)"
                  textAnchor={far ? 'end' : 'start'}
                >
                  {el.label.toUpperCase()}
                </text>
              </g>
            );
          }
          if (el.kind === 'STRUCTURE') {
            return (
              <g key={el.id}>
                <line x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} stroke="var(--text)" strokeWidth="2.5" strokeDasharray="4 3" />
                <text x={el.x2 + 1} y={el.y1 + 6} fontSize="5.5" fill="var(--text)" fontFamily="var(--mono)">
                  {el.label.toUpperCase()}
                </text>
              </g>
            );
          }
          if (el.kind === 'DIMENSION') {
            const top = Math.min(el.y1, el.y2);
            const bottom = Math.max(el.y1, el.y2);
            return (
              <g key={el.id}>
                <line x1={el.x} y1={top} x2={el.x} y2={bottom} stroke="var(--observed)" strokeWidth="1.2" />
                <line x1={el.x - 3} y1={top} x2={el.x + 3} y2={top} stroke="var(--observed)" strokeWidth="1.2" />
                <line x1={el.x - 3} y1={bottom} x2={el.x + 3} y2={bottom} stroke="var(--observed)" strokeWidth="1.2" />
                <text x={el.x + 3} y={(top + bottom) / 2 + 2} fontSize="7" fill="var(--observed)" fontFamily="var(--mono)" fontWeight="700">
                  {el.label}
                </text>
              </g>
            );
          }
          return (
            <text key={el.id} x={el.x} y={el.y} fontSize="4.5" fill="var(--warn)" textAnchor="middle">
              {el.label}
            </text>
          );
        })}
      </svg>
      <figcaption className="small muted" style={{ marginTop: 6 }}>
        {diagram.senseText}
      </figcaption>
    </figure>
  );
}

export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString() : '—');
export const fmtDateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');

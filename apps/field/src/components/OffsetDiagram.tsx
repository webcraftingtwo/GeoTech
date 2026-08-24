import { buildOffsetDiagram, type OffsetGeometryInput } from '@geotech/core';

/**
 * The generated offset section (§12 step 6).
 *
 * This is the error-catching step of the whole workflow. An offset recorded as
 * stepping down when the reef in front of the technician steps up is nearly
 * invisible in a form and obvious here — while they are still standing at the
 * face and it costs nothing to fix.
 */
export function OffsetDiagram({ input }: { input: OffsetGeometryInput }) {
  const diagram = buildOffsetDiagram(input);

  return (
    <figure style={{ margin: 0 }}>
      <svg className="diagram" viewBox="0 0 100 100" role="img" aria-label={diagram.caption}>
        {diagram.elements.map((el) => {
          if (el.kind === 'MARKER') {
            // The far label is right-anchored at the end of its segment so it
            // cannot collide with the dimension line between the two markers.
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
                <line x1={el.x} y1={top} x2={el.x} y2={bottom} stroke="var(--info)" strokeWidth="1.2" />
                <line x1={el.x - 3} y1={top} x2={el.x + 3} y2={top} stroke="var(--info)" strokeWidth="1.2" />
                <line x1={el.x - 3} y1={bottom} x2={el.x + 3} y2={bottom} stroke="var(--info)" strokeWidth="1.2" />
                <text
                  x={el.x + 3}
                  y={(top + bottom) / 2 + 2}
                  fontSize="7"
                  fill="var(--info)"
                  fontFamily="var(--mono)"
                  fontWeight="700"
                  textAnchor="start"
                >
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
      <figcaption className="small muted" style={{ marginTop: 8 }}>
        {diagram.senseText} {diagram.caption}
      </figcaption>
    </figure>
  );
}

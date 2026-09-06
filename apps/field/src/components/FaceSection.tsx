import { buildSectionProfile, type FaceMeasurement } from '@geotech/core';

/**
 * The face section — the drawing on the Face Marking Sheet.
 *
 * A vertical scale in metres centred on the BMSZ at zero, the two mining-cut
 * limits as dashed lines, and the measured hangingwall and footwall traces
 * across the face. A technician who has filled these sheets in by hand should
 * recognise it without being told what it is.
 *
 * Breaching stations are drawn in the breach colour *and* as a larger marker,
 * because status is never carried by colour alone under a cap lamp.
 */
export function FaceSection({
  measurement,
  activeStation,
  onSelectStation,
}: {
  measurement: FaceMeasurement;
  activeStation?: number;
  onSelectStation?: (index: number) => void;
}) {
  const profile = buildSectionProfile(measurement, { width: 320, height: 190 });

  const path = (points: { x: number; y: number }[]) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <svg
      viewBox={`0 0 ${profile.width} ${profile.height}`}
      className="face-section"
      role="img"
      aria-label={`Face section: ${profile.hangingwall.length} stations measured from the BMSZ`}
    >
      {profile.ticks.map((tick) => (
        <g key={tick.value}>
          <line x1={34} x2={profile.width - 14} y1={tick.y} y2={tick.y} stroke="var(--line)" strokeWidth="0.5" />
          <text x={30} y={tick.y + 3} textAnchor="end" fontSize="7" fill="var(--muted)" fontFamily="var(--mono)">
            {tick.value.toFixed(2)}
          </text>
        </g>
      ))}

      {/* The mining-cut limits. */}
      {[
        { y: profile.hangingwallLimitY, label: 'H/W LIMIT' },
        { y: profile.footwallLimitY, label: 'F/W LIMIT' },
      ].map((limit) => (
        <g key={limit.label}>
          <line
            x1={34}
            x2={profile.width - 14}
            y1={limit.y}
            y2={limit.y}
            stroke="var(--danger)"
            strokeWidth="1"
            strokeDasharray="5 3"
          />
          <text x={profile.width - 15} y={limit.y - 3} textAnchor="end" fontSize="6" fill="var(--danger)" letterSpacing="0.08em">
            {limit.label}
          </text>
        </g>
      ))}

      {/* The BMSZ datum: the yellow line actually painted on the face. */}
      <line x1={34} x2={profile.width - 14} y1={profile.datumY} y2={profile.datumY} stroke="var(--accent)" strokeWidth="2" />
      <text x={37} y={profile.datumY - 4} fontSize="7" fill="var(--accent)" fontWeight="700" letterSpacing="0.1em">
        BMSZ
      </text>

      <path d={path(profile.hangingwall)} fill="none" stroke="var(--text)" strokeWidth="1.5" strokeLinejoin="round" />
      <path d={path(profile.footwall)} fill="none" stroke="var(--text)" strokeWidth="1.5" strokeLinejoin="round" opacity="0.7" />

      {[...profile.hangingwall, ...profile.footwall].map((point, i) => {
        const active = activeStation === point.index;
        return (
          <circle
            key={`${point.index}-${i}`}
            cx={point.x}
            cy={point.y}
            r={point.breach ? (active ? 5 : 4) : active ? 4 : 2.6}
            fill={point.breach ? 'var(--danger)' : 'var(--ok)'}
            stroke={active ? 'var(--accent)' : 'var(--bg)'}
            strokeWidth={active ? 1.6 : 1}
            onClick={onSelectStation ? () => onSelectStation(point.index) : undefined}
            style={onSelectStation ? { cursor: 'pointer' } : undefined}
          />
        );
      })}

      {measurement.stations.map((station, index) => (
        <text
          key={index}
          x={profile.xFor(index)}
          y={profile.height - 3}
          textAnchor="middle"
          fontSize="6.5"
          fill={activeStation === index ? 'var(--accent)' : 'var(--muted)'}
          fontFamily="var(--mono)"
          fontWeight={activeStation === index ? 700 : 400}
        >
          {station.distance}
        </text>
      ))}
    </svg>
  );
}

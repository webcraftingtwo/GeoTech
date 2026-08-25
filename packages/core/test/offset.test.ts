import { describe, expect, it } from 'vitest';
import { buildOffsetDiagram, deriveThrowHeave, describeSense, toAsciiDiagram } from '../src/index.js';

describe('resolving an apparent offset (§13)', () => {
  it('resolves 2.5 m along a 57-degree structure into throw and heave', () => {
    const d = deriveThrowHeave(2.5, 57);
    expect(d.throw).toBeCloseTo(2.1, 1);
    expect(d.heave).toBeCloseTo(1.36, 1);
  });

  it('gives the whole offset to throw for a vertical structure', () => {
    const d = deriveThrowHeave(3, 90);
    expect(d.throw).toBeCloseTo(3, 5);
    expect(d.heave).toBeCloseTo(0, 5);
  });

  it('gives the whole offset to heave for a horizontal structure', () => {
    const d = deriveThrowHeave(3, 0);
    expect(d.throw).toBeCloseTo(0, 5);
    expect(d.heave).toBeCloseTo(3, 5);
  });

  it('always marks the result as requiring geological review', () => {
    const d = deriveThrowHeave(2.5, 57);
    expect(d.requiresReview).toBe(true);
    expect(d.basis).toMatch(/requires geological review/i);
  });

  it('never returns a negative component', () => {
    const d = deriveThrowHeave(-4, 30);
    expect(d.throw).toBeGreaterThanOrEqual(0);
    expect(d.heave).toBeGreaterThanOrEqual(0);
  });
});

describe('offset diagram (§12 step 6)', () => {
  const base = { apparentOffset: 2.5, unit: 'm', markerLabel: 'Reef', structureLabel: 'Fault' };

  it('draws the far marker below the near one for a down-stepping offset', () => {
    const d = buildOffsetDiagram({ ...base, verticalSense: 'DOWN' });
    const near = d.elements.find((e) => e.kind === 'MARKER' && e.id === 'near') as any;
    const far = d.elements.find((e) => e.kind === 'MARKER' && e.id === 'far') as any;
    expect(far.y1).toBeGreaterThan(near.y1); // y increases downward
    expect(d.senseAssumed).toBe(false);
  });

  it('draws the far marker above the near one for an up-stepping offset', () => {
    const d = buildOffsetDiagram({ ...base, verticalSense: 'UP' });
    const near = d.elements.find((e) => e.kind === 'MARKER' && e.id === 'near') as any;
    const far = d.elements.find((e) => e.kind === 'MARKER' && e.id === 'far') as any;
    expect(far.y1).toBeLessThan(near.y1);
  });

  it('marks the step as illustrative when no sense was recorded', () => {
    const d = buildOffsetDiagram(base);
    expect(d.senseAssumed).toBe(true);
    expect(d.elements.some((e) => e.kind === 'NOTE')).toBe(true);
    expect(d.senseText).toMatch(/not recorded/i);
  });

  it('keeps very small and very large offsets inside the frame', () => {
    for (const offset of [0.05, 0.5, 5, 50, 500]) {
      const d = buildOffsetDiagram({ ...base, apparentOffset: offset, verticalSense: 'DOWN' });
      for (const e of d.elements) {
        const ys = 'y' in e ? [e.y] : [(e as any).y1, (e as any).y2].filter((v) => v !== undefined);
        for (const y of ys) expect(y).toBeGreaterThanOrEqual(0), expect(y).toBeLessThanOrEqual(100);
      }
    }
  });

  it('labels the dimension with the measured value and unit', () => {
    const d = buildOffsetDiagram({ ...base, verticalSense: 'DOWN' });
    const dim = d.elements.find((e) => e.kind === 'DIMENSION') as any;
    expect(dim.label).toBe('2.5 m');
  });

  it('describes the sense the way a geologist would say it', () => {
    expect(describeSense({ apparentOffset: 2.5, verticalSense: 'DOWN', lateralSense: 'RIGHT', markerLabel: 'Reef' }))
      .toBe('Far side reef steps down and to the right.');
  });
});

describe('text diagram for reports (§12, §26)', () => {
  it('renders the section as a single line', () => {
    const line = toAsciiDiagram({
      apparentOffset: 2.5,
      unit: 'm',
      markerLabel: 'Reef',
      structureLabel: 'Fault',
      verticalSense: 'DOWN',
      lateralSense: 'RIGHT',
    });
    expect(line).toContain('REEF -------- FAULT -------- REEF');
    expect(line).toContain('2.5 m');
    expect(line).toContain('↓');
  });
});

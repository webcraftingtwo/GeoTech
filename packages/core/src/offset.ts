/**
 * Offset geometry and diagram model (§12).
 *
 * The generated diagram is not decoration. A technician who records an offset
 * as stepping down when the reef in front of them steps up has made an error
 * that is nearly invisible in a form and obvious in a picture. Generating the
 * section from the recorded values and showing it back **before** the
 * technician leaves the face is the cheapest possible place to catch it.
 *
 * Nothing here interprets geology. `deriveThrowHeave` is an arithmetic aid,
 * explicitly labelled as such, and its output is never written into an
 * observed field.
 */

import type { Confidence, LateralSense, VerticalSense } from './types.js';

export interface OffsetGeometryInput {
  apparentOffset: number;
  unit?: string;
  /** Which way the marker steps on the far side of the structure. */
  lateralSense?: LateralSense | null;
  verticalSense?: VerticalSense | null;
  dip?: number | null;
  throwObserved?: number | null;
  heaveObserved?: number | null;
  markerLabel?: string;
  structureLabel?: string;
  confidence?: Confidence | null;
}

/* ── derived components ───────────────────────────────────────────────── */

export interface DerivedComponents {
  throw: number;
  heave: number;
  /** Always present. This is an aid, not a geological determination. */
  basis: string;
  requiresReview: true;
}

/**
 * Resolves an apparent offset measured **along the structure** into vertical
 * and horizontal components for the recorded dip.
 *
 *   throw = apparent × sin(dip)      heave = apparent × cos(dip)
 *
 * This holds only for pure dip-slip displacement measured in the dip plane. Any
 * oblique or strike-slip component makes it an approximation. It is offered to
 * the geologist as a starting point for interpretation and is never stored as
 * an observed value.
 */
export function deriveThrowHeave(apparentOffset: number, dipDegrees: number): DerivedComponents {
  const rad = (dipDegrees * Math.PI) / 180;
  return {
    throw: round2(Math.abs(apparentOffset) * Math.sin(rad)),
    heave: round2(Math.abs(apparentOffset) * Math.cos(rad)),
    basis: `Resolved from an apparent offset of ${apparentOffset} measured along a structure dipping ${dipDegrees}°, assuming dip-slip displacement. Approximate — requires geological review.`,
    requiresReview: true,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ── sense in plain language ──────────────────────────────────────────── */

/**
 * Turns the recorded senses into the sentence a geologist would say out loud.
 * Senses describe the marker on the **far side** of the structure relative to
 * the near side the technician is standing on.
 */
export function describeSense(input: OffsetGeometryInput): string {
  const parts: string[] = [];
  if (input.verticalSense) parts.push(input.verticalSense === 'UP' ? 'up' : 'down');
  if (input.lateralSense) parts.push(`to the ${input.lateralSense === 'LEFT' ? 'left' : 'right'}`);
  if (parts.length === 0) return 'Sense of displacement not recorded.';
  const marker = input.markerLabel ?? 'marker';
  return `Far side ${marker.toLowerCase()} steps ${parts.join(' and ')}.`;
}

/* ── diagram model ────────────────────────────────────────────────────── */

export type DiagramElement =
  | {
      kind: 'MARKER';
      id: string;
      side: 'NEAR' | 'FAR';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      label: string;
    }
  | {
      kind: 'STRUCTURE';
      id: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      label: string;
    }
  | {
      kind: 'DIMENSION';
      id: string;
      x: number;
      y1: number;
      y2: number;
      label: string;
    }
  | {
      kind: 'NOTE';
      id: string;
      x: number;
      y: number;
      label: string;
    };

export interface OffsetDiagram {
  /** Elements are laid out in a 0–100 × 0–100 space, y increasing downward. */
  width: 100;
  height: 100;
  elements: DiagramElement[];
  caption: string;
  senseText: string;
  /** True when the senses are missing and the diagram shows a neutral step. */
  senseAssumed: boolean;
}

/**
 * Builds the section shown back to the technician at step 6 of the offset
 * workflow. The vertical step is drawn proportionally but clamped, so a 0.1 m
 * offset is still visible and a 40 m offset does not leave the frame.
 */
export function buildOffsetDiagram(input: OffsetGeometryInput): OffsetDiagram {
  const marker = input.markerLabel ?? 'MARKER';
  const structure = input.structureLabel ?? 'STRUCTURE';
  const unit = input.unit ?? 'm';
  const magnitude = Math.abs(input.apparentOffset);

  const senseAssumed = !input.verticalSense;
  const down = input.verticalSense ? input.verticalSense === 'DOWN' : true;

  // Proportional but bounded: readable across three orders of magnitude.
  const step = clamp(8 + Math.log10(1 + magnitude) * 26, 10, 34);

  const centreY = 50;
  const nearY = down ? centreY - step / 2 : centreY + step / 2;
  const farY = down ? centreY + step / 2 : centreY - step / 2;

  // A left-stepping marker is drawn with the far segment retreating from the
  // structure, so the lateral sense is visible as well as the vertical one.
  const left = input.lateralSense === 'LEFT';
  const farStartX = left ? 62 : 54;
  const farEndX = left ? 96 : 96;

  const elements: DiagramElement[] = [
    { kind: 'MARKER', id: 'near', side: 'NEAR', x1: 4, y1: nearY, x2: 46, y2: nearY, label: marker },
    { kind: 'STRUCTURE', id: 'structure', x1: 46, y1: 6, x2: 58, y2: 94, label: structure },
    { kind: 'MARKER', id: 'far', side: 'FAR', x1: farStartX, y1: farY, x2: farEndX, y2: farY, label: marker },
    {
      // Placed in the clear band between the structure and the far marker's
      // label: at the midpoint of the far segment the value ran off the right
      // edge, and hard against the structure it sat on the fault trace.
      kind: 'DIMENSION',
      id: 'offset',
      x: farStartX + 8,
      y1: nearY,
      y2: farY,
      label: `${formatNumber(magnitude)} ${unit}`,
    },
  ];

  if (senseAssumed) {
    elements.push({
      kind: 'NOTE',
      id: 'sense-note',
      x: 50,
      y: 96,
      label: 'Sense not recorded — step shown for illustration only',
    });
  }

  const confidenceText = input.confidence ? ` Confidence: ${input.confidence}.` : '';

  return {
    width: 100,
    height: 100,
    elements,
    senseText: describeSense(input),
    senseAssumed,
    caption: `Apparent offset of ${formatNumber(magnitude)} ${unit} of ${marker.toLowerCase()} across ${structure.toLowerCase()}.${confidenceText}`,
  };
}

/**
 * The same section as a single line of text — used in printed reports, in the
 * shift handover, and anywhere a vector diagram cannot go. Matches the shape
 * described in §12: `REEF -------- FAULT -------- REEF`.
 */
export function toAsciiDiagram(input: OffsetGeometryInput): string {
  const marker = (input.markerLabel ?? 'MARKER').toUpperCase();
  const structure = (input.structureLabel ?? 'STRUCTURE').toUpperCase();
  const unit = input.unit ?? 'm';
  const magnitude = formatNumber(Math.abs(input.apparentOffset));
  const arrow = input.verticalSense === 'UP' ? '↑' : input.verticalSense === 'DOWN' ? '↓' : '↕';
  const lateral = input.lateralSense ? ` ${input.lateralSense === 'LEFT' ? '←' : '→'}` : '';
  return `${marker} -------- ${structure} -------- ${marker}   ${arrow}${lateral} ${magnitude} ${unit}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '');
}

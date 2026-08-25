import { activeItems, labelFor } from '@geotech/core';
import { useApp } from '../state/app.js';
import type { ChipOption } from './Chips.js';

/**
 * Reference options come from the mine's configured lists, cached on the
 * device. Nothing here is hard-coded, so a mine that renames a structure type
 * sees the change at the face after the next reference refresh (§39).
 */
export function useOptions(listCode: string): ChipOption[] {
  const { reference } = useApp();
  return activeItems(reference.lists, listCode).map((i) => ({ code: i.code, label: i.label }));
}

export function useLabel(): (listCode: string, code?: string | null) => string {
  const { reference } = useApp();
  return (listCode, code) => labelFor(reference.lists, listCode, code);
}

export const CONFIDENCE_OPTIONS: ChipOption[] = [
  { code: 'HIGH', label: 'HIGH' },
  { code: 'MEDIUM', label: 'MEDIUM' },
  { code: 'LOW', label: 'LOW' },
];

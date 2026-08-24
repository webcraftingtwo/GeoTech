import {
  DEFAULT_CONVENTION,
  type ConfigurableRule,
  type MeasurementConvention,
  type RefList,
} from '@geotech/core';
import { prisma } from './prisma.js';

/**
 * Loads the mine's configured terminology and rules out of the database and
 * into the shapes the shared validation engine expects, so the server enforces
 * exactly what the device enforced (§18, §38).
 */
export async function loadReferenceLists(): Promise<RefList[]> {
  const lists = await prisma.refList.findMany({
    include: { items: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { code: 'asc' },
  });
  return lists.map((l) => ({
    code: l.code,
    name: l.name,
    description: l.description,
    mineSpecific: l.mineSpecific,
    items: l.items.map((i) => ({
      code: i.code,
      label: i.label,
      sortOrder: i.sortOrder,
      active: i.active,
      ...(i.meta ? { meta: i.meta as Record<string, unknown> } : {}),
    })),
  }));
}

export async function loadConvention(): Promise<MeasurementConvention> {
  const row = await prisma.measurementConventionConfig.findUnique({ where: { key: 'default' } });
  if (!row) return DEFAULT_CONVENTION;
  return {
    dipMin: row.dipMin,
    dipMax: row.dipMax,
    strikeMin: row.strikeMin,
    strikeMax: row.strikeMax,
    dipDirectionMin: row.dipDirectionMin,
    dipDirectionMax: row.dipDirectionMax,
    allowNegativeOffset: row.allowNegativeOffset,
    strikeDipRule: row.strikeDipRule as MeasurementConvention['strikeDipRule'],
    strikeDipToleranceDeg: row.strikeDipToleranceDeg,
    defaultUnit: row.defaultUnit,
    maxPlausibleWidthM: row.maxPlausibleWidthM,
    maxPlausibleOffsetM: row.maxPlausibleOffsetM,
  };
}

export async function loadValidationRules(): Promise<ConfigurableRule[]> {
  const rules = await prisma.validationRule.findMany({ where: { active: true } });
  return rules.map((r) => ({
    id: r.id,
    entity: r.entity,
    field: r.field,
    ruleType: r.ruleType as ConfigurableRule['ruleType'],
    params: (r.params ?? undefined) as ConfigurableRule['params'],
    severity: r.severity,
    message: r.message ?? undefined,
    active: r.active,
  }));
}

export interface ValidationConfig {
  lists: RefList[];
  convention: MeasurementConvention;
  rules: ConfigurableRule[];
}

/**
 * Cached briefly: every sync operation validates, and configuration changes
 * rarely. The TTL is short enough that an administrator's change is live within
 * a minute without a restart.
 */
let cache: { at: number; value: ValidationConfig } | null = null;
const TTL_MS = 60_000;

export async function loadValidationConfig(force = false): Promise<ValidationConfig> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const [lists, convention, rules] = await Promise.all([
    loadReferenceLists(),
    loadConvention(),
    loadValidationRules(),
  ]);
  cache = { at: Date.now(), value: { lists, convention, rules } };
  return cache.value;
}

export function invalidateConfigCache(): void {
  cache = null;
}

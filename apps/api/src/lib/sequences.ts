import type { RecordPrefix } from '@geotech/core';
import { formatRecordId } from '@geotech/core';
import type { Tx } from './prisma.js';

/**
 * Mints the definitive human-readable record identifier, e.g.
 * `UNK-FL-2026-000124`.
 *
 * A device offline mints a *provisional* identifier with a device-scoped
 * suffix; this replaces it at ingest. The update is atomic so two devices
 * syncing at once cannot receive the same number.
 */
export async function nextRecordId(
  tx: Tx,
  args: { site: string; prefix: RecordPrefix; year?: number },
): Promise<string> {
  const year = args.year ?? new Date().getUTCFullYear();
  const row = await tx.recordSequence.upsert({
    where: { prefix_year: { prefix: args.prefix, year } },
    create: { prefix: args.prefix, year, current: 1 },
    update: { current: { increment: 1 } },
    select: { current: true },
  });
  return formatRecordId({ site: args.site, prefix: args.prefix, year, sequence: row.current });
}

import type { Prisma } from '@prisma/client';
import type { Tx } from './prisma.js';

export interface AuditInput {
  userId?: string | null;
  entity: string;
  entityId: string;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
  deviceId?: string | null;
  syncBatchId?: string | null;
  ipAddress?: string | null;
}

/**
 * Writes an audit entry (§21).
 *
 * Always called inside the same transaction as the change it describes, so a
 * record can never exist without the entry explaining how it got there. There
 * is deliberately no update or delete counterpart anywhere in this codebase.
 */
export async function recordAudit(tx: Tx, input: AuditInput): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: input.userId ?? null,
      entity: input.entity,
      entityId: input.entityId,
      action: input.action,
      oldValue: (input.oldValue ?? null) as Prisma.InputJsonValue,
      newValue: (input.newValue ?? null) as Prisma.InputJsonValue,
      deviceId: input.deviceId ?? null,
      syncBatchId: input.syncBatchId ?? null,
      ipAddress: input.ipAddress ?? null,
    },
  });
}

/**
 * Snapshots a record as a new version (§20). Versions are what make a
 * "correction" possible without an overwrite ever occurring.
 */
export async function recordVersion(
  tx: Tx,
  args: {
    entityType: Prisma.RecordVersionCreateInput['entityType'];
    entityId: string;
    version: number;
    snapshot: unknown;
    reason?: string;
    createdById?: string | null;
  },
): Promise<void> {
  await tx.recordVersion.upsert({
    where: {
      entityType_entityId_version: {
        entityType: args.entityType,
        entityId: args.entityId,
        version: args.version,
      },
    },
    create: {
      entityType: args.entityType,
      entityId: args.entityId,
      version: args.version,
      snapshot: args.snapshot as Prisma.InputJsonValue,
      reason: args.reason ?? null,
      createdById: args.createdById ?? null,
    },
    update: {},
  });
}

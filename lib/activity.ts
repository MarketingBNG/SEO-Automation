import prisma from './prisma';

export async function log(action, { entityType, entityId, details, actor }: any = {}) {
  await prisma.activity_log.create({
    data: {
      action,
      entity_type: entityType || null,
      entity_id: entityId || null,
      details: details || '',
      actor: actor || 'system',
    },
  });
}

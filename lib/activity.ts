import prisma from './prisma';

// Records a major action: what happened, to what, who did it and how (dashboard, assistant or
// automatic). When no actor is given, the signed-in person of the current request is used; outside
// a request (scheduler, cron) it is recorded as automatic work.
export async function log(action, { entityType, entityId, details, actor, source }: any = {}) {
  let email: string | null = null;
  let who = actor || null;
  try {
    const { getMe } = await import('./auth');
    const me = await getMe();
    if (me) {
      email = me.email;
      who = who || me.name;
    }
  } catch {
    // No request (scheduler, background job): automatic work.
  }
  await prisma.activity_log.create({
    data: {
      action,
      entity_type: entityType || null,
      entity_id: entityId || null,
      details: details || '',
      actor: who || 'Automatic',
      actor_email: email,
      source: source || (email ? 'dashboard' : 'automatic'),
    },
  });
}

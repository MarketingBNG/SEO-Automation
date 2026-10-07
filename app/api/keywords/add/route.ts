import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { existingTopics, duplicateReason } from '@/lib/duplicates';
import { getActor } from '@/lib/auth';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { keywords, batchName }: any = (await req.json().catch(() => ({}))) || {};
  if (!Array.isArray(keywords) || keywords.length === 0) {
    return NextResponse.json({ error: 'keywords array is required' }, { status: 400 });
  }

  const data: any[] = [];
  for (const row of keywords) {
    const keyword = String(row.keyword || '').trim();
    if (!keyword) continue;
    data.push({ batch_name: batchName || 'SE Ranking research', keyword, notes: row.notes || '', status: 'pending' });
  }
  // Was a db.transaction of single INSERTs; createMany is one atomic statement that keeps insert order.
  // K10: duplicate topics are rejected with a reason before they enter the pipeline.
  const known = await existingTopics();
  const rejected: string[] = [];
  for (let i = data.length - 1; i >= 0; i--) {
    const why = await duplicateReason(data[i].keyword, [...known, ...data.slice(0, i).map((d) => ({ keyword: d.keyword, where: 'repeated in this list' }))]);
    if (why) {
      rejected.unshift(why);
      data.splice(i, 1);
    }
  }
  if (data.length) await prisma.keywords.createMany({ data });
  const inserted = data.length;

  await activity.log('keywords.added', {
    entityType: 'keyword',
    details: `${inserted} keyword(s) added from ${batchName || 'SE Ranking research'}`,
    actor: await getActor(),
  });

  return NextResponse.json({ inserted, rejected }, { status: 200 });
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

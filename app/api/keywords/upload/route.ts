import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import prisma from '@/lib/prisma';
import * as activity from '@/lib/activity';
import { existingTopics, duplicateReason } from '@/lib/duplicates';
import { getActor } from '@/lib/auth';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const batchNameField = form.get('batchName');
    const batchName = (typeof batchNameField === 'string' && batchNameField) || file.name || 'Upload';

    const buf = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buf);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (!rows.length) return NextResponse.json({ error: 'File is empty' }, { status: 400 });

    // Find a column that looks like the keyword column
    const firstRow = rows[0];
    const keys = Object.keys(firstRow);
    const keywordKey =
      keys.find((k) => /keyword/i.test(k)) || keys.find((k) => /topic/i.test(k)) || keys[0];
    const notesKey = keys.find((k) => /note|context|angle|instruction/i.test(k));

    const data: any[] = [];
    for (const row of rows) {
      const keyword = String(row[keywordKey] || '').trim();
      if (!keyword) continue;
      const notes = notesKey ? String(row[notesKey] || '').trim() : '';
      data.push({ batch_name: batchName, keyword, notes, status: 'pending' });
    }
    // K10: duplicate topics are rejected with a reason before they enter the pipeline.
    const known = await existingTopics();
    const rejected: string[] = [];
    for (let i = data.length - 1; i >= 0; i--) {
      const why = await duplicateReason(data[i].keyword, [...known, ...data.slice(0, i).map((d) => ({ keyword: d.keyword, where: 'repeated in this upload' }))]);
      if (why) {
        rejected.unshift(why);
        data.splice(i, 1);
      }
    }
    if (data.length) await prisma.keywords.createMany({ data });
    const inserted = data.length;

    await activity.log('keywords.uploaded', {
      entityType: 'keyword',
      details: `${inserted} keyword(s) imported from "${batchName}"`,
      actor: await getActor(),
    });

    return NextResponse.json({ inserted, rejected, batchName, keywordColumnUsed: keywordKey }, { status: 200 });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

import { NextRequest, NextResponse } from 'next/server';
import mammoth from 'mammoth';
import { methodNotAllowed } from '../../_lib/http';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const name = file.name || '';
    const isDocx = /\.docx$/i.test(name);

    if (!isDocx) {
      return NextResponse.json(
        {
          error:
            'Only .docx files are supported. If this is a Google Doc, use File → Download → Microsoft Word (.docx) first.',
        },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { value: html, messages } = await mammoth.convertToHtml({ buffer });

    const titleGuess = name.replace(/\.docx$/i, '').replace(/[_-]+/g, ' ').trim();

    return NextResponse.json(
      {
        title: titleGuess,
        contentHtml: html,
        warnings: messages.filter((m: any) => m.type === 'warning').map((m: any) => m.message),
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export { methodNotAllowed as GET, methodNotAllowed as PUT, methodNotAllowed as PATCH, methodNotAllowed as DELETE };

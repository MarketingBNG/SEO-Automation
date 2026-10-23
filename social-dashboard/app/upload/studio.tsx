'use client';

import { useState } from 'react';
import { UploadCloud, Wand2, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { PLATFORMS } from '@/lib/mock';

const FORMATS = ['Post', 'Carousel', 'Story', 'Reel', 'YouTube Short', 'YouTube video', 'WhatsApp status'];

export function UploadStudio() {
  const [file, setFile] = useState<string | null>(null);
  const [format, setFormat] = useState('Reel');
  const [platforms, setPlatforms] = useState<string[]>(['Instagram', 'Facebook']);
  const [mode, setMode] = useState<'auto' | 'prompt'>('auto');
  const [prompt, setPrompt] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const toggle = (p: string) => setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>1. Upload a raw image or clip</CardTitle></CardHeader>
        <CardContent>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center hover:bg-muted/50">
            <UploadCloud className="size-8 text-muted-foreground" />
            <span className="text-sm">{file ?? 'Click to choose photos or video (event, office, team)'}</span>
            <input type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => setFile(e.target.files?.[0]?.name ?? null)} />
          </label>

          <div className="mt-6 text-sm font-medium">2. What should we make?</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {FORMATS.map((f) => (
              <button key={f} onClick={() => setFormat(f)} className={`rounded-full border px-3 py-1 text-sm ${format === f ? 'border-[#1B2A5E] bg-[#1B2A5E] text-white' : ''}`}>{f}</button>
            ))}
          </div>

          <div className="mt-6 text-sm font-medium">3. Which platforms? (select many)</div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PLATFORMS.map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={platforms.includes(p)} onChange={() => toggle(p)} /> {p}
              </label>
            ))}
          </div>

          <div className="mt-6 text-sm font-medium">4. How?</div>
          <div className="mt-2 flex gap-2">
            <Button variant={mode === 'auto' ? 'default' : 'outline'} size="sm" onClick={() => setMode('auto')}><Wand2 className="size-3.5" /> Auto-create</Button>
            <Button variant={mode === 'prompt' ? 'default' : 'outline'} size="sm" onClick={() => setMode('prompt')}><Type className="size-3.5" /> Use my prompt</Button>
          </div>
          {mode === 'prompt' && (
            <Textarea className="mt-2" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder='e.g. "20-second reel, captions, upbeat music, end with our logo"' />
          )}

          <Button className="mt-6" disabled={!file || platforms.length === 0} onClick={() => setSubmitted(true)}>
            Create {format} for {platforms.length} platform{platforms.length === 1 ? '' : 's'}
          </Button>
          {submitted && <p className="mt-3 text-sm text-emerald-700">Queued. A preview for each platform will appear in Content Review for approval.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>What the AI does</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p><b className="text-foreground">Images:</b> crop per platform, colour correction, brand frame, headline, carousel.</p>
          <p><b className="text-foreground">Raw clips:</b> remove mistakes and silences, crop 9:16 / 1:1 / 16:9, B-roll, subtitles, titles, transitions, logo, licensed music and sound effects.</p>
          <p><b className="text-foreground">Then:</b> caption and hashtags per platform, fact check, preview, your approval, publish.</p>
          <p>All files are saved in the Asset Library.</p>
        </CardContent>
      </Card>
    </div>
  );
}

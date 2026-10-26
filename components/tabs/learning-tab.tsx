'use client';

// Learn from YouTube: add videos (links or the learning library spreadsheet), watch them with Gemini
// (sight and sound) within a daily budget, read the notes, and build the creative skills from them.
import { useCallback, useEffect, useState } from 'react';
import { BrainCircuit, Clapperboard, Eye, FileSpreadsheet, Loader2, Play, Plus, RotateCw, SkipForward, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/shared/status-badge';
import { DataTable, TD, TD_MUTED, NativeSelect } from '@/components/shared/content-ui';
import { SafeHtml, renderMarkdown } from '@/components/shared/article';
import { onScreen } from '@/components/shared/on-screen';
import { jobsChanged } from '@/components/shared/job-progress';
import { useRole } from '@/hooks/use-role';

const CATEGORY_HINT = 'Let Gemini decide the category';

const hhmm = (sec: number | null | undefined) => {
  if (!sec && sec !== 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};
const hours = (sec: number) => `${(sec / 3600).toFixed(1)} h`;

const STATUS: Record<string, { tone: string; label: string }> = {
  queued: { tone: 'pending', label: 'Waiting' },
  watching: { tone: 'generating', label: 'Watching' },
  watched: { tone: 'approved', label: 'Watched' },
  failed: { tone: 'failed', label: 'Failed' },
  skipped: { tone: 'pending', label: 'Skipped' },
};

export default function LearningTab() {
  const who = useRole();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [links, setLinks] = useState('');
  const [category, setCategory] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [budget, setBudget] = useState('');
  const [test, setTest] = useState<any>(null);
  const [view, setView] = useState<{ title: string; html: string; meta?: string } | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const res = await fetch('/api/learning').catch(() => null);
    const j = res ? await res.json().catch(() => null) : null;
    if (!res?.ok || !j) return setError(j?.error || 'Could not load Learn from YouTube.');
    setError(null);
    setData(j);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => onScreen('tab-learning') && load(), 10000);
    return () => clearInterval(t);
  }, [load]);

  async function post(body: any, done?: string) {
    setBusy(body.action + (body.id || body.category || ''));
    setMsg(null);
    try {
      const res = await fetch('/api/learning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setMsg(j.note || done || 'Done.');
      jobsChanged();
      await load();
      return j;
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function addLinks() {
    const j = await post({ action: 'add', links, category: category || null });
    if (j) {
      setLinks('');
      setMsg(`${j.added} added${j.requeued ? `, ${j.requeued} queued again` : ''}${j.kept ? `, ${j.kept} were already here` : ''}${j.invalid?.length ? `. Not YouTube links: ${j.invalid.join(', ')}` : ''}.`);
    }
  }

  async function importFile() {
    if (!file) return;
    setBusy('import');
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/learning/import', { method: 'POST', body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setMsg(`${j.found} videos in the file: ${j.added} added${j.requeued ? `, ${j.requeued} queued again` : ''}${j.kept ? `, ${j.kept} were already here` : ''}.`);
      setFile(null);
      await load();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function testKey() {
    setBusy('test');
    const j = await fetch('/api/learning/test', { method: 'POST' }).then((r) => r.json()).catch((e) => ({ ok: false, error: e.message }));
    setTest(j);
    setBusy(null);
  }

  async function showNotes(id: number) {
    const j = await fetch(`/api/learning/notes?id=${id}`).then((r) => r.json()).catch(() => null);
    if (!j || j.error) return setMsg(j?.error || 'Could not load the notes.');
    setView({ title: j.title || j.url, meta: `${j.category} · ${j.parts_done}/${j.parts_total || 1} part(s) watched${j.model ? ` · ${j.model}` : ''}`, html: renderMarkdown(j.notes || 'No notes yet.') });
  }

  async function showSkill(slug: string) {
    const j = await fetch(`/api/learning/skill?slug=${encodeURIComponent(slug)}`).then((r) => r.json()).catch(() => null);
    if (!j || j.error) return setMsg(j?.error || 'Could not load the skill.');
    setView({ title: `${j.category} skill`, meta: `Version ${j.version} · built ${j.created_at} UTC by ${j.built_by || 'the dashboard'} · ${j.sources.length} source(s)`, html: renderMarkdown(j.content) });
  }

  if (!data) return <Card><CardContent className="py-6 text-sm text-muted-foreground">{error || 'Loading...'}</CardContent></Card>;

  const b = data.budget;
  const byCat: Record<string, any[]> = {};
  for (const v of data.videos) (byCat[v.category] ||= []).push(v);
  const cats = Object.keys(byCat).sort((x, y) => byCat[y].filter((v: any) => v.status === 'watched').length - byCat[x].filter((v: any) => v.status === 'watched').length || x.localeCompare(y));
  const total = data.videos.length;
  const watched = data.videos.filter((v: any) => v.status === 'watched').length;
  const leftSec = data.videos.filter((v: any) => v.status === 'queued' || v.status === 'watching').reduce((n: number, v: any) => n + Math.max(0, (v.duration_sec || 1800) - (v.watched_seconds || 0)), 0);
  const admin = who.role === 'admin';
  const canWork = who.can('content.work');
  const knownCats: string[] = data.skills.categories.map((c: any) => c.category);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Clapperboard className="size-5 text-red-600" />Learn from YouTube</CardTitle>
          <CardDescription>
            The dashboard watches each video with Google Gemini (it sees the screen and hears the voice) and takes notes on what is taught, what is shown, and how the creator thinks. The notes become creative skills that every design job follows.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!data.gemini ? (
            <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
              <div className="font-semibold">Gemini key not set yet</div>
              <div className="text-muted-foreground">Create a key at aistudio.google.com (Get API key), then add it in Coolify as <code>GEMINI_API_KEY</code> and redeploy. Videos can be added now; watching starts once the key is there.</div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span><strong>{watched}</strong> of {total} videos watched</span>
              <span>Today: <strong>{hours(b.usedSeconds)}</strong> of {b.dailyHours} h of video</span>
              {leftSec > 0 && <span className="text-muted-foreground">About {Math.ceil(leftSec / 3600)} h of video left (≈ {Math.ceil(leftSec / 3600 / b.dailyHours)} day(s) at this pace)</span>}
              {data.running && <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400"><Loader2 className="size-3.5 animate-spin" />Watching now</span>}
            </div>
          )}
          {b.pausedUntil && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3">
              Gemini said today&apos;s limit is reached, so watching continues tomorrow (it resets at midnight US Pacific time).
              {canWork && <Button size="sm" variant="outline" className="ml-2" disabled={!!busy} onClick={() => post({ action: 'resume' }, 'Trying again now.')}>Try again now</Button>}
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            {admin && (
              <>
                <label className="grid gap-1"><span className="text-xs text-muted-foreground">Hours of video a day (free tier: 8)</span><Input className="h-8 w-40" type="number" min="1" max="200" value={budget} placeholder={String(b.dailyHours)} onChange={(e) => setBudget(e.target.value)} /></label>
                <Button size="sm" variant="outline" disabled={!budget || !!busy} onClick={() => post({ action: 'budget', hours: budget }, 'Saved.').then(() => setBudget(''))}>Save</Button>
              </>
            )}
            <Button size="sm" variant="outline" disabled={busy === 'test'} onClick={testKey}>{busy === 'test' && <Loader2 className="animate-spin" />}Test Gemini key</Button>
          </div>
          {test && (
            <div className={`rounded-lg border p-2 text-xs ${test.ok && test.modelAvailable ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/50 bg-amber-500/10'}`}>
              {test.ok ? (test.modelAvailable ? `The key works and ${test.model} is available.` : `The key works, but ${test.model} is not in its list. Set GEMINI_MODEL to one of: ${test.models.slice(0, 12).join(', ')}.`) : `Not working: ${test.error}`}
            </div>
          )}
          {msg && <div className="text-muted-foreground">{msg}</div>}
        </CardContent>
      </Card>

      {canWork && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Plus className="size-4" />Add YouTube videos</CardTitle>
              <CardDescription>Paste one or more links (one per line). Public videos only.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Textarea rows={4} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
              <div className="flex flex-wrap gap-2">
                <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)} className="w-72">
                  <option value="">{CATEGORY_HINT}</option>
                  {knownCats.map((c) => <option key={c} value={c}>{c}</option>)}
                </NativeSelect>
                <Button disabled={!links.trim() || !!busy} onClick={addLinks}>{busy?.startsWith('add') ? <Loader2 className="animate-spin" /> : <Plus />}Add and learn</Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FileSpreadsheet className="size-4" />Upload a learning library</CardTitle>
              <CardDescription>An Excel or CSV file with a &quot;YouTube Link&quot; (or &quot;Video ID&quot;) column. Category, Level, Order, Duration and Channel are read when present.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              <Button disabled={!file || !!busy} onClick={importFile}>{busy === 'import' ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}Import videos</Button>
            </CardContent>
          </Card>
        </div>
      )}

      {data.upNext?.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Up next</CardTitle><CardDescription>Short lessons first, long courses last. &quot;Watch now&quot; moves a video to the front.</CardDescription></CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {data.upNext.map((v: any) => <li key={v.id}>{v.title || 'Untitled'} <span className="text-muted-foreground">· {v.category} · {hhmm(v.duration_sec)}{v.status === 'watching' ? ' · part-watched' : ''}</span></li>)}
            </ol>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BrainCircuit className="size-4" />Skills learned</CardTitle>
          <CardDescription>A skill is rebuilt by itself once all videos of its category are watched. &quot;Build skill&quot; does it now with what is watched so far. In Testing mode a build waits for Claude Code (&quot;run the SEO AI queue&quot;).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
            <strong>Creative Director</strong>
            <span className="text-muted-foreground">(joins every category skill: how to think, direct and judge)</span>
            {data.skills.master ? <StatusBadge status="approved">v{data.skills.master.version}{data.skills.master.outdated ? ', newer skills since' : ''}</StatusBadge> : <StatusBadge status="pending">not built</StatusBadge>}
            <span className="ml-auto flex gap-2">
              {data.skills.master && <Button size="sm" variant="outline" onClick={() => showSkill('creative-director')}><Eye />View</Button>}
              {canWork && <Button size="sm" disabled={!!busy || data.skills.categorySkills < 2} title={data.skills.categorySkills < 2 ? 'Build at least two category skills first' : ''} onClick={() => post({ action: 'build_master' })}>{busy === 'build_master' ? <Loader2 className="animate-spin" /> : <BrainCircuit />}Build</Button>}
            </span>
          </div>
          <DataTable head={['Category', 'Watched', 'Skill', 'New since build', '']}>
            {data.skills.categories.map((c: any) => (
              <tr key={c.slug}>
                <td className={TD}>{c.category}</td>
                <td className={TD_MUTED}>{c.watched} / {c.total}{c.waiting ? ` (${c.waiting} waiting)` : ''}</td>
                <td className={TD}>{c.skill ? <StatusBadge status="approved">v{c.skill.version}</StatusBadge> : <StatusBadge status="pending">not built</StatusBadge>}</td>
                <td className={TD_MUTED}>{c.skill ? c.newSinceBuild : ''}</td>
                <td className={`${TD} whitespace-nowrap text-right`}>
                  {c.skill && <Button size="sm" variant="ghost" onClick={() => showSkill(c.slug)}><Eye />View</Button>}
                  {canWork && <Button size="sm" variant="outline" disabled={!!busy || !c.watched} onClick={() => post({ action: 'build_skill', category: c.category })}>{busy === `build_skill${c.category}` ? <Loader2 className="animate-spin" /> : <BrainCircuit />}{c.skill ? 'Update' : 'Build'}</Button>}
                </td>
              </tr>
            ))}
          </DataTable>
        </CardContent>
      </Card>

      {cats.map((cat) => {
        const vs = byCat[cat];
        const done = vs.filter((v: any) => v.status === 'watched').length;
        const isOpen = open[cat] ?? false;
        return (
          <Card key={cat}>
            <CardHeader className="cursor-pointer" onClick={() => setOpen({ ...open, [cat]: !isOpen })}>
              <CardTitle className="flex items-center justify-between text-base">
                <span>{cat}</span>
                <span className="text-sm font-normal text-muted-foreground">{done} / {vs.length} watched {isOpen ? '▴' : '▾'}</span>
              </CardTitle>
            </CardHeader>
            {isOpen && (
              <CardContent>
                <DataTable head={['Video', 'Level', 'Length', 'Status', '']}>
                  {vs.map((v: any) => {
                    const st = STATUS[v.status] || STATUS.queued;
                    return (
                      <tr key={v.id}>
                        <td className={TD}>
                          <a href={v.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">{v.title || v.url}</a>
                          <div className="text-xs text-muted-foreground">{v.channel}{v.note ? ` · ${v.note}` : ''}</div>
                          {v.error && <div className="text-xs text-red-600 dark:text-red-400">{v.error}</div>}
                        </td>
                        <td className={TD_MUTED}>{v.level}</td>
                        <td className={TD_MUTED}>{hhmm(v.duration_sec)}</td>
                        <td className={TD}>
                          <StatusBadge status={st.tone}>{st.label}{v.parts_total > 1 ? ` ${v.parts_done}/${v.parts_total}` : ''}</StatusBadge>
                        </td>
                        <td className={`${TD} whitespace-nowrap text-right`}>
                          {(v.status === 'watched' || v.parts_done > 0) && <Button size="sm" variant="ghost" onClick={() => showNotes(v.id)}><Eye />Notes</Button>}
                          {canWork && (v.status === 'queued' || v.status === 'watching') && data.gemini && <Button size="sm" variant="ghost" disabled={!!busy || data.running} title="Watch this one next, starting now" onClick={() => post({ action: 'watch_now', id: v.id }, 'Watching it now. It shows in the progress bar at the top.')}><Play />Watch now</Button>}
                          {canWork && (v.status === 'failed' || v.status === 'skipped') && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => post({ action: 'retry', id: v.id }, 'Queued again.')}><RotateCw />Retry</Button>}
                          {canWork && v.status === 'queued' && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => post({ action: 'skip', id: v.id }, 'Skipped.')}><SkipForward />Skip</Button>}
                          {canWork && v.status !== 'watching' && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => window.confirm(`Remove "${v.title || v.url}" and its notes?`) && post({ action: 'remove', id: v.id }, 'Removed.')}><Trash2 /></Button>}
                        </td>
                      </tr>
                    );
                  })}
                </DataTable>
              </CardContent>
            )}
          </Card>
        );
      })}

      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{view?.title}</DialogTitle>
            {view?.meta && <div className="text-xs text-muted-foreground">{view.meta}</div>}
          </DialogHeader>
          <SafeHtml className="prose-article text-sm" html={view?.html || ''} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

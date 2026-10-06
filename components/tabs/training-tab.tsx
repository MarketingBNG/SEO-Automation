'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, History, Loader2, RotateCw, Save, Sparkles } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { renderMarkdown } from '@/components/shared/article';

const GUIDELINE_KEYS = ['max_words', 'voice_guidelines', 'byline_author', 'byline_reviewer', 'cta_text', 'cta_url'];

const TONE: Record<string, string> = {
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25',
  warn: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25',
  danger: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/25',
};

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-muted-foreground font-normal">{label}</Label>
      {children}
    </div>
  );
}

export default function TrainingTab() {
  const [settings, setSettings] = useState<any>({ max_words: '', voice_guidelines: '' });
  // Save stays off until the stored values are in the form, so it cannot overwrite them with blanks.
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [message, setMessage] = useState('');

  const [skillStatus, setSkillStatus] = useState<any>(null);
  const [skillHistory, setSkillHistory] = useState<any[]>([]);
  const [generatingSkill, setGeneratingSkill] = useState(false);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [playbook, setPlaybook] = useState('');
  const [showPlaybook, setShowPlaybook] = useState(false);
  // Manual edit of the active writing skill.
  const [editingSkill, setEditingSkill] = useState(false);
  const [skillDraft, setSkillDraft] = useState({ skill_content: '', research_summary: '' });
  const [savingSkill, setSavingSkill] = useState(false);

  const loadSettings = useCallback(async () => {
    setSettingsError(null);
    try {
      const res = await fetch('/api/settings');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setSettings(json);
      setSettingsLoaded(true);
    } catch (err: any) {
      setSettingsError(`Could not load the saved guidelines (${err.message}). Saving is off until they load.`);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const [status, history, pb] = await Promise.all([
        fetch('/api/skill/status').then((r) => r.json()),
        fetch('/api/skill').then((r) => r.json()),
        fetch('/api/skill/playbook').then((r) => r.json()),
      ]);
      setSkillStatus(status);
      setSkillHistory(Array.isArray(history) ? history : []);
      setPlaybook(pb.text || '');
    } catch (err: any) {
      setSkillError(`Could not load the writing skill: ${err.message}`);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSettings();
    load();
  }, [loadSettings, load]);

  async function saveSettings() {
    if (!settingsLoaded) return;
    setSavingSettings(true);
    setMessage('');
    try {
      const body: Record<string, any> = {};
      for (const key of GUIDELINE_KEYS) body[key] = settings[key] ?? '';
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
      // Re-read, so a field left empty shows the default it was reset to.
      const fresh = await fetch('/api/settings').then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (fresh) setSettings(fresh);
      setMessage('Guidelines saved.');
    } catch (err: any) {
      setMessage('Error: ' + err.message);
    } finally {
      setSavingSettings(false);
    }
  }

  async function saveSkill() {
    setSavingSkill(true);
    setSkillError(null);
    try {
      const res = await fetch('/api/skill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(skillDraft) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setEditingSkill(false);
      await load();
    } catch (err: any) {
      setSkillError(err.message);
    } finally {
      setSavingSkill(false);
    }
  }

  async function generateSkill() {
    setGeneratingSkill(true);
    setSkillError(null);
    try {
      const res = await fetch('/api/skill/generate', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      load();
    } catch (err: any) {
      setSkillError(err.message);
    } finally {
      setGeneratingSkill(false);
    }
  }

  const active = skillStatus?.active;

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Writing guidelines</CardTitle>
          <CardDescription>
            These rules apply to every blog the system writes. Leave the word limit, voice or call to action empty to go back to the default.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {settingsError && (
            <Alert>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>{settingsError}</span>
                <Button variant="outline" size="sm" onClick={loadSettings}>
                  <RotateCw /> Try again
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <Field label="Maximum words per blog">
            <Input
              type="text"
              value={settings.max_words || ''}
              onChange={(e) => setSettings({ ...settings, max_words: e.target.value })}
              className="max-w-[120px]"
            />
          </Field>
          <Field label="Voice / style guidelines">
            <Textarea
              rows={4}
              value={settings.voice_guidelines || ''}
              onChange={(e) => setSettings({ ...settings, voice_guidelines: e.target.value })}
            />
          </Field>
          <Field label={<>Author shown on posts (name and credential, e.g. &quot;Priya Shah, CA&quot;)</>}>
            <Input
              type="text"
              value={settings.byline_author || ''}
              placeholder="Leave empty to add it by hand on each draft"
              onChange={(e) => setSettings({ ...settings, byline_author: e.target.value })}
            />
          </Field>
          <Field
            label={
              <>&quot;Reviewed by&quot; (a CA, CPA or EA with credential, e.g. &quot;Rahul Mehta, CPA (licensed in New York)&quot;)</>
            }
          >
            <Input
              type="text"
              value={settings.byline_reviewer || ''}
              placeholder="Until this is set, each draft gets a placeholder that must be filled before publishing"
              onChange={(e) => setSettings({ ...settings, byline_reviewer: e.target.value })}
            />
            <p className="text-muted-foreground text-xs">
              The research recommends a named, credentialed reviewer on every tax post (Google rates finance content on who stands behind
              it). Use real people only.
            </p>
          </Field>
          <Field label="Call to action at the end of each post">
            <Input type="text" value={settings.cta_text || ''} onChange={(e) => setSettings({ ...settings, cta_text: e.target.value })} />
          </Field>
          <Field label="Call to action link (must start with http:// or https://)">
            <Input type="text" value={settings.cta_url || ''} onChange={(e) => setSettings({ ...settings, cta_url: e.target.value })} />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={saveSettings} disabled={savingSettings || !settingsLoaded}>
              {savingSettings ? <Loader2 className="animate-spin" /> : <Save />}
              {settingsLoaded || settingsError ? 'Save guidelines' : 'Loading…'}
            </Button>
            {message && <p className="text-muted-foreground text-sm">{message}</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Content writing skill</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="bg-muted/40 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <BookOpen className="text-muted-foreground size-4" />
                <strong className="text-sm">SEO, GEO &amp; AEO playbook</strong>
                <Badge variant="outline" className={playbook ? TONE.success : TONE.warn}>
                  {playbook ? 'applied to every write, rewrite and audit' : 'not built yet'}
                </Badge>
              </div>
              {playbook && (
                <Button variant="outline" size="sm" onClick={() => setShowPlaybook((v) => !v)}>
                  {showPlaybook ? 'Hide' : 'Read the playbook'}
                </Button>
              )}
            </div>
            <p className="text-muted-foreground mt-2 text-sm">
              The permanent foundation: researched and fact-checked rules for ranking in Google, getting cited by AI
              answer engines, winning featured snippets, and avoiding penalties.
            </p>
            {showPlaybook && (
              <div
                className="prose-article bg-background mt-3 max-h-[520px] overflow-auto rounded-md border p-4 text-sm"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(playbook.replace(/^---[\s\S]*?---\s*/, '').replace(/<!--[^>]*-->/g, '')),
                }}
              />
            )}
          </div>

          <p className="text-muted-foreground text-sm">
            On top of that foundation, this researches real high-engagement blogs across the internet (hooks,
            structure, storytelling vs. educational style) plus our own GA4 performance, and refreshes itself
            every 15 days. No approval needed, it only shapes future drafts. Every version is kept below.
          </p>

          {skillStatus && (
            <p className="text-muted-foreground text-sm">
              {active
                ? `Active version is ${skillStatus.daysSinceUpdate} day(s) old (refreshes every ${skillStatus.refreshDays} days).`
                : 'No skill generated yet.'}
              {skillStatus.needsUpdate && ' Due for a refresh.'}
            </p>
          )}

          <div>
            <Button onClick={generateSkill} disabled={generatingSkill}>
              {generatingSkill ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {generatingSkill
                ? 'Researching… (can take a few minutes)'
                : active
                ? 'Research & refresh now'
                : 'Research & build the skill'}
            </Button>
          </div>
          {skillError && <p className="text-destructive text-sm">Error: {skillError}</p>}

          {active && (
            <div className="grid gap-3">
              <div className="flex flex-wrap gap-2">
                {!editingSkill ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSkillDraft({ skill_content: active.skill_content || '', research_summary: active.research_summary || '' });
                      setEditingSkill(true);
                    }}
                  >
                    Edit skill
                  </Button>
                ) : (
                  <>
                    <Button onClick={saveSkill} disabled={savingSkill}>
                      {savingSkill ? <Loader2 className="animate-spin" /> : null}
                      Save as new version
                    </Button>
                    <Button variant="ghost" onClick={() => setEditingSkill(false)} disabled={savingSkill}>
                      Cancel
                    </Button>
                  </>
                )}
              </div>
              {editingSkill && (
                <p className="text-muted-foreground text-sm">
                  Change, remove or rewrite anything. Saving keeps the old version in the history below, and future drafts use your edited version.
                </p>
              )}
              <Field label="Current skill">
                {editingSkill ? (
                  <Textarea className="min-h-[300px] text-sm" value={skillDraft.skill_content} onChange={(e) => setSkillDraft({ ...skillDraft, skill_content: e.target.value })} />
                ) : (
                  <div className="bg-muted/40 max-h-[300px] overflow-auto rounded-md border p-3 text-sm whitespace-pre-wrap">
                    {active.skill_content}
                  </div>
                )}
              </Field>
              {(active.research_summary || editingSkill) && (
                <Field label="What changed this cycle">
                  {editingSkill ? (
                    <Textarea className="min-h-[150px] text-sm" value={skillDraft.research_summary} onChange={(e) => setSkillDraft({ ...skillDraft, research_summary: e.target.value })} />
                  ) : (
                    <div className="bg-muted/40 max-h-[150px] overflow-auto rounded-md border p-3 text-sm whitespace-pre-wrap">
                      {active.research_summary}
                    </div>
                  )}
                </Field>
              )}
              {active.sources && active.sources.length > 0 && (
                <Field label="Sources studied">
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {active.sources.map((s: any, i: number) => (
                      <li key={i}>
                        <a href={s.url} target="_blank" rel="noreferrer" className="text-primary break-all underline-offset-4 hover:underline">
                          {s.title || s.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </Field>
              )}
            </div>
          )}

          {skillHistory.length > 1 && (
            <div className="grid gap-3">
              <div>
                <Button variant="outline" onClick={() => setShowHistory((v) => !v)}>
                  <History /> {showHistory ? 'Hide' : 'Show'} version history ({skillHistory.length})
                </Button>
              </div>
              {showHistory && (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {skillHistory.map((h) => (
                        <TableRow key={h.id}>
                          <TableCell>
                            <Badge variant="outline" className={h.status === 'active' ? TONE.success : TONE.danger}>
                              {h.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{h.created_at}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

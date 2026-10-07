'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Search, Sparkles, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/shared/status-badge';
import { DataTable, NativeSelect, TD, TD_MUTED } from '@/components/shared/content-ui';

export default function KeywordsTab() {
  const [keywords, setKeywords] = useState<any[]>([]);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState<{ stage: string; percent: number } | null>(null); // { stage, percent }
  const abortRef = useRef<AbortController | null>(null);

  const [seedKeyword, setSeedKeyword] = useState('');
  const [researchType, setResearchType] = useState('similar');
  const [researchResults, setResearchResults] = useState<any[] | null>(null);
  const [loadingResearch, setLoadingResearch] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set());
  const [addingKeywords, setAddingKeywords] = useState(false);

  const load = useCallback(async () => {
    const j = await fetch('/api/keywords/list').then((r) => r.json()).catch(() => null);
    setKeywords(Array.isArray(j) ? j : []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- same effect as the old app
    load();
  }, [load]);

  async function generateNext() {
    setGenerating(true);
    setMessage('');
    setProgress({ stage: 'Starting…', percent: 2 });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: controller.signal,
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Request failed (${res.status})`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() as string;
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line);
          if (evt.stage || evt.percent != null) setProgress({ stage: evt.stage, percent: evt.percent });
          if (evt.status === 'done') {
            setMessage(`Draft ready: "${evt.result.title}". Check the Drafts tab.`);
            load();
          } else if (evt.status === 'stopped') {
            setMessage('Stopped. The keyword is back in the pending queue.');
            load();
          } else if (evt.status === 'error') {
            setMessage('Error: ' + evt.error);
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setMessage('Stopped. The keyword is back in the pending queue.');
        load();
      } else {
        // The connection dropped, but the blog keeps being written on the server; its progress
        // shows in the bar at the top of every page and the draft appears in Drafts & Review.
        setMessage('Lost the live connection, but the blog is still being written on the server. Watch the progress bar at the top; the draft will appear in Drafts & Review.');
        load();
      }
    } finally {
      setGenerating(false);
      setProgress(null);
      abortRef.current = null;
    }
  }

  async function stopGeneration() {
    // Stop the run on the server first (it no longer stops just because the page closes).
    await fetch('/api/generate/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
    abortRef.current?.abort();
  }

  async function runResearch() {
    if (!seedKeyword.trim()) return;
    setLoadingResearch(true);
    setResearchError(null);
    setResearchResults(null);
    setSelectedKeywords(new Set());
    try {
      const res = await fetch(
        `/api/seranking/research?keyword=${encodeURIComponent(seedKeyword)}&type=${researchType}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setResearchResults(json);
    } catch (err: any) {
      setResearchError(err.message);
    } finally {
      setLoadingResearch(false);
    }
  }

  function toggleSelected(kw: string) {
    setSelectedKeywords((prev) => {
      const next = new Set(prev);
      if (next.has(kw)) next.delete(kw);
      else next.add(kw);
      return next;
    });
  }

  async function addSelectedKeywords() {
    if (selectedKeywords.size === 0) return;
    setAddingKeywords(true);
    try {
      const res = await fetch('/api/keywords/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: [...selectedKeywords].map((keyword) => ({ keyword })),
          batchName: `SE Ranking: "${seedKeyword}"`,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setMessage(`${json.inserted} keyword(s) added to the pipeline.${json.rejected?.length ? ` Not added (duplicate topics): ${json.rejected.join(' ')}` : ''}`);
      setSelectedKeywords(new Set());
      load();
    } catch (err: any) {
      setResearchError(err.message);
    } finally {
      setAddingKeywords(false);
    }
  }

  const pendingCount = keywords.filter((k) => k.status === 'pending').length;

  return (
    <div className="space-y-4">

      <Card>
        <CardHeader>
          <CardTitle>Keyword research (SE Ranking)</CardTitle>
          <CardDescription>
            Enter a seed keyword to find related search terms with volume, CPC and difficulty.
            Pick the ones worth writing about and add them straight to the pipeline below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              type="text"
              placeholder="e.g. virtual cfo, us entity setup, fbar"
              value={seedKeyword}
              onChange={(e) => setSeedKeyword(e.target.value)}
              className="sm:max-w-72"
            />
            <NativeSelect value={researchType} onChange={(e) => setResearchType(e.target.value)}>
              <option value="similar">Similar keywords</option>
              <option value="related">Related keywords</option>
              <option value="questions">Questions people ask</option>
              <option value="longtail">Long-tail variations</option>
            </NativeSelect>
            <Button onClick={runResearch} disabled={loadingResearch || !seedKeyword.trim()}>
              {loadingResearch ? <Loader2 className="animate-spin" /> : <Search />}
              {loadingResearch ? 'Searching…' : 'Find keywords'}
            </Button>
          </div>
          {researchError && <p className="text-sm text-destructive">Error: {researchError}</p>}

          {researchResults && (
            <>
              <DataTable head={['', 'Keyword', 'Volume', 'Difficulty', 'CPC']}>
                {researchResults.map((r) => (
                  <tr key={r.keyword}>
                    <td className={`${TD} w-8`}>
                      <Checkbox
                        checked={selectedKeywords.has(r.keyword)}
                        onCheckedChange={() => toggleSelected(r.keyword)}
                        aria-label={`Select ${r.keyword}`}
                      />
                    </td>
                    <td className={TD}>{r.keyword}</td>
                    <td className={TD_MUTED}>{r.volume}</td>
                    <td className={TD_MUTED}>{r.difficulty}</td>
                    <td className={TD_MUTED}>${r.cpc}</td>
                  </tr>
                ))}
                {researchResults.length === 0 && (
                  <tr>
                    <td colSpan={5} className={TD_MUTED}>No results for that keyword.</td>
                  </tr>
                )}
              </DataTable>
              <Button onClick={addSelectedKeywords} disabled={selectedKeywords.size === 0 || addingKeywords}>
                {addingKeywords ? <Loader2 className="animate-spin" /> : <Plus />}
                {addingKeywords ? 'Adding…' : `Add ${selectedKeywords.size} selected to pipeline`}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              <strong className="text-lg tabular-nums">{pendingCount}</strong> keyword(s) waiting to be researched &amp; written.
            </div>
            <div className="flex gap-2">
              {generating && (
                <Button variant="destructive" onClick={stopGeneration}>
                  <Square />
                  Stop
                </Button>
              )}
              <Button onClick={generateNext} disabled={generating || pendingCount === 0}>
                {generating ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {generating ? 'Working…' : 'Generate next blog draft'}
              </Button>
            </div>
          </div>

          {generating && progress && (
            <div className="space-y-1.5">
              <Progress value={progress.percent} />
              <p className="text-sm text-muted-foreground">{progress.stage}</p>
            </div>
          )}

          {message && <p className="text-sm text-muted-foreground">{message}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All keywords</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable head={['Keyword', 'Batch', 'Status', 'Added']}>
            {keywords.map((k) => (
              <tr key={k.id}>
                <td className={TD}>{k.keyword}</td>
                <td className={TD_MUTED}>{k.batch_name}</td>
                <td className={TD}>
                  <StatusBadge status={k.status}>{k.status}</StatusBadge>
                </td>
                <td className={`${TD_MUTED} whitespace-nowrap`}>{k.created_at}</td>
              </tr>
            ))}
            {keywords.length === 0 && (
              <tr>
                <td colSpan={4} className={TD_MUTED}>No keywords yet. Add them from the strategy plan or keyword research above.</td>
              </tr>
            )}
          </DataTable>
        </CardContent>
      </Card>
    </div>
  );
}

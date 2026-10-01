'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Download, Loader2, PlugZap, X } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';

const TONE: Record<string, string> = {
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/25',
  warn: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25',
  danger: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/25',
};

export default function MeetingsTab() {
  const [ffStatus, setFfStatus] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<any[]>([]);
  const [loadingTranscripts, setLoadingTranscripts] = useState(false);

  const [insights, setInsights] = useState<any[]>([]);

  const loadInsights = useCallback(async () => {
    const j = await fetch('/api/client-insights').then((r) => r.json()).catch(() => null);
    setInsights(Array.isArray(j) ? j : []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadInsights();
  }, [loadInsights]);

  async function testFireflies() {
    setFfStatus('Testing…');
    try {
      const res = await fetch('/api/fireflies/test');
      const json = await res.json();
      setFfStatus(json.ok ? `Connected as ${json.connectedAs}` : `Failed: ${json.error}`);
    } catch (err: any) {
      setFfStatus('Failed: ' + err.message);
    }
  }

  async function loadTranscripts() {
    setLoadingTranscripts(true);
    try {
      const res = await fetch('/api/fireflies/transcripts?limit=10');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setTranscripts(json);
    } catch (err: any) {
      setFfStatus('Failed: ' + err.message);
    } finally {
      setLoadingTranscripts(false);
    }
  }

  async function importTranscript(t: any) {
    await fetch('/api/client-insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript_id: t.id,
        title: t.title,
        meeting_date: new Date(t.date).toISOString(),
        overview: t.summary?.overview || t.summary?.short_summary || '',
        action_items: t.summary?.action_items || '',
        keywords: t.summary?.keywords || [],
      }),
    });
    loadInsights();
  }

  async function decideInsight(id: any, status: string) {
    await fetch(`/api/client-insights/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    loadInsights();
  }

  async function updateInsightOverview(id: any, overview: string) {
    await fetch(`/api/client-insights/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overview }),
    });
    loadInsights();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Fireflies connection</CardTitle>
          <CardDescription>
            Pulls meeting summaries only, no raw transcript, no participant identities are
            stored. Nothing reaches the blog writer until you review and approve it below.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            <Button onClick={testFireflies}>
              <PlugZap /> Test Fireflies connection
            </Button>
            <Button variant="outline" onClick={loadTranscripts} disabled={loadingTranscripts}>
              {loadingTranscripts && <Loader2 className="animate-spin" />}
              {loadingTranscripts ? 'Loading…' : 'Load recent meetings'}
            </Button>
          </div>
          {ffStatus && <p className="text-muted-foreground text-sm">{ffStatus}</p>}

          {transcripts.map((t) => (
            <div key={t.id} className="bg-muted/30 rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <strong className="text-sm">{t.title}</strong>
                  <div className="text-muted-foreground text-xs">{new Date(t.date).toLocaleString()}</div>
                </div>
                <Button variant="outline" size="sm" onClick={() => importTranscript(t)}>
                  <Download /> Import for review
                </Button>
              </div>
              <div className="mt-2 text-[13px] whitespace-pre-wrap">{t.summary?.overview || t.summary?.short_summary}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Client insight review</CardTitle>
          <CardDescription>
            Redact any client-identifying detail from the text below before approving. Only
            approved items are used (as general themes, never as named client cases) to inform
            future blog topics and angles.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {insights.map((i) => (
            <div key={i.id} className="grid gap-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-sm">{i.title || '(untitled meeting)'}</strong>
                <Badge
                  variant="outline"
                  className={i.status === 'approved' ? TONE.success : i.status === 'rejected' ? TONE.danger : TONE.warn}
                >
                  {i.status.replace('_', ' ')}
                </Badge>
              </div>
              <Textarea
                rows={5}
                defaultValue={i.overview}
                onBlur={(e) => {
                  if (e.target.value !== i.overview) updateInsightOverview(i.id, e.target.value);
                }}
              />
              {i.status === 'pending_review' && (
                <div className="flex flex-wrap gap-2">
                  <Button className="bg-emerald-600 text-white hover:bg-emerald-600/85" onClick={() => decideInsight(i.id, 'approved')}>
                    <Check /> Approve
                  </Button>
                  <Button variant="destructive" onClick={() => decideInsight(i.id, 'rejected')}>
                    <X /> Reject
                  </Button>
                </div>
              )}
            </div>
          ))}
          {insights.length === 0 && <p className="text-muted-foreground text-sm">No meetings imported yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

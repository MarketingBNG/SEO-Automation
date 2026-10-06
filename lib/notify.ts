// Reviewer and alert notifications. Sends by email (Resend) and/or Slack when configured, and
// always records the notice in the Activity Log so nothing is lost when neither is set.
import * as activity from './activity';

export async function notify(subject: string, body: string, { action = 'notify.sent' }: { action?: string } = {}) {
  const sent: string[] = [];
  const to = (process.env.REVIEW_NOTIFY_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (process.env.RESEND_API_KEY && to.length) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.NOTIFY_FROM_EMAIL || 'SEO Dashboard <onboarding@resend.dev>', to, subject, text: body }),
    }).catch(() => null);
    if (res?.ok) sent.push('email');
  }
  if (process.env.SLACK_WEBHOOK_URL) {
    const res = await fetch(process.env.SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `*${subject}*\n${body}` }) }).catch(() => null);
    if (res?.ok) sent.push('slack');
  }
  await activity.log(action, { details: `${subject}${sent.length ? ` (sent by ${sent.join(', ')})` : ' (dashboard only: no email or Slack configured)'}` });
  return sent;
}

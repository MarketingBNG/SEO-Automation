// Reviewer and alert notifications. Sends to Slack when configured, and always records the notice
// in the Activity Log so nothing is lost when Slack is not set.
import * as activity from './activity';

export async function notify(subject: string, body: string, { action = 'notify.sent' }: { action?: string } = {}) {
  const sent: string[] = [];
  if (process.env.SLACK_WEBHOOK_URL) {
    const res = await fetch(process.env.SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `*${subject}*\n${body}` }) }).catch(() => null);
    if (res?.ok) sent.push('slack');
  }
  await activity.log(action, { details: `${subject}${sent.length ? ` (sent by ${sent.join(', ')})` : ' (dashboard only: Slack is not configured)'}` });
  return sent;
}

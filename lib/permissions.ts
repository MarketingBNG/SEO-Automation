// Who may do what. Four roles only. Pure functions (no database), so proxy.ts can check every
// request on the server before it reaches a route, and the UI can hide what a role cannot use.
//
//  admin    everything: settings, AI credits, team and roles, blocking anyone. Cannot be blocked.
//  manager  sees reports (no download), approves and edits strategy, does content work, assigns
//           manual tasks, blocks users and analysts.
//  analyst  sees and downloads all reports, does all content work, sees AI credits (read only).
//           Cannot approve strategy, change settings or manage the team.
//  user     sees the strategy, asks the assistant, and does the manual tasks assigned to them.
//  tester   for 48 hours: everything an admin can do except managing the team (roles, blocking).
//           Then the person becomes a user again, unless the admin gives the role again.
//
// A blocked person can still look at the dashboard but cannot take any action.
export const ROLES = ['admin', 'manager', 'analyst', 'user', 'tester'] as const;
export const TESTER_HOURS = 48;
export type Role = (typeof ROLES)[number];

export const OWNER_EMAIL = (process.env.ADMIN_EMAIL || 'abhuday@usaindiacfo.com').toLowerCase();
export const isRole = (r: unknown): r is Role => ROLES.includes(r as Role);

export type Action =
  | 'settings.change'
  | 'credits.view'
  | 'credits.change'
  | 'team.view'
  | 'team.roles'
  | 'reports.view'
  | 'reports.download'
  | 'strategy.approve'
  | 'strategy.edit'
  | 'content.work'
  | 'website.change'
  | 'manual.assign'
  | 'manual.do'
  | 'assistant.ask';

const CAN: Record<Role, Action[]> = {
  admin: ['settings.change', 'credits.view', 'credits.change', 'team.view', 'team.roles', 'reports.view', 'reports.download', 'strategy.approve', 'strategy.edit', 'content.work', 'website.change', 'manual.assign', 'manual.do', 'assistant.ask'],
  manager: ['credits.view', 'team.view', 'reports.view', 'strategy.approve', 'strategy.edit', 'content.work', 'website.change', 'manual.assign', 'manual.do', 'assistant.ask'],
  analyst: ['credits.view', 'reports.view', 'reports.download', 'content.work', 'website.change', 'manual.do', 'assistant.ask'],
  user: ['manual.do', 'assistant.ask'],
  tester: ['settings.change', 'credits.view', 'credits.change', 'reports.view', 'reports.download', 'strategy.approve', 'strategy.edit', 'content.work', 'website.change', 'manual.assign', 'manual.do', 'assistant.ask'],
};

export function can(role: Role | undefined | null, action: Action): boolean {
  return !!role && CAN[role]?.includes(action);
}

// Who may block whom: the admin blocks anyone else; a manager blocks users and analysts.
export function canBlock(actor: Role, target: Role, targetEmail: string): boolean {
  if (targetEmail.toLowerCase() === OWNER_EMAIL || target === 'admin') return false;
  if (actor === 'admin') return true;
  return actor === 'manager' && (target === 'user' || target === 'analyst');
  // Testers cannot block anyone; only the admin can block a tester.
}

// The permission an API request needs, from its method and path. null = anyone signed in.
export function actionFor(method: string, path: string): Action | null {
  const m = method.toUpperCase();
  const p = path.replace(/\/+$/, '');
  const write = m !== 'GET' && m !== 'HEAD';

  // Reading
  if (!write) {
    if (/^\/api\/performance\/download|^\/api\/audit\/[^/]+\/download/.test(p)) return 'reports.download';
    if (/^\/api\/(performance|ga4|gsc|seranking|clarity|blog-analytics|zoho\/leads|zoho\/pipeline|zoho\/business)/.test(p)) return 'reports.view';
    if (/^\/api\/ai-credits/.test(p)) return 'credits.view';
    if (/^\/api\/team/.test(p)) return 'team.view';
    return null;
  }

  // Writing
  if (/^\/api\/assistant\/(chat|upload)/.test(p)) return 'assistant.ask';
  if (/^\/api\/assistant\/(decide|undo)/.test(p)) return 'website.change';
  if (/^\/api\/strategy\/manual|^\/api\/strategy\/backlinks\//.test(p)) return 'manual.do';
  if (/^\/api\/strategy\/[^/]+\/approve/.test(p)) return 'strategy.approve';
  if (/^\/api\/strategy/.test(p)) return 'strategy.edit';
  if (/^\/api\/ai-credits/.test(p)) return 'credits.change';
  if (/^\/api\/team/.test(p)) return 'team.view'; // finer checks (roles, who can be blocked) in the route
  if (/^\/api\/(settings|gsc|ga4|gbp|zoho|wordpress|fireflies|bing|surfer\/test|serphouse\/test|seranking\/test|seranking\/topup)/.test(p)) return 'settings.change';
  return 'content.work';
}

export function deniedMessage(action: Action): string {
  const what: Record<Action, string> = {
    'settings.change': 'Only an admin can change settings.',
    'credits.view': 'Your role cannot see AI credits.',
    'credits.change': 'Only an admin can change AI credits.',
    'team.view': 'Only an admin or a manager can manage the team.',
    'team.roles': 'Only an admin can change roles.',
    'reports.view': 'Your role cannot see reports.',
    'reports.download': 'Your role cannot download reports.',
    'strategy.approve': 'Only an admin or a manager can approve the strategy.',
    'strategy.edit': 'Your role cannot change the strategy.',
    'content.work': 'Your role cannot do this. Ask a manager or analyst.',
    'website.change': 'Your role cannot approve changes to the website.',
    'manual.assign': 'Only an admin or a manager can assign tasks.',
    'manual.do': 'Your role cannot do this task.',
    'assistant.ask': 'Your role cannot use the assistant.',
  };
  return what[action];
}

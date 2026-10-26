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
  | 'assistant.ask'
  | 'blog.publish_now';

const CAN: Record<Role, Action[]> = {
  admin: ['settings.change', 'credits.view', 'credits.change', 'team.view', 'team.roles', 'reports.view', 'reports.download', 'strategy.approve', 'strategy.edit', 'content.work', 'website.change', 'manual.assign', 'manual.do', 'assistant.ask', 'blog.publish_now'],
  manager: ['credits.view', 'team.view', 'reports.view', 'strategy.approve', 'strategy.edit', 'content.work', 'website.change', 'manual.assign', 'manual.do', 'assistant.ask', 'blog.publish_now'],
  analyst: ['credits.view', 'reports.view', 'reports.download', 'content.work', 'website.change', 'manual.do', 'assistant.ask'],
  user: ['manual.do', 'assistant.ask'],
  tester: ['settings.change', 'credits.view', 'credits.change', 'reports.view', 'reports.download', 'strategy.approve', 'strategy.edit', 'content.work', 'website.change', 'manual.assign', 'manual.do', 'assistant.ask', 'blog.publish_now'],
};

export const ACTIONS = Object.keys({
  'settings.change': 1, 'credits.view': 1, 'credits.change': 1, 'team.view': 1, 'team.roles': 1, 'reports.view': 1, 'reports.download': 1, 'strategy.approve': 1,
  'strategy.edit': 1, 'content.work': 1, 'website.change': 1, 'manual.assign': 1, 'manual.do': 1, 'assistant.ask': 1, 'blog.publish_now': 1,
} satisfies Record<Action, 1>) as Action[];

// What each action means, for the access screens.
export const ACTION_LABEL: Record<Action, string> = {
  'settings.change': 'Change settings and connections',
  'credits.view': 'See AI credits',
  'credits.change': 'Change AI credits (balance, pause)',
  'team.view': 'Open Team & Roles, block users and analysts',
  'team.roles': 'Change roles and give access',
  'reports.view': 'See reports',
  'reports.download': 'Download reports',
  'strategy.approve': 'Approve the monthly strategy',
  'strategy.edit': 'Edit the strategy',
  'content.work': 'Write, edit, audit and refresh blogs',
  'website.change': 'Approve changes to the website',
  'manual.assign': 'Assign manual tasks',
  'manual.do': 'Do tasks; approve, pause and reschedule calendar blogs',
  'assistant.ask': 'Use the assistant',
  'blog.publish_now': 'Publish a blog now (skip its slot)',
};

// The dashboard's pages (sidebar keys), for page access.
export const PAGES: { key: string; label: string }[] = [
  { key: 'home', label: 'Home' }, { key: 'assistant', label: 'Assistant' },
  { key: 'strategy', label: 'Monthly Strategy' }, { key: 'calendar', label: 'Blog Calendar' }, { key: 'topics', label: 'Topics & News' },
  { key: 'keywords', label: 'Write a blog' }, { key: 'drafts', label: 'Drafts & Review' }, { key: 'audit', label: 'Check a blog' }, { key: 'renewal', label: 'Refresh a live blog' }, { key: 'training', label: 'Writing rules' },
  { key: 'sitecontent', label: 'Website Content' },
  { key: 'learning', label: 'Learn from YouTube' }, { key: 'brand', label: 'Brand Palette' },
  { key: 'overall', label: 'Overall Report' }, { key: 'seo', label: 'SEO' }, { key: 'aeo', label: 'AEO' }, { key: 'geo', label: 'GEO' }, { key: 'meetings', label: 'Meeting insights' },
  { key: 'associates', label: 'Associate Training' }, { key: 'team', label: 'Team & Roles' }, { key: 'activity', label: 'Activity Log' },
  { key: 'guide', label: 'Guide & map' },
  { key: 'agents', label: 'Agents & memory' },
  { key: 'settings', label: 'Settings' },
];
const ALL_PAGES = PAGES.map((p) => p.key);
const HIDDEN_PAGES: Record<Role, string[]> = {
  admin: [],
  manager: ['settings'],
  analyst: ['team', 'settings', 'agents'],
  tester: ['team', 'agents'],
  user: ['sitecontent', 'learning', 'brand', 'agents', 'keywords', 'topics', 'drafts', 'audit', 'renewal', 'overall', 'seo', 'aeo', 'geo', 'training', 'meetings', 'activity', 'team', 'settings'],
};

// What a person can see and do: their role's access (the admin can change it per role), plus extra
// access given to them alone, for good or until a time. The admin always has everything.
export type Access = { actions: Action[]; pages: string[] };
export type Grant = { key: string; exp: number | null }; // key: an action, or 'page:<key>'; exp: ms
export type RoleAccess = Partial<Record<Role, Access>>;

export function defaultAccess(role: Role): Access {
  return { actions: [...CAN[role]], pages: ALL_PAGES.filter((p) => !HIDDEN_PAGES[role].includes(p)) };
}

export function roleAccess(role: Role, custom?: RoleAccess | null): Access {
  if (role === 'admin') return defaultAccess('admin');
  const c = custom?.[role];
  if (!c) return defaultAccess(role);
  return { actions: (c.actions || []).filter((a) => ACTIONS.includes(a)), pages: (c.pages || []).filter((p) => ALL_PAGES.includes(p)) };
}

const live = (g: Grant, now: number) => g.exp === null || g.exp > now;
export function allows(access: Access | null | undefined, grants: Grant[] | null | undefined, key: string, now = Date.now()): boolean {
  const own = key.startsWith('page:') ? access?.pages.includes(key.slice(5)) : access?.actions.includes(key as Action);
  return !!own || !!grants?.some((g) => g.key === key && live(g, now));
}

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
    if (/^\/api\/(ai-credits|agent)/.test(p)) return 'credits.view';
    if (/^\/api\/team/.test(p)) return 'team.view';
    return null;
  }

  // Writing
  if (/^\/api\/seranking\/topup/.test(p)) return 'settings.change';
  if (/^\/api\/assistant\/(chat|upload)/.test(p)) return 'assistant.ask';
  if (/^\/api\/assistant\/(decide|undo)/.test(p)) return 'website.change';
  if (/^\/api\/associate-training/.test(p)) return 'manual.do'; // admin-only actions are checked in the route
  if (/^\/api\/strategy\/manual|^\/api\/strategy\/backlinks\//.test(p)) return 'manual.do';
  // Everyone on the team (managers and associates too) can approve, reject, pause and reschedule calendar blogs.
  if (/^\/api\/strategy\/schedule\/[^/]+$/.test(p)) return 'manual.do';
  if (/^\/api\/strategy\/[^/]+\/approve/.test(p)) return 'strategy.approve';
  if (/^\/api\/strategy/.test(p)) return 'strategy.edit';
  if (/^\/api\/(ai-credits|agent)/.test(p)) return 'credits.change';
  if (/^\/api\/team\/access/.test(p)) return 'team.roles';
  if (/^\/api\/team/.test(p)) return 'team.view'; // finer checks (roles, who can be blocked) in the route
  if (/^\/api\/(settings|gsc|ga4|gbp|zoho|wordpress|fireflies|bing|surfer\/test|serphouse\/test|seranking\/test)/.test(p)) return 'settings.change';
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
    'blog.publish_now': 'Only an admin or a manager can publish a blog straight away.',
  };
  return what[action];
}

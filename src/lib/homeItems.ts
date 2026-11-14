import type { Project } from './projects';

export interface ConversationSummary {
  id: string;
  title: string;
  projectId: string | null;
  updatedAt: number;
}

export type HomeItem =
  | { type: 'project'; key: string; project: Project; count: number }
  | { type: 'conversation'; key: string; conversation: ConversationSummary; indented: boolean }
  | { type: 'header'; key: string; title: string }
  | { type: 'more'; key: string; projectId: string; hidden: number };

/**
 * Flattens projects and chats into one list: each project followed by its most
 * recent conversations, then conversations that belong to no project.
 */
export function buildHomeItems(
  projects: Project[],
  conversations: ConversationSummary[],
  opts: { perProject?: number; expanded?: ReadonlySet<string>; query?: string } = {},
): HomeItem[] {
  const perProject = opts.perProject ?? 3;
  const q = opts.query?.trim().toLowerCase() ?? '';
  const match = (c: ConversationSummary) => !q || c.title.toLowerCase().includes(q);

  const byProject = new Map<string | null, ConversationSummary[]>();
  for (const c of [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (!match(c)) continue;
    const list = byProject.get(c.projectId) ?? [];
    list.push(c);
    byProject.set(c.projectId, list);
  }

  const lastActivity = (p: Project) => byProject.get(p.id)?.[0]?.updatedAt ?? p.createdAt;
  const items: HomeItem[] = [];

  const visibleProjects = [...projects]
    .filter((p) => !q || p.name.toLowerCase().includes(q) || byProject.has(p.id))
    .sort((a, b) => lastActivity(b) - lastActivity(a));

  for (const project of visibleProjects) {
    const convs = byProject.get(project.id) ?? [];
    items.push({ type: 'project', key: `p:${project.id}`, project, count: convs.length });
    const expanded = opts.expanded?.has(project.id) || !!q;
    const shown = expanded ? convs : convs.slice(0, perProject);
    for (const c of shown) items.push({ type: 'conversation', key: `c:${c.id}`, conversation: c, indented: true });
    if (!expanded && convs.length > perProject) {
      items.push({ type: 'more', key: `m:${project.id}`, projectId: project.id, hidden: convs.length - perProject });
    }
  }

  const loose = byProject.get(null) ?? [];
  if (loose.length) {
    items.push({ type: 'header', key: 'h:chats', title: 'Chats' });
    for (const c of loose) items.push({ type: 'conversation', key: `c:${c.id}`, conversation: c, indented: false });
  }
  return items;
}

/** "3d", "4h", "now": compact relative time like the Antigravity conversation list. */
export function relativeTime(then: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - then) / 1000));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return `${Math.floor(d / 30)}mo`;
}

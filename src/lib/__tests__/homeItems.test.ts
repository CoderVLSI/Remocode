import { buildHomeItems, relativeTime } from '../homeItems';
import type { ConversationSummary } from '../homeItems';
import type { Project } from '../projects';

const project = (id: string, createdAt = 0): Project => ({ id, name: `Project ${id}`, instructions: '', resources: [], createdAt });
const conv = (id: string, projectId: string | null, updatedAt: number, title = `Chat ${id}`): ConversationSummary => ({
  id,
  title,
  projectId,
  updatedAt,
});

describe('buildHomeItems', () => {
  it('orders projects by latest activity and nests their newest conversations', () => {
    const items = buildHomeItems(
      [project('a', 1), project('b', 2)],
      [conv('1', 'a', 100), conv('2', 'a', 300), conv('3', 'b', 200)],
    );
    expect(items.map((i) => i.key)).toEqual(['p:a', 'c:2', 'c:1', 'p:b', 'c:3']);
  });

  it('collapses long project lists with a "more" row and expands on demand', () => {
    const convs = [1, 2, 3, 4, 5].map((n) => conv(String(n), 'a', n));
    const collapsed = buildHomeItems([project('a')], convs, { perProject: 2 });
    expect(collapsed.map((i) => i.key)).toEqual(['p:a', 'c:5', 'c:4', 'm:a']);
    expect(collapsed[3]).toMatchObject({ type: 'more', hidden: 3 });
    const expanded = buildHomeItems([project('a')], convs, { perProject: 2, expanded: new Set(['a']) });
    expect(expanded).toHaveLength(6);
  });

  it('lists unassigned chats under a Chats header', () => {
    const items = buildHomeItems([], [conv('x', null, 5), conv('y', null, 9)]);
    expect(items.map((i) => i.key)).toEqual(['h:chats', 'c:y', 'c:x']);
    expect(items[1]).toMatchObject({ indented: false });
  });

  it('filters by query across titles and project names', () => {
    const items = buildHomeItems(
      [project('a'), project('b')],
      [conv('1', 'a', 1, 'Fix login bug'), conv('2', null, 2, 'Dinner ideas')],
      { query: 'login' },
    );
    expect(items.map((i) => i.key)).toEqual(['p:a', 'c:1']);
    const byName = buildHomeItems([project('b')], [], { query: 'project b' });
    expect(byName.map((i) => i.key)).toEqual(['p:b']);
  });

  it('keeps empty projects visible', () => {
    expect(buildHomeItems([project('a')], []).map((i) => i.key)).toEqual(['p:a']);
  });
});

describe('relativeTime', () => {
  const now = 1_000_000_000_000;
  it.each([
    [30_000, 'now'],
    [5 * 60_000, '5m'],
    [4 * 3_600_000, '4h'],
    [3 * 86_400_000, '3d'],
    [65 * 86_400_000, '2mo'],
  ])('%d ms ago -> %s', (delta, expected) => {
    expect(relativeTime(now - delta, now)).toBe(expected);
  });
});

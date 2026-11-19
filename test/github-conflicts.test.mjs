import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.mjs';
import { toItems, listPullRequests } from '../lib/github.mjs';

const cfg = { ...config, repo: 'dennis-brutski/demo' };
const node = (number, o = {}) => ({ number, title: `#${number}`, body: '', author: { login: 'dennis-brutski' }, ...o });

test('toItems gives a pull request its mergeable state', () => {
  const items = toItems({ data: { repository: { issues: { nodes: [node(1)] },
    pullRequests: { nodes: [node(2, { mergeable: 'CONFLICTING' }), node(3)] } } } });
  assert.deepEqual(items.map((i) => [i.number, i.mergeable]), [[1, null], [2, 'CONFLICTING'], [3, null]]);
});
test('listPullRequests pages all open pull requests with their mergeable state', async () => {
  const pages = {
    '': { nodes: [node(4, { mergeable: 'MERGEABLE' })], pageInfo: { hasNextPage: true, endCursor: 'p1' } },
    p1: { nodes: [node(5, { mergeable: 'CONFLICTING' })], pageInfo: { hasNextPage: false, endCursor: 'p2' } },
  };
  const asked = [];
  const items = await listPullRequests(cfg, async (query, after) => { asked.push([query, after]); return pages[after ?? '']; });
  assert.deepEqual(items.map((i) => [i.kind, i.number, i.mergeable]), [['pr', 4, 'MERGEABLE'], ['pr', 5, 'CONFLICTING']]);
  assert.deepEqual(asked, [['conflicts', null], ['conflicts', 'p1']]);
});

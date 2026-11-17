import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../config.mjs';
import { listCandidates } from '../lib/github.mjs';

const cfg = { ...config, repo: 'dennis-brutski/demo' };
const node = (number) => ({ number, title: `#${number}`, body: '', author: { login: 'dennis-brutski' } });

test('listCandidates merges two pages of issues and of pull requests in order', async () => {
  const pages = {
    issues: { '': { nodes: [node(1), node(2)], pageInfo: { hasNextPage: true, endCursor: 'i1' } },
      i1: { nodes: [node(3)], pageInfo: { hasNextPage: false, endCursor: 'i2' } } },
    pullRequests: { '': { nodes: [node(4)], pageInfo: { hasNextPage: true, endCursor: 'p1' } },
      p1: { nodes: [node(5), node(6)], pageInfo: { hasNextPage: false, endCursor: 'p2' } } },
  };
  const asked = [];
  const fetchPage = async (kind, after) => { asked.push([kind, after]); return pages[kind][after ?? '']; };
  const items = await listCandidates(cfg, fetchPage);
  assert.deepEqual(items.map((i) => [i.kind, i.number]), [['issue', 1], ['issue', 2], ['issue', 3], ['pr', 4], ['pr', 5], ['pr', 6]]);
  assert.deepEqual(asked, [['issues', null], ['issues', 'i1'], ['pullRequests', null], ['pullRequests', 'p1']]);
});

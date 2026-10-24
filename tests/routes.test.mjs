import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveScreen } from '../dist/routes.mjs';

test('a fresh visit opens the welcome screen and direct app links stay reachable', () => {
  assert.equal(resolveScreen(''), 'welcome');
  assert.equal(resolveScreen('#top'), 'welcome');
  for (const page of ['workbench', 'experiments', 'dataset', 'method']) {
    assert.equal(resolveScreen(`#${page}`), page);
  }
  assert.equal(resolveScreen('#lab'), 'workbench');
  assert.equal(resolveScreen('#main'), 'workbench');
  assert.equal(resolveScreen('#study'), 'method');
  assert.equal(resolveScreen('#missing'), 'welcome');
});

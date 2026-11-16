import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { targetForSharedImport, isForbiddenSharedDependency } from '../dependency-targets.mjs';
const root = path.join(path.sep,'tmp','atlas');
const source = path.join(root,'frontend','src','shared','api','supabase-client.ts');
const resolve = spec => targetForSharedImport(source,spec,root);

test('blocks aliased import from feature in shared', () => {
  assert.equal(isForbiddenSharedDependency(resolve('@/features/auth/model/auth-storage')),true);
});
test('blocks aliased import from app in shared', () => {
  assert.equal(isForbiddenSharedDependency(resolve('@/app/App')),true);
});
test('blocks relative import from feature in shared', () => {
  assert.equal(isForbiddenSharedDependency(resolve('../../features/auth/model/auth-storage')),true);
});
test('allows local shared and external packages', () => {
  assert.equal(isForbiddenSharedDependency(resolve('@/shared/lib/auth-storage')),false);
  assert.equal(resolve('@yds-atlas/shared'),null);
  assert.equal(isForbiddenSharedDependency(resolve('./api-client')),false);
});
test('does not check feature-to-feature import in shared-only gate', () => {
  assert.equal(targetForSharedImport(path.join(root,'frontend/src/features/auth/model/use-auth.ts'),'@/features/account/foo',root),null);
});

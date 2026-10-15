import { test } from '@playwright/test';
import { mutateState, readState, visit } from './state.mjs';

test('independent-noise', () => visit('independent-noise'));

test('independent-polluter', () => {
  mutateState(state => { state.dirty = true; });
});

test('independent-target', () => {
  if (!readState().seed) throw new Error('INDEPENDENT_SEED_MISSING');
});

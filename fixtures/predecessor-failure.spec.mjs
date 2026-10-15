import { test } from '@playwright/test';
import { mutateState, readState } from './state.mjs';

test('predecessor-failing-polluter', () => {
  mutateState(state => { state.dirty = true; });
  throw new Error('PREDECESSOR_FAILED');
});

test('predecessor-target', () => {
  if (readState().dirty) throw new Error('PREDECESSOR_TARGET_POLLUTION');
});

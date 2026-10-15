import { test } from '@playwright/test';
import { mutateState, readState } from './state.mjs';

test('cleaner-polluter', () => {
  mutateState(state => { state.dirty = true; });
});

test('cleaner-clean', () => {
  mutateState(state => { state.dirty = false; });
});

test('cleaner-target', () => {
  if (readState().dirty) throw new Error('CLEANER_POLLUTION');
});

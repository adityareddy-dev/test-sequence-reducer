import { test } from '@playwright/test';
import { mutateState, readState, visit } from './state.mjs';

test('single-noise-a', () => visit('single-noise-a'));

test('single-polluter', () => {
  mutateState(state => { state.dirty = true; });
});

test('single-noise-b', () => visit('single-noise-b'));
test('single-noise-c', () => visit('single-noise-c'));

test('single-target', () => {
  if (readState().dirty) throw new Error('SINGLE_POLLUTION');
});

import { test } from '@playwright/test';
import { mutateState, readState, visit } from './state.mjs';

test('pair-noise-a', () => visit('pair-noise-a'));

test('pair-prepare', () => {
  mutateState(state => { state.prepared = true; });
});

test('pair-noise-b', () => visit('pair-noise-b'));

test('pair-polluter', () => {
  mutateState(state => { state.dirty = state.prepared; });
});

test('pair-noise-c', () => visit('pair-noise-c'));

test('pair-target', () => {
  if (readState().dirty) throw new Error('PAIR_POLLUTION');
});

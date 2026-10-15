import { test } from '@playwright/test';
import { mutateState, readState } from './state.mjs';

test('cleaner-order-old-polluter', () => {
  mutateState(state => { state.dirty = true; state.source = 'old'; });
});

test('cleaner-order-clean', () => {
  mutateState(state => { state.dirty = false; state.source = null; });
});

test('cleaner-order-final-polluter', () => {
  mutateState(state => { state.dirty = true; state.source = 'final'; });
});

test('cleaner-order-target', () => {
  const state = readState();
  if (state.dirty) {
    throw new Error(state.source === 'final' ? 'CLEANER_ORDER_POLLUTION' : 'OTHER_ORDER_FAILURE');
  }
});

import { test } from '@playwright/test';
import { mutateState, readState, visit } from './state.mjs';

test('fingerprint-noise', () => visit('fingerprint-noise'));

test('fingerprint-prepare', () => {
  mutateState(state => { state.prepared = true; });
});

test('fingerprint-polluter', () => {
  mutateState(state => { state.dirty = true; });
});

test('fingerprint-target', () => {
  const state = readState();
  if (state.dirty) {
    throw new Error(state.prepared ? 'EXPECTED_TARGET_FAILURE' : 'OTHER_TARGET_FAILURE');
  }
});

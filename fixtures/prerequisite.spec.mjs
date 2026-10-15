import { test } from '@playwright/test';
import { mutateState, readState } from './state.mjs';

test('prerequisite-prepare', () => {
  mutateState(state => { state.readyForTarget = true; });
});

test('prerequisite-target', () => {
  if (!readState().readyForTarget) throw new Error('TARGET_PREREQUISITE_MISSING');
});

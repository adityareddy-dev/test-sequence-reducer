import { test } from '@playwright/test';
import { mutateState, readState, visit } from './state.mjs';

test('setter-dependent-noise', () => visit('setter-dependent-noise'));

test('setter-dependent-prepare', () => {
  mutateState(state => { state.prepared = true; });
});

test('setter-dependent-polluter', () => {
  if (!readState().prepared) throw new Error('SETTER_PREREQUISITE_MISSING');
  mutateState(state => { state.dirty = true; });
});

test('setter-dependent-target', () => {
  if (readState().dirty) throw new Error('SETTER_DEPENDENT_POLLUTION');
});

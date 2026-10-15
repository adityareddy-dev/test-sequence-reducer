import { test } from '@playwright/test';
import { readState, visit } from './state.mjs';

test('alternating-noise', () => visit('alternating-noise'));

test('alternating-target', () => {
  if (readState().attempt % 2 === 0) throw new Error('ALTERNATING_FAILURE');
});

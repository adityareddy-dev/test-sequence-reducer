import { readFileSync, writeFileSync } from 'node:fs';

function statePath() {
  const value = process.env.SEQUENCE_REDUCER_STATE;
  if (!value) throw new Error('SEQUENCE_REDUCER_STATE is required, run the reset command first');
  return value;
}

export function readState() {
  return JSON.parse(readFileSync(statePath(), 'utf8'));
}

export function mutateState(change) {
  const state = readState();
  change(state);
  writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`);
}

export function visit(title) {
  mutateState(state => state.visits.push(title));
}

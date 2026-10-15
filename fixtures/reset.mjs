import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const statePath = process.env.SEQUENCE_REDUCER_STATE;
if (!statePath) throw new Error('SEQUENCE_REDUCER_STATE is required');
const attempt = Number(process.env.SEQUENCE_REDUCER_ATTEMPT ?? '1');
if (!Number.isSafeInteger(attempt) || attempt < 1) {
  throw new Error('SEQUENCE_REDUCER_ATTEMPT must be a positive integer');
}
const seed = 'synthetic-clean-v1';
const resetId = `${seed}:${attempt}:${randomUUID()}`;
mkdirSync(dirname(statePath), { recursive: true });
writeFileSync(statePath, `${JSON.stringify({
  seed,
  resetId,
  attempt,
  dirty: false,
  prepared: false,
  readyForTarget: false,
  visits: [],
}, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ resetId, seed, ready: true, attempt })}\n`);

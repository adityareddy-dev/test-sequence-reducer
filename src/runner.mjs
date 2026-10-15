import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from './oracle.mjs';

export async function execute(command, { cwd, env, timeoutMs }) {
  const start = performance.now();
  return await new Promise(resolve => {
    let stdout = '', stderr = '', timedOut = false, settled = false;
    const child = spawn(command[0], command.slice(1), { cwd, env, shell: false, windowsHide: true,
      detached: process.platform !== 'win32' });
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
        killer.on('error', () => child.kill());
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }
    }, timeoutMs);
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    const finish = (exitCode, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ command, exitCode, timedOut, stdout, stderr, error: error?.message,
        seconds: (performance.now() - start) / 1000 });
    };
    child.on('error', error => finish(null, error));
    child.on('close', code => finish(code));
  });
}

export function makeProbe(config, attempts) {
  const resetIds = new Set();
  let expectedSeed = config.seed;
  let expectedFingerprint;
  return async prefix => {
    if (attempts.length >= config.maxAttempts) throw new Error('attempt-budget-exhausted');
    const sequence = [...prefix, config.target];
    const index = attempts.length + 1;
    const dir = path.join(config.output, String(index).padStart(4, '0'));
    await mkdir(dir);
    const env = { ...process.env, ...config.env, NO_COLOR: '1',
      SEQUENCE_REDUCER_ATTEMPT: String(index),
      SEQUENCE_REDUCER_STATE: path.join(config.output, 'state.json'),
      SEQUENCE_REDUCER_REPORT: path.join(dir, 'playwright.json') };
    delete env.FORCE_COLOR;
    const reset = await execute(config.reset, { cwd: config.cwd, env, timeoutMs: config.timeoutMs });
    await writeFile(path.join(dir, 'reset.json'), JSON.stringify(reset, null, 2));
    let receipt;
    try { receipt = JSON.parse(reset.stdout); } catch { /* Invalid receipts stop this attempt. */ }
    const attempt = { index, sequence, resetId: receipt?.resetId, seed: receipt?.seed,
      status: 'inconclusive', reason: 'reset-failed', seconds: reset.seconds };
    attempts.push(attempt);
    if (reset.exitCode === 0 && !reset.timedOut && typeof receipt?.resetId === 'string' &&
        receipt.resetId.trim() && typeof receipt.seed === 'string' && receipt.seed.trim() &&
        receipt.ready === true && !resetIds.has(receipt.resetId) &&
        (expectedSeed === undefined || receipt.seed === expectedSeed)) {
      expectedSeed ??= receipt.seed;
      resetIds.add(receipt.resetId);
      env.SEQUENCE_REDUCER_RESET_ID = receipt.resetId;
      const escaped = sequence.map(title => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const command = [...config.command, '--workers=1', '--retries=0', '--repeat-each=1',
        '--max-failures=0', '--no-deps', '--grep', `(?:^|\\s)(?:${escaped.join('|')})$`,
        '--reporter', fileURLToPath(new URL('./reporter.mjs', import.meta.url))];
      const run = await execute(command, { cwd: config.cwd, env, timeoutMs: config.timeoutMs });
      await writeFile(path.join(dir, 'process.json'), JSON.stringify(run, null, 2));
      let report;
      try { report = JSON.parse(await readFile(env.SEQUENCE_REDUCER_REPORT, 'utf8')); } catch { /* Missing report is inconclusive. */ }
      const verdict = classify({ report, sequence, target: config.target,
        failure: config.failure, expectedFingerprint, exitCode: run.exitCode, timedOut: run.timedOut });
      if (verdict.status === 'reproduces' && !expectedFingerprint) expectedFingerprint = verdict.fingerprint;
      Object.assign(attempt, verdict, { seconds: reset.seconds + run.seconds });
    }
    await writeFile(path.join(dir, 'attempt.json'), JSON.stringify(attempt, null, 2));
    return attempt.status;
  };
}

export async function prepareConfig(input) {
  for (const key of ['command', 'reset']) {
    if (!Array.isArray(input[key]) || !input[key].length || input[key].some(v => typeof v !== 'string' || !v)) {
      throw new Error(`${key} must be a nonempty argv array`);
    }
  }
  if (!Array.isArray(input.tests) || input.tests.some(v => typeof v !== 'string' || !v) ||
      typeof input.target !== 'string' || !input.target || typeof input.failure !== 'string' || !input.failure ||
      new Set([...input.tests, input.target]).size !== input.tests.length + 1) {
    throw new Error('provide unique flat test titles, a target and a nonempty literal failure matcher');
  }
  const config = { timeoutMs: 60000, maxAttempts: 500, ...input };
  for (const key of ['timeoutMs', 'maxAttempts']) {
    if (!Number.isSafeInteger(config[key]) || config[key] <= 0) throw new Error(`${key} must be positive`);
  }
  config.cwd = path.resolve(config.cwd ?? '.');
  config.output = path.resolve(config.cwd, config.output ?? `artifacts/run-${randomUUID()}`);
  // Refuse reuse, so a prior report or reset state cannot become evidence.
  await mkdir(path.dirname(config.output), { recursive: true });
  await mkdir(config.output, { recursive: false });
  return config;
}

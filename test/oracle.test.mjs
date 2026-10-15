import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { classify } from '../src/oracle.mjs';
import { makeProbe } from '../src/runner.mjs';

const marker = 'state must be clean';
const sequence = ['neutral', 'target'];

function reportFor(titles = sequence, targetStatus = 'failed') {
  const tests = titles.map((title, index) => ({
    title, id: `id-${title}`, location: { file: '/fixture.spec.mjs', line: index + 1, column: 1 },
  }));
  return {
    config: { workers: 1, projects: [{ name: 'synthetic', retries: 0, repeatEach: 1,
      fullyParallel: false, dependencies: [] }] },
    listed: structuredClone(tests),
    begun: [...titles],
    ended: tests.map((entry, index) => ({ ...entry, expectedStatus: 'passed', retry: 0,
      status: index === titles.length - 1 ? targetStatus : 'passed',
      errors: index === titles.length - 1 && targetStatus === 'failed'
        ? [{ message: marker, location: { file: '/fixture.spec.mjs', line: 20, column: 3 } }] : [],
    })),
    errors: [],
    status: targetStatus === 'failed' ? 'failed' : 'passed',
  };
}

function verdict(report = reportFor(), options = {}) {
  return classify({ report, sequence, target: 'target', failure: marker,
    exitCode: 1, timedOut: false, ...options });
}

test('only a successful target execution is a pass', () => {
  assert.equal(verdict(reportFor(sequence, 'passed'), { exitCode: 0 }).status, 'passes');
  assert.equal(verdict(reportFor(sequence, 'passed'), { exitCode: 1 }).status, 'inconclusive');
});

test('the same target failure has a stable fingerprint', () => {
  const first = verdict();
  assert.equal(first.status, 'reproduces');
  assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(verdict(reportFor(), { expectedFingerprint: first.fingerprint }).status, 'reproduces');
  const ansi = reportFor();
  ansi.ended.at(-1).errors[0].message = `\u001b[31m${marker}\u001b[0m`;
  assert.equal(verdict(ansi, { expectedFingerprint: first.fingerprint }).status, 'reproduces');
});

test('a changed failure is not accepted merely because the matcher remains present', () => {
  const expectedFingerprint = verdict().fingerprint;
  const changed = reportFor();
  changed.ended.at(-1).errors[0].message = `${marker}: a different assertion`;
  assert.equal(verdict(changed, { expectedFingerprint }).reason, 'different-fingerprint');
  changed.ended.at(-1).errors[0].message = 'unrelated timeout';
  assert.equal(verdict(changed, { expectedFingerprint }).reason, 'different-failure-matcher');
});

test('a changed failure location does not reuse the original fingerprint', () => {
  const changed = reportFor();
  changed.ended.at(-1).errors[0].location.line += 1;
  assert.equal(verdict(changed, { expectedFingerprint: verdict().fingerprint }).reason, 'different-fingerprint');
});

const invalidCases = [
  ['missing report', () => null],
  ['global runner error', r => { r.errors.push({ message: 'setup failed' }); return r; }],
  ['failed predecessor', r => { r.ended[0].status = 'failed'; return r; }],
  ['skipped predecessor', r => { r.ended[0].status = 'skipped'; return r; }],
  ['skipped target', r => { r.ended.at(-1).status = 'skipped'; return r; }],
  ['expected target failure', r => { r.ended.at(-1).expectedStatus = 'failed'; return r; }],
  ['target retry', r => { r.ended.at(-1).retry = 1; return r; }],
  ['extra selected test', r => { r.listed.push({ ...r.listed[0], title: 'extra' }); return r; }],
  ['duplicate target', r => { r.begun.push('target'); r.ended.push(r.ended.at(-1)); return r; }],
  ['missing target execution', r => { r.begun.pop(); r.ended.pop(); return r; }],
  ['reversed actual order', r => { r.begun.reverse(); return r; }],
  ['duplicate listed identity', r => { r.listed[1].id = r.listed[0].id; return r; }],
  ['multiple spec files', r => { r.listed[1].location.file = '/other.spec.mjs'; return r; }],
  ['different completed target identity', r => { r.ended.at(-1).id = 'other-target'; return r; }],
  ['different completed target location', r => { r.ended.at(-1).location.file = '/other.spec.mjs'; return r; }],
  ['multiple projects', r => { r.config.projects.push({ ...r.config.projects[0] }); return r; }],
  ['parallel workers', r => { r.config.workers = 2; return r; }],
  ['project retries', r => { r.config.projects[0].retries = 1; return r; }],
  ['repeat each', r => { r.config.projects[0].repeatEach = 2; return r; }],
  ['parallel project', r => { r.config.projects[0].fullyParallel = true; return r; }],
  ['project dependency', r => { r.config.projects[0].dependencies = ['setup']; return r; }],
];

for (const [name, mutate] of invalidCases) {
  test(`${name} is inconclusive`, () => {
    assert.equal(verdict(mutate(reportFor())).status, 'inconclusive');
  });
}

test('process failure cannot substitute for the target failure', () => {
  for (const exitCode of [0, 2, null]) assert.equal(verdict(reportFor(), { exitCode }).status, 'inconclusive');
  assert.equal(verdict(reportFor(), { timedOut: true }).status, 'inconclusive');
});

const malformedCases = [
  ['null listed entry', r => { r.listed[0] = null; }],
  ['absent listed location', r => { delete r.listed[0].location; }],
  ['absent project list', r => { delete r.config.projects; }],
  ['nonarray project list', r => { r.config.projects = {}; }],
  ['null project', r => { r.config.projects[0] = null; }],
  ['absent project dependencies', r => { delete r.config.projects[0].dependencies; }],
  ['null ended entry', r => { r.ended[0] = null; }],
  ['absent target errors', r => { delete r.ended.at(-1).errors; }],
  ['nonarray target errors', r => { r.ended.at(-1).errors = {}; }],
  ['null target error', r => { r.ended.at(-1).errors = [null]; }],
  ['nonstring target message', r => { r.ended.at(-1).errors[0].message = 42; }],
  ['malformed global errors', r => { r.errors = {}; }],
];

for (const [name, mutate] of malformedCases) {
  test(`${name} is inconclusive without throwing`, () => {
    const report = reportFor();
    mutate(report);
    let result;
    assert.doesNotThrow(() => { result = verdict(report); });
    assert.equal(result.status, 'inconclusive');
  });
}

test('a single selected target still needs an explicit identity and location', () => {
  for (const missing of ['id', 'location']) {
    const report = reportFor(['target']);
    delete report.listed[0][missing];
    let result;
    assert.doesNotThrow(() => { result = verdict(report, { sequence: ['target'] }); });
    assert.equal(result.status, 'inconclusive');
  }
});

async function harness(t, resetBody, runBody) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sequence-oracle-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = path.join(dir, 'attempts');
  await mkdir(output);
  const reset = path.join(dir, 'reset.cjs');
  const run = path.join(dir, 'run.cjs');
  const sentinel = path.join(dir, 'runner-started');
  await writeFile(reset, resetBody);
  await writeFile(run, `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'started');\n${runBody}`);
  const attempts = [];
  const config = { output, cwd: dir, target: 'target', failure: marker,
    command: [process.execPath, run], reset: [process.execPath, reset],
    timeoutMs: 5000, maxAttempts: 10, env: {} };
  return { probe: makeProbe(config, attempts), attempts, output, sentinel };
}

const goodReset = `console.log(JSON.stringify({resetId:'run-'+process.env.SEQUENCE_REDUCER_ATTEMPT,seed:'clean-v1',ready:true}));`;
const passingRun = `require('node:fs').writeFileSync(process.env.SEQUENCE_REDUCER_REPORT, ${JSON.stringify(JSON.stringify(reportFor(['target'], 'passed')))});`;

for (const [name, receipt] of [
  ['missing reset identity', { seed: 'clean-v1', ready: true }],
  ['blank reset identity', { resetId: ' ', seed: 'clean-v1', ready: true }],
  ['missing seed identity', { resetId: 'run-1', ready: true }],
  ['blank seed identity', { resetId: 'run-1', seed: '', ready: true }],
  ['server not ready', { resetId: 'run-1', seed: 'clean-v1', ready: false }],
]) {
  test(`${name} stops the candidate before execution`, async t => {
    const h = await harness(t, `console.log(${JSON.stringify(JSON.stringify(receipt))});`, passingRun);
    assert.equal(await h.probe([]), 'inconclusive');
    await assert.rejects(stat(h.sentinel), { code: 'ENOENT' });
    assert.equal(h.attempts[0].reason, 'reset-failed');
  });
}

test('a nonzero reset exit stops the candidate despite a plausible receipt', async t => {
  const h = await harness(t, `${goodReset}\nprocess.exitCode=1;`, passingRun);
  assert.equal(await h.probe([]), 'inconclusive');
  await assert.rejects(stat(h.sentinel), { code: 'ENOENT' });
});

test('malformed reset output stops the candidate', async t => {
  const h = await harness(t, `console.log('not JSON');`, passingRun);
  assert.equal(await h.probe([]), 'inconclusive');
  await assert.rejects(stat(h.sentinel), { code: 'ENOENT' });
});

test('a reset timeout stops the candidate and is retained', async t => {
  const h = await harness(t, `setInterval(() => {}, 1000);`, passingRun);
  const config = { output: h.output, cwd: path.dirname(h.output), target: 'target', failure: marker,
    command: [process.execPath, path.join(path.dirname(h.output), 'run.cjs')],
    reset: [process.execPath, path.join(path.dirname(h.output), 'reset.cjs')],
    timeoutMs: 100, maxAttempts: 10, env: {} };
  const probe = makeProbe(config, h.attempts);
  assert.equal(await probe([]), 'inconclusive');
  await assert.rejects(stat(h.sentinel), { code: 'ENOENT' });
  const receipt = JSON.parse(await readFile(path.join(h.output, '0001', 'reset.json'), 'utf8'));
  assert.equal(receipt.timedOut, true);
});

test('a missing test report is inconclusive and retained', async t => {
  const h = await harness(t, goodReset, '');
  assert.equal(await h.probe([]), 'inconclusive');
  assert.equal(h.attempts[0].reason, 'runner-error');
  const attempt = JSON.parse(await readFile(path.join(h.output, '0001', 'attempt.json'), 'utf8'));
  assert.equal(attempt.status, 'inconclusive');
});

test('a malformed test report does not crash a probe', async t => {
  const h = await harness(t, goodReset,
    `require('node:fs').writeFileSync(process.env.SEQUENCE_REDUCER_REPORT, '{bad');`);
  assert.equal(await h.probe([]), 'inconclusive');
});

test('duplicate reset identity is not reused', async t => {
  const h = await harness(t, `console.log(JSON.stringify({resetId:'same',seed:'clean-v1',ready:true}));`, passingRun);
  assert.equal(await h.probe([]), 'passes');
  assert.equal(await h.probe([]), 'inconclusive');
  assert.equal(h.attempts[1].reason, 'reset-failed');
});

test('changing the declared seed identity does not establish a common baseline', async t => {
  const h = await harness(t,
    `console.log(JSON.stringify({resetId:'run-'+process.env.SEQUENCE_REDUCER_ATTEMPT,seed:'seed-'+process.env.SEQUENCE_REDUCER_ATTEMPT,ready:true}));`, passingRun);
  assert.equal(await h.probe([]), 'passes');
  assert.equal(await h.probe([]), 'inconclusive');
});

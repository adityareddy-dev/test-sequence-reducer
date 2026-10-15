import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cases } from '../fixtures/cases.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const startedAt = new Date().toISOString();
const started = performance.now();
const output = path.resolve(root, process.argv[2] ?? `artifacts/acceptance/run-${startedAt.replace(/[:.]/g, '-')}`);
await mkdir(output, { recursive: true });
const results = [];

function execute(command) {
  return new Promise(resolve => {
    let stdout = '', stderr = '';
    const child = spawn(command[0], command.slice(1), { cwd: root, shell: false, windowsHide: true });
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => resolve({ command, exitCode: null, stdout, stderr, error: error.message }));
    child.on('close', (exitCode, signal) => resolve({ command, exitCode, signal, stdout, stderr }));
  });
}

function verifyReport(fixture, report, execution) {
  assert.equal(report.status, fixture.expectedStatus, 'overall classification');
  assert.equal(report.target, fixture.target, 'target identity');
  assert.equal(execution.exitCode, fixture.expectedStatus === 'reduced' ? 0 : 2, 'CLI exit code');
  assert.ok(Number.isFinite(report.seconds) && report.seconds > 0, 'measured runtime');
  assert.ok(Array.isArray(report.attempts) && report.attempts.length >= 3, 'repeated probes');
  assert.equal(new Set(report.attempts.map(attempt => attempt.resetId)).size, report.attempts.length, 'fresh reset identities');
  for (const [index, attempt] of report.attempts.entries()) {
    assert.equal(attempt.index, index + 1, 'probe number');
    assert.equal(attempt.sequence.at(-1), fixture.target, 'target last');
    const predecessors = attempt.sequence.slice(0, -1);
    assert.deepEqual(fixture.tests.filter(title => predecessors.includes(title)), predecessors, 'original order preserved');
  }
  if (fixture.expectedStatus === 'reduced') {
    assert.deepEqual(report.witness, fixture.expectedWitness, 'known ordered witness');
    assert.equal(report.deletionMinimal, fixture.expectedDeletionMinimal ?? true, 'observed deletion-minimality');
    assert.deepEqual(report.confirmation, { witness: 5, alone: 5 }, 'final confirmation counts');
    for (const attempt of report.attempts.slice(-10, -5)) {
      assert.deepEqual(attempt.sequence, [...fixture.expectedWitness, fixture.target], 'confirmed witness sequence');
      assert.equal(attempt.status, 'reproduces', 'confirmed witness failure');
    }
    for (const attempt of report.attempts.slice(-5)) {
      assert.deepEqual(attempt.sequence, [fixture.target], 'confirmed target-alone sequence');
      assert.equal(attempt.status, 'passes', 'confirmed target-alone pass');
    }
    if (report.deletionMinimal) {
      for (const removed of report.witness) {
        const candidate = report.witness.filter(title => title !== removed);
        assert.ok(report.reduction.attempts.some(attempt => attempt.phase === 'single-removal' &&
          JSON.stringify(attempt.sequence) === JSON.stringify(candidate) && attempt.outcome === 'passes'),
        `single-removal evidence for ${removed}`);
      }
    }
  } else {
    assert.deepEqual(report.witness, [], 'controls produce no claimed witness');
    assert.equal(report.deletionMinimal, false, 'controls produce no minimality claim');
  }
  if (fixture.id === 'alternating') {
    assert.deepEqual(report.attempts.slice(0, 3).map(attempt => attempt.status), ['passes', 'reproduces', 'passes']);
  }
  if (fixture.id === 'predecessor-failure') {
    assert.ok(report.attempts.some(attempt => attempt.reason === 'predecessor-failed'), 'predecessor failure retained');
  }
  if (fixture.id === 'fingerprint') {
    assert.ok(report.attempts.some(attempt => attempt.reason === 'different-failure-matcher'), 'different error rejected');
  }
  if (fixture.id === 'setter-dependent') {
    assert.ok(report.attempts.some(attempt => attempt.reason === 'predecessor-failed'), 'missing setup invalidates predecessor');
  }
}

for (const fixture of cases) {
  const caseStarted = performance.now();
  const caseOutput = path.join(output, fixture.id);
  await mkdir(caseOutput);
  const configPath = path.join(caseOutput, 'config.json');
  const config = {
    cwd: root,
    command: [process.execPath, path.join(root, 'node_modules/playwright/cli.js'), 'test',
      '--config=playwright.config.mjs', `fixtures/${fixture.id}.spec.mjs`],
    reset: [process.execPath, path.join(root, 'fixtures/reset.mjs')],
    tests: fixture.tests,
    target: fixture.target,
    failure: fixture.failure,
    output: path.join(caseOutput, 'result'),
    timeoutMs: 30_000,
    maxAttempts: 300,
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const execution = await execute([process.execPath, path.join(root, 'src/cli.mjs'), configPath]);
  await writeFile(path.join(caseOutput, 'execution.json'), `${JSON.stringify(execution, null, 2)}\n`);
  let report, assertionFailure;
  try {
    report = JSON.parse(await readFile(path.join(config.output, 'report.json'), 'utf8'));
    verifyReport(fixture, report, execution);
    for (const attempt of report.attempts) {
      const reset = JSON.parse(await readFile(path.join(config.output, String(attempt.index).padStart(4, '0'), 'reset.json'), 'utf8'));
      const receipt = JSON.parse(reset.stdout);
      assert.equal(reset.exitCode, 0, 'reset exit');
      assert.equal(receipt.ready, true, 'reset readiness');
      assert.equal(receipt.seed, 'synthetic-clean-v1', 'named seed');
      assert.equal(receipt.resetId, attempt.resetId, 'reset receipt identity');
      assert.equal(receipt.attempt, attempt.index, 'reset invocation index');
    }
  } catch (error) {
    assertionFailure = error.stack;
  }
  const result = {
    id: fixture.id,
    passed: !assertionFailure,
    expectedStatus: fixture.expectedStatus,
    status: report?.status,
    expectedWitness: fixture.expectedWitness,
    witness: report?.witness,
    deletionMinimal: report?.deletionMinimal,
    probes: report?.attempts?.length,
    seconds: report?.seconds,
    wallSeconds: (performance.now() - caseStarted) / 1000,
    output: config.output,
    assertionFailure,
  };
  results.push(result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const negativeControls = results.filter(result => result.expectedStatus !== 'reduced');
const summary = {
  scope: `${cases.length} authored browserless synthetic fixtures, no real-app validation or accuracy estimate`,
  startedAt,
  node: process.version,
  platform: process.platform,
  playwright: JSON.parse(await readFile(path.join(root, 'node_modules/@playwright/test/package.json'), 'utf8')).version,
  passed: results.every(result => result.passed),
  casesPassed: results.filter(result => result.passed).length,
  casesTotal: results.length,
  knownWitnessCases: results.length - negativeControls.length,
  negativeControls: negativeControls.length,
  falsePositives: negativeControls.filter(result => result.status === 'reduced').length,
  seconds: (performance.now() - started) / 1000,
  cases: results,
};
await writeFile(path.join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ passed: summary.passed, casesPassed: summary.casesPassed,
  casesTotal: summary.casesTotal, falsePositives: summary.falsePositives, seconds: summary.seconds,
  summary: path.join(output, 'summary.json') })}\n`);
process.exitCode = summary.passed ? 0 : 1;

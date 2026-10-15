import { createHash } from 'node:crypto';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clean = value => value.replace(/\u001b\[[0-9;]*m/g, '');

export function classify({ report, sequence, target, failure, expectedFingerprint, exitCode, timedOut }) {
  const invalid = reason => ({ status: 'inconclusive', reason });
  if (timedOut || !report || !Array.isArray(report.errors) || report.errors.length) return invalid('runner-error');
  if (!Array.isArray(report.listed) || !Array.isArray(report.begun) || !Array.isArray(report.ended)) {
    return invalid('invalid-report');
  }
  const identity = t => t && typeof t.title === 'string' && typeof t.id === 'string' && t.id &&
    t.location && typeof t.location.file === 'string' && Number.isInteger(t.location.line) &&
    Number.isInteger(t.location.column);
  if (!report.listed.every(identity) || !report.ended.every(identity)) return invalid('invalid-test-identity');
  if (!equal(report.listed.map(t => t.title), sequence) || !equal(report.begun, sequence) ||
      !equal(report.ended.map(t => t.title), sequence)) return invalid('execution-order-or-selection');
  if (new Set(report.listed.map(t => t.id)).size !== sequence.length ||
      new Set(report.listed.map(t => t.location.file)).size !== 1) return invalid('unsupported-test-identity');
  if (!equal(report.listed.map(t => [t.id, t.location]), report.ended.map(t => [t.id, t.location]))) {
    return invalid('changed-test-identity');
  }
  const config = report.config;
  if (config?.workers !== 1 || !Array.isArray(config.projects) || config.projects.length !== 1 ||
      config.projects.some(p => !p || p.retries !== 0 || p.repeatEach !== 1 || p.fullyParallel ||
        !Array.isArray(p.dependencies) || p.dependencies.length)) {
    return invalid('unsupported-runner-config');
  }
  const results = report.ended;
  if (results.some(t => t.retry !== 0 || t.expectedStatus !== 'passed')) return invalid('retry-or-expected-failure');
  if (results.slice(0, -1).some(t => t.status !== 'passed')) return invalid('predecessor-failed');
  const last = results.at(-1);
  if (last?.title !== target) return invalid('target-missing');
  if (!Array.isArray(last.errors) || last.errors.some(e => !e || typeof e.message !== 'string')) {
    return invalid('invalid-errors');
  }
  if (last.status === 'passed' && exitCode === 0 && report.status === 'passed') {
    return { status: 'passes', reason: 'target-passed' };
  }
  if (last.status !== 'failed' || exitCode !== 1 || report.status !== 'failed') return invalid('unexpected-target-result');
  const messages = last.errors.map(e => clean(e.message));
  if (!messages.some(message => message.includes(failure))) return invalid('different-failure-matcher');
  const fingerprint = createHash('sha256').update(JSON.stringify({
    id: last.id, location: last.location, status: last.status,
    errors: last.errors.map((e, i) => ({ message: messages[i], location: e.location })),
  })).digest('hex');
  if (expectedFingerprint && expectedFingerprint !== fingerprint) return invalid('different-fingerprint');
  return { status: 'reproduces', fingerprint, reason: 'same-target-failure' };
}

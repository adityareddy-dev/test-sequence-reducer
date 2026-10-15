#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { reduceSequence } from './reduce.mjs';
import { makeProbe, prepareConfig } from './runner.mjs';

const started = performance.now();
let config;
const attempts = [];
let report;
try {
  if (process.argv.length !== 3) throw new Error('usage: node src/cli.mjs CONFIG.json');
  config = await prepareConfig(JSON.parse(await readFile(process.argv[2], 'utf8')));
  const probe = makeProbe(config, attempts);
  const repeat = async (prefix, expected, count) => {
    const statuses = [];
    for (let i = 0; i < count; i++) statuses.push(await probe(prefix));
    return statuses.every(s => s === expected);
  };
  report = { status: 'inconclusive', target: config.target, witness: [], deletionMinimal: false,
    attempts, config, confirmation: {} };
  const alone = await repeat([], 'passes', 3);
  if (!alone) {
    report.status = attempts.every(a => a.status === 'reproduces') ? 'no-contrast' : 'inconclusive';
    report.reason = 'target-did-not-pass-alone-3-of-3';
  } else if (!(await repeat(config.tests, 'reproduces', 3))) {
    const full = attempts.slice(-3);
    report.status = full.every(a => a.status === 'passes') ? 'no-contrast' : 'inconclusive';
    report.reason = 'original-prefix-did-not-reproduce-3-of-3';
  } else {
    const reduced = await reduceSequence({ prefix: config.tests, probe, repetitions: 3,
      maxProbes: config.maxAttempts - attempts.length });
    report.reduction = reduced;
    report.witness = reduced.sequence;
    if (reduced.outcome === 'reproduces' &&
        await repeat(reduced.sequence, 'reproduces', 5) && await repeat([], 'passes', 5)) {
      report.status = 'reduced';
      report.deletionMinimal = reduced.deletionMinimal;
      report.confirmation = { witness: 5, alone: 5 };
      report.reason = reduced.deletionMinimal ? 'verified-ordered-witness' : 'verified-witness-minimality-unresolved';
    } else report.reason = 'final-confirmation-failed';
  }
} catch (error) {
  report = { ...report, status: 'error', reason: error.message, attempts };
}
report.seconds = (performance.now() - started) / 1000;
if (config) await writeFile(path.join(config.output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, reason: report.reason, witness: report.witness,
  deletionMinimal: report.deletionMinimal, attempts: attempts.length, seconds: report.seconds,
  output: config?.output }));
process.exitCode = report.status === 'reduced' ? 0 : report.status === 'error' ? 1 : 2;

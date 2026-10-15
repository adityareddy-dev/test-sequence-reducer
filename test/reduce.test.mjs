import assert from 'node:assert/strict';
import test from 'node:test';
import { reduceSequence } from '../src/reduce.mjs';

test('finds a polluter and preserves caller input and relative order', async () => {
  const prefix = ['unrelated-a', 'polluter', 'unrelated-b', 'unrelated-c'];
  const original = [...prefix];
  const result = await reduceSequence({
    prefix,
    probe: async sequence => {
      const reproduces = sequence.includes('polluter');
      sequence.reverse();
      return reproduces ? 'reproduces' : 'passes';
    },
  });
  assert.deepEqual(prefix, original);
  assert.deepEqual(result.sequence, ['polluter']);
  assert.equal(result.outcome, 'reproduces');
  assert.equal(result.deletionMinimal, true);
  assert.deepEqual(result.unresolved, []);
  for (const attempt of result.attempts) {
    assert.deepEqual([...attempt.indices].sort((a, b) => a - b), attempt.indices);
    assert.equal(attempt.observations.length, 3);
  }
});

test('retains two predecessors that must interact in order', async () => {
  const result = await reduceSequence({
    prefix: ['noise-a', 'set-a', 'noise-b', 'set-b', 'noise-c'],
    probe: async sequence => sequence.includes('set-a') && sequence.indexOf('set-a') < sequence.indexOf('set-b')
      ? 'reproduces' : 'passes',
  });
  assert.deepEqual(result.sequence, ['set-a', 'set-b']);
  assert.equal(result.deletionMinimal, true);
});

test('handles a cleaner between polluters without assuming monotonicity', async () => {
  const result = await reduceSequence({
    prefix: ['noise', 'polluter-a', 'cleaner', 'polluter-b', 'tail'],
    probe: async sequence => {
      let dirty = false;
      for (const item of sequence) {
        if (item.startsWith('polluter')) dirty = true;
        if (item === 'cleaner') dirty = false;
      }
      return dirty ? 'reproduces' : 'passes';
    },
  });
  assert.equal(result.sequence.length, 1);
  assert.match(result.sequence[0], /^polluter/);
  assert.equal(result.deletionMinimal, true);
});

test('single-removal minimality does not promise the shortest nonmonotonic witness', async () => {
  const result = await reduceSequence({
    prefix: ['a', 'b', 'c', 'd'],
    probe: async sequence => sequence.join('') === 'abcd' || sequence.join('') === 'ac'
      ? 'reproduces' : 'passes',
  });
  assert.deepEqual(result.sequence, ['a', 'b', 'c', 'd']);
  assert.equal(result.deletionMinimal, true);
  const removals = result.attempts.filter(attempt => attempt.phase === 'single-removal');
  assert.equal(removals.length, 4);
  assert.ok(removals.every(attempt => attempt.outcome === 'passes'));
});

test('does not treat a missing prerequisite as a passing removal', async () => {
  const result = await reduceSequence({
    prefix: ['noise', 'setup', 'dependent-polluter'],
    probe: async sequence => {
      if (sequence.includes('dependent-polluter') && !sequence.includes('setup')) return 'inconclusive';
      return sequence.includes('dependent-polluter') ? 'reproduces' : 'passes';
    },
  });
  assert.deepEqual(result.sequence, ['setup', 'dependent-polluter']);
  assert.equal(result.outcome, 'reproduces');
  assert.equal(result.deletionMinimal, false);
  assert.deepEqual(result.unresolved, [{ removedIndex: 1, sequence: ['dependent-polluter'], reason: 'inconclusive' }]);
});

test('rejects an unstable initial sequence', async () => {
  let calls = 0;
  const result = await reduceSequence({
    prefix: ['polluter'],
    probe: async () => ++calls % 2 ? 'reproduces' : 'passes',
  });
  assert.equal(result.outcome, 'inconclusive');
  assert.equal(result.deletionMinimal, false);
  assert.equal(result.reason, 'initial-sequence-inconclusive');
  assert.equal(result.probes, 3);
});

test('detects an outcome changing across separate attempts', async () => {
  const counts = new Map();
  const result = await reduceSequence({
    prefix: ['polluter'],
    repetitions: 1,
    probe: async sequence => {
      const key = sequence.join(',');
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (sequence.length === 0) return 'passes';
      return counts.get(key) === 1 ? 'reproduces' : 'passes';
    },
  });
  assert.equal(result.outcome, 'inconclusive');
  assert.equal(result.deletionMinimal, false);
  assert.equal(result.reason, 'witness-inconclusive');
  assert.deepEqual(result.attempts.at(-1).observedOutcomes, ['reproduces', 'passes']);
});

test('treats throws and invalid outcomes as inconclusive', async () => {
  for (const probe of [async () => { throw new Error('reset failed'); }, async () => 'failed']) {
    const result = await reduceSequence({ prefix: ['polluter'], probe });
    assert.equal(result.outcome, 'inconclusive');
    assert.equal(result.deletionMinimal, false);
    assert.equal(result.attempts[0].errors.length, 3);
  }
});

test('keeps duplicate entries as distinct original positions', async () => {
  const result = await reduceSequence({
    prefix: ['polluter', 'noise', 'polluter'],
    probe: async sequence => sequence.filter(item => item === 'polluter').length === 2 ? 'reproduces' : 'passes',
  });
  assert.deepEqual(result.sequence, ['polluter', 'polluter']);
  assert.deepEqual(result.indices, [0, 2]);
  assert.equal(result.deletionMinimal, true);
});

test('does not claim minimality after exhausting a probe budget', async () => {
  const result = await reduceSequence({
    prefix: ['a', 'b', 'c'],
    maxProbes: 4,
    probe: async () => 'reproduces',
  });
  assert.equal(result.probes, 4);
  assert.equal(result.exhausted, true);
  assert.equal(result.outcome, 'inconclusive');
  assert.equal(result.deletionMinimal, false);
  assert.equal(result.reason, 'probe-budget-exhausted');
  assert.ok(result.unresolved.length > 0);
});

test('can reduce to empty and rejects an initially passing sequence', async () => {
  const empty = await reduceSequence({ prefix: ['noise'], probe: async () => 'reproduces' });
  assert.deepEqual(empty.sequence, []);
  assert.equal(empty.deletionMinimal, true);
  const passing = await reduceSequence({ prefix: ['noise'], probe: async () => 'passes' });
  assert.equal(passing.outcome, 'passes');
  assert.equal(passing.deletionMinimal, false);
});

test('validates caller options', async () => {
  await assert.rejects(reduceSequence({}), /prefix/);
  await assert.rejects(reduceSequence({ prefix: [] }), /probe/);
  await assert.rejects(reduceSequence({ prefix: [], probe() {}, repetitions: 0 }), /repetitions/);
  await assert.rejects(reduceSequence({ prefix: [], probe() {}, maxProbes: 0 }), /maxProbes/);
});

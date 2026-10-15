const OUTCOMES = new Set(['reproduces', 'passes', 'inconclusive']);

/**
 * Remove complete predecessors without changing their relative order.
 * The caller owns resets, target selection, and failure fingerprint matching.
 * Each probe receives a new array, but its entries are not cloned.
 * deletionMinimal describes observed single removals, not a global minimum.
 */
export async function reduceSequence({
  prefix,
  probe,
  repetitions = 3,
  maxProbes = 1000,
} = {}) {
  if (!Array.isArray(prefix)) throw new TypeError('prefix must be an array');
  if (typeof probe !== 'function') throw new TypeError('probe must be a function');
  if (!Number.isSafeInteger(repetitions) || repetitions < 1) {
    throw new RangeError('repetitions must be a positive safe integer');
  }
  if (maxProbes !== Infinity && (!Number.isSafeInteger(maxProbes) || maxProbes < 1)) {
    throw new RangeError('maxProbes must be a positive safe integer or Infinity');
  }

  const original = [...prefix];
  const attempts = [];
  const history = new Map();
  let current = original.map((_, index) => index);
  let probes = 0;
  let exhausted = false;
  let unresolved = [];

  const sequenceFor = indices => indices.map(index => original[index]);

  async function evaluate(indices, phase) {
    const observations = [];
    const errors = [];
    const key = JSON.stringify(indices);
    const seen = history.get(key) ?? new Set();

    for (let run = 0; run < repetitions; run += 1) {
      if (probes >= maxProbes) {
        exhausted = true;
        break;
      }
      probes += 1;
      let outcome;
      try {
        outcome = await probe(sequenceFor(indices));
        if (!OUTCOMES.has(outcome)) {
          errors.push({ name: 'InvalidOutcome', message: 'probe must return reproduces, passes, or inconclusive' });
          outcome = 'inconclusive';
        }
      } catch (error) {
        errors.push({ name: error?.name ?? 'Error', message: String(error?.message ?? error) });
        outcome = 'inconclusive';
      }
      observations.push(outcome);
      seen.add(outcome);
    }
    history.set(key, seen);

    const complete = observations.length === repetitions;
    const outcome = complete && seen.size === 1 && !seen.has('inconclusive')
      ? observations[0]
      : 'inconclusive';
    const attempt = {
      phase,
      indices: [...indices],
      sequence: sequenceFor(indices),
      outcome,
      observations,
      observedOutcomes: [...seen],
      complete,
      errors,
    };
    attempts.push(attempt);
    return attempt;
  }

  function result(outcome, deletionMinimal, reason) {
    return {
      sequence: sequenceFor(current),
      indices: [...current],
      outcome,
      deletionMinimal,
      unresolved,
      probes,
      attempts,
      exhausted,
      reason,
    };
  }

  const initial = await evaluate(current, 'initial');
  if (initial.outcome !== 'reproduces') {
    return result(initial.outcome, false, exhausted
      ? 'probe-budget-exhausted'
      : `initial-sequence-${initial.outcome}`);
  }

  // Chunk complements keep pairs and dependencies together when possible.
  let granularity = 2;
  while (current.length >= 2 && !exhausted) {
    let reduced = false;
    const chunks = Math.min(granularity, current.length);
    for (let chunk = 0; chunk < chunks; chunk += 1) {
      const start = Math.floor(chunk * current.length / chunks);
      const end = Math.floor((chunk + 1) * current.length / chunks);
      const candidate = [...current.slice(0, start), ...current.slice(end)];
      const attempt = await evaluate(candidate, 'chunk-complement');
      if (attempt.outcome === 'reproduces') {
        current = candidate;
        granularity = Math.max(2, chunks - 1);
        reduced = true;
        break;
      }
      if (exhausted) break;
    }
    if (exhausted) break;
    if (reduced) continue;
    if (chunks === current.length) break;
    granularity = Math.min(current.length, chunks * 2);
  }

  // A deletion can change whether an earlier deletion is safe.
  let position = 0;
  while (position < current.length) {
    const removedIndex = current[position];
    const candidate = current.filter((_, index) => index !== position);
    if (exhausted || probes >= maxProbes) {
      exhausted = true;
      unresolved.push({ removedIndex, sequence: sequenceFor(candidate), reason: 'probe-budget-exhausted' });
      position += 1;
      continue;
    }
    const attempt = await evaluate(candidate, 'single-removal');
    if (attempt.outcome === 'reproduces') {
      current = candidate;
      position = 0;
      unresolved = [];
      continue;
    }
    if (attempt.outcome === 'inconclusive') {
      unresolved.push({
        removedIndex,
        sequence: sequenceFor(candidate),
        reason: exhausted ? 'probe-budget-exhausted' : 'inconclusive',
      });
    }
    position += 1;
  }

  const confirmation = await evaluate(current, 'confirmation');
  if (confirmation.outcome !== 'reproduces') {
    return result('inconclusive', false, exhausted ? 'probe-budget-exhausted' : 'witness-inconclusive');
  }
  return result('reproduces', unresolved.length === 0,
    unresolved.length === 0 ? 'deletion-minimal' : 'single-removal-inconclusive');
}

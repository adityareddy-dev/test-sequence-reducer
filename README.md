# test-sequence-reducer

A Playwright test passes alone and fails after other tests. This tool removes chunks of earlier tests, keeps their order, and saves an ordered witness, removing earlier tests when possible while preserving the target's original error.

This is a feasibility spike. The included fixtures use Playwright Test and shared JSON file state, they do not launch a browser. No real application or independent developer's failing suite has been tested. There is no accuracy estimate or adoption claim.

## Run the synthetic checks

Requires Node 22 or later and npm. Playwright Test is pinned to 1.64.1.

```sh
npm ci --ignore-scripts
npm test
npm run test:synthetic
```

The last command runs the authored fixtures and writes `artifacts/acceptance/run-*/summary.json`. It measures wall time, checks known witnesses, and counts claimed witnesses among the declared negative controls. Those counts describe these examples only. Browser downloads are unnecessary for these fixtures. One local Windows run completed all 10 declared expectations in 275.65 seconds, finding the five known witnesses and claiming none among the five negative controls. Two witnesses left deletion-minimality unresolved. The [saved run summary](docs/synthetic-results.json) includes per-case probe counts and time. This is a finite synthetic observation, not a general accuracy result.

## Try one case

Save this as `example.json` in the repository root, then run `node src/cli.mjs example.json`:

```json
{
  "command": ["node", "node_modules/playwright/cli.js", "test", "--config=playwright.config.mjs", "fixtures/single.spec.mjs"],
  "reset": ["node", "fixtures/reset.mjs"],
  "tests": ["single-noise-a", "single-polluter", "single-noise-b", "single-noise-c"],
  "target": "single-target",
  "failure": "SINGLE_POLLUTION",
  "output": "artifacts/example"
}
```

The output directory must be new. `cwd` defaults to the current directory. Commands are argv arrays executed without a shell. Use `node` and script paths rather than Windows `.cmd` wrappers. Configurations and test code must be trusted, both can execute local commands.

For a different suite, provide the original ordered predecessor titles, a target title, and a literal substring specific to the failure. This adapter currently supports unique flat titles from one spec file in one project. It selects a subsequence using escaped `--grep`, then rejects any mismatch between requested and observed test selection or execution order. It does not rearrange tests or use the newer `--test-list` API.

## Reset and failure contract

Before every probe the reset command must restore the declared external state and readiness, then write exactly one JSON object to stdout:

```json
{"resetId":"unique-per-invocation","seed":"clean-state-v1","ready":true}
```

The runner requires a successful reset exit, unique reset IDs and one unchanged seed identity. An optional config `seed` pins the expected identity. It cannot independently prove that a reset restored an application. The caller must implement and verify that contract, including server, database and browser/session state when relevant.

Reset and test commands receive `SEQUENCE_REDUCER_STATE`, `SEQUENCE_REDUCER_ATTEMPT` and `SEQUENCE_REDUCER_REPORT`. Tests also receive `SEQUENCE_REDUCER_RESET_ID` after reset. The bundled reset uses only the state-file path, no real service. `timeoutMs` defaults to 60000 per process, `maxAttempts` to 500 for the full run.

The target must pass alone 3/3 times, then fail after the original prefix 3/3 times. Every predecessor must pass. The reporter checks order, identities, retries, skips, global errors and exit status. The failure fingerprint includes the target identity, source location and error messages, stripping ANSI color only. A different assertion or setup failure stays inconclusive even if it contains the failure substring.

Reduction uses ordered chunk deletion followed by individual removals. Each candidate gets three fresh probes. A retained witness must then fail 5/5 times and the target alone must pass 5/5 times. Mixed observations remain inconclusive. Reset receipts, exact commands, process output, reporter errors and every verdict are kept under the output directory.

`report.json` contains `status`, `witness` (predecessors only), `deletionMinimal`, attempts and elapsed seconds. Exit 0 means a confirmed witness, exit 2 means no stable contrast or an inconclusive run, exit 1 means a configuration or execution error. `deletionMinimal` is true only when every single removal was observed to pass. A prerequisite failure or different target error makes that claim unresolved. It never means the witness is globally shortest or uniquely causal.

To repeat a witness, copy the config, replace `tests` with the report's `witness` and choose a new output directory. The same reset and contrast checks run again. Keep output local until reviewed, test stdout and errors may contain private application data.

## Limits

The spike does not support multi-file scheduling, repeated titles, multiple projects, parallel races, automatic database resets, fixture rewriting or arbitrary test dependencies. It rejects unsupported observed execution, though it cannot infer all hidden suite behavior. Running separate commands restarts the Playwright workers, so worker-local state is recreated for each candidate, while external state must be reset explicitly. There is no browser isolation or application reset integration beyond what the supplied tests and reset command implement.

The algorithm is established delta debugging, this project is an experiment in a small Playwright adapter. The initial motivation is the manual reduction workflow documented by [Flakiness.io](https://github.com/flakiness/playwright#debugging-test-failures). Playwright documents [custom reporters](https://playwright.dev/docs/test-reporters), [CLI selection](https://playwright.dev/docs/test-cli) and [serial execution limits](https://playwright.dev/docs/test-parallel). Independent real-app reproduction and usefulness remain unproven.

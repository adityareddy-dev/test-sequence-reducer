import { writeFileSync } from 'node:fs';

export default class SequenceReporter {
  data = { listed: [], begun: [], ended: [], errors: [] };
  onBegin(config, suite) {
    this.data.config = {
      workers: config.workers,
      projects: config.projects.map(p => ({ name: p.name, retries: p.retries,
        repeatEach: p.repeatEach, dependencies: p.dependencies, fullyParallel: p.fullyParallel })),
    };
    this.data.listed = suite.allTests().map(test => ({
      title: test.title, id: test.id, location: test.location,
    }));
  }
  onTestBegin(test) { this.data.begun.push(test.title); }
  onTestEnd(test, result) {
    this.data.ended.push({ title: test.title, id: test.id, location: test.location,
      expectedStatus: test.expectedStatus, status: result.status, retry: result.retry,
      errors: result.errors.map(error => ({ message: error.message ?? error.value ?? '',
        stack: error.stack ?? '', location: error.location ?? null })) });
  }
  onError(error) { this.data.errors.push(error); }
  onEnd(result) {
    this.data.status = result.status;
    writeFileSync(process.env.SEQUENCE_REDUCER_REPORT, JSON.stringify(this.data, null, 2));
  }
}

import type { DiagnosticsCategory, DiagnosticsChecker } from './types';

/**
 * Sample tests for testing
 */
class CheckTesting implements DiagnosticsChecker {
  pass: boolean;
  constructor(pass: boolean) {
    this.pass = pass;
  }

  get id() {
    return `STATIC_${ this.pass.toString().toUpperCase() }`;
  }

  category = 'Testing' as DiagnosticsCategory;
  applicable(): Promise<boolean> {
    return Promise.resolve(/^dev|test/i.test(process.env.NODE_ENV ?? ''));
  }

  check() {
    return Promise.resolve({
      passed:        this.pass,
      documentation: '!!!',
      description:   `This is a sample test that will ${ this.pass ? 'always' : 'never' } pass.`,
      fixes:         [],
    });
  }
}

export default [new CheckTesting(true), new CheckTesting(false)];

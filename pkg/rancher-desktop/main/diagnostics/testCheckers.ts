import { DiagnosticsCategory, DiagnosticsChecker } from './types';

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

  category = DiagnosticsCategory.Testing;
  applicable(): Promise<boolean> {
    return Promise.resolve(/^dev|test/i.test(process.env.NODE_ENV ?? '') && !process.env.MOCK_FOR_SCREENSHOTS);
  }

  check() {
    return Promise.resolve({
      passed:        this.pass,
      documentation: 'https://www.example.com/not-a-valid-link',
      description:   `This is a \`sample\` test that will **${ this.pass ? 'always' : 'never' }** pass.`,
      fixes:         [],
    });
  }
}

export default [new CheckTesting(true), new CheckTesting(false)];

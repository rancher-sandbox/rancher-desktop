import { DiagnosticsCategory, DiagnosticsChecker } from './types';

/**
 * Sample tests for testing
 */
class MockChecker implements DiagnosticsChecker {
  get id() {
    return 'MOCK_CHECKER';
  }

  category = DiagnosticsCategory.Utilities;
  applicable(): Promise<boolean> {
    return Promise.resolve(!!process.env.MOCK_FOR_SCREENSHOTS);
  }

  check() {
    return Promise.resolve({
      passed:        false,
      documentation: 'https://www.example.com/not-a-valid-link',
      description:   `The \`~/.rd/bin\` directory has not been added to the \`PATH\`, so command-line utilities are not configured in your shell.`,
      fixes:         [],
    });
  }
}

export default [new MockChecker()];

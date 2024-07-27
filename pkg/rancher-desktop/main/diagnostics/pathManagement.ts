import { DiagnosticsCategory, DiagnosticsChecker, DiagnosticsCheckerResult, DiagnosticsCheckerSingleResult } from './types';

import mainEvents from '@pkg/main/mainEvents';
import Logging from '@pkg/utils/logging';

const console = Logging.diagnostics;
const cachedResults: Record<string, DiagnosticsCheckerResult> = {};

const CheckPathManagement: DiagnosticsChecker = {
  id:       'PATH_MANAGEMENT',
  category: DiagnosticsCategory.Utilities,
  applicable() {
    return Promise.resolve(['darwin', 'linux'].includes(process.platform));
  },
  check(): Promise<DiagnosticsCheckerSingleResult[]> {
    return Promise.resolve(Object.entries(cachedResults).map(([id, result]) => {
      return ({
        ...result,
        id,
      });
    }));
  },
};

mainEvents.on('diagnostics-event', (id, state) => {
  console.log('diagnostics-event', id, state);
  if (id !== 'path-management') {
    return;
  }
  const typedState: { fileName: string, error: Error | undefined } = state;
  const { fileName, error } = typedState;

  cachedResults[fileName] = {
    passed:      !error,
    description: error?.toString() ?? 'Passed',
    fixes:       [],
  };
});

export default CheckPathManagement;

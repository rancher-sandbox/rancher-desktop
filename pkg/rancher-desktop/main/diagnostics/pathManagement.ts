import { DiagnosticsCategory, DiagnosticsChecker, DiagnosticsCheckerResult, DiagnosticsCheckerSingleResult } from './types';

import { ErrorHasExtendedAttributes, ErrorNotRegularFile, ErrorWritingFile } from '@pkg/integrations/manageLinesInFile';
import mainEvents from '@pkg/main/mainEvents';

const cachedResults: Record<string, DiagnosticsCheckerResult> = {};

/**
 * Check for any errors raised from handling path management (i.e. handling of
 * ~/.bashrc and related files) and report them to the user.
 */
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
  if (id !== 'path-management') {
    return;
  }
  const typedState: { fileName: string, error: Error | undefined } = state;
  const { fileName, error } = typedState;

  cachedResults[fileName] = {
    description: error?.message ?? error?.toString() ?? `Unknown error managing ${ fileName }`,
    passed:      false,
    fixes:       [],
    ...(() => {
      if (!error) {
        return { passed: true, description: `\`${ fileName }\` is managed` };
      }

      if (error instanceof ErrorHasExtendedAttributes) {
        return { fixes: [{ description: `Remove extended attributes from \`${ fileName }\`` }] };
      }

      if (error instanceof ErrorNotRegularFile) {
        return { fixes: [{ description: `Replace \`${ fileName }\` with a regular file` }] };
      }

      if (error instanceof ErrorWritingFile) {
        return { fixes: [{ description: `Restore \`${ fileName }\` from backup file \`${ error.backupPath }\`` }] };
      }

      return {};
    })(),
  };
});

export default CheckPathManagement;

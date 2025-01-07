import { DiagnosticsCategory, DiagnosticsChecker, DiagnosticsCheckerResult, DiagnosticsCheckerSingleResult } from './types';

import mainEvents from '@pkg/main/mainEvents';

const cachedResults: Record<string, DiagnosticsCheckerResult> = {};

const CheckWindowsIntegrations: DiagnosticsChecker = {
  id:       'WINDOWS_INTEGRATIONS',
  category: DiagnosticsCategory.ContainerEngine,
  applicable() {
    return Promise.resolve(process.platform === 'win32');
  },
  check(): Promise<DiagnosticsCheckerSingleResult[]> {
    const resultMapper = ([id, result]: [string, DiagnosticsCheckerResult]) => {
      return ({ ...result, id });
    };

    return Promise.resolve(Object.entries(cachedResults).map(resultMapper));
  },
};

mainEvents.on('diagnostics-event', (payload) => {
  if (payload.id !== 'integrations-windows') {
    return;
  }
  const { distro, key, error } = payload;
  const message = error?.message ?? error?.toString();

  cachedResults[`${ distro || '<main>' }-${ key }`] = {
    passed: false,
    fixes:  [],
    ...(() => {
      if (!error) {
        return { passed: true, description: `${ distro }/${ key } passed` };
      }
      if (distro) {
        return { description: `Error managing distribution ${ distro }: ${ key }: ${ message }` };
      }

      return { description: `Error managing ${ key }: ${ message }` };
    })(),
  };
});

export default CheckWindowsIntegrations;

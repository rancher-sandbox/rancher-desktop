import { DiagnosticsCategory, DiagnosticsChecker, DiagnosticsCheckerResult, DiagnosticsCheckerSingleResult } from './types';

import { ContainerEngine } from '@pkg/config/settings';
import mainEvents from '@pkg/main/mainEvents';
import dockerDirManager from '@pkg/utils/dockerDirManager';

const dockerContextChecker: DiagnosticsChecker = {
  id:       'DOCKER_CONTEXT',
  category: DiagnosticsCategory.ContainerEngine,
  async applicable(): Promise<boolean> {
    const settings = await mainEvents.invoke('settings-fetch');

    return settings.containerEngine.name === ContainerEngine.MOBY;
  },
  async check(): Promise<DiagnosticsCheckerSingleResult[]> {
    const results: DiagnosticsCheckerSingleResult[] = [];
    for (const variable of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG']) {
      if (variable in process.env) {
        results.push({
          id:          `DOCKER_CONTEXT_ENV_${ variable }`,
          description: `\`${ variable }\` environment variable is set.`,
          passed:      false,
          fixes:       [{ description: `Unset \`${ variable }\`.` }],
        });
      }
    }

    const settings = await mainEvents.invoke('settings-fetch');
    const useDefaultContext = process.platform === 'win32' || settings.application.adminAccess;
    const currentContext = await dockerDirManager.currentDockerContext ?? 'default';
    const desiredContext = useDefaultContext
      ? 'default'
      : await dockerDirManager.getDesiredDockerContext(settings.application.adminAccess, currentContext);

    if (currentContext !== desiredContext) {
      results.push({
        id:          'DOCKER_CONTEXT',
        description: `Docker context is currently \`${ currentContext }\` instead of \`${ desiredContext }\`.`,
        passed:      false,
        fixes:       [{
          description: `Run \`docker context use ${ desiredContext }\``,
        }],
      });
    } else {
      results.push({
        id:          'DOCKER_CONTEXT',
        description: `Correctly using context \`${ currentContext }\``,
        passed:      true,
        fixes:       [],
      });
    }

    return results;
  },
};

export default dockerContextChecker;

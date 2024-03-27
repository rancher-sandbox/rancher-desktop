import path from 'path';

import mainEvents from '@pkg/main/mainEvents';
import { spawnFile } from '@pkg/utils/childProcess';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';

import type { DiagnosticsCategory, DiagnosticsChecker, DiagnosticsCheckerResult } from './types';

const console = Logging.diagnostics;

const KubeContextDefaultChecker: DiagnosticsChecker = {
  id:       'KUBE_CONTEXT',
  category: 'Kubernetes' as DiagnosticsCategory,
  async applicable(): Promise<boolean> {
    const settings = await mainEvents.invoke('settings-fetch');

    console.debug(`${ this.id }: Kubernetes enabled? ${ settings.kubernetes.enabled }`);

    return settings.kubernetes.enabled;
  },
  async check(): Promise<DiagnosticsCheckerResult> {
    const kubectl = path.join(paths.resources, process.platform, 'bin', 'kubectl');
    const { stdout } = await spawnFile(kubectl, ['config', 'view', '--minify', '--output=json'], {
      stdio:    ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    const config = JSON.parse(stdout);
    const contexts = config['contexts'] as Array<any> ?? [];
    const passed = contexts.some(context => context.name === 'rancher-desktop');
    let description = 'Unknown issue determining default Kubernetes context.';

    console.debug(`${ this.id }: using ${ kubectl }`);
    console.debug(`${ this.id }: defaults to RD context? ${ passed }`);
    if (passed) {
      description = 'Kubernetes is using the \`rancher-desktop\` context.';
    } else {
      const context = contexts.map(context => context.name).filter(c => c).shift();

      console.debug(`${ this.id }: current default context: ${ context }`);
      if (context) {
        description = `Kubernetes is using context \`${ context }\` instead of \`rancher-desktop\`.`;
      } else {
        description = 'No active Kubernetes context found; should be \`rancher-desktop\`.';
      }
    }

    return {
      description,
      fixes: [],
      passed,
    };
  },
};

export default KubeContextDefaultChecker;

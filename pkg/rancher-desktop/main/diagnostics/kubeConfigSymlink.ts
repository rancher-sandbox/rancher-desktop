import { DiagnosticsCategory, DiagnosticsChecker } from './types';

import WindowsIntegrationManager from '@pkg/integrations/windowsIntegrationManager';
import Logging from '@pkg/utils/logging';

const console = Logging.diagnostics;

async function verifyKubeConfigSymlink(): Promise<boolean> {
  const integrationManager = WindowsIntegrationManager.getInstance();

  try {
    await integrationManager.verifyAllDistrosKubeConfig();

    return true;
  } catch (error: any) {
    console.error(`Error verifying kubeconfig symlinks: ${ error.message }`);

    return false;
  }
}

/**
 * CheckKubeConfigSymlink checks the symlinked kubeConfig in WSL integration
 * enabled distro for non-rancher desktop configuration.
 */
const CheckKubeConfigSymlink: DiagnosticsChecker = {
  id:       'VERIFY_WSL_INTEGRATION_KUBECONFIG',
  category: DiagnosticsCategory.Kubernetes,
  applicable() {
    return Promise.resolve(process.platform === 'win32');
  },
  async check() {
    return Promise.resolve({
      description: 'Rancher Desktop cannot automatically convert the provided kubeconfig file to a symlink' +
        ' due to existing configurations within that file. To resolve this issue, you will need to ' +
        'manually create the symlink to ensure existing configurations are preserved and to prevent ' +
        'any loss of configuration.',
      passed: await verifyKubeConfigSymlink(),
      fixes:  [],
    });
  },
};

export default CheckKubeConfigSymlink;

import os from 'os';
import path from 'path';
import paths from '@/utils/paths';
import UnixIntegrationManager from '@/integrations/unixIntegrationManager';
import WindowsIntegrationManager from '@/integrations/windowsIntegrationManager';

// An IntegrationManager is a class that manages integrations for a particular
// platform. An "integration" is a tool that is used with Rancher Desktop, such
// as kubectl, nerdctl, docker CLI plugins and so on. These tools are included
// in the Rancher Desktop installation, but extra steps are usually needed to
// make them available to the user. Carrying out these steps, as well as reversing
// them when desired, is what an IntegrationManager is for.
export interface IntegrationManager {
  // Idempotent. Realize any changes to the system.
  enforce(): Promise<void>
  // Idempotent. Remove any changes from the system that the IntegrationManager
  // may have made.
  remove(): Promise<void>
  // A leaky part of this abstraction. Was introduced for the case where RD is
  // running as an AppImage on Linux. In this case, we need to remove and remake
  // integration symlinks on every quit-start cycle since they are mounted at a
  // different location every run. Idempotent.
  removeSymlinksOnly(): Promise<void>
}

export function getIntegrationManager(): IntegrationManager {
  const dockerCliPluginDir = path.join(os.homedir(), '.docker', 'cli-plugins');
  const platform = os.platform();

  switch (platform) {
  case 'linux':
    return new UnixIntegrationManager(paths.resources, paths.integration, dockerCliPluginDir);
  case 'darwin':
    return new UnixIntegrationManager(paths.resources, paths.integration, dockerCliPluginDir);
  case 'win32':
    return new WindowsIntegrationManager();
  default:
    throw new Error(`OS ${ platform } is not supported`);
  }
}

import os from 'os';
import path from 'path';
import paths from '@/utils/paths';
import UnixIntegrationManager from '@/integrations/unixIntegrationManager';
import WindowsIntegrationManager from '@/integrations/windowsIntegrationManager';

export interface IntegrationManager {
  enforce(): Promise<void>
  remove(): Promise<void>
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

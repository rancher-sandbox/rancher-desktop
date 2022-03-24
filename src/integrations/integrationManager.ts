import os from 'os';
import path from 'path';
import paths from '@/utils/paths';
import UnixIntegrationManager from '@/integrations/unixIntegrationManager';
import WindowsIntegrationManager from '@/integrations/windowsIntegrationManager';

export interface IntegrationManager {
  enforce(): void
  remove(): void
  removeSymlinksOnly(): void
}

export function getIntegrationManager(): IntegrationManager {
  const dockerCliPluginDir = path.join(os.homedir(), '.docker', 'cli-plugins');
  switch (os.platform()) {
  case 'linux':
    return new UnixIntegrationManager(paths.resources, paths.integration, dockerCliPluginDir);
  case 'darwin':
    return new UnixIntegrationManager(paths.resources, paths.integration, dockerCliPluginDir);
  case 'win32':
    return new windowsIntegrationManager();
  default:
    throw new Error(`OS ${ os.platform() } is not supported`);
  }
}

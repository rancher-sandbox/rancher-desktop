import os from 'os';
import path from 'path';

import UnixIntegrationManager from '@pkg/integrations/unixIntegrationManager';
import WindowsIntegrationManager from '@pkg/integrations/windowsIntegrationManager';
import paths from '@pkg/utils/paths';

/**
 * An IntegrationManager is a class that manages integrations for a particular
 * platform. An "integration" is a tool that is used with Rancher Desktop, such
 * as kubectl, nerdctl, docker CLI plugins and so on. These tools are included
 * in the Rancher Desktop installation, but extra steps are usually needed to
 * make them available to the user. Carrying out these steps, as well as reversing
 * them when desired, is what an IntegrationManager is for.
 */
export interface IntegrationManager {
  /** Idempotent. Realize any changes to the system. */
  enforce(): Promise<void>
  /**
   * Idempotent. Remove any changes from the system that the IntegrationManager
   * may have made.
   */
  remove(): Promise<void>
  /**
   * A leaky part of this abstraction. Was introduced for the case where RD is
   * running as an AppImage on Linux. In this case, we need to remove and remake
   * integration symlinks on every quit-start cycle since they are mounted at a
   * different location every run. Idempotent.
   */
  removeSymlinksOnly(): Promise<void>

  /**
   * On Windows only, list the integrations available; returns a mapping of WSL
   * distribution to:
   * - true: integration is enabled
   * - false: integration is disabled
   * - (string): error with given details
   * On non-Windows platforms, returns null.
   */
  listIntegrations(): Promise<Record<string, boolean | string> | null>;
}

export function getIntegrationManager(): IntegrationManager {
  const platform = os.platform();
  const resourcesBinDir = path.join(paths.resources, platform, 'bin');
  const dockerCliPluginDir = path.join(os.homedir(), '.docker', 'cli-plugins');

  switch (platform) {
  case 'linux':
    return new UnixIntegrationManager(resourcesBinDir, paths.integration, dockerCliPluginDir);
  case 'darwin':
    return new UnixIntegrationManager(resourcesBinDir, paths.integration, dockerCliPluginDir);
  case 'win32':
    return new WindowsIntegrationManager();
  default:
    throw new Error(`OS ${ platform } is not supported`);
  }
}

import { ExtensionManager } from './types';

import { ContainerEngineClient } from '@pkg/backend/containerClient';
import type { Settings } from '@pkg/config/settings';
import { RecursiveReadonly } from '@pkg/utils/typeUtils';

export * from './types';

/**
 * Get the extension manager for the given client using the given settings.
 * If the client is not given, return the previously fetched extension manager.
 * It is an error to call this without a client if not previously called with
 * one.
 */
export async function getExtensionManager(): Promise<ExtensionManager | undefined>;
export async function getExtensionManager(client: ContainerEngineClient, cfg: RecursiveReadonly<Settings>): Promise<ExtensionManager>;
export async function getExtensionManager(client?: ContainerEngineClient, cfg?: RecursiveReadonly<Settings>): Promise<ExtensionManager | undefined> {
  // We do a local import here to ensure we don't pull in everything when this
  // is just imported for the types.
  const getEMImpl = (await import('./manager')).default;

  if (client) {
    if (!cfg) {
      throw new Error(`getExtensionManager called without configuration`);
    }

    return getEMImpl(client, cfg);
  } else {
    return getEMImpl();
  }
}

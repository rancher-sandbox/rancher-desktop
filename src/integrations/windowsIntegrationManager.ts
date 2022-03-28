import { IntegrationManager } from '@/integrations/integrationManager';

// TODO: change this comment once Windows integration management is refactored.
// Doesn't do anything at the moment. Integration management on Windows
// still is done inside the WSLBackend object. This class exists because
// we need an IntegrationManager for Windows that does nothing until we can
// write one that actually manages integrations.
export default class WindowsIntegrationManager implements IntegrationManager {
  async enforce(): Promise<void> {}
  async remove(): Promise<void> {}
  async removeSymlinksOnly(): Promise<void> {}
}

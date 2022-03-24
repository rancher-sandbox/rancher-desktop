import { IntegrationManager } from '@/integrations/integrationManager';

export default class WindowsIntegrationManager implements IntegrationManager {
  async enforce(): Promise<void> {
    // currently a no-op; must be implemented
  }

  async remove(): Promise<void> {
    // currently a no-op; must be implemented
  }

  async removeSymlinksOnly(): Promise<void> {
    // currently a no-op; must be implemented
  }
}

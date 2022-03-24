import { IntegrationManager } from '@/integrations/integrationManager';

export default class WindowsIntegrationManager implements IntegrationManager {
  async enforce(): void {
    // currently a no-op; must be implemented
  }

  async remove(): void {
    // currently a no-op; must be implemented
  }

  async removeSymlinksOnly(): void {
    // currently a no-op; must be implemented
  }
}

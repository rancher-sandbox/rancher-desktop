import mainEvents from '../mainEvents';
import { DiagnosticsCategory, DiagnosticsChecker, DiagnosticsCheckerResult } from './types';

let kubeVersionsAvailable = true;

mainEvents.on('diagnostics-event', (payload) => {
  if (payload.id !== 'kube-versions-available') {
    return;
  }
  kubeVersionsAvailable = payload.available;
  mainEvents.invoke('diagnostics-trigger', instance.id);
});

/**
 * KubeVersionsAvailable is a diagnostic that will be emitted when all of the
 * following are met:
 * - Kubernetes was configured to be enabled
 * - The selected Kubernetes version is unavailable (e.g. user is offline)
 * Once the diagnostic is triggered, it stays on until the backend is restarted.
 */
class KubeVersionsAvailable implements DiagnosticsChecker {
  readonly id = 'KUBE_VERSIONS_AVAILABLE';
  readonly category = DiagnosticsCategory.Kubernetes;
  applicable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  check(): Promise<DiagnosticsCheckerResult> {
    const description = [
      'There are no issues with Kubernetes versions',
      'Kubernetes has been disabled due to issues with fetching Kubernetes versions',
    ][kubeVersionsAvailable ? 0 : 1];

    return Promise.resolve({
      passed: kubeVersionsAvailable,
      description,
      fixes:  [{ description: 'Check your network connection to update.k3s.io' }],
    });
  }
}

const instance = new KubeVersionsAvailable();

export default instance;

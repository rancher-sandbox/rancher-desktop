import { DiagnosticsCategory, DiagnosticsChecker } from './types';
import { checkConnectivity } from '@/main/networking';

/**
 * CheckConnectedToInternet checks whether the machine is connected to the
 * internet (which is required for most operations).
 */
const CheckConnectedToInternet: DiagnosticsChecker = {
  id:         'CONNECTED_TO_INTERNET',
  category: DiagnosticsCategory.Networking,
  applicable() {
    return Promise.resolve(true);
  },
  async check() {
    return Promise.resolve({
      description:   'The application cannot reach the general internet for ' +
      'updated kubernetes versions and other components, but can still operate.',
      passed: await checkConnectivity('k3s.io'),
      fixes:  [],
    });
  },
};

export default CheckConnectedToInternet;

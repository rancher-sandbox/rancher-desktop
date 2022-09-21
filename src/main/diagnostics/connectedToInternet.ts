import { DiagnosticsCategory, DiagnosticsChecker } from './types';

import mainEvents from '@/main/mainEvents';

let online = false;

mainEvents.on('update-network-status', (status) => {
  online = status;
  CheckConnectedToInternet.trigger?.call(null, CheckConnectedToInternet);
});

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
  check() {
    return Promise.resolve({
      description:   'The application cannot reach the general internet for ' +
      'updated kubernetes versions and other components, but can still operate.',
      passed: online,
      fixes:  [],
    });
  },
};

export default CheckConnectedToInternet;

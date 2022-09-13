import mainEvents from '@/main/mainEvents';

import type { DiagnosticsCategory, DiagnosticsChecker } from './diagnostics';

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
  category:   'Networking' as DiagnosticsCategory,
  applicable() {
    return Promise.resolve(true);
  },
  check() {
    return Promise.resolve({
      documentation: 'path#connected_to_internet',
      description:   'The application cannot reach the general internet for ' +
      'updated kubernetes versions and other components, but can still operate.',
      passed: online,
      fixes:  [],
    });
  },
};

export default CheckConnectedToInternet;

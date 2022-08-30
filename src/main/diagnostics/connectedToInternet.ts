import mainEvents from '@/main/mainEvents';

import type { DiagnosticsCategory, DiagnosticsChecker } from './diagnostics';

let online = false;

mainEvents.on('update-network-status', (status) => {
  online = status;
});

const CheckConnectedToInternet: DiagnosticsChecker = {
  id:            'CONNECTED_TO_INTERNET',
  documentation: 'path#connected_to_internet',
  description:   'The application cannot reach the general internet for updated ' +
   'kubernetes versions and other components, but can still operate.',
  category: 'Networking' as DiagnosticsCategory,
  check:    function(): Promise<boolean> {
    return Promise.resolve(online);
  },
};

export default CheckConnectedToInternet;

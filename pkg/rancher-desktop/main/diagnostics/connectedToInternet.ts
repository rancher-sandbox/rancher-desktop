import { net } from 'electron';

import { DiagnosticsCategory, DiagnosticsChecker } from './types';

import mainEvents from '@pkg/main/mainEvents';
import Logging from '@pkg/utils/logging';

const console = Logging.diagnostics;

let pollingInterval: NodeJS.Timeout;
let timeout = 5_000;

// Since this is just a status check, it's fine to just reset the timer every
// time _any_ setting has been updated.
mainEvents.on('settings-update', settings => {
  clearInterval(pollingInterval);

  const { timeout: localTimeout, interval } = settings.diagnostics.connectivity;

  timeout = localTimeout;
  if (interval > 0) {
    pollingInterval = setInterval(() => {
      mainEvents.invoke('diagnostics-trigger', CheckConnectedToInternet.id);
    }, interval);
  }
});

/**
 * Checks whether we can perform an HTTP request to a host on the internet,
 * with a reasonably short timeout.
 */
async function checkNetworkConnectivity(): Promise<boolean> {
  const request = net.request({
    method:      'HEAD',
    url:         'https://docs.rancherdesktop.io/',
    credentials: 'omit',
    cache:       'no-cache',
  });
  const timeoutId = setTimeout(() => {
    console.log(`${ CheckConnectedToInternet.id }: aborting due to timeout after ${ timeout } milliseconds.`);
    request.abort();
  }, timeout);
  try {
    return await new Promise<boolean>(resolve => {
      request.on('response', () => resolve(true));
      request.on('redirect', () => resolve(true));
      request.on('error', () => resolve(false));
      request.on('abort', () => resolve(false));
      request.end();
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * CheckConnectedToInternet checks whether the machine is connected to the
 * internet (which is required for most operations).
 */
const CheckConnectedToInternet: DiagnosticsChecker = {
  id:       'CONNECTED_TO_INTERNET',
  category: DiagnosticsCategory.Networking,
  applicable() {
    return Promise.resolve(true);
  },
  async check() {
    const connected = await checkNetworkConnectivity();
    mainEvents.emit('diagnostics-event', { id: 'network-connectivity', connected });
    if (connected) {
      return {
        description: 'The application can reach the internet successfully.',
        passed:      true,
        fixes:       [],
      };
    }
    return {
      description: 'The application cannot reach the general internet for ' +
      'updated kubernetes versions and other components, but can still operate.',
      passed: false,
      fixes:  [],
    };
  },
};

export default CheckConnectedToInternet;

import fetch from 'node-fetch';

import { DiagnosticsCategory, DiagnosticsChecker } from './types';

/**
 * Checks whether we can perform an HTTP request to a host on the internet,
 * with a reasonably short timeout.
 */
async function checkNetworkConnectivity(): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);
  let connected: boolean;

  try {
    await fetch('https://example.com/', { signal: controller.signal });
    connected = true;
  } catch (error: any) {
    connected = false;
  } finally {
    clearTimeout(timeoutId);
  }

  return connected;
}

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
      passed: await checkNetworkConnectivity(),
      fixes:  [],
    });
  },
};

export default CheckConnectedToInternet;

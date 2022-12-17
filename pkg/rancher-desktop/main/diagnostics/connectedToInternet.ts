import fetch from 'node-fetch';

import { DiagnosticsCategory, DiagnosticsChecker } from './types';

import Logging from '@pkg/utils/logging';

const console = Logging.diagnostics;

// Returns the timeout, in milliseconds, for the network connectivity check.
function getTimeout(): number {
  if (process.env.RD_CONNECTED_TO_INTERNET_TIMEOUT) {
    const parsedTimeout = parseInt(process.env.RD_CONNECTED_TO_INTERNET_TIMEOUT);

    if (parsedTimeout > 0) {
      return parsedTimeout;
    }
  }

  return 5000;
}

/**
 * Checks whether we can perform an HTTP request to a host on the internet,
 * with a reasonably short timeout.
 */
async function checkNetworkConnectivity(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = getTimeout();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  let connected: boolean;

  console.log(`Running connectivity test with timeout of ${ timeout } ms`);
  try {
    await fetch('https://example.com/', { signal: controller.signal });
    console.log('Connection test completed successfully');
    connected = true;
  } catch (error: any) {
    let errorMessage = error;

    if (error.name === 'AbortError') {
      errorMessage = `timed out after ${ timeout } ms`;
    }
    console.log(`Got error while checking connectivity: ${ errorMessage }`);
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
  id:       'CONNECTED_TO_INTERNET',
  category: DiagnosticsCategory.Networking,
  applicable() {
    return Promise.resolve(true);
  },
  async check() {
    return Promise.resolve({
      description: 'The application cannot reach the general internet for ' +
      'updated kubernetes versions and other components, but can still operate.',
      passed: await checkNetworkConnectivity(),
      fixes:  [],
    });
  },
};

export default CheckConnectedToInternet;

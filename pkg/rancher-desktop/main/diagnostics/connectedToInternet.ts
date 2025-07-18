import { net } from 'electron';

import { DiagnosticsCategory, DiagnosticsChecker } from './types';

import Logging from '@pkg/utils/logging';

const console = Logging.diagnostics;
let allowSuccessfulConnectionDiagnosticLog = true;

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
  const runningConnectivityTestMessage = `Running connectivity test with timeout of ${ timeout } ms`;

  try {
    // Using HTTP request that returns a 301 redirect response instead of a 20+ kB web page
    const resp = await net.fetch('http://docs.rancherdesktop.io/', { signal: controller.signal, redirect: 'manual' });
    const location = resp.headers.get('Location') || '';

    // Verify that we get the original redirect and not a captive portal
    if (resp.status !== 301 || !location.includes('docs.rancherdesktop.io')) {
      throw new Error(`expected status 301 (was ${ resp.status }) and location including docs.rancherdesktop.io (was ${ location })`);
    }
    if (allowSuccessfulConnectionDiagnosticLog) {
      console.log(runningConnectivityTestMessage);
      console.log('Connection test completed successfully');
      allowSuccessfulConnectionDiagnosticLog = false;
    }
    connected = true;
  } catch (error: any) {
    let errorMessage = error;

    console.log(runningConnectivityTestMessage);
    if (error.name === 'AbortError') {
      errorMessage = `timed out after ${ timeout } ms`;
    }
    console.log(`Got error while checking connectivity: ${ errorMessage }`);
    connected = false;
    allowSuccessfulConnectionDiagnosticLog = true;
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

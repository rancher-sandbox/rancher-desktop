/*
Copyright © 2022 SUSE LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import tls from 'tls';

import * as childProcess from '@pkg/utils/childProcess';
import AsyncCallbackIterator from '@pkg/utils/iterator';
import Logging from '@pkg/utils/logging';
import { executable } from '@pkg/utils/resources';

/**
 * Asynchronously enumerate the certificate authorities that should be used to
 * build the Rancher Desktop trust store, in PEM format in undefined order.
 */
export default async function * getWinCertificates(): AsyncIterable<string> {
  // Windows will dynamically download CA certificates on demand by default;
  // this means that if we just enumerate the Windows certificate store, we will
  // be missing some standard certificates.  To approximate the desired
  // behaviour, we will enumerate both the Windows store as well as the OpenSSL
  // one built into NodeJS.

  let buffer = '';
  const proc = childProcess.spawn(executable('wsl-helper'), ['certificates'], {
    stdio:       ['ignore', 'pipe', await Logging['networking-ca'].fdStream],
    windowsHide: true,
  });
  const iterator = new AsyncCallbackIterator<string>();

  proc.stdout.on('data', async(chunk: string | Buffer) => {
    try {
      if (Buffer.isBuffer(chunk)) {
        buffer += chunk.toString('utf-8');
      } else {
        buffer += chunk;
      }
      while (true) {
        const [match] = /^.*?-----END CERTIFICATE-----\r?\n?/s.exec(buffer) ?? [];

        if (!match) {
          break;
        }
        buffer = buffer.substring(match.length);
        await iterator.emit(match);
      }
    } catch (ex) {
      await iterator.error(ex);
    }
  });
  proc.on('exit', async(code, signal) => {
    if (!(code === 0 || signal === 'SIGTERM')) {
      iterator.error(code || signal);
    } else {
      try {
        await iterator.emit(buffer);
        iterator.end();
      } catch (ex) {
        await iterator.error(ex);
      }
    }
  });

  yield * iterator;
  yield * tls.rootCertificates;
}

import fs from 'fs';
import path from 'path';
import stream from 'stream';

import { findHomeDir } from '@kubernetes/client-node';

import { spawnFile } from '@pkg/utils/childProcess';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';

interface credHelperInfo {
  /** The name of the credential helper to use (a suffix of `docker-credential-`) */
  credsStore:  string;
  /** hash of URLs to credential-helper-name */
  credHelpers: Record<string, string>
}

const console = Logging.server;

/**
 * Run the credential helper with the given command.
 * @param command The one-word command to run.
 * @param input Any input to be provided to the command (as standard input).
 */
export default async function runCommand(command: string, input?: string): Promise<string> {
  if (command === 'list') {
    // List requires special treatment.
    return JSON.stringify(await list());
  }

  const { credsStore } = await getCredentialHelperInfo(command, input ?? '');

  try {
    return runCredHelper(credsStore, command, input);
  } catch (ex: any) {
    ex.helper = credsStore;
    throw ex;
  }
}

/**
 * Run the `list` command.
 * This command needs special treatment as we need information from multiple
 * cred helpers, based on the settings found in the `credHelpers` section of
 * the configuration.
 *
 * Modeled after https://github.com/docker/cli/blob/d0bd373986b6678bfe1a0eb6989ce13907247a85/cli/config/configfile/file.go#L285
 */
export async function list(): Promise<Record<string, string>> {
  // Return the creds list from the default helper, plus any data from
  // additional credential helpers as listed in the `credHelpers` section.
  const { credsStore, credHelpers } = await getCredentialHelperInfo('list', '');
  const results = JSON.parse(await runCredHelper(credsStore, 'list'));
  const helperNames = new Set(Object.values(credHelpers ?? {}));

  for (const helperName of helperNames) {
    try {
      const additionalResults = JSON.parse(await runCredHelper(helperName, 'list'));

      for (const [url, username] of Object.entries(additionalResults)) {
        if (credHelpers[url] === helperName) {
          results[url] = username;
        }
      }
    } catch (err) {
      console.debug(`Failed to get credential list for helper ${ helperName }: ${ err }`);
    }
  }

  return results;
}

/**
 * Returns the name of the credential-helper to use (which is a suffix of the helper `docker-credential-`).
 *
 * Note that callers are responsible for catching exceptions, which usually happens if the
 * `$HOME/docker/config.json` doesn't exist, its JSON is corrupt, or it doesn't have a `credsStore` field.
 */
async function getCredentialHelperInfo(command: string, payload: string): Promise<credHelperInfo> {
  const home = findHomeDir();
  const dockerConfig = path.join(home ?? '', '.docker', 'config.json');
  const contents = JSON.parse(await fs.promises.readFile(dockerConfig, { encoding: 'utf-8' }));
  const credHelpers = contents.credHelpers;
  const credsStore = contents.credsStore;

  if (credHelpers) {
    let credsStoreOverride = '';

    switch (command) {
    case 'erase':
    case 'get':
      credsStoreOverride = credHelpers[payload.trim()];
      break;
    case 'store': {
      const obj = JSON.parse(payload);

      credsStoreOverride = obj.ServerURL ? credHelpers[obj.ServerURL] : '';
    }
    }
    if (credsStoreOverride) {
      return { credsStore: credsStoreOverride, credHelpers: { } };
    }
  }

  return { credsStore, credHelpers };
}

/**
 * Run the credential helper, with minimal checking.
 * @param helper The name of the credential helper to use (a suffix of `docker-credential-`)
 * @param command The one-word command to run
 * @param input Any input to the helper, to be sent as standard input.
 */
async function runCredHelper(helper: string, command: string, input?: string): Promise<string> {
  // The PATH needs to contain our resources directory (on macOS that would
  // not be in the application's PATH).
  // NOTE: This needs to match DockerDirManager.spawnFileWithExtraPath
  const pathVar = (process.env.PATH ?? '').split(path.delimiter).filter(x => x);

  pathVar.push(path.join(paths.resources, process.platform, 'bin'));

  const helperName = `docker-credential-${ helper }`;
  const body = stream.Readable.from(input ?? '');
  const { stdout } = await spawnFile(helperName, [command], {
    env:   { ...process.env, PATH: pathVar.join(path.delimiter) },
    stdio: [body, 'pipe', console],
  });

  return stdout;
}

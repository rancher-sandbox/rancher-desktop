/**
 * This script runs the end-to-end tests.
 */

'use strict';

import childProcess from 'child_process';
import events from 'events';
import util from 'util';

import buildUtils from './lib/build-utils';

import * as settings from '@pkg/config/settings';
import { readDeploymentProfiles } from '@pkg/main/deploymentProfiles';

const sleep = util.promisify(setTimeout);

class E2ETestRunner extends events.EventEmitter {
  emitError(message: string, error: any) {
    let combinedMessage = message;

    if (error?.message) {
      combinedMessage += `: ${ error.message }`;
    }
    const newError: Error & { code?: number } = new Error(combinedMessage);

    newError.code = error?.code;
    if (error?.stack) {
      newError.stack += `\nCaused by: ${ error.stack }`;
    }
    this.emit('error', newError);
  }

  get rendererPort() {
    return 8888;
  }

  /**
   * Spawn a child process, set up to emit errors on unexpected exit.
   * @param title The title of the process to show in messages.
   * @param command The executable to run.
   * @param  args Any arguments to the executable.
   * @returns The new child process.
   */
  spawn(title: string, command: string, ...args: string[]): childProcess.ChildProcess {
    const promise = buildUtils.spawn(command, ...args);

    promise
      .then(() => this.exit())
      .catch(error => this.emitError(`${ title } error`, error));

    return promise.child;
  }

  exit() {
    this.#testProcess?.kill();
  }

  #testProcess: null | childProcess.ChildProcess = null;
  startTestProcess(): Promise<void> {
    const args = processArgsForPlaywright(process.argv);
    const spawnArgs = ['node_modules/@playwright/test/cli.js', 'test', '--config=e2e/config/playwright-config.ts'];

    if (process.env.CI) {
      spawnArgs.push('--retries=2');
    }
    this.#testProcess = this.spawn('Test process', 'node', ...spawnArgs, ...args);

    return new Promise((resolve, reject) => {
      this.#testProcess?.on('exit', (code: number, signal: string) => {
        if (code === 201) {
          console.log('Another instance of Rancher Desktop is already running');
          resolve();
        } else if (code > 0) {
          console.log(`Rancher Desktop: main process exited with status ${ code }`);
          reject(code);
        } else if (signal) {
          console.log(`Rancher Desktop: main process exited with signal ${ signal }`);
          reject(signal);
        } else {
          resolve(process.exit());
        }
      });
    });
  }

  /**
   * Start the renderer process.
   */
  buildRenderer(): Promise<void> {
    process.env.VUE_CLI_SERVICE_CONFIG_PATH = 'pkg/rancher-desktop/vue.config.mjs';

    return buildUtils.spawn(
      process.execPath,
      '--stack-size=16384',
      'node_modules/@vue/cli-service/bin/vue-cli-service.js',
      'build',
      '--skip-plugins',
      'eslint',
    );
  }

  async run() {
    try {
      if (!process.env.RD_TEST_ALLOW_PROFILE) {
        let deploymentProfiles: settings.DeploymentProfileType = { defaults: {}, locked: {} };

        try {
          deploymentProfiles = await readDeploymentProfiles();
        } catch {}
        if (Object.keys(deploymentProfiles.defaults).length > 0 || Object.keys(deploymentProfiles.locked).length > 0) {
          throw new Error(["Trying to run e2e tests with existing deployment profiles isn't supported.",
            'Set environment variable RD_TEST_ALLOW_PROFILE=true to override this check',
          ].join('\n'));
        }
      }
      process.env.RD_TEST = 'e2e';

      // Set feature flags
      process.env.RD_ENV_EXTENSIONS = '1';

      // Start the renderer process and wait for it to complete the build.
      await this.buildRenderer();

      await buildUtils.wait(
        () => buildUtils.buildMain(),
        () => buildUtils.buildPreload(),
      );
      await isCiOrDevelopmentTimeout();
      await this.startTestProcess();
    } finally {
      this.exit();
    }
  }
}

(new E2ETestRunner()).run().catch((e) => {
  console.error(e);
  process.exit(1);
});

function isCiOrDevelopmentTimeout() {
  const ciTimeout = 40000;
  const devTimeout = 20000;

  if (process.env.CI) {
    console.log(`ENV Detected CI:${ process.env.CI } - Setting up Loading timeout: ${ ciTimeout }ms`);

    return sleep(ciTimeout);
  } else {
    console.log(`ENV Detected non-CI:${ process.env.NODE_ENV } - Setting up Loading timeout: ${ devTimeout }ms`);

    return sleep(devTimeout);
  }
}

// Convert any single backslash into two, but leave pairs of backslashes alone.
function escapeUnescapedBackslashes(s: string): string {
  return s.replace(/\\(?:.|$)/g, m => m === '\\\\' ? m : `\\${ m }`);
}

/**
 * The first 2 args are internal for yarn/npm and shouldn't be passed to playwright. Same with `--serial`.
 * Now playwright treats paths as regexes, meaning that unescaped backslashes will normally be treated
 * as meta-regex-characters and will be unlikely to match files. This wasn't an issue in the NPM world,
 * because on Windows npm escaped each backslash: `.\e2e\foo.spec.ts` showed up as .\\e2e\\foo.spec.ts`.
 * But Yarn doesn't escape the backslashes, so we need to escape them ourselves.
 *
 * I filed an upstream bug on Playwright, but they closed it due to the claim that paths are actually
 * regexes: https://github.com/microsoft/playwright/issues/24408#issuecomment-1652146685 . This is so
 * you can specify a command like `npx playwright foot head` and run any tests that match the terms
 * `foot` or `head` but skip, for example, `thin-waist.spec.ts`.
 *
 * I don't think it's worth writing a bug against yarn on this. For whatever reason, the paths were
 * escaped in the npm world but not yarn, and we can just allow both forms.
 *
 * The code assumes that anything starting with a '-' doesn't need escaping (because we don't invoke
 * this script with any such options)
 *
 * @param args
 */
function processArgsForPlaywright(args: string[]): string[] {
  args = process.argv.slice(2).filter(x => x !== '--serial');
  if (process.platform !== 'win32') {
    return args;
  }

  return args.map((s) => {
    return s[0] === '-' ? s : escapeUnescapedBackslashes(s);
  });
}

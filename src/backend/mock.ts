import events from 'events';
import os from 'os';
import util from 'util';

import semver from 'semver';

import { execOptions, VMExecutor } from './backend';
import {
  KubernetesBackend, KubernetesError, State, RestartReasons, KubernetesBackendEvents,
} from './k8s';
import ProgressTracker from './progressTracker';

import { Settings } from '@/config/settings';
import { ChildProcess } from '@/utils/childProcess';
import Logging from '@/utils/logging';

const console = Logging.mock;

export default class MockBackend extends events.EventEmitter implements KubernetesBackend, VMExecutor {
  readonly kube = this;
  readonly executor = this;
  readonly backend = 'mock';
  state: State = State.STOPPED;
  readonly availableVersions = Promise.resolve([{ version: new semver.SemVer('0.0.0'), channels: ['latest'] }]);
  version = '';
  readonly cpus = Promise.resolve(1);
  readonly memory = Promise.resolve(1);
  desiredPort = 9443;
  progress = { current: 0, max: 0 };
  readonly progressTracker = new ProgressTracker((progress) => {
    this.progress = progress;
    this.emit('progress');
  });

  debug = false;

  getBackendInvalidReason(): Promise<KubernetesError | null> {
    return Promise.resolve(null);
  }

  cachedVersionsOnly(): Promise<boolean> {
    return Promise.resolve(false);
  }

  protected setState(state: State) {
    this.state = state;
    this.emit('state-changed', state);
  }

  async start(config: Settings['kubernetes']): Promise<void> {
    if ([State.DISABLED, State.STARTING, State.STARTED].includes(this.state)) {
      await this.stop();
    }
    console.log('Starting mock backend...');
    this.setState(State.STARTING);
    for (let i = 0; i < 10; i++) {
      this.progressTracker.numeric('Starting mock backend', i, 10);
      await util.promisify(setTimeout)(1_000);
    }
    this.progressTracker.numeric('Starting mock backend', 10, 10);
    this.setState(State.STARTED);
    console.log('Mock backend started');
  }

  async stop(): Promise<void> {
    console.log('Stopping mock backend...');
    this.setState(State.STOPPING);
    await this.progressTracker.action('Stopping mock backend', 0,
      util.promisify(setTimeout)(1_000));
    this.setState(State.STOPPED);
    console.log('Mock backend stopped.');
  }

  async del(): Promise<void> {
    console.log('Deleting mock backend...');
    await this.stop();
  }

  reset(config: Settings['kubernetes']): Promise<void> {
    return Promise.resolve();
  }

  factoryReset(keepSystemImages: boolean): Promise<void> {
    return Promise.resolve();
  }

  ipAddress = Promise.resolve('192.0.2.1');

  listServices() {
    return [];
  }

  portForwarder = null;

  getFailureDetails() {
    return Promise.resolve({
      lastCommandComment: 'Not implemented',
      lastLogLines:       [],
    });
  }

  lastCommandComment = '';

  noModalDialogs = true;

  requiresRestartReasons(): Promise<RestartReasons> {
    return Promise.resolve({});
  }

  listIntegrations(): Promise<Record<string, string | boolean>> {
    if (os.platform() !== 'win32') {
      throw new Error('This is only expected on Windows');
    }

    return Promise.resolve({
      alpha: true,
      beta:  false,
      gamma: 'some error',
    });
  }

  forwardPort(namespace: string, service: string, k8sPort: number | string, hostPort: number): Promise<number | undefined> {
    return Promise.resolve(12345);
  }

  cancelForward(namespace: string, service: string, k8sPort: number | string): Promise<void> {
    return Promise.resolve();
  }

  // #region VMExecutor
  execCommand(...command: string[]): Promise<void>;
  execCommand(options: execOptions, ...command: string[]): Promise<void>;
  execCommand(options: execOptions & { capture: true }, ...command: string[]): Promise<string>;
  execCommand(optionsOrArg: execOptions | string, ...command: string[]): Promise<void | string> {
    const options: execOptions & { capture?: boolean } = typeof (optionsOrArg) === 'string' ? {} : optionsOrArg;
    const args = (typeof (optionsOrArg) === 'string' ? [optionsOrArg] : []).concat(command);

    if (options.capture) {
      return Promise.resolve(`Mock not executing ${ args.join(' ') }`);
    }

    return Promise.resolve();
  }

  spawn(...command: string[]): ChildProcess {
    return null as unknown as ChildProcess;
  }

  // #endregion

  // #region Events
  eventNames(): Array<keyof KubernetesBackendEvents> {
    return super.eventNames() as Array<keyof KubernetesBackendEvents>;
  }

  listeners<eventName extends keyof KubernetesBackendEvents>(
    event: eventName,
  ): KubernetesBackendEvents[eventName][] {
    return super.listeners(event) as KubernetesBackendEvents[eventName][];
  }

  rawListeners<eventName extends keyof KubernetesBackendEvents>(
    event: eventName,
  ): KubernetesBackendEvents[eventName][] {
    return super.rawListeners(event) as KubernetesBackendEvents[eventName][];
  }
  // #endregion
}

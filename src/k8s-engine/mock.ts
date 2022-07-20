import events from 'events';
import os from 'os';
import util from 'util';
import semver from 'semver';

import { KubernetesBackend, KubernetesError, State, RestartReason } from './k8s';
import ProgressTracker from './progressTracker';
import { Settings } from '@/config/settings';
import Logging from '@/utils/logging';

const console = Logging.mock;

export default class MockBackend extends events.EventEmitter implements KubernetesBackend {
  readonly backend = 'mock';
  state: State = State.STOPPED;
  readonly availableVersions = Promise.resolve([{ version: new semver.SemVer('0.0.0') }]);
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

  isServiceReady(): Promise<boolean> {
    return Promise.resolve(false);
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

  requiresRestartReasons(): Promise<Record<string, RestartReason | undefined>> {
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
}

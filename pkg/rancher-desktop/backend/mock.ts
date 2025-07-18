import events from 'events';
import fs from 'fs';
import os from 'os';
import util from 'util';

import semver from 'semver';

import {
  BackendEvents, BackendSettings, execOptions, RestartReasons, State, VMExecutor,
} from './backend';
import {
  ContainerBasicOptions,
  ContainerComposeExecOptions,
  ContainerComposeOptions,
  ContainerComposePortOptions,
  ContainerEngineClient,
  ContainerRunClientOptions,
  ContainerRunOptions,
  ContainerStopOptions,
  ReadableProcess,
} from './containerClient';
import { KubernetesBackend, KubernetesBackendEvents, KubernetesError } from './k8s';
import ProgressTracker from './progressTracker';

import K3sHelper from '@pkg/backend/k3sHelper';
import { Settings } from '@pkg/config/settings';
import { ChildProcess } from '@pkg/utils/childProcess';
import Logging, { Log } from '@pkg/utils/logging';
import { RecursivePartial } from '@pkg/utils/typeUtils';

const console = Logging.mock;

export default class MockBackend extends events.EventEmitter implements VMExecutor {
  readonly kubeBackend: KubernetesBackend = new MockKubernetesBackend();
  readonly executor = this;
  readonly backend = 'mock';
  cfg:                  BackendSettings | undefined;
  state:                State = State.STOPPED;
  readonly cpus = Promise.resolve(1);
  readonly memory = Promise.resolve(1);
  progress = { current: 0, max: 0 };
  readonly progressTracker = new ProgressTracker((progress) => {
    this.progress = progress;
    this.emit('progress');
  });

  debug = false;

  containerEngineClient = new MockContainerEngineClient();

  getBackendInvalidReason(): Promise<KubernetesError | null> {
    return Promise.resolve(null);
  }

  protected setState(state: State) {
    this.state = state;
    this.emit('state-changed', state);
  }

  async start(config: Settings): Promise<void> {
    if ([State.DISABLED, State.STARTING, State.STARTED].includes(this.state)) {
      await this.stop();
    }
    console.log('Starting mock backend...');
    this.setState(State.STARTING);
    this.cfg = config;
    for (let i = 0; i < 10; i++) {
      this.progressTracker.numeric('Starting mock backend', i, 10);
      await util.promisify(setTimeout)(1_000);
    }
    this.progressTracker.numeric('Starting mock backend', 10, 10);
    await this.kubeBackend.start(config, new semver.SemVer('1.0.0'));
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

  reset(config: Settings): Promise<void> {
    return Promise.resolve();
  }

  ipAddress = Promise.resolve('192.0.2.1');

  getFailureDetails() {
    return Promise.resolve({
      lastCommandComment: 'Not implemented',
      lastLogLines:       [],
    });
  }

  lastCommandComment = '';

  noModalDialogs = true;

  async handleSettingsUpdate(_: BackendSettings): Promise<void> {}

  requiresRestartReasons(config: RecursivePartial<BackendSettings>): Promise<RestartReasons> {
    if (!this.cfg) {
      return Promise.resolve({});
    }

    return this.kubeBackend.requiresRestartReasons(this.cfg, config);
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

  spawn(...command: string[]): ChildProcess;
  spawn(options: execOptions, ...command: string[]): ChildProcess;
  spawn(optionsOrCommand: string | execOptions, ...command: string[]): ChildProcess {
    return null as unknown as ChildProcess;
  }

  readFile(filePath: string, options: { encoding?: BufferEncoding } = {}): Promise<string> {
    return Promise.reject('MockBackend#readFile() not implemented');
  }

  writeFile(filePath: string, fileContents: string, permissions: fs.Mode = 0o644): Promise<void> {
    return Promise.resolve();
  }

  copyFileIn(hostPath: string, vmPath: string): Promise<void> {
    return Promise.reject('MockBackend#copyFileIn() not implemented');
  }

  copyFileOut(vmPath: string, hostPath: string): Promise<void> {
    return Promise.reject('MockBackend#copyFileOut() not implemented');
  }

  // #endregion

  // #region Events
  eventNames(): (keyof BackendEvents)[] {
    return super.eventNames() as (keyof BackendEvents)[];
  }

  listeners<eventName extends keyof BackendEvents>(
    event: eventName,
  ): BackendEvents[eventName][] {
    return super.listeners(event) as BackendEvents[eventName][];
  }

  rawListeners<eventName extends keyof BackendEvents>(
    event: eventName,
  ): BackendEvents[eventName][] {
    return super.rawListeners(event) as BackendEvents[eventName][];
  }
  // #endregion
}

class MockKubernetesBackend extends events.EventEmitter implements KubernetesBackend {
  readonly availableVersions = Promise.resolve([]);
  version = '';
  desiredPort = 9443;

  readonly k3sHelper = new K3sHelper('x86_64');

  cachedVersionsOnly(): Promise<boolean> {
    return Promise.resolve(false);
  }

  listServices() {
    return [];
  }

  forwardPort(namespace: string, service: string, k8sPort: number | string, hostPort: number): Promise<number | undefined> {
    return Promise.resolve(12345);
  }

  cancelForward(namespace: string, service: string, k8sPort: number | string): Promise<void> {
    return Promise.resolve();
  }

  download() {
    return Promise.resolve([undefined, false] as const);
  }

  deleteIncompatibleData() {
    return Promise.resolve();
  }

  install() {
    return Promise.resolve();
  }

  start() {
    return Promise.resolve();
  }

  stop() {
    return Promise.resolve();
  }

  cleanup() {
    return Promise.resolve();
  }

  reset() {
    return Promise.resolve();
  }

  requiresRestartReasons() {
    return Promise.resolve({});
  }

  // #region Events
  eventNames(): (keyof KubernetesBackendEvents)[] {
    return super.eventNames() as (keyof KubernetesBackendEvents)[];
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

class MockContainerEngineClient implements ContainerEngineClient {
  waitForReady(): Promise<void> {
    return Promise.resolve();
  }

  readFile(imageID: string, filePath: string, options?: { encoding?: BufferEncoding; namespace?: string; }): Promise<string> {
    throw new Error('Method not implemented.');
  }

  copyFile(imageID: string, sourcePath: string, destinationDir: string, options?: { namespace?: string; }): Promise<void> {
    throw new Error('Method not implemented.');
  }

  getTags(imageName: string, options?: ContainerBasicOptions): Promise<Set<string>> {
    throw new Error('Method not implemented.');
  }

  run(imageID: string, options?: ContainerRunOptions): Promise<string> {
    throw new Error('Method not implemented.');
  }

  stop(container: string, options?: ContainerStopOptions): Promise<void> {
    throw new Error('Method not implemented.');
  }

  composeUp(options: ContainerComposeOptions): Promise<void> {
    throw new Error('Method not implemented.');
  }

  composeDown(options?: ContainerComposeOptions): Promise<void> {
    throw new Error('Method not implemented.');
  }

  composeExec(options: ContainerComposeExecOptions): Promise<ReadableProcess> {
    throw new Error('Method not implemented.');
  }

  composePort(options: ContainerComposePortOptions): Promise<string> {
    throw new Error('Method not implemented.');
  }

  runClient(args: string[], stdio?: 'ignore', options?: ContainerRunClientOptions): Promise<Record<string, never>>;
  runClient(args: string[], stdio: Log, options?: ContainerRunClientOptions): Promise<Record<string, never>>;
  runClient(args: string[], stdio: 'pipe', options?: ContainerRunClientOptions): Promise<{ stdout: string; stderr: string; }>;
  runClient(args: string[], stdio: 'stream', options?: ContainerRunClientOptions): ReadableProcess;
  runClient(args: string[], stdio?: unknown, options?: ContainerRunClientOptions): unknown {
    return Promise.resolve({ stdout: '', stderr: '' });
  }
}

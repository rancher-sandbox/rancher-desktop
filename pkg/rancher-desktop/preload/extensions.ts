/**
 * This is the preload script that is exposed to extension frontends.
 * It implements the "ddClient" API.
 */

import Electron from 'electron';

import type { SpawnOptions } from '@pkg/main/extensions/types';
import clone from '@pkg/utils/clone';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

/* eslint-disable import/namespace -- that rule doesn't work with TypeScript type-only imports. */
import type { v1 } from '@docker/extension-api-client-types';

// We use a bunch of symbols for names of properties we do not want to reflect
// over.
const stream = Symbol('stream');
const stdout = Symbol('stdout');
const stderr = Symbol('stderr');
const id = Symbol('id');

/**
 * DockerListContainersOptions describes the arguments for
 * ddClient.docker.listContainers()
 */
interface DockerListContainersOptions {
  all?: boolean;
  limit?: number;
  size?: boolean;
  filters?: string;
  namespace?: string;
}

/**
 * DockerListImagesOptions describes the arguments for
 * ddClient.docker.listImages()
 */
interface DockerListImagesOptions {
  all?: boolean;
  filters?: string;
  digests?: boolean;
  namespace?: string;
}

/** execProcess holds the state associated with a v1.ExecProcess. */
interface execProcess {
  /** The identifier for this process. */
  [id]: string;
  [stdout]: string;
  [stderr]: string;
  [stream]: v1.ExecStreamOptions;
}

/**
 * The identifier for the extension (the name of the image).
 */
const extensionId = decodeURIComponent(location.hostname.replace(/(..)/g, '%$1'));

/**
 * The processes that are waiting to complete, keyed by the process ID.
 * This uses weak references so that if the user no longer cares about them we
 * will not either.
 */
const outstandingProcesses: Record<string, WeakRef<execProcess>> = {};

/**
 * Construct a TypeError message that is similar to what the browser would
 * have constructed.
 * @param name The name of the argument.
 * @param expectedType: The name of the type that was expected.
 * @param object The actual object that was passed in (of the incorrect type).
 */
function getTypeErrorMessage(name: string, expectedType: string, object: any) {
  let message = `[ERROR_INVALID_ARG_TYPE]: The "${ name }" argument must be of type ${ expectedType }.`;

  if (typeof object === 'object' && 'constructor' in object && 'name' in object.constructor) {
    message += ` Received an instance of ${ object.constructor.name }`;
  } else {
    message += ` Received ${ typeof object }`;
  }

  return message;
}

/**
 * Given an options object passed to exec(), check if it's a v1.SpawnOptions.
 */
function isSpawnOptions(options: v1.ExecOptions | v1.SpawnOptions): options is v1.SpawnOptions {
  return 'stream' in options;
}

/**
 * Return an exec function for the given scope.
 * @param scope The scope to run the execution in.
 */
function getExec(scope: SpawnOptions['scope']): v1.Exec {
  let nextId = 0;

  function exec(cmd: string, args: string[], options?: v1.ExecOptions): Promise<v1.ExecResult>;
  function exec(cmd: string, args: string[], options: v1.SpawnOptions): v1.ExecProcess;
  function exec(cmd: string, args: string[], options?: v1.ExecOptions | v1.SpawnOptions): Promise<v1.ExecResult> | v1.ExecProcess {
    // Do some minimal parameter validation, since passing these to the backend
    // directly can end up with confusing messages otherwise.
    if (typeof cmd !== 'string') {
      throw new TypeError(getTypeErrorMessage('cmd', 'string', cmd));
    }
    if (!Array.isArray(args)) {
      throw new TypeError(getTypeErrorMessage('args', 'array', args));
    }
    for (const [i, arg] of Object.entries(args)) {
      if (typeof arg !== 'string') {
        throw new TypeError(getTypeErrorMessage(`args[${ i }]`, 'string', arg));
      }
    }
    if (!['undefined', 'string'].includes(typeof options?.cwd)) {
      throw new TypeError(getTypeErrorMessage('options.cwd', 'string', options?.cwd));
    }
    if (typeof options?.env !== 'undefined') {
      if (typeof options.env !== 'object') {
        throw new TypeError(getTypeErrorMessage('options.env', 'object', options.env));
      }
      for (const [k, v] of Object.entries(options.env)) {
        if (!['undefined', 'string'].includes(typeof v)) {
          throw new TypeError(getTypeErrorMessage(`options.env.${ k }`, 'string', v));
        }
      }
    }

    const execId = `${ scope }-${ nextId++ }`;
    // Build options to pass to the main process, while not trusting the input
    // too much.
    const safeOptions: SpawnOptions = {
      command: [`${ cmd }`].concat(Array.from(args).map(arg => `${ arg }`)),
      execId,
      scope,
      ...options?.cwd ? { cwd: options.cwd } : {},
      ...options?.env ? { env: options.env } : {},
    };

    if (options && isSpawnOptions(options)) {
      // Build the object to return to the caller.  We manually define
      // properties with symbol keys so they can't be enumerated (to avoid
      // people accidentally clobbering our stuff).
      const proc = Object.defineProperties({}, {
        [id]: {
          enumerable: false, value: execId, writable: false,
        },
        [stdout]: {
          enumerable: false, value: '', writable: true,
        },
        [stderr]: {
          enumerable: false, value: '', writable: true,
        },
        [stream]: {
          enumerable: false, value: options.stream, writable: false,
        },
        close: {
          value: function() {
            ipcRenderer.send('extensions/spawn/kill', execId);
            delete outstandingProcesses[execId];
          },
        },
      }) as execProcess & v1.ExecProcess;

      outstandingProcesses[execId] = new WeakRef(proc);
      ipcRenderer.send('extensions/spawn/streaming', safeOptions);

      return proc;
    }

    return (async() => {
      const response = await ipcRenderer.invoke('extensions/spawn/blocking', safeOptions);

      console.debug(`spawn/blocking got result:`, response);

      return {
        cmd:    response.cmd,
        signal: typeof response.result === 'string' ? response.result : undefined,
        code:   typeof response.result === 'number' ? response.result : undefined,
        stdout: response.stdout,
        stderr: response.stderr,
        lines() {
          return response.stdout.split(/\r?\n/);
        },
        parseJsonLines() {
          return response.stdout.split(/\r?\n/).filter(line => line).map(line => JSON.parse(line));
        },
        parseJsonObject() {
          return JSON.parse(response.stdout);
        },
      };
    })();
  }

  return exec;
}

function getProcess(id: string): execProcess | undefined {
  const process = outstandingProcesses[id]?.deref();

  if (process) {
    return process;
  }

  // The process handle has gone away on our side, just try to kill it.
  ipcRenderer.send('extensions/spawn/kill', id);
  delete outstandingProcesses[id];
  console.debug(`Process ${ id } not found, discarding.`);
}

ipcRenderer.on('extensions/spawn/output', (event, id, data) => {
  const process = getProcess(id);
  const streamOpts = process?.[stream];

  if (!process || !streamOpts?.onOutput) {
    // Process died, or there's no output handler.
    return;
  }

  if (!streamOpts.splitOutputLines) {
    streamOpts.onOutput(data);

    return;
  }

  for (const key of ['stdout', 'stderr'] as const) {
    const input = (data as Record<string, string>)[key];
    const keySym = { stdout, stderr }[key] as typeof stdout | typeof stderr;

    if (input) {
      process[keySym] += input;
      while (true) {
        const [_match, line, rest] = /^(.*?)\r?\n(.*)$/s.exec(process[keySym]) ?? [];

        if (typeof line === 'undefined') {
          return;
        }
        process[stream].onOutput?.({ [key]: line } as {stdout:string} | {stderr:string});
        process[keySym] = rest;
      }
    }
  }
});

ipcRenderer.on('extensions/spawn/error', (_, id, error) => {
  console.debug(`RDX: Extension ${ id } errored:`, error);
  getProcess(id)?.[stream].onError?.(error);
});

ipcRenderer.on('extensions/spawn/close', (_, id, returnValue) => {
  console.debug(`RDX: Extension ${ id } closed:`, returnValue);
  getProcess(id)?.[stream]?.onClose?.(typeof returnValue === 'number' ? returnValue : -1);
});

class Client implements v1.DockerDesktopClient {
  constructor(info: {arch: string, hostname: string}) {
    Object.assign(this.host, info);
  }

  /**
   * makeRequest is a helper for ddClient.extension.vm.service.<HTTP method>
   * that wraps ddClient.extension.vm.service.request().
   */
  protected makeRequest(method: string, url: string, data?: any): Promise<unknown> {
    return this.request({
      method, url, data, headers: {},
    });
  }

  protected async request(config: v1.RequestConfig): Promise<unknown> {
    try {
      const result = await ipcRenderer.invoke('extensions/vm/http-fetch', config);

      // Parse as JSON if possible (API is unclear).
      try {
        return JSON.parse(result);
      } catch {
        return result;
      }
    } catch (ex) {
      console.debug(`${ config.method } ${ config.url } error:`, ex);
      throw ex;
    }
  }

  extension: v1.Extension = {
    vm: {
      cli:     { exec: getExec('container') },
      service: {
        request: (config: v1.RequestConfig) => this.request(config),
        get:     (url: string) => this.makeRequest('GET', url),
        post:    (url: string, data: any) => this.makeRequest('POST', url, data),
        put:     (url: string, data: any) => this.makeRequest('PUT', url, data),
        patch:   (url: string, data: any) => this.makeRequest('PATCH', url, data),
        delete:  (url: string) => this.makeRequest('DELETE', url),
        head:    (url: string) => this.makeRequest('HEAD', url),
      },
    },
    host:  { cli: { exec: getExec('host') } },
    image: extensionId,
  };

  desktopUI = {
    dialog: {
      showOpenDialog(options: any): Promise<v1.OpenDialogResult> {
        // Use the clone() here to ensure we only pass plain data structures to
        // the main process.
        return ipcRenderer.invoke('extensions/ui/show-open', clone(options));
      },
    },
    navigate: {} as v1.NavigationIntents,
    toast:    {
      success(msg: string) {
        ipcRenderer.send('extensions/ui/toast', 'success', `${ msg }`);
      },
      warning(msg: string) {
        ipcRenderer.send('extensions/ui/toast', 'warning', `${ msg }`);
      },
      error(msg: string) {
        ipcRenderer.send('extensions/ui/toast', 'error', `${ msg }`);
      },
    },
  };

  host: v1.Host = {
    openExternal: (url: string) => {
      ipcRenderer.send('extensions/open-external', url);
    },
    platform: process.platform,
    arch:     '<unknown>',
    hostname: '<unknown>',
  };

  docker = {
    cli:            { exec: getExec('docker-cli') },
    listContainers: async(options: DockerListContainersOptions = {}) => {
      const args = ['ls', '--format={{json .}}', '--no-trunc'];

      args.push(`--all=${ options.all ?? false }`);
      if ((options.limit ?? -1) > -1) {
        args.push(`--last=${ options.limit }`);
      }
      args.push(`--size=${ options.size ?? false }`);
      if (options.filters !== undefined) {
        args.push(`--filter=${ options.filters }`);
      }
      if (options.namespace) {
        args.unshift(`--namespace=${ options.namespace }`);
      }

      const result = await this.docker.cli.exec('container', args);

      if (result.code || result.signal) {
        throw new Error(`failed to list containers: ${ result.stderr }`);
      }

      return result.parseJsonLines();
    },
    listImages: async(options: DockerListImagesOptions = {}) => {
      const args = ['ls', '--format={{json .}}', '--no-trunc'];

      args.push(`--all=${ options.all ?? false }`);
      if (options.filters !== undefined) {
        args.push(`--filter=${ options.filters }`);
      }
      args.push(`--digests=${ options.digests ?? false }`);
      if (options.namespace) {
        args.unshift(`--namespace=${ options.namespace }`);
      }

      const result = await this.docker.cli.exec('image', args);

      if (result.code || result.signal) {
        throw new Error(`failed to list images: ${ result.stderr }`);
      }

      return result.parseJsonLines();
    },
  };
}

export default function initExtensions(): void {
  if (document.location.protocol === 'x-rd-extension:') {
    const hostInfo: { arch: string, hostname: string } = JSON.parse(process.argv.slice(-1).pop() ?? '{}');
    const ddClient = new Client(hostInfo);

    Electron.contextBridge.exposeInMainWorld('ddClient', ddClient);
  } else {
    console.debug(`Not adding extension API to ${ document.location.protocol }`);
  }
}

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
      command: [`${ cmd }`].concat(Array.from(args).map((arg) => {
        return `${ arg }`.replace(/^(["'])(.*)\1$/, '\\2');
      })),
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

      console.debug(`spawn/blocking got result:`, process.env.RD_E2E_TEST ? JSON.stringify(response) : response);

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
        return ipcRenderer.invoke('extensions/ui/show-open', clone(options ?? {}));
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
      // Unfortunately, there's no command line option to just make an API call,
      // and `container ls` by itself doesn't provide all the info.
      const lsArgs = ['ls', '--format={{json .}}', '--no-trunc'];

      lsArgs.push(`--all=${ options.all ?? false }`);
      if ((options.limit ?? -1) > -1) {
        lsArgs.push(`--last=${ options.limit }`);
      }
      if (options.filters !== undefined) {
        lsArgs.push(`--filter=${ options.filters }`);
      }
      if (options.namespace) {
        lsArgs.unshift(`--namespace=${ options.namespace }`);
      }

      const lsResult = await this.docker.cli.exec('container', lsArgs);

      if (lsResult.code || lsResult.signal) {
        throw new Error(`failed to list containers: ${ lsResult.stderr }`);
      }

      const lsContainers = lsResult.parseJsonLines();

      if (lsContainers.length === 0) {
        return [];
      }

      // We need to run `container inspect` to add more info.
      const inspectArgs = [
        '--format={{json .}}',
        options.size ? ['--size=true'] : [],
        lsContainers.map(c => c.ID),
        options.namespace ? [`--namespace=${ options.namespace }`] : [],
      ].flat();

      const inspectResults = await this.docker.cli.exec('inspect', inspectArgs);

      if (inspectResults.code || inspectResults.signal) {
        throw new Error(`failed to inspect containers: ${ inspectResults.stderr }`);
      }

      const inspectContainers = inspectResults.parseJsonLines().flat();

      return lsContainers.map((c) => {
        const details = inspectContainers.find(i => i.Id.startsWith(c.ID));
        const pick = (object: any, ...prop: (string | [string, string])[]) => {
          const result: Record<string, any> = {};

          for (const p of prop) {
            const [key, newKey] = Array.isArray(p) ? p : [p, p];

            if (key in object ?? {}) {
              result[newKey] = object[key];
            }
          }

          return result;
        };

        return {
          ...pick(c, 'Image', 'Command', 'Status'),
          ...pick(details, 'Id', ['Image', 'ImageID'], 'NetworkSettings', 'Mounts'),
          HostConfig: details.HostConfig ?? {},
          SizeRootFs: details.SizeRootFs ?? -1,
          SizeRw:     details.SizeRw ?? -1,
          Ports:      details.NetworkSettings.Ports ?? {},
          ...pick(details.Config, 'Labels'),
          ...pick(details.State, ['Status', 'State']),
          Names:      c.Names.split(/\s+/g),
          Created:    Date.parse(c.CreatedAt).valueOf(),
        };
      });
    },
    listImages: async(options: DockerListImagesOptions = {}) => {
      const lsArgs = ['ls', '--format={{json .}}', '--no-trunc'];

      lsArgs.push(`--all=${ options.all ?? false }`);
      if (options.filters !== undefined) {
        lsArgs.push(`--filter=${ options.filters }`);
      }
      lsArgs.push(`--digests=${ options.digests ?? false }`);
      if (options.namespace) {
        lsArgs.unshift(`--namespace=${ options.namespace }`);
      }

      const lsResult = await this.docker.cli.exec('image', lsArgs);

      if (lsResult.code || lsResult.signal) {
        throw new Error(`failed to list images: ${ lsResult.stderr }`);
      }

      const lsImages = lsResult.parseJsonLines();

      if (lsImages.length === 0) {
        return [];
      }

      const inspectArgs = [
        options.namespace ? [`--namespace=${ options.namespace }`] : [],
        ['--format', 'json'],
        lsImages.map(i => i.ID),
      ].flat();
      const inspectResults = await this.docker.cli.exec('inspect', inspectArgs);

      if (inspectResults.code || inspectResults.signal) {
        throw new Error(`failed to inspect images: ${ inspectResults.stderr }`);
      }

      // When doing JSON format, docker CLI returns an array, but nerdctl
      // returns JSON lines.  ParseJsonLines + flat() deals with the difference.
      const inspectImages = inspectResults.parseJsonLines().flat();
      const mergedImages = lsImages.map((image) => {
        let inspected = inspectImages.find(i => i.Id === image.ID);

        // nerdctl uses the config digest for inspectImages[*].Id (or at least
        // a different value than image.ID); we need to try to match it up to
        // the desired inspect result via digests instead.
        inspected ||= inspectImages.find(i => (i.RepoDigests as any[]).some(d => d.endsWith(image.Digest)));

        return { ...image, ...inspected ?? {} };
      });

      return mergedImages.map((i) => {
        const containers = parseInt(i.Containers, 10);

        return {
          Id:          i.Id,
          ParentId:    i.Parent ?? '',
          RepoTags:    i.RepoTags,
          Created:     Date.parse(i.Created).valueOf(),
          Size:        i.Size,
          SharedSize:  -1,
          VirtualSize: i.VirtualSize ?? i.Size,
          Labels:      i.Config?.Labels ?? {},
          Containers:  isNaN(containers) ? -1 : containers,
        };
      });
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

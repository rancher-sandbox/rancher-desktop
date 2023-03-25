/**
 * This is the preload script that is exposed to extension frontends.
 * It implements the "ddClient" API.
 */

import Electron from 'electron';

import type { SpawnOptions } from '@pkg/main/extensions/types';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

/* eslint-disable import/namespace -- that rule doesn't work with TypeScript type-only imports. */
import type { v1 } from '@docker/extension-api-client-types';

// We use a bunch of symbols for names of properties we do not want to reflect
// over.
const stream = Symbol('stream');
const stdout = Symbol('stdout');
const stderr = Symbol('stderr');
const id = Symbol('id');

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
const extensionId = decodeURIComponent((location.href.match(/:\/\/([^/]+)/)?.[1] ?? '').replace(/(..)/g, '%$1'));

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

  if (typeof object === 'object' && 'constructor' in object && 'name' in object.constructor.name) {
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
      ...(typeof options?.cwd === 'string' ? { cwd: `${ options.cwd }` } : {}),
      ...(options?.env ? { env: Object.fromEntries(Object.entries(options.env).map(([k, v]) => [`${ k }`, `${ v }`])) } : {}),
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

class Client implements v1.DockerDesktopClient {
  constructor(info: {platform: string, arch: string, hostname: string}) {
    Object.assign(this.host, info);
  }

  extension = {
    vm:    { } as v1.ExtensionVM,
    host:  { cli: { exec: getExec('host') } },
    image: extensionId,
  };

  desktopUI = {} as v1.DesktopUI;
  host: v1.Host = {
    openExternal: (url: string) => {
      ipcRenderer.send('extensions/open-external', url);
    },
    platform: '<unknown>',
    arch:     '<unknown>',
    hostname: '<unknown>',
  };

  docker = {} as v1.Docker;
}

export default async function initExtensions(): Promise<void> {
  if (document.location.protocol === 'x-rd-extension:') {
    const info = await ipcRenderer.invoke('extensions/host-info');
    const ddClient = new Client(info);

    Electron.contextBridge.exposeInMainWorld('ddClient', ddClient);
  } else {
    console.debug(`Not adding extension API to ${ document.location.protocol }`);
  }
}

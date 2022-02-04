/**
 * Custom declarations for Electron IPC topics.
 */

import Electron from 'electron';

// Partial<T> (https://www.typescriptlang.org/docs/handbook/utility-types.html#partialtype)
// only allows missing properties on the top level; if anything is given, then all
// properties of that top-level property must exist.  RecursivePartial<T> instead
// allows any descendent properties to be omitted.
type RecursivePartial<T> = {
  [P in keyof T]?:
    T[P] extends (infer U)[] ? RecursivePartial<U>[] :
    // eslint-disable-next-line @typescript-eslint/ban-types
    T[P] extends object ? RecursivePartial<T[P]> :
    T[P];
}

/**
 * IpcMainEvents describes events the renderer can send to the main process,
 * i.e. ipcRenderer.send() -> ipcMain.on().
 */
interface IpcMainEvents {
  'k8s-restart': () => void;
  'settings-read': () => void;
  'k8s-versions': () => void;
  'k8s-reset': (mode: 'fast' | 'wipe') => void;
  'k8s-state': () => void;
  'k8s-current-engine': () => void;
  'k8s-current-port': () => void;
  'k8s-restart-required': () => void;
  'k8s-progress': () => void;
  'k8s-integrations': () => void;
  'k8s-integration-set': (name: string, newState: boolean) => void;
  'k8s-integration-warnings': () => void;
  'factory-reset': () => void;
  'get-app-version': () => void;

  // #region main/update
  'update-state': () => void;
  // Quit and apply the update.
  'update-apply': () => void;
  // #endregion

  // #region main/imageEvents
  'confirm-do-image-deletion': (imageName: string, imageID: string) => void;
  'do-image-build': (taggedImageName: string) => void;
  'do-image-pull': (imageName: string) => void;
  'do-image-scan': (imageName: string) => void;
  'do-image-push': (imageName: string, imageID: string, tag: string) => void;
  'do-image-deletion': (imageName: string, imageID: string) => void;
  'images-namespaces-read': () => void;
  // #endregion

  // #region firstrun
  'firstrun/ready': () => void;
  // #endregion

  // #region kubernetes-errors
  'kubernetes-errors/ready': () => void;
  // #endregion

  'troubleshooting/show-logs': () => void;
}

/**
 * IpcMainInvokeEvents describes handlers describes RPC calls the renderer can
 * invoke on the main process, i.e. ipcRenderer.invoke() -> ipcMain.handle()
 */
interface IpcMainInvokeEvents {
  'settings-write': (arg: RecursivePartial<import('@/config/settings').Settings>) => void;
  'service-fetch': (namespace?: string) => import('@/k8s-engine/k8s').ServiceEntry[];
  'service-forward': (service: {namespace: string, name: string, port: string | number}, state: boolean) => void;
  'get-app-version': () => string;
  'show-message-box': (options: Electron.MessageBoxOptions) => Promise<Electron.MessageBoxReturnValue>;

  // #region main/imageEvents
  'images-mounted': (mounted: boolean) => {imageName: string, tag: string, imageID: string, size: string}[];
  'images-check-state': () => boolean;
  // #endregion
}

/**
 * IpcRendererEvents describes events that the main process may send to the renderer
 * process, i.e. webContents.send() -> ipcRenderer.on().
 */
export interface IpcRendererEvents {
  'settings-update': (settings: import('@/config/settings').Settings) => void;
  'handle-failure': (titlePart: string, message: string) => void;
  'settings-read': (settings: import('@/config/settings').Settings) => void;
  'get-app-version': (version: string) => void;
  'update-state': (state: import('@/main/update').UpdateState) => void;
  'k8s-progress': (progress: Readonly<{current: number, max: number, description?: string, transitionTime?: Date}>) => void;
  'k8s-check-state': (state: import('@/k8s-engine/k8s').State) => void;
  'k8s-current-engine': (engine: import('@/config/settings').ContainerEngine) => void;
  'k8s-current-port': (port: number) => void;
  'k8s-restart-required': (required: Record<string, [any, any] | []>) => void;
  'k8s-versions': (versions: import('@/k8s-engine/k8s').VersionEntry[]) => void;
  'k8s-integrations': (integrations: Record<string, boolean | string>) => void;
  'k8s-integration-warnings': (name: string, warnings: Array<string>) => void;
  'service-changed': (services: import('@/k8s-engine/k8s').ServiceEntry[]) => void;
  'kubernetes-errors-details': (titlePart: string, mainMessage: string, failureDetails: import('@/k8s-engine/k8s').FailureDetails) => void;

  // #region Images
  'images-process-cancelled': () => void;
  'images-process-ended': (exitCode: number) => void;
  'images-process-output': (data: string, isStdErr: boolean) => void;
  'ok:images-process-output': (data: string) => void;
  'images-changed': (images: {imageName: string, tag: string, imageID: string, size: string}[]) => void;
  'images-check-state': (state: boolean) => void;
  'images-namespaces': (namespaces: string[]) => void;
  // #endregion
}

declare module 'electron' {
  // We mark the default signatures as deprecated, so that ESLint will throw an
  // error if they are used.

  interface IpcMain {
    on<eventName extends keyof IpcMainEvents>(
      channel: eventName,
      listener: (event: Electron.IpcMainEvent, ...args: globalThis.Parameters<IpcMainEvents[eventName]>) => void
    ): this;
    /** @deprecated */
    on(channel: string, listener: (...args: any[]) => void): this;

    once<eventName extends keyof IpcMainEvents>(
      channel: eventName,
      listener: (event: Electron.IpcMainEvent, ...args: globalThis.Parameters<IpcMainEvents[eventName]>) => void
    ): this;
    /** @deprecated */
    once(channel: string, listener: (...args: any[]) => void): this;

    removeListener<eventName extends keyof IpcMainEvents>(
      channel: eventName,
      listener: (event: Electron.IpcMainEvent, ...args: globalThis.Parameters<IpcMainEvents[eventName]>) => void
    ): this;
    /** @deprecated */
    removeListener(channel: string, listener: (...args: any[]) => void): this;

    removeAllListeners<eventName extends keyof IpcMainEvents>(channel?: eventName): this;
    /** @deprecated */
    removeAllListeners(channel: string): this;

    handle<eventName extends keyof IpcMainInvokeEvents>(
      channel: eventName,
      listener: (
        event: Electron.IpcMainInvokeEvent,
        ...args: globalThis.Parameters<IpcMainInvokeEvents[eventName]>
      ) => Promise<ReturnType<IpcMainInvokeEvents[eventName]>> | ReturnType<IpcMainInvokeEvents[eventName]>
    ): this;
    /** @deprecated */
    handle(channel: string, listener: (...args: any[]) => any): this;

    handleOnce<eventName extends keyof IpcMainInvokeEvents>(
      channel: eventName,
      listener: (
        event: Electron.IpcMainInvokeEvent,
        ...args: globalThis.Parameters<IpcMainInvokeEvents[eventName]>
      ) => Promise<ReturnType<IpcMainInvokeEvents[eventName]>> | ReturnType<IpcMainInvokeEvents[eventName]>
    ): this;
    /** @deprecated */
    handleOnce(channel: string, listener: (...args: any[]) => any): this;

    removeHandler<eventName extends keyof IpcMainInvokeEvents>(channel: eventName): this;
    /** @deprecated */
    removeHandler(channel: string): this;
  }

  interface IpcRenderer {
    on<eventName extends keyof IpcRendererEvents>(
      channel: eventName,
      listener: (event: Electron.IpcRendererEvent, ...args: globalThis.Parameters<IpcRendererEvents[eventName]>) => void
    ): this;
    /** @deprecated */
    on(channel: string, listener: (...args: any[]) => void): this;

    once<eventName extends keyof IpcRendererEvents>(
      channel: eventName,
      listener: (event: Electron.IpcRendererEvent, ...args: globalThis.Parameters<IpcRendererEvents[eventName]>) => void
    ): this;
    /** @deprecated */
    once(channel: string, listener: (...args: any[]) => void): this;

    removeListener<eventName extends keyof IpcRendererEvents>(
      channel: eventName,
      listener: (event: Electron.IpcRendererEvent, ...args: globalThis.Parameters<IpcRendererEvents[eventName]>) => void
    ): this;
    /** @deprecated */
    removeListener(channel: string, listener: (...args: any[]) => void): this;

    removeAllListeners<eventName extends keyof IpcRendererEvents>(channel?: eventName): this;
    /** @deprecated */
    removeAllListeners(channel: string): this;

    // When the renderer side is implement in JavaScript (rather than TypeScript),
    // the type checking for arguments seems to fail and always prefers the
    // generic overload (which we want to avoid) rather than the specific overload
    // we provide here.  Until we convert all of the Vue components to TypeScript,
    // for now we will need to forego checking the arguments.
    send<eventName extends keyof IpcMainEvents>(
      channel: eventName,
      ...args: any[],
    ): this;
    /** @deprecated */
    send(channel: string, ...args: any[]): void;

    // When the renderer side is implement in JavaScript (rather than TypeScript),
    // the type checking for arguments seems to fail and always prefers the
    // generic overload (which we want to avoid) rather than the specific overload
    // we provide here.  Until we convert all of the Vue components to TypeScript,
    // for now we will need to forego checking the arguments.
    invoke<eventName extends keyof IpcMainInvokeEvents>(
      channel: eventName,
      ...args: any[],
    ): Promise<ReturnType<IpcMainInvokeEvents[eventName]>>;
    /** @deprecated */
    invoke(channel: string, ...args: any[]): any;
  }
}

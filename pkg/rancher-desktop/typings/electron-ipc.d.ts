/**
 * Custom declarations for Electron IPC topics.
 */

import Electron from 'electron';

import type { ServiceEntry } from '@pkg/backend/k8s';
import type { RecursivePartial } from '@pkg/utils/typeUtils';
/**
 * IpcMainEvents describes events the renderer can send to the main process,
 * i.e. ipcRenderer.send() -> ipcMain.on().
 */
export interface IpcMainEvents {
  'k8s-restart': () => void;
  'settings-read': () => void;
  'k8s-versions': () => void;
  'k8s-reset': (mode: 'fast' | 'wipe') => void;
  'k8s-state': () => void;
  'k8s-current-engine': () => void;
  'k8s-current-port': () => void;
  'k8s-progress': () => void;
  'k8s-integrations': () => void;
  'k8s-integration-set': (name: string, newState: boolean) => void;
  'factory-reset': (keepSystemImages: boolean) => void;
  'get-app-version': () => void;
  'app-ready': () => void;
  'update-network-status': (status: boolean) => void;

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
  'do-image-deletion-batch': (images: string[]) => void;
  'images-namespaces-read': () => void;
  // #endregion

  // #region dialog
  'dialog/load': () => void;
  'dialog/ready': () => void;
  'dialog/mounted': () => void;
  /** For message box only */
  'dialog/close': (...args: any[]) => void;
  // #endregion

  // #region sudo-prompt
  'sudo-prompt/closed': (suppress: boolean) => void;
  // #endregion

  // #region kubernetes-errors
  'kubernetes-errors/ready': () => void;
  // #endregion

  // #region Preferences
  'preferences-open': () => void;
  'preferences-close': () => void;
  'preferences-set-dirty': (isDirty: boolean) => void;
  // #endregion

  'show-logs': () => void;

  /** @deprecated */
  'api-get-credentials': () => void;

  'dashboard-open': () => void;
  'dashboard-close': () => void;

  'diagnostics/run': () => void;

  /** Only for the preferences window */
  'preferences/load': () => void;

  'help/preferences/open-url': () => void;
}

/**
 * IpcMainInvokeEvents describes handlers describes RPC calls the renderer can
 * invoke on the main process, i.e. ipcRenderer.invoke() -> ipcMain.handle()
 */
export interface IpcMainInvokeEvents {
  'settings-write': (arg: RecursivePartial<import('@pkg/config/settings').Settings>) => void;
  'transient-settings-fetch': () => import('@pkg/config/transientSettings').TransientSettings;
  'transient-settings-update': (arg: RecursivePartial<import('@pkg/config/transientSettings').TransientSettings>) => void;
  'service-fetch': (namespace?: string) => import('@pkg/backend/k8s').ServiceEntry[];
  'service-forward': (service: ServiceEntry, state: boolean) => void;
  'get-app-version': () => string;
  'show-message-box': (options: Electron.MessageBoxOptions) => Promise<Electron.MessageBoxReturnValue>;
  'api-get-credentials': () => { user: string, password: string, port: number, pid: number };

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
  'settings-update': (settings: import('@pkg/config/settings').Settings) => void;
  'settings-read': (settings: import('@pkg/config/settings').Settings) => void;
  'get-app-version': (version: string) => void;
  'update-state': (state: import('@pkg/main/update').UpdateState) => void;
  'k8s-progress': (progress: Readonly<{current: number, max: number, description?: string, transitionTime?: Date}>) => void;
  'k8s-check-state': (state: import('@pkg/backend/k8s').State) => void;
  'k8s-current-engine': (engine: import('@pkg/config/settings').ContainerEngine) => void;
  'k8s-current-port': (port: number) => void;
  'k8s-versions': (versions: import('@pkg/backend/k8s').VersionEntry[], cachedOnly: boolean) => void;
  'k8s-integrations': (integrations: Record<string, boolean | string>) => void;
  'service-changed': (services: ServiceEntry[]) => void;
  'service-error': (service: ServiceEntry, errorMessage: string) => void;
  'kubernetes-errors-details': (titlePart: string, mainMessage: string, failureDetails: import('@pkg/backend/k8s').FailureDetails) => void;
  'update-network-status': (status: boolean) => void;

  // #region Images
  'images-process-cancelled': () => void;
  'images-process-ended': (exitCode: number) => void;
  'images-process-output': (data: string, isStdErr: boolean) => void;
  'ok:images-process-output': (data: string) => void;
  'images-changed': (images: {imageName: string, tag: string, imageID: string, size: string}[]) => void;
  'images-check-state': (state: boolean) => void;
  'images-namespaces': (namespaces: string[]) => void;
  // #endregion

  // #endregion

  // #region dialog
  'dialog/populate': (...args: any) => void;
  'dialog/size': (size: {width: number, height: number}) => void;
  'dialog/options': (...args: any) => void;
  'dashboard-open': () => void;
  // #endregion

  // #region api
  'api-credentials': (credentials: {user: string, password: string, port: number}) => void;
  // #endregion
}

/**
 * Custom declarations for Electron IPC topics.
 */

import Electron from 'electron';
import semver from 'semver';

import type { ServiceEntry } from '@pkg/backend/k8s';
import { SnapshotDialog, SnapshotEvent } from '@pkg/main/snapshots/types';
import type { Direction, RecursivePartial } from '@pkg/utils/typeUtils';
/**
 * IpcMainEvents describes events the renderer can send to the main process,
 * i.e. ipcRenderer.send() -> ipcMain.on().
 */
export interface IpcMainEvents {
  'backend-state-check': () => string;
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
  'update-network-status': (status: boolean) => void;

  // #region main/update
  'update-state': () => void;
  // Quit and apply the update.
  'update-apply': () => void;
  // #endregion

  // #region main/containerEvents
  'do-containers-exec': (command: string, containerId: string[]) => void;
  'containers-process-output': (data: string, isStdErr: boolean) => void;
  // #endregion

  // #region main/imageEvents
  'confirm-do-image-deletion': (imageName: string, imageID: string) => void;
  'do-image-build': (taggedImageName: string) => void;
  'do-image-pull': (imageName: string) => void;
  'do-image-scan': (imageName: string, namespace: string) => void;
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
  'dialog/error': (args: Record<string, string>) => void;
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
  'get-debugging-statuses': () => void;
  // #endregion

  'show-logs': () => void;

  'dashboard-open': () => void;
  'dashboard-close': () => void;

  'diagnostics/run': () => void;

  /** Only for the preferences window */
  'preferences/load': () => void;

  'help/preferences/open-url': () => void;

  // #region Extensions
  'extensions/open': (id: string, path: string) => void;
  'extensions/close': () => void;
  'extensions/open-external': (url: string) => void;
  'extensions/spawn/kill': (execId: string) => void;
  /** Execute the given command, streaming results back via events. */
  'extensions/spawn/streaming': (
    options: import('@pkg/main/extensions/types').SpawnOptions
  ) => void;
  /** Show a notification */
  'extensions/ui/toast': (
    level: 'success' | 'warning' | 'error',
    message: string
  ) => void;
  'ok:extensions/getContentArea': (payload: { top: number, right: number, bottom: number, left: number }) => void;
  // #endregion

  // #region Snapshots
  'snapshot': (event: SnapshotEvent | null) => void;
  'snapshot/cancel': () => void;
  // #endregion
}

/**
 * IpcMainInvokeEvents describes handlers describes RPC calls the renderer can
 * invoke on the main process, i.e. ipcRenderer.invoke() -> ipcMain.handle()
 */
export interface IpcMainInvokeEvents {
  'get-locked-fields': () => import('@pkg/config/settings').LockedSettingsType;
  'settings-write': (arg: RecursivePartial<import('@pkg/config/settings').Settings>) => void;
  'transient-settings-fetch': () => import('@pkg/config/transientSettings').TransientSettings;
  'transient-settings-update': (arg: RecursivePartial<import('@pkg/config/transientSettings').TransientSettings>) => void;
  'service-fetch': (namespace?: string) => import('@pkg/backend/k8s').ServiceEntry[];
  'service-forward': (service: ServiceEntry, state: boolean) => void;
  'get-app-version': () => string;
  'show-message-box': (options: Electron.MessageBoxOptions) => Electron.MessageBoxReturnValue;
  'show-message-box-rd': (options: Electron.MessageBoxOptions, modal?: boolean) => any;
  'api-get-credentials': () => { user: string, password: string, port: number };
  'k8s-progress': () => Readonly<{current: number, max: number, description?: string, transitionTime?: Date}>;

  // #region main/imageEvents
  'images-mounted': (mounted: boolean) => {imageName: string, tag: string, imageID: string, size: string}[];
  'images-check-state': () => boolean;
  // #endregion

  // #region extensions
  /** Execute the given command and return the results. */
  'extensions/spawn/blocking': (options: import('@pkg/main/extensions/types').SpawnOptions) => import('@pkg/main/extensions/types').SpawnResult;
  'extensions/ui/show-open': (options: import('electron').OpenDialogOptions) => import('electron').OpenDialogReturnValue;
  /* Fetch data from the backend, or arbitrary host ignoring CORS. */
  'extensions/vm/http-fetch': (config: import('@docker/extension-api-client-types').v1.RequestConfig) => import('@docker/extension-api-client-types').v1.ServiceError;
  // #endregion

  // #region Versions
  'versions/macOs': () => semver.SemVer;
  // #endregion

  // #region Host
  'host/isArm': () => boolean;
  // #endregion

  // #region Snapshots
  'show-snapshots-confirm-dialog': (options: { window: Partial<Electron.MessageBoxOptions>, format: SnapshotDialog }) => any;
  'show-snapshots-blocking-dialog': (options: { window: Partial<Electron.MessageBoxOptions>, format: SnapshotDialog }) => any;
  // #endregion
}

/**
 * IpcRendererEvents describes events that the main process may send to the renderer
 * process, i.e. webContents.send() -> ipcRenderer.on().
 */
export interface IpcRendererEvents {
  'backend-locked': (action?: string) => void;
  'backend-unlocked': () => void;
  'settings-update': (
    settings: import('@pkg/config/settings').Settings
  ) => void;
  'settings-read': (settings: import('@pkg/config/settings').Settings) => void;
  'get-app-version': (version: string) => void;
  'update-state': (state: import('@pkg/main/update').UpdateState) => void;
  'always-debugging': (status: boolean) => void;
  'is-debugging': (status: boolean) => void;
  'k8s-progress': (
    progress: Readonly<{
      current: number;
      max: number;
      description?: string;
      transitionTime?: Date;
    }>
  ) => void;
  'k8s-check-state': (state: import('@pkg/backend/k8s').State) => void;
  'k8s-current-engine': (
    engine: import('@pkg/config/settings').ContainerEngine
  ) => void;
  'k8s-current-port': (port: number) => void;
  'k8s-versions': (
    versions: import('@pkg/utils/kubeVersions').VersionEntry[],
    cachedOnly: boolean
  ) => void;
  'k8s-integrations': (integrations: Record<string, boolean | string>) => void;
  'service-changed': (services: ServiceEntry[]) => void;
  'service-error': (service: ServiceEntry, errorMessage: string) => void;
  'kubernetes-errors-details': (
    titlePart: string,
    mainMessage: string,
    failureDetails: import('@pkg/backend/k8s').FailureDetails
  ) => void;
  'update-network-status': (status: boolean) => void;

  // #region Images
  'images-process-cancelled': () => void;
  'images-process-ended': (exitCode: number) => void;
  'images-process-output': (data: string, isStdErr: boolean) => void;
  'ok:images-process-output': (data: string) => void;
  'images-changed': (
    images: { imageName: string; tag: string; imageID: string; size: string }[]
  ) => void;
  'images-check-state': (state: boolean) => void;
  'images-namespaces': (namespaces: string[]) => void;
  'container-process-output': (data: string, isStdErr: boolean) => void;
  // #endregion

  // #region dialog
  'dialog/mounted': () => void;
  'dialog/populate': (...args: any) => void;
  'dialog/size': (size: { width: number; height: number }) => void;
  'dialog/options': (...args: any) => void;
  'dialog/close': (...args: any) => void;
  'dialog/error': (args: any) => void;
  'dialog/info': (args: Record<string, string>) => void;
  'dashboard-open': () => void;
  // #endregion

  // #region tab navigation
  route: (route: {
    name?: string;
    path?: string;
    direction?: Direction;
  }) => void;
  // #endregion

  // #region extensions
  // The list of installed extensions may have changed.
  'extensions/changed': () => void;
  'extensions/getContentArea': () => void;
  'extensions/open': (id: string, path: string) => void;
  'err:extensions/open': () => void;
  'extensions/close': () => void;
  'extensions/spawn/close': (id: string, code: number) => void;
  'extensions/spawn/error': (id: string, error: Error | NodeJS.Signals) => void;
  'extensions/spawn/output': (
    id: string,
    data: { stdout: string } | { stderr: string }
  ) => void;
  'ok:extensions/uninstall': (id: string) => void;
  // #endregion

  // #region window
  'window/blur': (state: boolean) => void;
  // #endregion

  // #region preferences
  'preferences/changed': () => void;
  // #endregion

  // #region Versions
  'versions/macOs': (macOsVersion: semver.SemVer) => void;
  // #endregion

  // #region Host
  'host/isArm': (isArm: boolean) => void;
  // #endregion

  // #region Snapshots
  'snapshot': (event: SnapshotEvent | null) => void;
  'snapshot/cancel': () => void;
  // #endregion
}

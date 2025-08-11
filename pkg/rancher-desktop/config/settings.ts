// This file contains exportable types and constants used for managing preferences
// All the actual data and functions are in settingsImpl.ts

import os from 'os';

import { PathManagementStrategy } from '@pkg/integrations/pathManager';
import { RecursivePartial } from '@pkg/utils/typeUtils';

export const CURRENT_SETTINGS_VERSION = 16 as const;

export enum VMType {
  QEMU = 'qemu',
  VZ = 'vz',
}
export enum ContainerEngine {
  NONE = '',
  CONTAINERD = 'containerd',
  MOBY = 'moby',
}

export const ContainerEngineNames: Record<ContainerEngine, string> = {
  [ContainerEngine.NONE]:       '',
  [ContainerEngine.CONTAINERD]: 'containerd',
  [ContainerEngine.MOBY]:       'dockerd',
};

export enum MountType {
  NINEP = '9p',
  REVERSE_SSHFS = 'reverse-sshfs',
  VIRTIOFS = 'virtiofs',
}

export enum ProtocolVersion {
  NINEP2000 = '9p2000',
  NINEP2000_U = '9p2000.u',
  NINEP2000_L = '9p2000.L',
}

export enum SecurityModel {
  PASSTHROUGH = 'passthrough',
  MAPPED_XATTR = 'mapped-xattr',
  MAPPED_FILE = 'mapped-file',
  NONE = 'none',
}

export enum CacheMode {
  NONE = 'none',
  LOOSE = 'loose',
  FSCACHE = 'fscache',
  MMAP = 'mmap',
}

export class SettingsError extends Error {
  toString() {
    // This is needed on linux. Without it, we get a randomish replacement
    // for 'SettingsError' (like 'ys Error')
    return `SettingsError: ${ this.message }`;
  }
}

export const defaultSettings = {
  version:     CURRENT_SETTINGS_VERSION,
  application: {
    adminAccess: false,
    debug:       false,
    extensions:  {
      allowed: {
        enabled: false,
        list:    [] as string[],
      },
      /** Installed extensions, mapping to the installed version (tag). */
      installed: { } as Record<string, string>,
    },
    pathManagementStrategy: process.platform === 'win32' ? PathManagementStrategy.Manual : PathManagementStrategy.RcFiles,
    telemetry:              { enabled: true },
    /** Whether we should check for updates and apply them. */
    updater:                { enabled: true },
    autoStart:              false,
    startInBackground:      false,
    hideNotificationIcon:   false,
    window:                 { quitOnClose: false },
  },
  containerEngine: {
    allowedImages: {
      enabled:  false,
      patterns: [] as string[],
    },
    name: ContainerEngine.MOBY,
  },
  virtualMachine: {
    memoryInGB: 2,
    numberCPUs: 2,
    /** can only be set to VMType.VZ on macOS Ventura and later */
    type:       process.platform === 'darwin' && parseInt(os.release(), 10) >= 23 ? VMType.VZ : VMType.QEMU,
    /** can only be used when type is VMType.VZ, and only on aarch64 */
    useRosetta: false,
    mount:      {
      // Mount type defaults to virtiofs when using VZ.
      type: process.platform === 'darwin' && parseInt(os.release(), 10) >= 23 ? MountType.VIRTIOFS : MountType.REVERSE_SSHFS,
    },
  },
  WSL:        { integrations: {} as Record<string, boolean> },
  kubernetes: {
    /** The version of Kubernetes to launch, as a semver (without v prefix). */
    version: '',
    port:    6443,
    enabled: true,
    options: { traefik: true, flannel: true },
    ingress: { localhostOnly: false },
  },
  portForwarding: { includeKubernetesServices: false },
  images:         {
    showAll:   true,
    namespace: 'default',
  },
  containers: {
    showAll:   true,
    namespace: 'default',
  },
  diagnostics: {
    showMuted:   false,
    mutedChecks: {} as Record<string, boolean>,
  },
  /**
   * Experimental settings
   */
  experimental: {
    containerEngine: { webAssembly: { enabled: false } },
    /** can only be enabled if containerEngine.webAssembly.enabled is true */
    kubernetes:      { options: { spinkube: false } },
    virtualMachine:  {
      mount: {
        '9p': {
          securityModel:   SecurityModel.NONE,
          protocolVersion: ProtocolVersion.NINEP2000_L,
          msizeInKib:      128,
          cacheMode:       CacheMode.MMAP,
        },
      },
      proxy: {
        enabled:  false,
        address:  '',
        password: '',
        port:     3128,
        username: '',
        noproxy:  ['0.0.0.0/8', '10.0.0.0/8', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16',
          '224.0.0.0/4', '240.0.0.0/4'],
      },
      /** Lima only: use SSH port forwarding instead of gRPC. */
      sshPortForwarder: true,
    },
  },
};

export type Settings = typeof defaultSettings;

// A settings-like type with a subset of all the fields of defaultSettings,
// but all leaves are set to `true`.
export type LockedSettingsType = Record<string, any>;

export interface DeploymentProfileType {
  defaults: RecursivePartial<Settings>;
  locked:   RecursivePartial<Settings>;
}

// Imported from dashboard/config/settings.js
// Setting IDs
export const SETTING = { PL_RANCHER_VALUE: 'rancher' };

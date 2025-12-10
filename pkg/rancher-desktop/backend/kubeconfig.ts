// kubernetes-client/javascript doesn't have support for the `proxy-url` cluster field.
// We are providing variants of loadFromString() and exportConfig() that do.

import childProcess, { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { findHomeDir, KubeConfig } from '@kubernetes/client-node';
import {
  ActionOnInvalid,
  ConfigOptions,
  exportContext,
  exportUser,
  newContexts,
  newUsers,
} from '@kubernetes/client-node/dist/config_types';
import _ from 'lodash';
import yaml from 'yaml';

import { executable } from '@pkg/utils/resources';

interface Cluster {
  readonly name:           string;
  readonly caData?:        string;
  caFile?:                 string;
  readonly server:         string;
  readonly skipTLSVerify:  boolean;
  readonly tlsServerName?: string;
  readonly proxyUrl?:      string;
}

export function loadFromString(kubeConfig : KubeConfig, config: string, opts?: Partial<ConfigOptions>): void {
  const obj = yaml.parse(config);

  kubeConfig.clusters = newClusters(obj.clusters, opts);
  kubeConfig.contexts = newContexts(obj.contexts, opts);
  kubeConfig.users = newUsers(obj.users, opts);
  kubeConfig.currentContext = obj['current-context'];
}

function newClusters(a: any, opts?: Partial<ConfigOptions>): Cluster[] {
  const options = Object.assign({ onInvalidEntry: ActionOnInvalid.THROW }, opts || {});

  return _.compact(_.map(a, clusterIterator(options.onInvalidEntry)));
}

function exportCluster(cluster: Cluster): any {
  return {
    name:    cluster.name,
    cluster: {
      server:                       cluster.server,
      'certificate-authority-data': cluster.caData,
      'certificate-authority':      cluster.caFile,
      'insecure-skip-tls-verify':   cluster.skipTLSVerify,
      'proxy-url':                  cluster.proxyUrl,
      'tls-server-name':            cluster.tlsServerName,
    },
  };
}

function clusterIterator(onInvalidEntry: ActionOnInvalid): _.ListIterator<any, Cluster | null> {
  return (elt: any, i: number, list: _.List<any>): Cluster | null => {
    try {
      if (!elt.name) {
        throw new Error(`clusters[${ i }].name is missing`);
      }
      if (!elt.cluster) {
        throw new Error(`clusters[${ i }].cluster is missing`);
      }
      if (!elt.cluster.server) {
        throw new Error(`clusters[${ i }].cluster.server is missing`);
      }

      return {
        caData:        elt.cluster['certificate-authority-data'],
        caFile:        elt.cluster['certificate-authority'],
        name:          elt.name,
        proxyUrl:      elt.cluster['proxy-url'],
        server:        elt.cluster.server.replace(/\/$/, ''),
        skipTLSVerify: elt.cluster['insecure-skip-tls-verify'] === true,
        tlsServerName: elt.cluster['tls-server-name'],
      };
    } catch (err) {
      switch (onInvalidEntry) {
      case ActionOnInvalid.FILTER:
        return null;
      case ActionOnInvalid.THROW:
      default:
        throw err;
      }
    }
  };
}

export function exportConfig(config : KubeConfig): string {
  const configObj = {
    apiVersion:        'v1',
    kind:              'Config',
    clusters:          config.clusters.map(exportCluster),
    users:             config.users.map(exportUser),
    contexts:          config.contexts.map(exportContext),
    preferences:       {},
    'current-context': config.getCurrentContext(),
  };

  return JSON.stringify(configObj);
}

/**
 * Get the paths to the kubernetes client config path.
 * This is mainly useful for watching configuration changes.
 */
export async function getKubeConfigPaths(): Promise<string[]> {
  async function hasAccess(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
      return false;
    }

    return true;
  }

  if (process.env.KUBECONFIG && process.env.KUBECONFIG.length > 0) {
    const results: string[] = [];

    for (const filePath of process.env.KUBECONFIG.split(path.delimiter)) {
      if (await hasAccess(filePath)) {
        results.push(filePath);
      }
    }

    return results;
  }

  // We do not support locating kubeconfig files inside WSL distros, nor
  // in-cluster configs, so we only need to check the one path.
  return [path.join(findHomeDir() ?? os.homedir(), '.kube', 'config')];
}

// The K8s JS library will get the current context but does not have the ability
// to save the context. The current version of the package targets k8s 1.18 and
// there are new config file features (e.g., proxy) that may be lost by outputting
// the config with the library. So, we drop down to kubectl for this.
export function setCurrentContext(ctx: string, exitfunc: (code: number | null, signal: NodeJS.Signals | null) => void) {
  const opts: childProcess.SpawnOptions = {};

  opts.env = { ...process.env };

  const bat = spawn(executable('kubectl'), ['config', 'use-context', ctx], opts);

  // TODO: For data toggle this based on a debug mode
  bat.stdout?.on('data', (data) => {
    console.log(data.toString());
  });

  bat.stderr?.on('data', (data) => {
    console.error(data.toString());
  });

  bat.on('exit', exitfunc);
}

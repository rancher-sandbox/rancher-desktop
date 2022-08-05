// kubernetes-client/javascript doesn't have support for the `proxy-url` cluster field.
// We are providing variants of loadFromString() and exportConfig() that do.

import { KubeConfig } from '@kubernetes/client-node';
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

interface Cluster {
  readonly name: string;
  readonly caData?: string;
  caFile?: string;
  readonly server: string;
  readonly skipTLSVerify: boolean;
  readonly tlsServerName?: string;
  readonly proxyUrl?: string;
}

export function loadFromString(kubeConfig : KubeConfig, config: string, opts?: Partial<ConfigOptions>): void {
  const obj = yaml.parse(config) as any;

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

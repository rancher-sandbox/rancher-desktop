import { Buffer } from 'buffer';
import { spawn } from 'child_process';
import { Console } from 'console';
import net from 'net';
import path from 'path';
import tls from 'tls';
import util from 'util';

import * as k8s from '@kubernetes/client-node';
import * as childProcess from '@/utils/childProcess';
import * as K8s from '@/k8s-engine/k8s';
import Logging from '@/utils/logging';
import resources from '@/resources';
import * as imageProcessor from '@/k8s-engine/images/imageProcessor';

const KUBE_CONTEXT = 'rancher-desktop';

const console = new Console(Logging.images.stream);

function defined<T>(input: T | undefined | null): input is T {
  return typeof input !== 'undefined' && input !== null;
}

class KimImageProcessor extends imageProcessor.ImageProcessor {
  protected async runImagesCommand(args: string[], sendNotifications = true): Promise<imageProcessor.childResultType> {
    // Insert options needed for all calls to kim.
    const finalArgs = ['--context', KUBE_CONTEXT].concat(args);

    return await this.processChildOutput(spawn(resources.executable('kim'), finalArgs), args[0], sendNotifications);
  }

  /**
   * Determine if the KimImageProcessor service needs to be reinstalled.
   */
  async isInstallValid(mgr: K8s.KubernetesBackend, endpoint?: string): Promise<boolean> {
    const host = await mgr.ipAddress;

    if (!host) {
      return false;
    }

    const client = new k8s.KubeConfig();

    client.loadFromDefault();
    client.setCurrentContext(KUBE_CONTEXT);
    const api = client.makeApiClient(k8s.CoreV1Api);

    // Remove any stale pods; do this first, as we may end up having an invalid
    // configuration but with stale pods.  Note that `kim builder install --force`
    // will _not_ fix any stale pods.  We need to wait for the node IP to be
    // correct first, though, to ensure that we don't end up with a recreated
    // pod with the stale address.
    await this.waitForNodeIP(api, host);
    await this.removeStalePods(api);

    const wantedEndpoint = endpoint || host;

    // Check if the endpoint has the correct address
    try {
      const { body: endpointBody } = await api.readNamespacedEndpoints('builder', 'kube-image');
      const subset = endpointBody.subsets?.find(subset => subset.ports?.some(port => port.name === 'kim'));

      if (!(subset?.addresses || []).some(address => address.ip === wantedEndpoint)) {
        console.log('Existing kim install invalid: incorrect endpoint address.');

        return false;
      }
    } catch (ex) {
      if (ex.statusCode === 404) {
        console.log('Existing kim install invalid: missing endpoint');

        return false;
      }
      console.error('Error looking for endpoints:', ex);
      throw ex;
    }

    // Check if the certificate has the correct address
    const { body: secretBody } = await api.readNamespacedSecret('kim-tls-server', 'kube-image');
    const encodedCert = (secretBody.data || {})['tls.crt'];

    // If we don't have a cert, that's fine — kim will fix it.
    if (encodedCert) {
      const cert = Buffer.from(encodedCert, 'base64');
      const secureContext = tls.createSecureContext({ cert });
      const socket = new tls.TLSSocket(new net.Socket(), { secureContext });
      const parsedCert = socket.getCertificate();

      console.log(parsedCert);
      if (parsedCert && 'subjectaltname' in parsedCert) {
        const { subjectaltname } = parsedCert;
        const names = subjectaltname.split(',').map(s => s.trim());
        const acceptable = [`IP Address:${ wantedEndpoint }`, `DNS:${ wantedEndpoint }`];

        if (!names.some(name => acceptable.includes(name))) {
          console.log(`Existing kim install invalid: incorrect certificate (${ subjectaltname } does not contain ${ wantedEndpoint }).`);

          return false;
        }
      }
    }

    return true;
  }

  /**
   * Wait for the Kubernetes node to have the expected IP address.
   *
   * When the (single-node) cluster initially starts up, the node (internal)
   * address can take a while to be updated.
   * @param api API to communicate with Kubernetes.
   * @param hostAddr The expected node address.
   */
  protected async waitForNodeIP(api: k8s.CoreV1Api, hostAddr: string) {
    console.log(`Waiting for Kubernetes node IP to become ${ hostAddr }...`);
    while (true) {
      const { body: nodeList } = await api.listNode();
      const addresses = nodeList.items
        .flatMap(node => node.status?.addresses)
        .filter(defined)
        .filter(address => address.type === 'InternalIP')
        .flatMap(address => address.address);

      if (addresses.includes(hostAddr)) {
        break;
      }
      await util.promisify(setTimeout)(1_000);
    }
  }

  /**
   * When we start the cluster, we may have leftover pods from the builder
   * daemonset that have stale addresses.  They will not work correctly (not
   * listening on the new address), but their existence will prevent a new,
   * correct pod from being created.
   *
   * @param api API to communicate with Kubernetes.
   * @param hostAddr The expected node address.
   */
  protected async removeStalePods(api: k8s.CoreV1Api) {
    const { body: nodeList } = await api.listNode();
    const addresses = nodeList.items
      .flatMap(node => node.status?.addresses)
      .filter(defined)
      .filter(address => address.type === 'InternalIP')
      .flatMap(address => address.address);

    const { body: podList } = await api.listNamespacedPod(
      'kube-image', undefined, undefined, undefined, undefined,
      'app.kubernetes.io/name=kim,app.kubernetes.io/component=builder');

    for (const pod of podList.items) {
      const { namespace, name } = pod.metadata || {};

      if (!namespace || !name) {
        continue;
      }
      const currentAddress = pod.status?.podIP;

      if (currentAddress && !addresses.includes(currentAddress)) {
        console.log(`Deleting stale builder pod ${ namespace }:${ name } - pod IP ${ currentAddress } not in ${ addresses }`);
        api.deleteNamespacedPod(name, namespace);
      } else {
        console.log(`Keeping builder pod ${ namespace }:${ name } - pod IP ${ currentAddress } in ${ addresses }`);
      }
    }
  }

  /**
   * Install the kim backend if required; this returns when the backend is ready.
   * @param force If true, force a reinstall of the backend.
   */
  async install(backend: K8s.KubernetesBackend, force = false, address?: string) {
    if (!force && await backend.isServiceReady('kube-image', 'builder')) {
      console.log('Skipping kim reinstall: service is ready, and without --force');

      return;
    }

    const startTime = Date.now();
    const maxWaitTime = 120_000;
    const waitTime = 3_000;
    const args = ['builder', 'install'];

    if (force) {
      args.push('--force');
    }

    if (address) {
      args.push('--endpoint-addr', address);
    }

    console.log(`Installing kim: kim ${ args.join(' ') }`);

    try {
      await childProcess.spawnFile(
        resources.executable('kim'),
        args,
        {
          stdio:       ['ignore', await Logging.kim.fdStream, await Logging.kim.fdStream],
          windowsHide: true,
        });

      while (true) {
        const currentTime = Date.now();

        if ((currentTime - startTime) > maxWaitTime) {
          console.log(`Waited more than ${ maxWaitTime / 1000 } secs, it might start up later`);
          break;
        }
        if (await backend.isServiceReady('kube-image', 'builder')) {
          break;
        }
        await util.promisify(setTimeout)(waitTime);
      }
    } catch (e) {
      console.error(`Failed to restart the kim builder: ${ e.message }.`);
      console.error('The images page will probably be empty');
    }
  }

  async buildImage(dirPart: string, filePart: string, taggedImageName: string): Promise<imageProcessor.childResultType> {
    const args = ['build'];

    args.push('--file');
    args.push(path.join(dirPart, filePart));
    args.push('--tag');
    args.push(taggedImageName);
    args.push(dirPart);

    return await this.runImagesCommand(args);
  }

  async deleteImage(imageID: string): Promise<imageProcessor.childResultType> {
    return await this.runImagesCommand(['rmi', imageID]);
  }

  async pullImage(taggedImageName: string): Promise<imageProcessor.childResultType> {
    return await this.runImagesCommand(['pull', taggedImageName, '--debug']);
  }

  async pushImage(taggedImageName: string): Promise<imageProcessor.childResultType> {
    return await this.runImagesCommand(['push', taggedImageName, '--debug']);
  }

  async getImages(): Promise<imageProcessor.childResultType> {
    return await this.runImagesCommand(['images', '--all'], false);
  }
}

export default KimImageProcessor;

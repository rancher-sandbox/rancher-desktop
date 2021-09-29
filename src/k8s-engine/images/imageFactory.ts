import { ImageProcessorInterface } from '@/k8s-engine/images/imageProcessor';
import KimImageProcessor from '@/k8s-engine/images/kimImageProcessor';
import NerdctlImageProcessor from '@/k8s-engine/images/nerdctlImageProcessor';
import * as K8s from '~/k8s-engine/k8s';

export default function createImageProcessor(processorName: string, k8sManager: K8s.KubernetesBackend): ImageProcessorInterface {
  switch (processorName) {
  case 'kim':
    return new KimImageProcessor(k8sManager);
  case 'nerdctl':
    return new NerdctlImageProcessor(k8sManager);
  default:
    throw new Error(`No image processor called ${ processorName }`);
  }
}

import ImageBuildOutputCuller from '@/utils/processOutputInterpreters/image-build-output';
import ImageNonBuildOutputCuller from '@/utils/processOutputInterpreters/image-non-build-output';
import TrivyScanImageOutputCuller from '@/utils/processOutputInterpreters/trivy-image-output';

const cullersByName = {
  build:         ImageBuildOutputCuller,
  'trivy-image': TrivyScanImageOutputCuller
};

export default function getImageOutputCuller(command) {
  const klass = cullersByName[command] || ImageNonBuildOutputCuller;

  return new klass();
}

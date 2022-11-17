import ImageBuildOutputCuller from '@pkg/utils/processOutputInterpreters/image-build-output';
import ImageNonBuildOutputCuller from '@pkg/utils/processOutputInterpreters/image-non-build-output';
import TrivyScanImageOutputCuller from '@pkg/utils/processOutputInterpreters/trivy-image-output';

const cullersByName = {
  build:         ImageBuildOutputCuller,
  'trivy-image': TrivyScanImageOutputCuller,
};

export default function getImageOutputCuller(command) {
  const klass = cullersByName[command] || ImageNonBuildOutputCuller;

  return new klass();
}

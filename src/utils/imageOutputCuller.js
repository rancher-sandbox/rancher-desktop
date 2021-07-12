import KimNonBuildOutputCuller from '~/utils/processOutputInterpreters/kim-non-build-output';
import KimBuildOutputCuller from '~/utils/processOutputInterpreters/kim-build-output';
import TrivyScanImageOutputCuller from '~/utils/processOutputInterpreters/trivy-image-output';

const cullersByName = {
  build:         KimBuildOutputCuller,
  'trivy-image': TrivyScanImageOutputCuller
};

export default function getImageOutputCuller(command) {
  const klass = cullersByName[command] || KimNonBuildOutputCuller;

  return new klass();
}

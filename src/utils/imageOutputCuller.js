import KimNonBuildOutputCuller from '~/utils/processOutputInterpreters/kim-non-build-output';
import KimBuildOutputCuller from '~/utils/processOutputInterpreters/kim-build-output';

export default function getImageOutputCuller(command) {
  const klass = command === 'build' ? KimBuildOutputCuller : KimNonBuildOutputCuller;

  return new klass();
}

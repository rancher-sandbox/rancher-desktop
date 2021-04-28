import NonBuildImageOutputCuller from '@/utils/processOutputInterpreters/kim-partial-ansi';
import BuildImageOutputCuller from '@/utils/processOutputInterpreters/kim-ansi';

export default function getImageOutputCuller(command) {
  const className = command === 'build' ? BuildImageOutputCuller : NonBuildImageOutputCuller;

  return new className();
}

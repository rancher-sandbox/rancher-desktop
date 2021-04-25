import NonBuildImageOutputCuller from '@/utils/processOutputInterpreters/kim-partial-ansi';
import AnsiOutputInterpreter from '@/utils/processOutputInterpreters/kim-ansi';
import ImageOutputCuller from '@/utils/processOutputInterpreters/base';

export default function getImageOutputCuller(command:string): ImageOutputCuller {
  const className = command === 'build' ? AnsiOutputInterpreter : NonBuildImageOutputCuller;

  return new className();
}

import NonBuildImageOutputCuller from '@/utils/processOutputInterpreters/kim-partial-ansi';
import AnsiOutputInterpreter from '@/utils/processOutputInterpreters/kim-ansi';

export default function getImageOutputCuller(command) {
  const className = command === 'build' ? AnsiOutputInterpreter : NonBuildImageOutputCuller;

  return new className();
}

import ImageBuildOutputCuller from '@pkg/utils/processOutputInterpreters/image-build-output';
import ImageNonBuildOutputCuller from '@pkg/utils/processOutputInterpreters/image-non-build-output';
import TrivyScanImageOutputCuller from '@pkg/utils/processOutputInterpreters/trivy-image-output';

interface ImageOutputCuller {
  addData(data: string): void;
  getProcessedData(): string;
}

const cullersByName: Record<string, new() => ImageOutputCuller> = {
  build:         ImageBuildOutputCuller,
  'trivy-image': TrivyScanImageOutputCuller,
};

export default function getImageOutputCuller(command: string) {
  const klass = cullersByName[command] || ImageNonBuildOutputCuller;

  return new klass();
}

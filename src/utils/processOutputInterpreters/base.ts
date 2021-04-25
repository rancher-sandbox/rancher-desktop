/**
 * Process text containing ansi sequences into text suitable for html text widgets
 * Two simple methods that can be called repeatedly. Text is grow-only, so each
 * new process should create a new instance of this class.
 *
 * addData(string):void - give an object strings of text
 * getProcessedData():string - get the current processed text.
 */
interface ImageOutputCuller {
  addData(data: string): void;
  getProcessedData(): string;
}

export default ImageOutputCuller;

const LineSplitter = /\r?\n/;
const ShaLineMatcher = /^[-\w]+-sha256:(\w+):\s*\w+\s*\|.*?\|/;
const SummaryLineMatcher = /^elapsed:.*total:/;

/**
 * Process text containing ansi sequences into text suitable for html text widgets
 * Two simple methods that can be called repeatedly. Text is grow-only, so each
 * new process should create a new instance of this class.
 *
 * addData(string):void - give an object strings of text
 * getProcessedData():string - get the current processed text.
 */
export default class ImageOutputCuller {
  private buffering: boolean;
  readonly lines: string[];
  private summaryLine: string;
  constructor() {
    this.buffering = true;
    this.lines = [];
    this.summaryLine = '';
  }

  addData(data: string): void {
    // TODO (possibly): Deal with partial final lines - I haven't seen this happen yet
    const lines = data.split(LineSplitter);

    for (const line of lines) {
      if (!this.buffering) {
        this.lines.push(line);
      } else if (SummaryLineMatcher.test(line)) {
        this.summaryLine = line;
      } else if (/^\s*$/.test(line)) {
        // do nothing
      } else {
        const m = ShaLineMatcher.exec(line);

        if (m) {
          const idx = this.lines.findIndex(elt => elt.includes(m[1]));
          const strippedLine = line.replace(/\[\d+m/g, '');

          if (idx === -1) {
            this.lines.push(strippedLine);
          } else {
            // Replace an updated line in place
            this.lines[idx] = strippedLine;
          }
        } else {
          this.buffering = false;
          if (this.summaryLine) {
            this.lines.push(this.summaryLine);
            this.summaryLine = '';
          }
          this.lines.push(line);
        }
      }
    }
  }

  getProcessedData(): string {
    let data = this.lines.join('\n');

    if (this.summaryLine) {
      data += `\n ${ this.summaryLine }`;
    }

    return data;
  }
}

import ImageOutputCuller from '@/utils/processOutputInterpreters/base';

const LineSplitter = /\r?\n/;
/* eslint-disable no-control-regex */
const AnsiSequenceMatcher = /(\x1B\[[^a-zA-Z]*?[a-zA-Z])/;
const SequenceDestructor = /^\x1B\[([^a-zA-Z]*?)([a-zA-Z])$/;

export default class AnsiOutputInterpreter implements ImageOutputCuller {
  readonly lines: string[];
  private row: number;
  private column: number;
  readonly Operators: Record<string, (args: string) => void> = {
    A: this.moveUp,
    B: this.moveDown,
    G: this.moveStartOfLine,
    K: this.deleteLine,
    m: this.colorText,
  };

  constructor() {
    this.lines = [];
    this.row = 0;
    this.column = 0;
  }

  moveUp(args: string) {
    console.log(`moveUp ${ args }`);
    if (!args.match(/^\d*$/)) {
      console.log(`AWP!: moveUp args ${ args } isn't a number`);

      return;
    }
    this.row -= args ? parseInt(args, 10) : 1;
    if (this.row < 0) {
      this.row = 0;
    }
  }

  moveDown(args: string) {
    console.log(`moveDown ${ args }`);
    if (!args.match(/^\d*$/)) {
      console.log(`AWP!: moveDown args ${ args } isn't a number`);

      return;
    }
    this.row += args ? parseInt(args, 10) : 1;
    if (this.row >= this.lines.length) {
      this.row = this.lines.length - 1;
    }
    this.extendLinesArray();
  }

  moveStartOfLine(args: string) {
    console.log(`moveStartOfLine ${ args }`);
    if (!args.match(/^\d*$/)) {
      console.log(`AWP!: moveStartOfLine args ${ args } isn't a number`);

      return;
    }
    this.column = args ? parseInt(args, 10) : 0;
  }

  deleteLine(args: string) {
    console.log(`deleteLine ${ args }`);
    this.lines[this.row] = this.lines[this.row].substr(this.column);
  }

  colorText(args: string) {
    console.log(`colorText ${ args }`);
  }

  addData(data: string): void {
    // TODO (possibly): Deal with partial final lines - I haven't seen this happen yet
    const lines = data.split(LineSplitter);

    for (const line of lines) {
      const parts = line.split(AnsiSequenceMatcher);

      console.log(`QQQ: line ${ line.replace(/\x1B/g, '[ESC]') },  ${ parts.length } parts`);
      this.extendLinesArray();
      // first part is text to keep, next part is a control sequence
      for (let i = 0; i < parts.length; i += 2) {
        const [textPart, controlPart] = [parts[i], parts[i + 1]];

        this.lines[this.row] += textPart;
        if (controlPart === undefined) {
          // Doesn't end with a control-part
          break;
        }

        const m = SequenceDestructor.exec(controlPart);

        if (!m) {
          console.log(`Error: can't match sequence ${ controlPart } for part ${ i + 1 } of line ${ line }`);
          continue;
        }
        const [args, operator] = [m[1], m[2]];
        const fn = this.Operators[operator];

        if (!fn) {
          console.log(`AWP: No operator for op ${ operator } in ${ controlPart } for part ${ i + 1 } of line ${ line }`);
          continue;
        }
        fn.bind(this)(args);
        if (i === parts.length - 2 && operator === 'K' && this.lines[this.row] === '') {
          // stay on the current line
        } else {
          this.row += 1;
        }
      }
    }
  }

  private extendLinesArray() {
    while (this.lines.length <= this.row) {
      this.lines.push('');
    }
  }

  getProcessedData(): string {
    return this.lines.join('\n');
  }
}

const LineSplitter = /\r?\n/;
/* eslint-disable no-control-regex */
const AnsiSequenceMatcher = /(\x1B\[\??[^a-zA-Z]*?[a-zA-Z])/;
const SequenceDestructor = /^\x1B\[(\??[^a-zA-Z]*?)([a-zA-Z])$/;

export default class AnsiOutputInterpreter {
  constructor() {
    this.lines = [];
    this.row = 0;
    this.column = 0;
    this.Operators = {
      A: this.moveUp,
      B: this.moveDown,
      G: this.moveStartOfLine,
      K: this.deleteLine,
      h: this.showCursor,
      l: this.hideCursor,
      m: this.colorText,
    };
  }

  moveUp(args) {
    // console.log(`moveUp ${ args }`);
    if (!args.match(/^\d*$/)) {
      console.log(`AWP!: moveUp args ${ args } isn't a number`);

      return;
    }
    this.row -= args ? parseInt(args, 10) : 1;
    if (this.row < 0) {
      this.row = 0;
    }
  }

  moveDown(args) {
    // console.log(`moveDown ${ args }`);
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

  moveStartOfLine(args) {
    // console.log(`moveStartOfLine ${ args }`);
    if (!args.match(/^\d*$/)) {
      console.log(`AWP!: moveStartOfLine args ${ args } isn't a number`);

      return;
    }
    this.column = args ? parseInt(args, 10) : 0;
    this.lines[this.row] = (this.lines[this.row] || '').substring(0, this.column);
  }

  deleteLine(args) {
    // console.log(`deleteLine ${ args }`);
    this.lines[this.row] = this.lines[this.row].substr(this.column);
  }

  colorText(args) {
    // console.log(`colorText ${ args }`);
  }

  hideCursor(args) {
    // console.log(`hideCursor: ${ args }`);
  }

  showCursor(args) {
    // console.log(`showCursor: ${ args }`);
  }

  addData(data) {
    // TODO (possibly): Deal with partial final lines - I haven't seen this happen yet
    const lines = data.split(LineSplitter);

    if (lines.length > 0 && lines[lines.length - 1].length === 0) {
      lines.pop();
    }
    for (const line of lines) {
      const parts = line.split(AnsiSequenceMatcher);

      // console.log(`QQQ: line ${ line.replace(/\x1B/g, '[ESC]') },  ${ parts.length } parts`);
      this.extendLinesArray();
      this.lines[this.row] = '';
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
      }
      this.row += 1;
      // if (i === parts.length - 2 && operator === 'K' && this.lines[this.row] === '') {
      //   // stay on the current line
      // } else {
      //
      // }
    }
    const lastIdx = this.lines.length - 1;

    if (lastIdx > 0) {
      if (this.lines[lastIdx] === '') {
        this.lines.splice(lastIdx);
      }
    }
  }

  extendLinesArray() {
    while (this.lines.length <= this.row) {
      this.lines.push('');
    }
  }

  getProcessedData() {
    return this.lines.join('\n');
  }
}

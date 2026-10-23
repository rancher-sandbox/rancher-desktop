import { execFileSync } from 'child_process';
import os from 'os';

import { EscapeDoubleQuotes } from '@pkg/sudo-prompt';

const describeUnix = os.platform() === 'win32' ? describe.skip : describe;

describeUnix('EscapeDoubleQuotes', () => {
  it.each([
    'path with spaces',
    'substitution $(echo injected)',
    'backticks `echo injected`',
    'variable $HOME',
    'double "quotes"',
    'backslash \\$(echo injected)',
  ])('keeps %j literal inside double quotes', (input) => {
    const output = execFileSync('/bin/sh', ['-c', `printf %s "${ EscapeDoubleQuotes(input) }"`], { encoding: 'utf-8' });

    expect(output).toEqual(input);
  });
});

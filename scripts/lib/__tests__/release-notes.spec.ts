import { quoteReleaseNotes } from '../release-notes';

describe('quoteReleaseNotes', () => {
  /** A mention in its quoted form. */
  function code(handle: string): string {
    return `<code>@\u200B${ handle }</code>`;
  }

  /** An issue reference in its quoted form. */
  function link(repository: string, number: number): string {
    return `[${ repository }#${ number }](https://redirect.github.com/${ repository }/issues/${ number })`;
  }

  it.each([
    ['* Fix it by @someone in #12', `* Fix it by ${ code('someone') } in ${ link('example/tool', 12) }`],
    ['Thanks (@another-person)', `Thanks (${ code('another-person') })`],
    ['cc @example/maintainers', `cc ${ code('example/maintainers') }`],
    ['See other/project#34', `See ${ link('other/project', 34) }`],
    ['See [#34]', `See [${ link('example/tool', 34) }]`],
    ['in https://github.com/example/tool/pull/56', 'in https://redirect.github.com/example/tool/pull/56'],
    ['[fixes #56](https://github.com/example/tool/pull/56)', '[fixes #56](https://redirect.github.com/example/tool/pull/56)'],
  ])('rewrites %j', (body, expected) => {
    expect(quoteReleaseNotes(body, 'example', 'tool')).toEqual(expected);
  });

  it.each([
    'Write to someone@example.com',
    'Read https://blog.example.com/@someone/post',
    '[found by @someone](https://example.com)',
    'Run `npm install @scope/package`',
    '```\n@someone fixed #12\n```',
    'https://example.com/page#12',
    'Zero&#8203;width',
    'https://github.com/example/tool/compare/v1.0.0...v1.1.0',
  ])('leaves %j unchanged', (body) => {
    expect(quoteReleaseNotes(body, 'example', 'tool')).toEqual(body);
  });
});

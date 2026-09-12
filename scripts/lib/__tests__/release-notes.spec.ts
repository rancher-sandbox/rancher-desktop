import { quoteReleaseNotes } from '../release-notes';

describe('quoteReleaseNotes', () => {
  /** A mention in its quoted form. */
  function mention(handle: string, profile = handle): string {
    return `<a href="https://github.com/${ profile }"><code>@\u200B${ handle }</code></a>`;
  }

  /** An issue reference in its quoted form. */
  function link(repository: string, number: number, text = `#${ number }`): string {
    return `<a href="https://redirect.github.com/${ repository }/issues/${ number }">${ text }</a>`;
  }

  it.each([
    ['* Fix it by @someone in #12', `* Fix it by ${ mention('someone') } in ${ link('upstream/project', 12) }`],
    ['Thanks (@another-person)', `Thanks (${ mention('another-person') })`],
    ['Thanks @someone.', `Thanks ${ mention('someone') }.`],
    ['cc @example/maintainers', `cc ${ mention('example/maintainers', 'orgs/example/teams/maintainers') }`],
    ['Thanks @someone/@another-person', `Thanks ${ mention('someone') }/${ mention('another-person') }`],
    ['See other/project#34', `See ${ link('other/project', 34, 'other/project#34') }`],
    ['See [#34]', `See [${ link('upstream/project', 34) }]`],
    ['Fixes GH-12', `Fixes ${ link('upstream/project', 12, 'GH-12') }`],
    ['Fixes #12/#13', `Fixes ${ link('upstream/project', 12) }/${ link('upstream/project', 13) }`],
    ['Escaped \\#12 and \\@someone', `Escaped ${ link('upstream/project', 12, '\\#12') } and ${ mention('someone') }`],
    ['in https://github.com/other/project/pull/56', 'in https://redirect.github.com/other/project/pull/56'],
    ['in http://github.com/other/project/pull/56', 'in https://redirect.github.com/other/project/pull/56'],
    ['_https://github.com/other/project/pull/56_', '_https://redirect.github.com/other/project/pull/56_'],
    ['[fixes #56](https://github.com/other/project/pull/56)', '[fixes #56](https://redirect.github.com/other/project/pull/56)'],
  ])('rewrites %j', (body, expected) => {
    expect(quoteReleaseNotes(body, 'upstream', 'project')).toEqual(expected);
  });

  it.each([
    'Write to someone@example.com',
    'Read https://blog.example.com/@someone/post',
    '[found by @someone](https://example.com)',
    'Run `npm install @scope/package`',
    '```\n@someone fixed #12\n```',
    'https://example.com/page#12',
    'https://example.com/#12',
    'Zero&#8203;width',
    'https://github.com/other/project/compare/v1.0.0...v1.1.0',
  ])('leaves %j unchanged', (body) => {
    expect(quoteReleaseNotes(body, 'upstream', 'project')).toEqual(body);
  });
});

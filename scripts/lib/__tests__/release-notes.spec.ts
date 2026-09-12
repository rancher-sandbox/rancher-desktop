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

  /** A bare pull request URL in its quoted form. */
  const pullRequest = '<a href="https://redirect.github.com/other/project/pull/56">other/project#56</a>';

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
    ['Thanks _@someone_', `Thanks _${ mention('someone') }_`],
    ['See _other/project#34_', `See _${ link('other/project', 34, 'other/project#34') }_`],
    ['Fixes _#12_ and __GH-13__', `Fixes _${ link('upstream/project', 12) }_ and __${ link('upstream/project', 13, 'GH-13') }__`],
    ['in https://github.com/other/project/pull/56', `in ${ pullRequest }`],
    ['in http://github.com/other/project/pull/56', `in ${ pullRequest }`],
    ['_https://github.com/other/project/pull/56_', `_${ pullRequest }_`],
    ['[fixes #56](https://github.com/other/project/pull/56)', '[fixes #56](https://redirect.github.com/other/project/pull/56)'],
    ['[56]: https://github.com/other/project/pull/56', '[56]: https://redirect.github.com/other/project/pull/56'],
    ['<https://github.com/other/project/pull/56>', '<https://redirect.github.com/other/project/pull/56>'],
    ['<a href="https://github.com/other/project/pull/56">fix</a>', '<a href="https://redirect.github.com/other/project/pull/56">fix</a>'],
    ['https://github.com/other/project/pull/56/files', 'https://redirect.github.com/other/project/pull/56/files'],
  ])('rewrites %j', (body, expected) => {
    expect(quoteReleaseNotes(body, 'upstream', 'project')).toEqual(expected);
  });

  it.each([
    'Write to someone@example.com',
    'snake_#12 and snake_@someone',
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

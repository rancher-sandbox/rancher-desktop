const quotablePattern = new RegExp([
  // A link to an issue or pull request.
  /https?:\/\/github\.com\/(?<path>[\w.-]+\/[\w.-]+\/(?:issues|pull)\/\d+)/.source,
  // Code spans, fenced code blocks, link text, and other URLs, copied
  // unchanged, since GitHub finds no mentions or references inside them.
  /(?<ticks>`+).*?\k<ticks>/.source,
  /\[[^\]\n]*\](?=\()/.source,
  /(?:https?:\/\/|www\.)[^\s<>]*/.source,
  // An issue reference, `#12`, `GH-12`, or `owner/repo#12`, outside HTML
  // entities. GitHub links references and mentions even after a backslash
  // escape, so the match includes the backslash.
  /(?<![\w&\\])\\?(?:(?<repository>[\w-]+\/[\w.-]+)#|#|GH-)(?<number>\d+)\b/.source,
  // A user or team mention, outside email addresses.
  /(?<![\w\\])\\?@(?<mention>[a-z\d](?:-?[a-z\d])*(?:\/[\w.-]+)?)(?![\w-])/.source,
].join('|'), 'gis');

/**
 * Rewrite upstream release notes for quoting in a pull request body.
 * GitHub notifies every user a body mentions and adds a backlink to every
 * issue or pull request it references; show mentions as code, and use
 * `redirect.github.com` to construct links instead, which disables the
 * backlink.
 * @see https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/autolinked-references-and-urls#avoiding-backlinks-to-linked-references
 */
export function quoteReleaseNotes(body: string, owner: string, repo: string): string {
  return body.replace(quotablePattern, (match, ...args) => {
    // The last argument to a replacer is the named groups object.
    const { path, repository, number, mention } = args.at(-1);

    if (path) {
      return `https://redirect.github.com/${ path }`;
    }
    // HTML links work inside HTML blocks too, where GitHub parses no markdown.
    if (number) {
      const target = repository ?? `${ owner }/${ repo }`;

      return `<a href="https://redirect.github.com/${ target }/issues/${ number }">${ match }</a>`;
    }
    if (mention) {
      const [login, team] = mention.split('/');
      const profile = team ? `orgs/${ login }/teams/${ team }` : login;

      // The zero-width space keeps a copy of the rendered text from mentioning anyone.
      return `<a href="https://github.com/${ profile }"><code>@\u200B${ mention }</code></a>`;
    }

    return match;
  });
}

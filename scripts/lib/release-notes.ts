// A user or organization name, in a mention or as a repository owner.
const login = /[a-z\d](?:-?[a-z\d])*/.source;

const quotablePattern = new RegExp([
  // A link to an issue or pull request.
  String.raw`https?://github\.com/(?<path>${ login }/[\w.-]+/(?:issues|pull)/\d+)`,
  // Code spans, fenced code blocks, link text, and other URLs, copied
  // unchanged, since GitHub finds no mentions or references inside them.
  /(?<ticks>`+).*?\k<ticks>/.source,
  /\[[^\]\n]*\](?=\()/.source,
  /(?:https?:\/\/|www\.)[^\s<>]*/.source,
  // An issue reference, `#12`, `GH-12`, or `owner/repo#12`, outside HTML
  // entities. GitHub links references and mentions even after a backslash
  // escape, so the match includes the backslash. GitHub also links them
  // inside `_emphasis_`, but not beside an underscore that is part of a
  // word, as in `snake_#12`.
  String.raw`(?<![a-z\d&\\]|[a-z\d]_)\\?(?:(?<repository>${ login }/[\w.-]+)#|#|GH-)(?<number>\d+)(?![a-z\d]|_[a-z\d])`,
  // A user or team mention, outside email addresses.
  String.raw`(?<![a-z\d\\]|[a-z\d]_)\\?@(?<mention>${ login }(?:/[\w.-]+)?)(?![a-z\d-]|_[a-z\d])`,
].join('|'), 'gis');

// Text that ends where only a URL fits: a markdown link destination or
// reference definition, an autolink, or an HTML attribute.
const urlOnlyContext = /(?:\][(:]\s*|[<"])$/;

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
    // A replacer's last three arguments are the match offset, the whole
    // string, and the named groups object.
    const [offset, , { path, repository, number, mention }] = args.slice(-3);

    if (path) {
      const href = `https://redirect.github.com/${ path }`;
      const before = body.slice(0, offset);
      const after = body.slice(offset + match.length);

      // Keep the URL where an HTML link would break the markup, or where the
      // link's `owner/repo#12` text would drop whatever follows the number.
      if (urlOnlyContext.test(before) || /^[/#?]/.test(after)) {
        return href;
      }
      // In an HTML block, GitHub would link the `owner/repo/pull/12` inside a
      // bare redirect URL.
      const [pathOwner, pathRepo, , pathNumber] = path.split('/');

      return `<a href="${ href }">${ pathOwner }/${ pathRepo }#${ pathNumber }</a>`;
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

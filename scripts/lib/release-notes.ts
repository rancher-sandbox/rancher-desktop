const quotablePattern = new RegExp([
  // Code spans, fenced code blocks and link text, copied unchanged, since
  // GitHub finds no mentions or references inside them.
  /(?<ticks>`+)[\s\S]*?\k<ticks>/.source,
  /\[[^\]\n]*\](?=\()/.source,
  // A link to an issue or pull request.
  /https:\/\/github\.com\/(?<path>[\w.-]+\/[\w.-]+\/(?:issues|pull)\/\d+)/.source,
  // An issue reference, `#12` or `owner/repo#12`, outside URLs and HTML entities.
  /(?<![\w.&/-])(?:(?<repository>[\w-]+\/[\w.-]+))?#(?<number>\d+)\b/.source,
  // A user or team mention, outside email addresses and URLs.
  /(?<![\w/])@(?<mention>[a-z\d](?:-?[a-z\d])*(?:\/[\w.-]+)?)(?![\w-])/.source,
].join('|'), 'gi');

/**
 * Rewrite upstream release notes for quoting in a pull request body.
 * GitHub notifies every user a body mentions and adds a backlink to every
 * issue or pull request it references, so mentions become code and references
 * link through redirect.github.com, which GitHub renders as a plain link.
 */
export function quoteReleaseNotes(body: string, owner: string, repo: string): string {
  return body.replace(quotablePattern, (match, ...args) => {
    // The last argument to a replacer is the named groups object.
    const { path, repository, number, mention } = args.at(-1);

    if (path) {
      return `https://redirect.github.com/${ path }`;
    }
    if (number) {
      const target = repository ?? `${ owner }/${ repo }`;

      return `[${ target }#${ number }](https://redirect.github.com/${ target }/issues/${ number })`;
    }
    if (mention) {
      // The zero-width space keeps a copy of the rendered text from mentioning anyone.
      return `<code>@\u200B${ mention }</code>`;
    }

    return match;
  });
}

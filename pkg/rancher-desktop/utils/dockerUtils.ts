/**
 * The return result of parseImageReference().
 *
 * @note This is only exported for the test.
 */
export class imageInfo {
  /**
   * The registry, as a URL (e.g. `https://registry.opensuse.org/`);
   * defaults to Docker Hub, i.e. `https://index.docker.io/`.
   */
  registry: URL;
  /**
   * The image name (e.g. `opensuse/leap`).
   * For Docker Hub images, `library/` will be added if there is no org.
   */
  name:     string;
  /** Any tags (e.g. `latest`, `15.4`) */
  tag?:     string;

  constructor(registry: URL, name: string, tag?: string) {
    this.registry = registry;
    this.name = name;
    this.tag = tag;
  }

  /**
   * Check if this image (excluding the tag) is the same as another one.
   */
  equalName(other?: imageInfo | null): boolean {
    return this.registry.href === other?.registry.href && this.name === other?.name;
  }
}

/**
 * makeRE is a tagged template for making regular expressions with /x (i.e.
 * ignoring any whitespace within the regular expression itself).
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals#tagged_templates
 */
function makeRE(strings: TemplateStringsArray, ...substitutions: any[]) {
  const substitutionSources = substitutions.map(s => s instanceof RegExp ? s.source : s);
  const raw = String.raw(strings, ...substitutionSources);
  const lines = raw.split(/\r?\n/);
  // Drop comments at end of line
  const uncommentedLines = lines.map(line => line.replace(/\s#.*$/, ''));

  return new RegExp(uncommentedLines.join('').replace(/\s+/g, ''));
}

const { ImageNameRegExp, ImageNamePrefixRegExp } = (function() {
  // a domain component is alpha-numeric-or-dash, but the start and end
  // characters may not be a dash.
  const domainComponent = /[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?/;
  // a domain is two or more domain components joined by dot, and optionally
  // with a colon followed by a port number.
  const domain = makeRE`
    ${ domainComponent }(?:\.${ domainComponent })+
    (?::[0-9]+)?
    `;
  // a name component is lower-alpha-numeric things, separated by any one of
  // a set of separators.
  const nameComponent = /[a-z0-9]+(?:(?:\.|_|__|-*)[a-z0-9]+)*/;

  /**
   * ImageNameRegExp is a regular expression that matches a docker image name
   * (including optional registry and one or more name components).
   */
  const ImageNameRegExp = makeRE`
    (?:(?<domain>${ domain })/)?
    (?<name>
      ${ nameComponent }
      (?:/${ nameComponent })*
    )
    `;

  /**
   * ImageRefPrefixRegExp is a regular expression similar to ImageNameRegExp but
   * supports looking for prefixes (i.e. a name that ends in a slash).
   * Note that we may end up with just the domain (no name).
   */
  const ImageNamePrefixRegExp = makeRE`
    (?:
      (?:(?<domain>${ domain })/)?
      (?<name>
        (?:${ nameComponent }/)*
        (?:${ nameComponent })?
      )
    )
  `;

  return { ImageNameRegExp, ImageNamePrefixRegExp };
})();

/**
 * ImageTagRegExp is a regular expression that matches a docker image tag (that
 * is, only the bit after the colon).
 */
const ImageTagRegExp = /[\w][\w.-]{0,127}/;

const ImageRefRegExp = makeRE`
  ^
  ${ ImageNameRegExp }
  (?::(?<tag>${ ImageTagRegExp }))?
  $
  `;

const ImageRefPrefixRegExp = makeRE`
  ^
  ${ ImageNamePrefixRegExp }
  (?::(?<tag>${ ImageTagRegExp }))?
  $
  `;

/**
 * Given an image reference, parse it into (possibly) registry, name, and
 * (possibly) tag components.
 * @param prefix If set, accept prefixes (names that end with a slash).
 */
export function parseImageReference(reference: string, prefix = false): imageInfo | null {
  const result = (prefix ? ImageRefPrefixRegExp : ImageRefRegExp).exec(reference);

  if (!result?.groups) {
    return null;
  }

  if (!result.groups['domain'] && !result.groups['name']) {
    // When checking for a prefix, parsing an empty string can succeed; in that
    // case, reject it rather than accepting anything from Docker Hub.
    return null;
  }

  let registry = result.groups['domain'] ?? 'index.docker.io';
  let name = result.groups['name'];

  if (registry === 'docker.io') {
    registry = 'index.docker.io';
  }
  if (!registry.includes('://')) {
    registry = `https://${ registry }`;
  }

  if (registry.endsWith('.docker.io') && !name.includes('/')) {
    name = `library/${ name }`;
  }

  return new imageInfo(new URL(registry), name, result.groups['tag']);
}

/**
 * Check if a given string is a valid docker image name component (excluding any
 * tags).
 */
export function validateImageName(name: string): boolean {
  return makeRE`^${ ImageNameRegExp }$`.test(name);
}

/**
 * Check if a given string is a valid docker image tag.
 */
export function validateImageTag(tag: string): boolean {
  return makeRE`^${ ImageTagRegExp }$`.test(tag);
}

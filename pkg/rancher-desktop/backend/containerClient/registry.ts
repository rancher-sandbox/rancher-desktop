import { net } from 'electron';

import registryAuth from '@pkg/backend/containerClient/auth';
import { parseImageReference } from '@pkg/utils/dockerUtils';

/**
 * Registry interaction, with both Docker Hub and Docker Registry V2 APIs.
 */
class DockerRegistry {
  /**
   * Fetch some API endpoint from the registry
   * @param endpoint The API endpoint, including the registry host.
   */
  async get(endpoint: URL): ReturnType<typeof net.fetch> {
    const headers = await this.authenticate(endpoint);

    return await net.fetch(endpoint.toString(), { headers });
  }

  /**
   * List all tags for the given image name.
   * @param name An image name, including registry as needed.
   */
  async getTags(name: string): Promise<string[]> {
    const info = parseImageReference(name);
    const tags: string[] = [];

    if (!info) {
      throw new Error(`Invalid image name: "${ name }"`);
    }

    let endpoint = new URL(`/v2/${ info.name }/tags/list?n=65536`, info.registry);
    let hasMore = true;

    while (hasMore) {
      const resp = await this.get(endpoint);

      if (!resp.ok) {
        throw new Error(`Failed to fetch ${ endpoint }: ${ resp.status } ${ resp.statusText }`);
      }

      const result: { name: string, tags: string[] } = await resp.json();

      if (result.name !== info.name) {
        throw new Error(`Invalid tags: incorrect response name ${ result.name } from ${ endpoint }`);
      }

      tags.push(...result.tags);
      hasMore = false;

      for (const link of (resp.headers.get('Link') ?? '').split(', ')) {
        const fields = link.split(/;\s*/);

        if (!fields.some(field => /^rel=("?)next\1$/i.test(field))) {
          continue;
        }
        // The `Link` header defined in RFC 8288 always has angle brackets
        // around the (possibly relative) URL:
        // https://www.rfc-editor.org/rfc/rfc8288#section-3
        endpoint = new URL(fields[0].replace(/^<(.+)>$/, '$1'), endpoint);
        hasMore = true;
      }
    }

    return tags;
  }

  protected authenticate(endpoint: URL): Promise<HeadersInit> {
    return registryAuth.authenticate(endpoint);
  }
}

const registry = new DockerRegistry();

export default registry;

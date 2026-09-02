import stream from 'stream';

import type { Extract, Pack } from 'tar-stream';

/**
 * A single entry yielded by iterating over a tar-stream `Extract`.
 * tar-stream declares this type as `Source`, but does not export it.
 */
export type TarEntry = Extract extends AsyncIterable<infer T> ? T : never;

/**
 * Wait for a tar-stream `Pack` or entry to finish.
 *
 * tar-stream is built on streamx. Its streams work with Node's
 * stream.finished() at runtime, but they lack isPaused(), unpipe() and wrap(),
 * so TypeScript rejects them as Node streams.
 */
export function tarStreamFinished(tarStream: Pack | TarEntry): Promise<void> {
  return stream.promises.finished(tarStream as unknown as NodeJS.ReadableStream);
}

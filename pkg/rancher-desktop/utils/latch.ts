/**
 * Interface Latch is a simple extension on Promise that is resolved via calling
 * a method.  It is essentially a simplified barrier.
 *
 * @see https://en.wikipedia.org/wiki/Barrier_(computer_science)
 */
interface Latch extends Promise<void> {
  /** Calling the resolve() method resolves the Latch. */
  resolve(): void;
  /** Calling the reject() method rejects the Latch. */
  reject(reason: any): void;
}

/**
 * Creates a Latch that is an extension of a Promise that can be resolved via
 * calling a method on that Promise.
 */
export default function Latch(): Latch {
  const holder: { resolve?: () => void, reject?: (reason: any) => void } = {};
  const result: Latch = new Promise<void>((resolve, reject) => {
    holder.resolve = resolve;
    holder.reject = reject;
  }) as any;

  if (!holder.resolve || !holder.reject) {
    throw new Error('Promise created, but resolve/reject function not set');
  }
  result.resolve = holder.resolve;
  result.reject = holder.reject;

  return result;
}

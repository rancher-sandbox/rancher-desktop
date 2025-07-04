import type { MockInstance } from 'jest-mock/build'

// `Symbol.dispose` exists as of NodeJS 20; if it's unset, set it (because we
// are currently on NodeJS 18).
(Symbol as any).dispose ??= Symbol.for('nodejs.dispose');

/**
 * Given a Jest SpyInstance, return it as a Disposable such that mockRestore will
 * be called when the instance goes out of scope.
 * @note This will no longer be needed as of Jest 30 (where it's built in).
 */
export function withResource<
  T extends (...args: any) => any,
  U extends MockInstance<T>,
>(input: U): U & Disposable {
  const impl = input.getMockImplementation();
  (input as any)[Symbol.dispose] = () => {
    input.mockRestore();
    if (impl) {
      input.mockImplementation(impl);
    }
  };

  return input as U & Disposable;
}

// `Symbol.dispose` exists as of NodeJS 20; if it's unset, set it (because we
// are currently on NodeJS 18).
(Symbol as any).dispose ??= Symbol.for('nodejs.dispose');

/**
 * Given a Jest SpyInstance, return it as a Disposable such that mockRestore will
 * be called when the instance goes out of scope.
 * @note This will no longer be needed as of Jest 30 (where it's built in).
 */
export function withResource<
  T = any,
  Y extends any[] = any,
  C = any,
  U extends jest.MockInstance<T, Y, C> = any,
>(input: U): U & Disposable {
  (input as any)[Symbol.dispose] = () => {
    input.mockRestore();
  };

  return input as U & Disposable;
}

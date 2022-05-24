// Partial<T> (https://www.typescriptlang.org/docs/handbook/utility-types.html#partialtype)
// only allows missing properties on the top level; if anything is given, then all
// properties of that top-level property must exist.  RecursivePartial<T> instead
// allows any descendent properties to be omitted.
export type RecursivePartial<T> = {
  [P in keyof T]?:
  T[P] extends (infer U)[] ? RecursivePartial<U>[] :
    // eslint-disable-next-line @typescript-eslint/ban-types
    T[P] extends object ? RecursivePartial<T[P]> :
      T[P];
}

export type RecursiveReadonly<T> = {
  readonly [P in keyof T]:
  T[P] extends (infer U)[] ? readonly RecursiveReadonly<U>[] :
  // eslint-disable-next-line @typescript-eslint/ban-types
  T[P] extends object ? RecursiveReadonly<T[P]> :
  T[P];
}

/** UpperAlpha is the set of upper-case alphabets. */
type UpperAlpha =
  'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' |
  'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z';

/** Alpha is the set of upper- or lower-case alphabets. */
type Alpha<T> = T extends UpperAlpha ? T : T extends Lowercase<UpperAlpha> ? T : never;

type UpperSnakeCaseInner<T extends string> =
  T extends '' ? never :
  T extends UpperAlpha ? `_${ T }` :
  T extends Alpha<T> ? Uppercase<T> :
  T extends `${ infer C }${ infer U }` ? `${ UpperSnakeCaseInner<C> }${ UpperSnakeCaseInner<U> }` :
  never;

/**
 * UpperSnakeCase transforms a string into upper snake case (all upper case,
 * underscore word separators.
 *
 * @example UpperSnakeCase<'HelloWorld'> == 'HELLO_WORLD'
 * @note This fails if there are any non-alphabetic characters.
 */
export type UpperSnakeCase<T extends string> =
  T extends Alpha<T> ? Uppercase<T> :
  T extends `${ infer C }${ infer U }` ? `${ Uppercase<C> }${ UpperSnakeCaseInner<U> }`
  : T;

/**
 * Check if a given object is defined (i.e. not undefined, and not null).
 */
export function defined<T>(input: T | undefined | null): input is T {
  return typeof input !== 'undefined' && input !== null;
}

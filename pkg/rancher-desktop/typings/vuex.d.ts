/**
 * Fix issues with Vuex typing, as TypeScript does not support `"typings":` in
 * `package.json` when `"exports":` is present in combination with
 * `tsconfig.json` using `moduleResolution: "bundler"`.
 * @see https://github.com/vuejs/vuex/issues/2213
 */
declare module 'vuex' {
  export * from 'vuex/types/index.d.ts';
}

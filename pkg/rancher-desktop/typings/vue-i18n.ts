// Ensure this augments the package, instead of overwriting it.
// See https://vuejs.org/guide/typescript/options-api.html#type-augmentation-placement
export {}

declare module 'vue' {
  interface ComponentCustomProperties {
      /**
       * Lookup a given string with the given arguments
       * @param raw if set, do not do HTML escaping.
       */
      t: (key: string, args?: Record<string, any>, raw?: boolean) => string,
  }
}

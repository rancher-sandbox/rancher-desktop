import { Store } from 'vuex/types';

import type { Modules } from '@pkg/entry/store';

type Actions<
  module extends string,
  actions extends Record<string, (context: any, args: any) => any>,
> = {
  [action in keyof actions as `${ module }/${ action & string }`]:
  (arg: Parameters<actions[action]>[1]) => ReturnType<actions[action]>;
};

type Keys<T> = T extends Record<infer K, any> ? K : never;
type Values<T> = T extends Record<any, infer V> ? V : never;
type Intersect<U extends object> = {
  [K in Keys<U>]: U extends Record<K, infer T> ? T : never;
};

type storeActions = Intersect<Values<{
  [module in keyof Modules]:
  Modules[module] extends { actions: any } ?
    Actions<module, Modules[module]['actions']> : never;
}>>;

declare module 'vuex/types' {
  export interface Dispatch {
    <action extends keyof storeActions>
    (
      type: action,
      payload: Parameters<storeActions[action]>[0],
      options?: DispatchOptions
    ): Promise<Awaited<ReturnType<storeActions[action]>>>;

    <action extends keyof storeActions>
    (
      type: action,
    ): Promise<Awaited<ReturnType<storeActions[action]>>>;
  }
}

declare module 'vue' {
  // provide typings for `this.$store`
  interface ComponentCustomProperties {
    $store: Store<object>
  }
}

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

type Mutations<
  module extends string,
  mutations extends Record<string, (state: any, payload?: any) => any>,
> = {
  [mutation in keyof mutations as `${ module }/${ mutation & string }`]:
  (payload: Parameters<mutations[mutation]>[1]) => ReturnType<mutations[mutation]>;
};

type storeMutations = Intersect<Values<{
  [module in keyof Modules]:
  Modules[module] extends { mutations: any } ?
    Mutations<module, Modules[module]['mutations']> : never;
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

  export interface Commit {
    <mutation extends keyof storeMutations>
    (
      type: mutation,
      payload?: Parameters<storeMutations[mutation]>[0],
      options?: CommitOptions
    ): void;
    <
      mutation extends keyof storeMutations,
      P extends { type: mutation } & Parameters<storeMutations[mutation]>[0],
    >(payloadWithType: P, options?: CommitOptions): void;
  }

  export function useStore(): Store<{
    [key in keyof Modules]: ReturnType<Modules[key]['state']>;
  }>;
}

declare module 'vue' {
  // provide typings for `this.$store`
  interface ComponentCustomProperties {
    $store: Store<{
      [key in keyof Modules]: ReturnType<Modules[key]['state']>;
    }>;
  }
}

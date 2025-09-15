import type { UpperSnakeCase } from '@pkg/utils/typeUtils';

import type { CommitOptions, Dispatch, GetterTree, MutationTree, Store } from 'vuex';

/**
 * MutationsType is used to describe the type that `mutations` should have.
 * This has a `SET_` method per property in `State`, that takes a payload of the
 * correct type.  Note that we may have additional mutations available; typically
 * this is used as `const mutations = { ... } satisfies MutationsType<State>`.
 */
export type MutationsType<T> = {
  [key in keyof T as `SET_${ UpperSnakeCase<key> }`]?: (state: T, payload: T[key]) => any;
};

/**
 * MutationsPayloadType converts from a MutationsType to a type with the same
 * keys but just the payload as the value.
 */
type MutationsPayloadType<M> = {
  [key in keyof M]: M[key] extends (...args: any) => any ? Parameters<M[key]>[1] : never;
};

/**
 * ActionContext is the first argument for an action.  We only declare the
 * subset we currently need.  We're not using the types from Vuex as that does
 * not provide typing to match the mutations.
 */
export interface ActionContext<S, M = MutationsType<S>, G = GetterTree<S, any>> {
  commit<mutationType extends keyof M>(
    type: mutationType,
    payload: MutationsPayloadType<M>[mutationType],
    commitOptions?: CommitOptions): void;
  dispatch:  Dispatch;
  state:     S;
  rootState: any;
  getters:   { [key in keyof G]: G[key] extends (...args: any) => any ? ReturnType<G[key]> : never };
}

// Copies from the vuex definition, but using our override ActionContext above.
type ActionHandler<S, R, M, G> = (this: Store<R>, context: ActionContext<S, M, G>, payload?: any) => any;
export interface ActionObject<S, R, M, G> {
  root?:   boolean;
  handler: ActionHandler<S, R, M, G>;
}
type Action<S, R, M, G> = ActionHandler<S, R, M, G> | ActionObject<S, R, M, G>;

export type ActionTree<
  S,
  R,
  M extends MutationsType<S> & MutationTree<S> = MutationsType<S> & MutationTree<S>,
  G extends GetterTree<S, any> = GetterTree<S, any>,
> = Record<string, Action<S, R, M, G>>;

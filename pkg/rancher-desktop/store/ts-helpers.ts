import type { UpperSnakeCase } from '@pkg/utils/typeUtils';

import type { CommitOptions, Dispatch } from 'vuex';

type MutationsPayloadType<T> = {
  [key in keyof T as `SET_${ UpperSnakeCase<key> }`]: T[key];
};

/**
 * MutationsType is used to describe the type that `mutations` should have.
 * This has a `SET_` method per property in `State`, that takes a payload of the
 * correct type.
 */
export type MutationsType<T> = {
  [key in keyof T as `SET_${ UpperSnakeCase<key> }`]: (state: T, payload: T[key]) => any;
};

/**
 * ActionContext is the first argument for an action.  We only declare the
 * subset we currently need.  We're not using the types from Vuex as that does
 * not provide typing to match the mutations.
 */
export interface ActionContext<T> {
  commit<mutationType extends keyof MutationsPayloadType<T>>(
    type: mutationType,
    payload: MutationsPayloadType<T>[mutationType],
    commitOptions?: CommitOptions): void;
  dispatch:  Dispatch;
  state:     T;
  rootState: any;
  getters:   any;
}

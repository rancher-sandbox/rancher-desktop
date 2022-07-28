import type { actions as ApplicationSettingsActions } from '@/store/applicationSettings';
import type { actions as PageActions } from '@/store/page';
import type { actions as PreferencesActions } from '@/store/preferences';
import type { actions as CredentialsActions } from '@/store/credentials';

type Actions<
  store extends string,
  actions extends Record<string, (context: any, args: any) => any>
> = {
  [action in keyof actions as `${ store }/${ action & string }`]:
    (arg: Parameters<actions[action]>[1]) => ReturnType<actions[action]>;
};

type storeActions = Record<string, never>
  & Actions<'applicationSettings', typeof ApplicationSettingsActions>
  & Actions<'page', typeof PageActions>
  & Actions<'preferences', typeof PreferencesActions>
  & Actions<'credentials', typeof CredentialsActions>;

declare module 'vuex/types' {
  export interface Dispatch {
    <action extends keyof storeActions>
      (
        type: action,
        payload: Parameters<storeActions[action]>[0],
        options?: DispatchOptions
      ): Promise<ReturnType<storeActions[action]>>;

    <action extends keyof storeActions>
      (
        type: action,
      ): Promise<ReturnType<storeActions[action]>>;

    /** @deprecated */
    (type: string, payload?: any, options?: DispatchOptions): Promise<any>;
  }
}

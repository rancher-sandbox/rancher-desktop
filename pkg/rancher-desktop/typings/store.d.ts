import type { actions as ApplicationSettingsActions } from '@pkg/store/applicationSettings';
import type { actions as CredentialsActions } from '@pkg/store/credentials';
import type { actions as DiagnosticsActions } from '@pkg/store/diagnostics';
import type { actions as ExtensionsActions } from '@pkg/store/extensions';
import type { actions as PageActions } from '@pkg/store/page';
import type { actions as PreferencesActions } from '@pkg/store/preferences';
import type { actions as TransientSettingsActions } from '@pkg/store/transientSettings';

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
  & Actions<'diagnostics', typeof DiagnosticsActions>
  & Actions<'credentials', typeof CredentialsActions>
  & Actions<'extensions', typeof ExtensionsActions>
  & Actions<'transientSettings', typeof TransientSettingsActions>

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

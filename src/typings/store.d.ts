
import type { DispatchOptions } from 'vuex/types';

import type { Settings } from '@/config/settings';
import type { PathManagementStrategy } from '@/integrations/pathManager';

interface storeActions {
  'applicationSettings/commitPathManagementStrategy'(strategy: PathManagementStrategy): void;
  'applicationSettings/commitSudoAllowed'(value: boolean): void;
  'applicationSettings/setPathManagementStrategy'(strategy: PathManagementStrategy): void;
  'applicationSettings/setSudoAllowed'(value: boolean): void;
  'page/setHeader'(args: {title?: string, description?: string, action?: string}): void;
  'preferences/initializePreferences'(args: Settings): void;
  'preferences/commitPreferences'(args: {port: number, user: string, password: string}): void;
  'preferences/fetchPreferences'(args: {port: number, user: string, password: string}): void;
  'preferences/setPlatformWindows'(value: boolean): void;
  'preferences/setWslIntegrations'(integrations: Record<string, boolean | string>): void;
  'preferences/updatePreferencesData'(args: {property: string, value: any}): void;
  'preferences/updateWslIntegrations'(args: {property: string, value: boolean}): void;
}

declare module 'vuex/types' {
  export interface Dispatch {
    <action extends keyof storeActions>
      (
        type: action,
        payload: Parameters<storeActions[action]>[0],
        options?: DispatchOptions
      ): Promise<ReturnType<storeActions[action]>>;

    /** @deprecated */
    (type: string, payload?: any, options?: DispatchOptions): Promise<any>;
  }
}

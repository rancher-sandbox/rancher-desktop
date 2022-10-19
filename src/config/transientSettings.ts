import _ from 'lodash';

import { RecursivePartial, RecursiveReadonly } from '@/utils/typeUtils';

export const defaultTransientSettings = {
  noModalDialogs: false,
  preferences:    {
    currentNavItem: {
      name: 'Application',
      tab:  'behavior',
    },
  },
};
export type TransientSettings = typeof defaultTransientSettings;
export type CurrentNavItem = typeof defaultTransientSettings.preferences.currentNavItem;

class TransientSettingsImpl {
  private _value = _.cloneDeep(defaultTransientSettings);

  get value(): RecursiveReadonly<TransientSettings> {
    return this._value;
  }

  update(transientSettings: RecursivePartial<TransientSettings>) {
    _.merge(this._value, transientSettings);
    if (transientSettings.preferences?.currentNavItem?.name !== 'Application') {
      delete (this._value.preferences.currentNavItem as any).tab;
    }
  }

  validate(property: string, key: string) {
    return Object.keys(_.get(defaultTransientSettings, property, {})).includes(key);
  }
}

export const TransientSettings = new TransientSettingsImpl();

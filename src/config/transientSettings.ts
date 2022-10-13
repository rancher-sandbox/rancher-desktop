import _ from 'lodash';

import { RecursivePartial, RecursiveReadonly } from '@/utils/typeUtils';

export const defaultTransientSettings = {
  noModalDialogs: false,
  preferences:    { currentNavItem: 'Application' },
};
export type TransientSettings = typeof defaultTransientSettings;

class TransientSettingsImpl {
  private _value = _.cloneDeep(defaultTransientSettings);

  get value(): RecursiveReadonly<TransientSettings> {
    return this._value;
  }

  update(transientSettings: RecursivePartial<TransientSettings>) {
    _.merge(this._value, transientSettings);
  }
}

export const TransientSettings = new TransientSettingsImpl();

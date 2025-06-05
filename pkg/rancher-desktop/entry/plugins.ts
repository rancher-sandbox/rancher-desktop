import { App } from 'vue';
import { Store } from 'vuex';

import '../plugins/clean-html-directive';
import cleanTooltip from '../plugins/clean-tooltip-directive';
import '../plugins/directives';
import i18n from '../plugins/i18n';
import shortKey from '../plugins/shortkey';
import tooltip from '../plugins/tooltip';
import '../plugins/trim-whitespace';
import '../plugins/v-select';

export default async function usePlugins(app: App, store: Store<any>) {
  await store.dispatch('i18n/init');

  app.use(tooltip);
  app.use(cleanTooltip);
  app.use(i18n);
  app.use(shortKey, {
    prevent:          ['input', 'textarea', 'select'],
    preventContainer: ['#modal-container-element'],
  });
}

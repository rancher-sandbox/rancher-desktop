import { App } from 'vue';
import { Store } from 'vuex';

import cleanHTML from '../plugins/clean-html-directive';
import cleanTooltip from '../plugins/clean-tooltip-directive';
import directives from '../plugins/directives';
import i18n from '../plugins/i18n';
import shortKey from '../plugins/shortkey';
import tooltip from '../plugins/tooltip';
import trimWhitespace from '../plugins/trim-whitespace';
import vSelect from '../plugins/v-select';

export default async function usePlugins(app: App, store: Store<any>) {
  await store.dispatch('i18n/init');

  app.use(cleanHTML);
  app.use(cleanTooltip);
  app.use(directives);
  app.use(i18n);
  app.use(shortKey, {
    prevent:          ['input', 'textarea', 'select'],
    preventContainer: ['#modal-container-element'],
  });
  app.use(tooltip);
  app.use(trimWhitespace);
  app.use(vSelect);
}

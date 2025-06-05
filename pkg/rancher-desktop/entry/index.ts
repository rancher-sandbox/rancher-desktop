/**
 * This is the main entry point for Vue.
 */

import Cookies from 'cookie-universal';
import { createApp } from 'vue';

import router from './router';
import store from './store';
import '../plugins/clean-html-directive';
import '../plugins/clean-tooltip-directive';
import '../plugins/directives';
import '../plugins/extend-router';
import '../plugins/i18n';
import '../plugins/shortkey';
import '../plugins/tooltip';
import '../plugins/trim-whitespace';
import '../plugins/v-select';

// This does just the Vuex part of cookie-universal-nuxt, which is all we need.
(store as any).$cookies = Cookies();

// Emulate Nuxt layouts by poking making the router match the main component we
// will load, and then inspect it for the layout we set.
// Because we're always using the hash mode for the router, get the correct
// route based on the hash.
const matched = router.match(location.hash.substring(1)).matched.find(r => r);
const component = matched?.components.default;
const layoutName: string = component?.layout ?? 'default';
const { default: layout } = await import(`../layouts/${ layoutName }.vue`);

const app = createApp({...layout, store, router});

app.mount('#app');

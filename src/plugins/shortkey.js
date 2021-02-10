import Vue from 'vue';
import ShortKey from 'vue-shortkey';

Vue.use(ShortKey, { prevent: ['input', 'textarea', 'select'] });

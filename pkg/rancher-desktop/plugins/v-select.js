import vSelect from 'vue-select';

export default {
  name: 'v-select',
  install(app) {
    app.component('v-select', vSelect);
  },
};

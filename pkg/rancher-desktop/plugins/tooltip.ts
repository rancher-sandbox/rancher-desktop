import FloatingVue from 'floating-vue';
import { App } from 'vue';

export default ({
  name: 'tooltip',
  install(app: App, ..._options: any) {
    app.use(FloatingVue);
  },
});

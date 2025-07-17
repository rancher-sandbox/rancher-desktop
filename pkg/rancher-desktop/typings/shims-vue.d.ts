declare module '*.vue' {
  import type { DefineComponent } from '@vue/runtime-core';
  const component: DefineComponent<object, object, any>;
  export default component;
}

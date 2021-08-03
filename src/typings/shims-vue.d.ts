declare module '*.vue' {
  import Vue from 'vue';
  /* Load @nuxt/types, as a side effect it aguments Vue */
  import {} from '@nuxt/types';
  export default Vue;
}

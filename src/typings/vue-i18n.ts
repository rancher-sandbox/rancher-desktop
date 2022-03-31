import Vue from 'vue';

declare module 'vue/types/vue' {
  interface t {
    (key: string, args?: any, raw?: boolean): string,
  }

  interface Vue {
    t: t;
  }
}

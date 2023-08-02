import Vue from 'vue'

export default {
  name: 'NuxtLink',
  extends: Vue.component('RouterLink'),
  props: {
    prefetch: {
      type: Boolean,
      default: false
    },
    noPrefetch: {
      type: Boolean,
      default: false
    }
  }
}

<template>
  <section class="loading-indicator">
    <slot name="icon">
      <span class="icon icon-spinner icon-lg loading-icon" />
    </slot>
    <slot>
      {{ loadingText }}
    </slot>
  </section>
</template>

<script lang="ts">
import Vue from 'vue';
export default Vue.extend({
  name: 'loading-indicator',

  props: {
    loadingText: {
      type:    String,
      default: ''
    }
  }
});
</script>

<style lang="scss" scoped>
  .loading-indicator {
    color: var(--primary);
  }

  .loading-icon {
    animation:spin 4s linear infinite;
  }

  @keyframes spin {
    100% {
      transform: rotate(360deg);
    }
  }

</style>

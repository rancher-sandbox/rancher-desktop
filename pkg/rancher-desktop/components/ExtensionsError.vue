<script lang="ts">
import Vue, { PropType } from 'vue';

export default Vue.extend({
  name:  'extensions-error',
  props: {
    extensionId: {
      type:    String,
      default: '',
    },
    error: {
      type:    Error as PropType<Error | undefined>,
      default: undefined,
    },
  },
});
</script>

<template>
  <div>
    <h2>Error rendering extension: {{ extensionId }}</h2>
    <code>
      {{ error }}
    </code>
  </div>
</template>

<style lang="scss" scoped>
  code {
    white-space: pre-line;
  }
</style>

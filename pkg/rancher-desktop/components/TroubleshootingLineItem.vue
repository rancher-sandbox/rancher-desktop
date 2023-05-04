<script lang="ts">
import { Card } from '@rancher/components';
import Vue from 'vue';

export default Vue.extend({
  name:       'troubleshooting-line-item',
  components: { Card },
});
</script>
<template>
  <card
    class="troubleshooting-line-item"
    :show-highlight-border="false"
  >
    <template #title>
      <slot name="title"></slot>
    </template>
    <template #body>
      <slot name="description"></slot>
      <span class="options">
        <slot name="options"></slot>
      </span>
    </template>
    <template #actions>
      <slot name="actions"></slot>
    </template>
  </card>
</template>

<style lang="scss" scoped>
  .options {
    margin-top: 0.5rem;
  }
</style>

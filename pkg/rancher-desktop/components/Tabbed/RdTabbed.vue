<script lang="ts">
import Vue from 'vue';

import Tabbed from '@pkg/components/Tabbed/index.vue';

export default Vue.extend({
  name:       'rd-tabbed',
  components: { Tabbed },
});
</script>

<template>
  <tabbed
    v-bind="$attrs"
    class="action-tabs"
    v-on="$listeners"
  >
    <slot name="tabs"></slot>
    <slot></slot>
  </tabbed>
</template>

<style lang="scss" scoped>
  .action-tabs {
    display: flex;
    flex-direction: column;
    max-height: 100%;

    :deep(.tabs:focus .tab.active) {
      text-decoration: none;
    }

    :deep(.tabs) {
      border-bottom: 1px solid var(--border);

      a {
        text-decoration: none;
      }
    }

    :deep(.tab-container) {
      max-height: 100%;
      overflow: auto;
      background-color: transparent;
    }

    :deep(li.tab) {
      margin-right: 0;
      padding-right: 0;
      border-bottom: 1px solid var(--border);

      &.active {
        border-color: var(--primary);
        background-color: transparent;

        a {
          color: var(--link);
          text-decoration: none;
        }
      }
    }
  }
</style>

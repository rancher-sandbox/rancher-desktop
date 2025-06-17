<script lang="ts">
import { defineComponent } from 'vue';

import Tabbed from '@pkg/components/Tabbed/index.vue';

export default defineComponent({
  name:       'rd-tabbed',
  components: { Tabbed },
});
</script>

<template>
  <tabbed
    v-bind="$attrs"
    :use-hash="true"
    class="action-tabs"
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
      border: none;
      border-bottom: 1px solid var(--border);

      &:focus {
        outline: none;
        .tab.active a span {
          text-decoration: none;
        }
      }
      .tab a:hover {
        color: var(--link);
        span {
          text-decoration: none;
        }
      }
    }

    :deep(.tab-container) {
      max-height: 100%;
      overflow: auto;
      background-color: transparent;
      &.no-content {
        border: none;
      }
    }

    :deep(li.tab) {
      margin-right: 0;
      margin-bottom: -1px;
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

<script lang="ts">
import Vue from 'vue';
export default Vue.extend({
  name:  'empty-state',
  props: {
    icon: {
      type:    String,
      default: 'icon-alert',
    },
    heading: {
      type:    String,
      default: 'Empty state',
    },
    body: {
      type:    String,
      default: 'This is an example of an empty state.',
    },
  },
  computed: {
    hasPrimaryActionSlot(): boolean {
      return !!this.$slots['primary-action'];
    },
  },
});
</script>

<template>
  <div class="empty-state">
    <div class="empty-state-icon">
      <slot name="icon">
        <span class="icon" :class="icon"></span>
      </slot>
    </div>
    <div class="empty-state-heading">
      <slot name="heading">
        {{ heading }}
      </slot>
    </div>
    <div class="empty-state-body">
      <slot name="body">
        {{ body }}
      </slot>
    </div>
    <div v-if="hasPrimaryActionSlot" class="empty-state-primary-action">
      <slot name="primary-action"></slot>
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .empty-state {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    align-items: center;
  }

  .empty-state-icon {
    font-size: 8rem;
    line-height: 1;
  }

  .empty-state-heading {
    font-size: 1.875rem;
    line-height: 2.25rem;
  }

  .empty-state-body {
    font-size: 1rem;
    line-height: 1.5rem;
  }

  .empty-state-primary-action {
    padding-top: 1.5rem;
  }
</style>

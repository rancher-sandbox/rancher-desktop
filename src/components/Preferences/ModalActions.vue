<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
  name:    'preferences-actions',
  props: {
    isDirty: {
      type:     Boolean,
      required: true
    }
  },
  methods: {
    cancel() {
      this.$emit('cancel');
    }
  }
});
</script>

<template>
  <div class="preferences-actions">
    <button
      data-test="preferences-cancel"
      class="btn role-secondary"
      @click="cancel"
    >
      Cancel
    </button>
    <button
      class="btn role-primary"
      :disabled="!isDirty"
    >
      Apply
    </button>
  </div>
</template>

<style lang="scss" scoped>
  .preferences-actions {
    display: flex;
    justify-content: flex-end;
    gap: 1rem;
    padding: var(--preferences-content-padding);
    border-top: 1px solid var(--header-border);
  }
</style>

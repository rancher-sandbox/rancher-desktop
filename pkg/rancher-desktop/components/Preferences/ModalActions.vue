<script lang="ts">
import Vue from 'vue';
import { mapGetters } from 'vuex';

export default Vue.extend({
  name:     'preferences-actions',
  computed: {
    ...mapGetters('preferences', ['canApply']),
    isDisabled(): boolean {
      return !this.canApply;
    },
  },
  methods: {
    cancel() {
      this.$emit('cancel');
    },
    apply() {
      this.$emit('apply');
    },
  },
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
      :disabled="isDisabled"
      @click="apply"
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

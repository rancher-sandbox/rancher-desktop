<script lang="ts">
import Vue from 'vue';
import Banner from '@/components/Banner.vue';

export default Vue.extend({
  name:       'preferences-actions',
  components: { Banner },
  props:      {
    isDirty: {
      type:     Boolean,
      required: true
    }
  },
  methods: {
    cancel() {
      this.$emit('cancel');
    },
    apply() {
      this.$emit('apply');
    }
  }
});
</script>

<template>
  <div class="preferences-actions">
    <banner color="warning">
      <span class="icon icon-warning"></span>
      Kubernetes reset required.
    </banner>
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

  .banner {
    margin: 0;
  }
</style>

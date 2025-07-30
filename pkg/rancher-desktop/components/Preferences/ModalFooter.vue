<script lang="ts">
import { defineComponent } from 'vue';
import { mapGetters } from 'vuex';

import PreferencesAlert from '@pkg/components/Preferences/Alert.vue';

export default defineComponent({
  name:       'preferences-footer',
  components: { PreferencesAlert },
  computed:   {
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
  <div class="preferences-footer">
    <div class="preferences-alert">
      <preferences-alert />
    </div>
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
  </div>
</template>

<style lang="scss" scoped>
  .preferences-footer {
    display: flex;
    justify-content: space-between;
    border-top: 1px solid var(--header-border);
    padding: var(--preferences-content-padding);

    .preferences-alert {
      display: flex;
      justify-content: right;
      align-items: center;
      height: 101%;
      width: 100%;
      padding-right: var(--preferences-content-padding);
    }

    .preferences-actions {
      display: flex;
      justify-content: flex-end;
      gap: 1rem;
    }
  }
</style>

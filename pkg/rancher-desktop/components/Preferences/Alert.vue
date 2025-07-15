<script lang="ts">
import { defineComponent } from 'vue';
import { mapState } from 'vuex';

type AlertMap = Record<'reset'|'restart'|'error', string>;

const alertMap: AlertMap = {
  reset:   'preferences.actions.banner.reset',
  restart: 'preferences.actions.banner.restart',
  error:   'preferences.actions.banner.error',
};

export default defineComponent({
  name:     'preferences-alert',
  computed: {
    ...mapState('preferences', ['severities', 'preferencesError']),
    severity(): keyof AlertMap | undefined {
      if (this.severities.error) {
        return 'error';
      }

      if (this.severities.reset) {
        return 'reset';
      }

      if (this.severities.restart) {
        return 'restart';
      }

      return undefined;
    },
    alert(): string {
      if (!this.severity) {
        return '';
      }

      return alertMap[this.severity];
    },
    alertText(): string | null {
      if (this.preferencesError) {
        return this.preferencesError;
      }

      if (this.alert) {
        return this.t(this.alert, { }, true);
      }

      return null;
    },
  },
});
</script>

<template>
  <div class="alert">
    <span
      v-if="alert"
      class="alert-text"
    >
      {{ alertText }}
    </span>
  </div>
</template>

<style lang="scss" scoped>
  .alert {
    .alert-text {
      color: var(--body-text);
    }
  }
</style>

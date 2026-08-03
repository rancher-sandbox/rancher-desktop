<script lang="ts">

import { defineComponent } from 'vue';

import DiagnosticsBody from '@pkg/components/DiagnosticsBody.vue';
import { mapTypedState } from '@pkg/entry/store';

export default defineComponent({
  name:       'diagnostics',
  components: { DiagnosticsBody },

  computed: mapTypedState('diagnostics', ['diagnostics', 'timeLastRun']),
  async beforeMount() {
    await this.$store.dispatch('credentials/fetchCredentials');
    await this.$store.dispatch('preferences/fetchPreferences');
    await this.$store.dispatch('diagnostics/fetchDiagnostics');
  },
  mounted() {
    this.$store.dispatch(
      'page/setHeader',
      { titleKey: 'diagnostics.title' },
    );
  },
});
</script>

<template>
  <diagnostics-body
    :rows="diagnostics"
    :time-last-run="timeLastRun"
  />
</template>

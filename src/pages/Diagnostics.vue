<script lang="ts">

import Vue from 'vue';
import { mapGetters } from 'vuex';

import DiagnosticsBody from '@/components/DiagnosticsBody.vue';

export default Vue.extend({
  name:       'diagnostics',
  components: { DiagnosticsBody },

  async fetch() {
    const credentials = await this.$store.dispatch('credentials/fetchCredentials');

    await this.$store.dispatch('diagnostics/fetchDiagnostics', credentials);
    await this.$store.dispatch('preferences/fetchPreferences', credentials);
  },
  computed: mapGetters('diagnostics', ['diagnostics', 'timeLastRun']),
  mounted() {
    this.$store.dispatch(
      'page/setHeader',
      { title: 'Diagnostics' },
    );
  },
});
</script>

<template>
  <diagnostics-body :rows="diagnostics" :time-last-run="timeLastRun"></diagnostics-body>
</template>

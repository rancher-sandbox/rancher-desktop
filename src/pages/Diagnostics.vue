<script lang="ts">

import Vue from 'vue';
import { mapGetters, mapState } from 'vuex';

import DiagnosticsBody from '@/components/DiagnosticsBody.vue';
import type { ServerState } from '@/main/commandServer/httpCommandServer';

export default Vue.extend({
  name:       'diagnostics',
  components: { DiagnosticsBody },

  data() {
    return { rows: [] };
  },
  async fetch() {
    await this.$store.dispatch('credentials/fetchCredentials');
    await this.$store.dispatch('diagnostics/fetchDiagnostics', this.credentials as ServerState);
    this.$data.rows = this.diagnostics;
  },
  computed: {
    ...mapState('credentials', ['credentials']),
    ...mapGetters('diagnostics', ['diagnostics', 'timeLastRun']),
  },
  mounted() {
    this.$store.dispatch(
      'page/setHeader',
      {
        title:  'Diagnostics',
        action: 'diagnostics-button-run',
      },
    );
  },
});
</script>

<template>
  <diagnostics-body :rows="rows" :time-last-run="timeLastRun"></diagnostics-body>
</template>

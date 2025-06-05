<script lang="ts">

import { defineComponent } from 'vue';
import { mapGetters } from 'vuex';

import DiagnosticsBody from '@pkg/components/DiagnosticsBody.vue';

export default defineComponent({
  name:       'diagnostics',
  components: { DiagnosticsBody },

  computed: mapGetters('diagnostics', ['diagnostics', 'timeLastRun']),
  async beforeMount() {
    const credentials = await this.$store.dispatch('credentials/fetchCredentials');

    await this.$store.dispatch('preferences/fetchPreferences', credentials);
    await this.$store.dispatch('diagnostics/fetchDiagnostics', credentials);
  },
  mounted() {
    this.$store.dispatch(
      'page/setHeader',
      { title: 'Diagnostics' },
    );
  },
});
</script>

<template>
  <diagnostics-body
    :rows="diagnostics"
    :time-last-run="timeLastRun"
  ></diagnostics-body>
</template>

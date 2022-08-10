<script lang="ts">
import Vue from 'vue';

import DiagnosticsBody from '@/components/DiagnosticsBody.vue';

export default Vue.extend({
  name:       'diagnostics',
  components: { DiagnosticsBody },
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
  <div>
    <diagnostics-body></diagnostics-body>
  </div>
</template>

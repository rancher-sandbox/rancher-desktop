<script lang="ts">
import Vue from 'vue';
import { mapGetters } from 'vuex';
import WslIntegration from '@/components/WSLIntegration.vue';

export default Vue.extend({ 
  name: 'preferences-application-wsl',
  components: { WslIntegration },
  computed: {
    ...mapGetters('preferences', ['getWslIntegrations']),
  },
  methods: {
    handleSetIntegration(val: any) {
      console.debug({ val });
    }
  }
});
</script>

<template>
  <wsl-integration
    :integrations="getWslIntegrations"
    @integration-set="handleSetIntegration"
  />
</template>

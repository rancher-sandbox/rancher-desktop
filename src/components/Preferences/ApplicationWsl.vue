<script lang="ts">
import Vue from 'vue';
import { mapGetters } from 'vuex';
import WslIntegration from '@/components/WSLIntegration.vue';

export default Vue.extend({
  name: 'preferences-application-wsl',
  components: { WslIntegration },
  props:      {
    preferences: {
      type:     Object,
      required: true
    }
  },
  computed: {
    ...mapGetters('preferences', ['getWslIntegrations']),
  },
  methods: {
    onChange(distro: string, value: boolean) {
      const property = `kubernetes.WSLIntegrations["${ distro }"]`;

      this.$store.dispatch('preferences/updatePreferencesData', { property, value });
    }
  }
});
</script>

<template>
  <wsl-integration
    :integrations="preferences.kubernetes.WSLIntegrations"
    @integration-set="onChange"
  />
</template>

<script lang="ts">
import Vue from 'vue';
import type { PropType } from 'vue';
import { mapGetters } from 'vuex';

import WslIntegration from '@/components/WSLIntegration.vue';
import RdFieldset from '@/components/form/RdFieldset.vue';
import { Settings } from '@/config/settings';

export default Vue.extend({
  name:       'preferences-application-wsl',
  components: { WslIntegration, RdFieldset },
  props:      {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true
    }
  },
  computed: {
    ...mapGetters('preferences', ['getWslIntegrations']),
    integrationDescription(): string {
      return this.t('integrations.windows.description', { }, true);
    },
  },
  methods: {
    onChange(distro: string, value: boolean) {
      const property = `kubernetes.WSLIntegrations["${ distro }"]`;

      this.$store.dispatch('preferences/updateWslIntegrations', { property: `["${ distro }"]`, value });
      this.$store.dispatch('preferences/updatePreferencesData', { property, value });
    }
  }
});
</script>

<template>
  <rd-fieldset
    :legend-text="t('integrations.windows.description', { }, true)"
  >
    <wsl-integration
      :integrations="getWslIntegrations"
      @integration-set="onChange"
    />
  </rd-fieldset>
</template>

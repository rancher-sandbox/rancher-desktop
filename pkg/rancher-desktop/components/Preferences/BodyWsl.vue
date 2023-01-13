<script lang="ts">

import Vue from 'vue';
import { mapGetters } from 'vuex';

import WslIntegration from '@pkg/components/WSLIntegration.vue';
import RdFieldset from '@pkg/components/form/RdFieldset.vue';
import { Settings } from '@pkg/config/settings';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default Vue.extend({
  name:       'preferences-body-wsl',
  components: { WslIntegration, RdFieldset },
  props:      {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  computed: { ...mapGetters('preferences', ['getWslIntegrations']) },
  methods:  {
    onChange(distro: string, value: boolean) {
      const property: keyof RecursiveTypes<Settings> = `WSL.integrations["${ distro }"]` as any;

      this.$store.dispatch('preferences/updateWslIntegrations', { distribution: `["${ distro }"]`, value });
      this.$store.dispatch('preferences/updatePreferencesData', { property, value });
    },
  },
});
</script>

<template>
  <div class="preferences-body">
    <rd-fieldset
      :legend-text="t('integrations.windows.description', { }, true)"
    >
      <wsl-integration
        :integrations="getWslIntegrations"
        @integration-set="onChange"
      />
    </rd-fieldset>
  </div>
</template>

<style lang="scss" scoped>
  .preferences-body {
    padding: var(--preferences-content-padding);
  }
</style>

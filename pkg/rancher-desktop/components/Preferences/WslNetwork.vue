<script lang="ts">

import { Checkbox } from '@rancher/components';
import Vue, { PropType } from 'vue';

import RdFieldset from '@pkg/components/form/RdFieldset.vue';
import { Settings } from '@pkg/config/settings';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

export default Vue.extend({
  name:       'preferences-wsl-network',
  components: { Checkbox, RdFieldset },
  props:      {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },

  methods: {
    onChange<P extends keyof RecursiveTypes<Settings>>(property: P, value: RecursiveTypes<Settings>[P]) {
      this.$store.dispatch('preferences/updatePreferencesData', { property, value });
    },
  },
});
</script>

<template>
  <div class="wsl-network">
    <rd-fieldset
      data-test="networkingTunnel"
      :legend-text="t('virtualMachine.networkingTunnel.legend')"
      :badge-text="t('prefs.experimental')"
    >
      <checkbox
        :label="t('virtualMachine.networkingTunnel.label')"
        :value="preferences.experimental.virtualMachine.networkingTunnel"
        @input="onChange('experimental.virtualMachine.networkingTunnel', $event)"
      />
    </rd-fieldset>
  </div>
</template>

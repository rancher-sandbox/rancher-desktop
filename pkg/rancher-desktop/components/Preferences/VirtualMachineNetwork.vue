<script lang="ts">
import { Checkbox } from '@rancher/components';
import Vue from 'vue';

import RdFieldset from '@pkg/components/form/RdFieldset.vue';
import { Settings } from '@pkg/config/settings';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default Vue.extend({
  name:       'preferences-virtual-machine-network',
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
  <div class="virtual-machine-network">
    <rd-fieldset
      data-test="socketVmNet"
      :legend-text="t('virtualMachine.socketVmNet.legend')"
      :badge-text="t('prefs.experimental')"
    >
      <checkbox
        :label="t('virtualMachine.socketVmNet.label')"
        :value="preferences.experimental.virtualMachine.socketVMNet"
        @input="onChange('experimental.virtualMachine.socketVMNet', $event)"
      />
    </rd-fieldset>
  </div>
</template>

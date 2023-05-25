<script lang="ts">
import Vue from 'vue';
import { mapGetters } from 'vuex';

import RdCheckbox from '@pkg/components/form/RdCheckbox.vue';
import RdFieldset from '@pkg/components/form/RdFieldset.vue';
import { Settings } from '@pkg/config/settings';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default Vue.extend({
  name:       'preferences-virtual-machine-network',
  components: { RdCheckbox, RdFieldset },
  props:      {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  computed: { ...mapGetters('preferences', ['isPreferenceLocked']) },
  methods:  {
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
      <rd-checkbox
        :label="t('virtualMachine.socketVmNet.label')"
        :value="preferences.experimental.virtualMachine.socketVMNet"
        :is-locked="isPreferenceLocked('experimental.virtualMachine.socketVMNet')"
        @input="onChange('experimental.virtualMachine.socketVMNet', $event)"
      />
    </rd-fieldset>
  </div>
</template>

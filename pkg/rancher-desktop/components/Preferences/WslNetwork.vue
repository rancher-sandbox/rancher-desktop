<script lang="ts">

import Vue, { PropType } from 'vue';
import { mapGetters } from 'vuex';

import RdCheckbox from '@pkg/components/form/RdCheckbox.vue';
import RdFieldset from '@pkg/components/form/RdFieldset.vue';
import { Settings } from '@pkg/config/settings';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

export default Vue.extend({
  name:       'preferences-wsl-network',
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
  <div class="wsl-network">
    <rd-fieldset
      data-test="networkingTunnel"
      :legend-text="t('virtualMachine.networkingTunnel.legend')"
      :badge-text="t('prefs.experimental')"
    >
      <rd-checkbox
        :label="t('virtualMachine.networkingTunnel.label')"
        :value="preferences.experimental.virtualMachine.networkingTunnel"
        :is-locked="isPreferenceLocked('experimental.virtualMachine.networkingTunnel')"
        @input="onChange('experimental.virtualMachine.networkingTunnel', $event)"
      />
    </rd-fieldset>
  </div>
</template>

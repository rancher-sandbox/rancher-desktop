<script lang="ts">
import Vue from 'vue';

import { mapGetters } from 'vuex';
import PathManagementSelector from '@/components/PathManagementSelector.vue';
import RdFieldset from '@/components/form/RdFieldset.vue';

export default Vue.extend({
  name:       'preferences-application-environment',
  components: { PathManagementSelector, RdFieldset },
  props:      {
    preferences: {
      type:     Object,
      required: true
    }
  },
  computed:   { ...mapGetters('applicationSettings', ['pathManagementStrategy']) },
  methods:    {
    onChange(property: string, value: string | number | boolean) {
      this.$store.dispatch('preferences/updatePreferencesData', { property, value });
    }
  }
});
</script>

<template>
  <rd-fieldset
    :legend-text="t('pathManagement.label')"
    :legend-tooltip="t('pathManagement.tooltip', { }, true)"
  >
    <path-management-selector
      :show-label="false"
      :value="preferences.pathManagementStrategy"
      @input="onChange('pathManagementStrategy', $event)"
    />
  </rd-fieldset>
</template>

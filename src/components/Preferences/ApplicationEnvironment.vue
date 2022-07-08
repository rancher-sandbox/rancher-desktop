<script lang="ts">
import Vue from 'vue';
import _ from 'lodash';

import { mapGetters } from 'vuex';
import PathManagementSelector from '@/components/PathManagementSelector.vue';
import { PathManagementStrategy } from '@/integrations/pathManager';
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
    onChange(key: string, val: string | number | boolean) {
      this.$emit('preferences:change', _.set(_.cloneDeep(this.preferences), key, val));
    },
    onPathManagementChange(val: PathManagementStrategy) {
      this.$store.dispatch('applicationSettings/commitPathManagementStrategy', val);
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

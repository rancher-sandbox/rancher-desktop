<script lang="ts">
import Vue from 'vue';
import { mapGetters } from 'vuex';
import PathManagementSelector from '@/components/PathManagementSelector.vue';
import { PathManagementStrategy } from '@/integrations/pathManager';
import InputLegend from '@/components/form/InputLegend.vue';

export default Vue.extend({
  name:       'preferences-application-environment',
  components: { PathManagementSelector, InputLegend },
  computed:   { ...mapGetters('applicationSettings', ['pathManagementStrategy']) },
  methods:    {
    onPathManagementChange(val: PathManagementStrategy) {
      this.$store.dispatch('applicationSettings/commitPathManagementStrategy', val);
    }
  }
});
</script>

<template>
  <input-legend>
    <template #legend>
      {{ t('pathManagement.label') }}
      <i v-tooltip="t('pathManagement.tooltip', { }, true)" class="icon icon-info icon-lg" />
    </template>
    <path-management-selector
      :value="pathManagementStrategy"
      @input="onPathManagementChange"
    />
  </input-legend>
</template>

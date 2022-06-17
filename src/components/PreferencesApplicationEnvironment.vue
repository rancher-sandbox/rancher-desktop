<script lang="ts">
import Vue from 'vue';
import { mapGetters } from 'vuex';
import PathManagementSelector from '@/components/PathManagementSelector.vue';
import { PathManagementStrategy } from '@/integrations/pathManager';

export default Vue.extend({
  name:       'preferences-application-environment',
  components: { PathManagementSelector },
  computed:   { ...mapGetters('applicationSettings', ['pathManagementStrategy']) },
  methods:    {
    onPathManagementChange(val: PathManagementStrategy) {
      this.$store.dispatch('applicationSettings/commitPathManagementStrategy', val);
    }
  }
});
</script>

<template>
  <path-management-selector
    :value="pathManagementStrategy"
    @input="onPathManagementChange"
  >
    <template #label>
      <div class="path-management-title">
        <span>{{ t('pathManagement.label') }}</span>
        <i v-tooltip="t('pathManagement.tooltip', { }, true)" class="icon icon-info icon-lg" />
      </div>
    </template>
  </path-management-selector>
</template>

<style lang="scss" scoped>
  .path-management-title {
    font-size: 1rem;
    line-height: 1.5rem;
    padding-bottom: 0.5rem;
  }
</style>

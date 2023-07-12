<script lang="ts">
import { Banner } from '@rancher/components';
import Vue, { PropType } from 'vue';

export type CompatiblePrefs = { prefName: string, tabName: string }[];

export default Vue.extend({
  components: { Banner },
  props:      {
    compatiblePrefs: {
      type:     Array as PropType<CompatiblePrefs>,
      required: true,
    },
  },
  methods: {
    changeTab(tab: string) {
      this.$emit('update:tab', tab);
    },
  },
});
</script>

<template>
  <banner
    v-if="compatiblePrefs.length > 0"
    color="warning"
  >
    <p>{{ t('preferences.incompatibleTypeWarningPre') }}</p>
    <p
      v-for="(pref, index) in compatiblePrefs"
      :key="index"
    >
      <a
        href="#"
        @click.prevent="changeTab(pref.tabName)"
      >
        {{ pref.prefName }}
      </a>
      <span v-if="compatiblePrefs.length > 2 && index < (compatiblePrefs.length - 2)">
        {{ ',' }}
      </span>
      <span v-else-if="compatiblePrefs.length >= 2 && index === (compatiblePrefs.length - 2)">
        {{ t('preferences.incompatiblePrefWarningOr') }}
      </span>
    </p>
    <p>{{ t('preferences.incompatibleTypeWarningPost') }}</p>
  </banner>
</template>

<style scoped lang="scss">
  ::v-deep .banner__content {
    flex-wrap: wrap;
  }
</style>

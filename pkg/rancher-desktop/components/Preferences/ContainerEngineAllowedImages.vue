<script lang="ts">
import { Checkbox, StringList } from '@rancher/components';
import Vue from 'vue';

import RdFieldset from '@/components/form/RdFieldset.vue';
import { Settings } from '@/config/settings';
import { RecursiveTypes } from '@/utils/typeUtils';

import type { PropType } from 'vue';

export default Vue.extend({
  name:       'preferences-container-engine-allowed-images',
  components: {
    Checkbox,
    RdFieldset,
    StringList,
  },
  props:      {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  computed: {
    patterns() {
      return this.preferences.containerEngine.imageAllowList.patterns;
    },
    isAllowedImagesEnabled(): boolean {
      return this.preferences.containerEngine.imageAllowList.enabled;
    },
    isAllowedImagesLocked(): boolean {
      return this.preferences.containerEngine.imageAllowList.locked;
    },
    allowedImagesLockedTooltip() {
      return this.t('allowedImages.locked.tooltip');
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
  <div
    class="container-engine-allowed-images"
  >
    <rd-fieldset
      data-test="allowedImages"
      :legend-text="t('allowedImages.label')"
    >
      <checkbox
        label="Enable"
        :value="isAllowedImagesEnabled"
        :class="{
          'disabled': isAllowedImagesLocked
        }"
        @input="onChange('containerEngine.imageAllowList.enabled', $event)"
      />
      <i
        v-if="isAllowedImagesLocked"
        v-tooltip="{
          content: allowedImagesLockedTooltip,
          placement: 'right'
        }"
        class="icon icon-lock icon-lg"
      />
    </rd-fieldset>
    <string-list
      :items="patterns"
      :case-sensitive="false"
      :placeholder="t('allowedImages.patterns.placeholder')"
      :readonly="!isAllowedImagesEnabled || isAllowedImagesLocked"
      :actions-position="'left'"
      @change="onChange('containerEngine.imageAllowList.patterns', $event)"
    />
  </div>
</template>

<style lang="scss" scoped>

  .container-engine-allowed-images {
    display: flex;
    flex-direction: column;
    grid-gap: 1rem;
    gap: 1rem;

    .string-list {
      height: 220px;
    }
  }

  .disabled {
    cursor: default;
    pointer-events: none;
    opacity: 0.4;
  }

  .icon-lock {
    vertical-align: 2%;
    color: var(--warning);
  }

</style>

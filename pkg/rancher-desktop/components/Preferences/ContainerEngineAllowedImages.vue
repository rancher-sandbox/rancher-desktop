<script lang="ts">
import { Checkbox, StringList } from '@rancher/components';
import Vue from 'vue';

import RdFieldset from '@pkg/components/form/RdFieldset.vue';
import { LockedSettingsType, Settings } from '@pkg/config/settings';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default Vue.extend({
  name:       'preferences-container-engine-allowed-images',
  components: {
    Checkbox,
    RdFieldset,
    StringList,
  },
  props: {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  data() {
    return { lockedFields: {} as LockedSettingsType };
  },
  computed: {
    patterns() {
      return this.preferences.containerEngine.allowedImages.patterns;
    },
    isAllowedImagesEnabled(): boolean {
      return this.preferences.containerEngine.allowedImages.enabled;
    },
    isEnabledFieldLocked(): boolean {
      return this.lockedFields.containerEngine?.allowedImages?.enabled ?? false;
    },
    isPatternsFieldLocked(): boolean {
      return this.lockedFields.containerEngine?.allowedImages?.patterns || !this.isAllowedImagesEnabled;
    },
    allowedImagesLockedTooltip() {
      return this.t('allowedImages.locked.tooltip');
    },
    patternsErrorMessages() {
      return { duplicate: this.t('allowedImages.errors.duplicate') };
    },
  },
  mounted() {
    ipcRenderer.invoke('get-locked-fields').then((lockedFields: LockedSettingsType) => {
      this.lockedFields = lockedFields;
    });
  },
  methods: {
    onChange<P extends keyof RecursiveTypes<Settings>>(property: P, value: RecursiveTypes<Settings>[P]) {
      this.$store.dispatch('preferences/updatePreferencesData', { property, value });
    },
    onType(item: string) {
      if (item) {
        this.setCanApply(item.trim().length > 0);
      }
    },
    onDuplicate(err: boolean) {
      if (err) {
        this.setCanApply(false);
      }
    },
    setCanApply(val: boolean) {
      this.$store.dispatch('preferences/setCanApply', val);
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
      :badge-text="t('prefs.experimental')"
    >
      <checkbox
        :label="t('allowedImages.enable')"
        :value="isAllowedImagesEnabled"
        :class="{
          'disabled': isEnabledFieldLocked
        }"
        @input="onChange('containerEngine.allowedImages.enabled', $event)"
      />
      <i
        v-if="isEnabledFieldLocked"
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
      :readonly="isPatternsFieldLocked"
      :actions-position="'left'"
      :error-messages="patternsErrorMessages"
      @change="onChange('containerEngine.allowedImages.patterns', $event)"
      @type:item="onType($event)"
      @errors="onDuplicate($event.duplicate)"
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

<style lang="scss">
  .string-list .string-list-box .item .label {
    white-space: nowrap;
  }
</style>

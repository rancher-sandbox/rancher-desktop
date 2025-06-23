<script lang="ts">

import { StringList } from '@rancher/components';
import { defineComponent } from 'vue';
import { mapGetters } from 'vuex';

import RdCheckbox from '@pkg/components/form/RdCheckbox.vue';
import RdFieldset from '@pkg/components/form/RdFieldset.vue';
import { Settings } from '@pkg/config/settings';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default defineComponent({
  name:       'preferences-container-engine-allowed-images',
  components: {
    RdFieldset,
    StringList,
    RdCheckbox,
  },
  props: {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  computed: {
    ...mapGetters('preferences', ['isPreferenceLocked']),
    patterns(): string[] {
      return this.preferences.containerEngine.allowedImages.patterns;
    },
    isAllowedImagesEnabled(): boolean {
      return this.preferences.containerEngine.allowedImages.enabled;
    },
    isPatternsFieldLocked(): boolean {
      return this.isPreferenceLocked('containerEngine.allowedImages.patterns') || !this.isAllowedImagesEnabled;
    },
    patternsErrorMessages(): { duplicate: string } {
      return { duplicate: this.t('allowedImages.errors.duplicate') };
    },
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
  <div class="container-engine-allowed-images">
    <rd-fieldset data-test="allowedImages" :legend-text="t('allowedImages.label')" :is-experimental="true">
      <rd-checkbox
        data-testid="allowedImagesCheckbox"
        :label="t('allowedImages.enable')"
        :value="isAllowedImagesEnabled"
        :is-locked="isPreferenceLocked('containerEngine.allowedImages.enabled')"
        @update:value="onChange('containerEngine.allowedImages.enabled', $event)"
      />
    </rd-fieldset>
    <string-list
      :items="patterns"
      :case-sensitive="false"
      :placeholder="t('allowedImages.patterns.placeholder')"
      :readonly="isPatternsFieldLocked"
      actions-position="left"
      :error-messages="patternsErrorMessages"
      @change="Array.isArray($event) && onChange('containerEngine.allowedImages.patterns', $event)"
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
      flex: 1;
    }
  }

</style>

<style lang="scss">
  .string-list .string-list-box .item .label {
    white-space: nowrap;
  }
</style>

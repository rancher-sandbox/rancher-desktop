<script lang="ts">

import { defineComponent } from 'vue';
import { mapGetters } from 'vuex';

import RdSelect from '@pkg/components/RdSelect.vue';
import RdCheckbox from '@pkg/components/form/RdCheckbox.vue';
import RdFieldset from '@pkg/components/form/RdFieldset.vue';
import { Settings } from '@pkg/config/settings';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default defineComponent({
  name:       'preferences-application-general',
  components: { RdSelect, RdCheckbox, RdFieldset },
  props:      {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  computed: {
    ...mapGetters('preferences', ['isPlatformWindows', 'isPreferenceLocked']),
    ...mapGetters('i18n', ['availableLocales']),
    isSudoAllowed(): boolean {
      return this.preferences?.application?.adminAccess ?? false;
    },
    canAutoUpdate(): boolean {
      return this.preferences?.application.updater.enabled ?? false;
    },
    selectedLocale(): string {
      const locale = this.preferences?.application?.locale;

      return (!locale || locale === 'none') ? 'en-us' : locale;
    },
    showLocaleDisclaimer(): boolean {
      return this.selectedLocale !== 'en-us';
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
  <div class="application-general">
    <rd-fieldset
      data-test="locale"
      class="width-xs"
      :legend-text="t('application.locale.legendText')"
      :is-experimental="true"
    >
      <rd-select
        data-test="localeSelect"
        :model-value="selectedLocale"
        :aria-label="t('application.locale.legendText')"
        :is-locked="isPreferenceLocked('application.locale')"
        @change="onChange('application.locale', $event.target.value)"
      >
        <option
          v-for="(label, code) in availableLocales"
          :key="code"
          :value="code"
        >
          {{ label }}
        </option>
      </rd-select>
      <p
        v-if="showLocaleDisclaimer"
        class="locale-disclaimer"
      >
        {{ t('application.locale.disclaimer') }}
      </p>
    </rd-fieldset>
    <rd-fieldset
      v-if="!isPlatformWindows"
      data-test="administrativeAccess"
      :legend-text="t('application.general.adminAccess.legendText')"
      :legend-tooltip="t('application.general.adminAccess.legendTooltip')"
    >
      <rd-checkbox
        :label="t('application.general.adminAccess.label')"
        :value="isSudoAllowed"
        :is-locked="isPreferenceLocked('application.adminAccess')"
        @update:value="onChange('application.adminAccess', $event)"
      />
    </rd-fieldset>
    <rd-fieldset
      data-test="automaticUpdates"
      :legend-text="t('application.general.automaticUpdates.legendText')"
    >
      <rd-checkbox
        data-test="automaticUpdatesCheckbox"
        :label="t('application.general.automaticUpdates.label')"
        :value="canAutoUpdate"
        :is-locked="isPreferenceLocked('application.updater.enabled')"
        @update:value="onChange('application.updater.enabled', $event)"
      />
    </rd-fieldset>
    <rd-fieldset
      data-test="statistics"
      :legend-text="t('application.general.statistics.legendText')"
    >
      <rd-checkbox
        :label="t('application.general.statistics.label')"
        :value="preferences.application.telemetry.enabled"
        :is-locked="isPreferenceLocked('application.telemetry.enabled')"
        @update:value="onChange('application.telemetry.enabled', $event)"
      />
    </rd-fieldset>
  </div>
</template>

<style lang="scss" scoped>
  .application-general {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .width-xs {
    max-width: 20rem;
    min-width: 20rem;
  }

  .locale-disclaimer {
    margin-top: 0.5rem;
    font-size: 0.85rem;
    color: var(--input-label);
  }
</style>

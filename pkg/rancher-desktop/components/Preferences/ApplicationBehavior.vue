<script lang="ts">

import { RadioButton, RadioGroup } from '@rancher/components';
import { defineComponent } from 'vue';
import { mapGetters } from 'vuex';

import RdCheckbox from '@pkg/components/form/RdCheckbox.vue';
import RdFieldset from '@pkg/components/form/RdFieldset.vue';
import { Settings, Theme } from '@pkg/config/settings';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default defineComponent({
  name:       'preferences-application-behavior',
  components: {
    RadioGroup, RadioButton, RdCheckbox, RdFieldset,
  },
  props:      {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  computed: {
    ...mapGetters('preferences', ['isPreferenceLocked']),
    themeOptions(): { label: string, value: Theme, description: string }[] {
      return Object.values(Theme).map(value => ({
        label:       this.t(`application.behavior.theme.options.${ value }.label`),
        value,
        description: this.t(`application.behavior.theme.options.${ value }.description`),
      }));
    },
  },
  methods:  {
    onChange<P extends keyof RecursiveTypes<Settings>>(property: P, value: RecursiveTypes<Settings>[P]) {
      this.$store.dispatch('preferences/updatePreferencesData', { property, value });
    },
  },
});
</script>

<template>
  <div class="application-behavior">
    <div class="row">
      <div class="col span-6">
        <rd-fieldset
          data-test="autoStart"
          :legend-text="t('application.behavior.autoStart.legendText')"
        >
          <rd-checkbox
            :label="t('application.behavior.autoStart.label')"
            :value="preferences.application.autoStart"
            :is-locked="isPreferenceLocked('application.autoStart')"
            @update:value="onChange('application.autoStart', $event)"
          />
        </rd-fieldset>
        <rd-fieldset
          data-test="background"
          :legend-text="t('application.behavior.background.legendText')"
          :legend-tooltip="t('application.behavior.background.legendTooltip')"
          class="checkbox-group"
        >
          <rd-checkbox
            :label="t('application.behavior.startInBackground.label')"
            :value="preferences.application.startInBackground"
            :is-locked="isPreferenceLocked('application.startInBackground')"
            @update:value="onChange('application.startInBackground', $event)"
          />
          <rd-checkbox
            :label="t('application.behavior.windowQuitOnClose.label')"
            :value="preferences.application.window.quitOnClose"
            :is-locked="isPreferenceLocked('application.window.quitOnClose')"
            @update:value="onChange('application.window.quitOnClose', $event)"
          />
        </rd-fieldset>
        <rd-fieldset
          data-test="notificationIcon"
          :legend-text="t('application.behavior.notificationIcon.legendText')"
        >
          <rd-checkbox
            :label="t('application.behavior.notificationIcon.label')"
            :value="preferences.application.hideNotificationIcon"
            :is-locked="isPreferenceLocked('application.hideNotificationIcon')"
            @update:value="onChange('application.hideNotificationIcon', $event)"
          />
        </rd-fieldset>
      </div>
      <div class="col span-6 theme-options">
        <rd-fieldset
          data-test="theme"
          :legend-text="t('application.behavior.theme.legendText')"
          :is-locked="isPreferenceLocked('application.theme')"
        >
          <template #default="{ isLocked }">
            <radio-group
              :options="themeOptions"
              name="theme"
              :disabled="isLocked"
              :class="{ 'locked-radio': isLocked }"
            >
              <template
                v-for="(option, index) in themeOptions"
                #[index]="{ isDisabled }"
              >
                <radio-button
                  :key="'theme-' + index"
                  name="theme"
                  :value="preferences.application.theme"
                  :val="option.value"
                  :disabled="isDisabled"
                  :data-test="option.label"
                  @update:value="onChange('application.theme', $event)"
                >
                  <template #label>
                    {{ option.label }}
                  </template>
                  <template #description>
                    {{ option.description }}
                  </template>
                </radio-button>
              </template>
            </radio-group>
          </template>
        </rd-fieldset>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .application-behavior {
    display: flex;
    flex-direction: column;
    gap: 1rem;

    .checkbox-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .theme-options {
      border-left: 1px solid var(--border);
      padding-left: 1rem;
    }
  }
</style>

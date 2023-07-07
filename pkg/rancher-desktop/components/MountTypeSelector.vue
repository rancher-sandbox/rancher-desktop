<script lang="ts">
import os from 'os';

import { RadioButton, RadioGroup } from '@rancher/components';
import Vue from 'vue';
import { mapGetters } from 'vuex';

import RdInput from '@pkg/components/RdInput.vue';
import RdSelect from '@pkg/components/RdSelect.vue';
import LabeledBadge from '@pkg/components/form/LabeledBadge.vue';
import RdFieldset from '@pkg/components/form/RdFieldset.vue';
import {
  CacheMode, MountType, ProtocolVersion, SecurityModel, Settings, VMType,
} from '@pkg/config/settings';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default Vue.extend({
  components: {
    LabeledBadge,
    RadioGroup,
    RdFieldset,
    RadioButton,
    RdSelect,
    RdInput,
  },
  props: {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  computed: {
    ...mapGetters('preferences', ['isPreferenceLocked']),
    options(): { label: string, value: MountType, description: string, experimental: boolean, disabled: boolean }[] {
      const defaultOption = MountType.REVERSE_SSHFS;

      return Object.values(MountType)
        .filter((x) => {
          // Filter because virtiofs is only available on MacOS from Ventura release
          if (x === MountType.VIRTIOFS) {
            return this.hasVirtIoFs;
          }

          return true;
        })
        .sort((x, y) => { // Non-experimental (default) option should go first
          return x === defaultOption ? -1 : y === defaultOption ? 1 : 0;
        })
        .map((x) => {
          return {
            label:        this.t(`virtualMachine.mount.type.options.${ x }.label`),
            value:        x,
            description:  this.t(`virtualMachine.mount.type.options.${ x }.description`, {}, true),
            experimental: x !== defaultOption, // Mark experimental options
            disabled:     x === MountType.VIRTIOFS && this.virtIoFsDisabled,
          };
        });
    },
    groupName() {
      return 'mountType';
    },
    ninePSelected(): boolean {
      return this.preferences.experimental.virtualMachine.mount.type === MountType.NINEP;
    },
    hasVirtIoFs(): boolean {
      return os.platform() === 'darwin';
    },
    virtIoFsDisabled(): boolean {
      return this.preferences.experimental.virtualMachine.type !== VMType.VZ;
    },
  },
  methods: {
    ninePOptions(setting: string) {
      let items: CacheMode[] | ProtocolVersion[] | SecurityModel[] = [];
      let selected: CacheMode | ProtocolVersion | SecurityModel;

      switch (setting) {
      case 'cacheMode':
        items = Object.values(CacheMode);
        selected = this.preferences.experimental.virtualMachine.mount['9p'].cacheMode;
        break;
      case 'protocolVersion':
        items = Object.values(ProtocolVersion);
        selected = this.preferences.experimental.virtualMachine.mount['9p'].protocolVersion;
        break;
      case 'securityModel':
        items = Object.values(SecurityModel);
        selected = this.preferences.experimental.virtualMachine.mount['9p'].securityModel;
        break;
      }

      return items
        .map((x) => {
          return {
            label:    this.t(`virtualMachine.mount.type.options.9p.options.${ setting }.options.${ x.replace('.', '') }`),
            value:    x,
            selected: x === selected,
          };
        });
    },
    updateValue<P extends keyof RecursiveTypes<Settings>>(property: P, value: RecursiveTypes<Settings>[P]) {
      this.$emit('update', property, value);
    },
    disabledVirtIoFsTooltip(disabled: boolean): { content: string } | {} {
      let tooltip = {};

      if (disabled) {
        tooltip = { content: this.t('prefs.onlyWithVZ') };
      }

      return tooltip;
    },
  },
});
</script>

<template>
  <div class="mount-type-selector">
    <div class="row">
      <div class="col span-6">
        <rd-fieldset
          data-test="mountType"
          :legend-text="t('virtualMachine.mount.type.legend')"
          :is-locked="isPreferenceLocked('experimental.virtualMachine.mount.type')"
        >
          <template #default="{ isLocked }">
            <radio-group
              :name="groupName"
              :options="options"
              :disabled="isLocked"
              :class="{ 'locked-radio' : isLocked }"
            >
              <template
                v-for="(option, index) in options"
                #[index]="{ isDisabled }"
              >
                <radio-button
                  :key="groupName+'-'+index"
                  v-tooltip="disabledVirtIoFsTooltip(option.disabled)"
                  :name="groupName"
                  :value="preferences.experimental.virtualMachine.mount.type"
                  :label="option.label"
                  :val="option.value"
                  :description="option.description"
                  :disabled="option.disabled || isDisabled"
                  :data-test="option.label"
                  @input="updateValue('experimental.virtualMachine.mount.type', $event)"
                >
                  <template #label>
                    {{ option.label }}
                    <labeled-badge
                      v-if="option.experimental"
                      :text="t('prefs.experimental')"
                    />
                  </template>
                </radio-button>
              </template>
            </radio-group>
          </template>
        </rd-fieldset>
      </div>
      <div
        v-if="ninePSelected"
        class="col span-6 mount-type-sub-options"
      >
        <rd-fieldset
          data-test="cacheMode"
          :legend-text="t('virtualMachine.mount.type.options.9p.options.cacheMode.legend')"
          :legend-tooltip="t('virtualMachine.mount.type.options.9p.options.cacheMode.tooltip')"
        >
          <rd-select
            :value="preferences.experimental.virtualMachine.mount['9p'].cacheMode"
            :is-locked="isPreferenceLocked('experimental.virtualMachine.mount.9p.cacheMode')"
            @change="updateValue('experimental.virtualMachine.mount.9p.cacheMode', $event.target.value)"
          >
            <option
              v-for="item in ninePOptions('cacheMode')"
              :key="item.label"
              :value="item.value"
              :selected="item.selected"
            >
              {{ item.label }}
            </option>
          </rd-select>
        </rd-fieldset>
        <rd-fieldset
          data-test="msizeInKib"
          :legend-text="t('virtualMachine.mount.type.options.9p.options.mSizeInKib.legend')"
          :legend-tooltip="t('virtualMachine.mount.type.options.9p.options.mSizeInKib.tooltip')"
        >
          <rd-input
            type="number"
            :value="preferences.experimental.virtualMachine.mount['9p'].msizeInKib"
            :is-locked="isPreferenceLocked('experimental.virtualMachine.mount.9p.msizeInKib')"
            min="4"
            @input="updateValue('experimental.virtualMachine.mount.9p.msizeInKib', $event.target.value)"
          />
        </rd-fieldset>
        <rd-fieldset
          data-test="protocolVersion"
          :legend-text="t('virtualMachine.mount.type.options.9p.options.protocolVersion.legend')"
          :legend-tooltip="t('virtualMachine.mount.type.options.9p.options.protocolVersion.tooltip')"
        >
          <rd-select
            :value="preferences.experimental.virtualMachine.mount['9p'].protocolVersion"
            :is-locked="isPreferenceLocked('experimental.virtualMachine.mount.9p.protocolVersion')"
            @change="updateValue('experimental.virtualMachine.mount.9p.protocolVersion', $event.target.value)"
          >
            <option
              v-for="item in ninePOptions('protocolVersion')"
              :key="item.label"
              :value="item.value"
              :selected="item.selected"
            >
              {{ item.label }}
            </option>
          </rd-select>
        </rd-fieldset>
        <rd-fieldset
          data-test="securityModel"
          :legend-text="t('virtualMachine.mount.type.options.9p.options.securityModel.legend')"
          :legend-tooltip="t('virtualMachine.mount.type.options.9p.options.securityModel.tooltip')"
        >
          <rd-select
            :value="preferences.experimental.virtualMachine.mount['9p'].securityModel"
            :is-locked="isPreferenceLocked('experimental.virtualMachine.mount.9p.securityModel')"
            @change="updateValue('experimental.virtualMachine.mount.9p.securityModel', $event.target.value)"
          >
            <option
              v-for="item in ninePOptions('securityModel')"
              :key="item.label"
              :value="item.value"
              :selected="item.selected"
            >
              {{ item.label }}
            </option>
          </rd-select>
        </rd-fieldset>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .mount-type-sub-options {
    border-left: 1px solid var(--border);
    padding-left: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
</style>

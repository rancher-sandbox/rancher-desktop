<script lang="ts">
import os from 'os';

import { RadioButton, RadioGroup } from '@rancher/components';
import Vue from 'vue';

import LabeledBadge from '@pkg/components/form/LabeledBadge.vue';
import RdFieldset from '@pkg/components/form/RdFieldset.vue';
import {
  CacheMode, MountType, ProtocolVersion, SecurityModel, Settings,
} from '@pkg/config/settings';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default Vue.extend({
  components: {
    LabeledBadge,
    RadioGroup,
    RdFieldset,
    RadioButton,
  },
  props: {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  computed: {
    options() {
      const defaultOption = MountType.REVERSE_SSHFS;

      return Object.values(MountType)
        .filter((x) => {
          // Filter because virtiofs is only available on MacOS from Ventura release
          if (x === MountType.VIRTIOFS) {
            return (os.platform() === 'darwin') && (parseInt(os.release()) >= 22);
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
          };
        });
    },
    groupName() {
      return 'mountType';
    },
    ninePSelected(): boolean {
      return this.preferences.experimental.virtualMachine.mount.type === MountType.NINEP;
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
        >
          <radio-group
            :name="groupName"
            :options="options"
          >
            <template
              v-for="(option, index) in options"
              #[index]
            >
              <radio-button
                :key="groupName+'-'+index"
                :name="groupName"
                :value="preferences.experimental.virtualMachine.mount.type"
                :label="option.label"
                :val="option.value"
                :description="option.description"
                @input="updateValue('experimental.virtualMachine.mount.type', $event)"
              >
                <template #label>
                  {{ option.label }}
                  <labeled-badge
                    v-if="option.experimental"
                    color="bg-darker"
                    :text="t('prefs.experimental')"
                  />
                </template>
              </radio-button>
            </template>
          </radio-group>
        </rd-fieldset>
      </div>
      <div
        v-if="ninePSelected"
        class="col span-6 mount-type-sub-options"
      >
        <rd-fieldset
          data-test="mountType"
          :legend-text="t('virtualMachine.mount.type.options.9p.options.cacheMode.legend')"
          :legend-tooltip="t('virtualMachine.mount.type.options.9p.options.cacheMode.tooltip')"
        >
          <select
            @input="updateValue('experimental.virtualMachine.mount.9p.cacheMode', $event.target.value)"
          >
            <option
              v-for="item in ninePOptions('cacheMode')"
              :key="item.label"
              :value="item.value"
              :selected="item.selected"
            >
              {{ item.label }}
            </option>
          </select>
        </rd-fieldset>
        <rd-fieldset
          data-test="msizeInKb"
          :legend-text="t('virtualMachine.mount.type.options.9p.options.mSizeInKb.legend')"
          :legend-tooltip="t('virtualMachine.mount.type.options.9p.options.mSizeInKb.tooltip')"
        >
          <input
            type="number"
            :value="preferences.experimental.virtualMachine.mount['9p'].msizeInKB"
            min="4"
            @input="updateValue('experimental.virtualMachine.mount.9p.msizeInKB', $event.target.value)"
          />
        </rd-fieldset>
        <rd-fieldset
          data-test="protocolVersion"
          :legend-text="t('virtualMachine.mount.type.options.9p.options.protocolVersion.legend')"
          :legend-tooltip="t('virtualMachine.mount.type.options.9p.options.protocolVersion.tooltip')"
        >
          <select
            @input="updateValue('experimental.virtualMachine.mount.9p.protocolVersion', $event.target.value)"
          >
            <option
              v-for="item in ninePOptions('protocolVersion')"
              :key="item.label"
              :value="item.value"
              :selected="item.selected"
            >
              {{ item.label }}
            </option>
          </select>
        </rd-fieldset>
        <rd-fieldset
          data-test="securityModel"
          :legend-text="t('virtualMachine.mount.type.options.9p.options.securityModel.legend')"
          :legend-tooltip="t('virtualMachine.mount.type.options.9p.options.securityModel.tooltip')"
        >
          <select
            @input="updateValue('experimental.virtualMachine.mount.9p.securityModel', $event.target.value)"
          >
            <option
              v-for="item in ninePOptions('securityModel')"
              :key="item.label"
              :value="item.value"
              :selected="item.selected"
            >
              {{ item.label }}
            </option>
          </select>
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
    gap: 0.75rem;
  }
</style>

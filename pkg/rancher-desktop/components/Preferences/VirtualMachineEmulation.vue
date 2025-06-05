<script lang="ts">

import { RadioButton, RadioGroup } from '@rancher/components';
import semver from 'semver';
import { defineComponent } from 'vue';
import { mapGetters, mapState } from 'vuex';

import IncompatiblePreferencesAlert, { CompatiblePrefs } from '@pkg/components/IncompatiblePreferencesAlert.vue';
import RdCheckbox from '@pkg/components/form/RdCheckbox.vue';
import RdFieldset from '@pkg/components/form/RdFieldset.vue';
import { MountType, Settings, VMType } from '@pkg/config/settings';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default defineComponent({
  name:       'preferences-virtual-machine-emulation',
  components: {
    IncompatiblePreferencesAlert,
    RadioGroup,
    RdFieldset,
    RdCheckbox,
    RadioButton,
  },
  props: {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  computed: {
    ...mapGetters('preferences', ['isPreferenceLocked']),
    ...mapState('transientSettings', ['macOsVersion', 'isArm']),
    options(): { label: string, value: VMType, description: string, disabled: boolean,
      compatiblePrefs: CompatiblePrefs | [] }[] {
      return Object.values(VMType)
        .map((x) => {
          return {
            label:           this.t(`virtualMachine.type.options.${ x }.label`),
            value:           x,
            description:     this.t(`virtualMachine.type.options.${ x }.description`, {}, true),
            disabled:        x === VMType.VZ && this.vzDisabled,
            compatiblePrefs: this.getCompatiblePrefs(x),
          };
        });
    },
    groupName(): string {
      return 'vmType';
    },
    vZSelected(): boolean {
      return this.preferences.virtualMachine.type === VMType.VZ;
    },
    vzDisabled(): boolean {
      return semver.lt(this.macOsVersion.version, '13.0.0') || (this.isArm && semver.lt(this.macOsVersion.version, '13.3.0'));
    },
    rosettaDisabled(): boolean {
      return !this.isArm;
    },
    arch(): string {
      return this.isArm ? 'arm64' : 'x64';
    },
  },
  methods: {
    onChange<P extends keyof RecursiveTypes<Settings>>(property: P, value: RecursiveTypes<Settings>[P]) {
      this.$store.dispatch('preferences/updatePreferencesData', { property, value });
    },
    disabledVmTypeTooltip(disabled: boolean): { content: string } | Record<string, never> {
      let tooltip = {};

      if (disabled) {
        tooltip = { content: this.t(`prefs.onlyFromVentura_${ this.arch }`) };
      }

      return tooltip;
    },
    getCompatiblePrefs(vmType: VMType): CompatiblePrefs | [] {
      const compatiblePrefs: CompatiblePrefs = [];

      switch (vmType) {
      case VMType.QEMU:
        if (this.preferences.virtualMachine.mount.type === MountType.VIRTIOFS) {
          compatiblePrefs.push(
            {
              title: MountType.REVERSE_SSHFS, navItemName: 'Virtual Machine', tabName: 'volumes',
            },
            {
              title: MountType.NINEP, navItemName: 'Virtual Machine', tabName: 'volumes',
            } );
        }
        break;
      case VMType.VZ:
        if (this.preferences.virtualMachine.mount.type === MountType.NINEP) {
          compatiblePrefs.push(
            {
              title: MountType.REVERSE_SSHFS, navItemName: 'Virtual Machine', tabName: 'volumes',
            },
            {
              title: MountType.VIRTIOFS, navItemName: 'Virtual Machine', tabName: 'volumes',
            } );
        }
        break;
      }

      return compatiblePrefs;
    },
  },
});
</script>

<template>
  <div class="virtual-machine-emulation">
    <div class="row">
      <div class="col span-6">
        <rd-fieldset
          data-test="vmType"
          :legend-text="t('virtualMachine.type.legend')"
          :is-locked="isPreferenceLocked('virtualMachine.type')"
        >
          <template #default="{ isLocked }">
            <radio-group
              :options="options"
              :name="groupName"
              :disabled="isLocked"
              :class="{ 'locked-radio' : isLocked }"
            >
              <template
                v-for="(option, index) in options"
                #[index]="{ isDisabled }"
              >
                <radio-button
                  :key="groupName+'-'+index"
                  v-tooltip="disabledVmTypeTooltip(option.disabled)"
                  :name="groupName"
                  :value="preferences.virtualMachine.type"
                  :val="option.value"
                  :disabled="option.disabled || isDisabled"
                  :data-test="option.label"
                  @input="onChange('virtualMachine.type', $event)"
                >
                  <template #label>
                    {{ option.label }}
                  </template>
                  <template #description>
                    {{ option.description }}
                    <incompatible-preferences-alert
                      v-if="option.value === preferences.virtualMachine.type"
                      :compatible-prefs="option.compatiblePrefs"
                    />
                  </template>
                </radio-button>
              </template>
            </radio-group>
          </template>
        </rd-fieldset>
      </div>
      <div
        v-if="vZSelected && !rosettaDisabled"
        class="col span-6 vz-sub-options"
      >
        <rd-fieldset
          data-test="useRosetta"
          :legend-text="t('virtualMachine.useRosetta.legend')"
        >
          <rd-checkbox
            :label="t('virtualMachine.useRosetta.label')"
            :value="preferences.virtualMachine.useRosetta"
            :is-locked="isPreferenceLocked('virtualMachine.useRosetta')"
            @input="onChange('virtualMachine.useRosetta', $event)"
          />
        </rd-fieldset>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .vz-sub-options {
    border-left: 1px solid var(--border);
    padding-left: 1rem;
    display: flex;
    flex-direction: column;
  }
</style>

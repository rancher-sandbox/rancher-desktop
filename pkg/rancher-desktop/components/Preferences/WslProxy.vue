<script lang="ts">

import { StringList } from '@rancher/components';
import { defineComponent } from 'vue';
import { mapGetters } from 'vuex';

import RdInput from '@pkg/components/RdInput.vue';
import RdCheckbox from '@pkg/components/form/RdCheckbox.vue';
import RdFieldset from '@pkg/components/form/RdFieldset.vue';
import { Settings } from '@pkg/config/settings';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default defineComponent({
  name:       'preferences-wsl-proxy',
  components: {
    RdCheckbox, RdFieldset, RdInput, StringList,
  },
  props: {
    preferences: {
      type:     Object as PropType<Settings>,
      required: true,
    },
  },
  computed: {
    ...mapGetters('preferences', ['isPreferenceLocked']),
    isFieldDisabled() {
      return !(this.preferences.experimental.virtualMachine.proxy.enabled);
    },
    noproxyErrorMessages(): { duplicate: string } {
      return { duplicate: this.t('virtualMachine.proxy.noproxy.errors.duplicate') };
    },
    isNoProxyFieldReadOnly() {
      return this.isFieldDisabled || this.isPreferenceLocked('experimental.virtualMachine.proxy.noproxy');
    },
  },
  methods: {
    onChange<P extends keyof RecursiveTypes<Settings>>(property: P, value: RecursiveTypes<Settings>[P]) {
      this.$store.dispatch('preferences/updatePreferencesData', { property, value });
    },
    onType(item: string) {
      if (item) {
        this.$store.dispatch('preferences/setCanApply', item.trim().length > 0);
      }
    },
    onDuplicate(err: boolean) {
      if (err) {
        this.$store.dispatch('preferences/setCanApply', false);
      }
    },
  },
});
</script>

<template>
  <div class="wsl-proxy">
    <rd-fieldset
      :legend-text="t('virtualMachine.proxy.legend')"
      :is-experimental="true"
    >
      <rd-checkbox
        :label="t('virtualMachine.proxy.label', { }, true)"
        :value="preferences.experimental.virtualMachine.proxy.enabled"
        :is-locked="isPreferenceLocked('experimental.virtualMachine.proxy.enabled')"
        @input="onChange('experimental.virtualMachine.proxy.enabled', $event)"
      />
    </rd-fieldset>
    <hr>
    <div class="proxy-row">
      <div class="proxy-col">
        <rd-fieldset
          data-test="addressTitle"
          class="wsl-proxy-fieldset"
          :legend-text="t('virtualMachine.proxy.addressTitle', { }, true)"
        >
          <rd-input
            :placeholder="t('virtualMachine.proxy.address', { }, true)"
            :disabled="isFieldDisabled"
            :value="preferences.experimental.virtualMachine.proxy.address"
            :is-locked="isPreferenceLocked('experimental.virtualMachine.proxy.address')"
            @input="onChange('experimental.virtualMachine.proxy.address', $event.target.value)"
          />
          <rd-input
            type="number"
            :placeholder="t('virtualMachine.proxy.port', { }, true)"
            :disabled="isFieldDisabled"
            :value="preferences.experimental.virtualMachine.proxy.port"
            :is-locked="isPreferenceLocked('experimental.virtualMachine.proxy.port')"
            @input="onChange('experimental.virtualMachine.proxy.port', $event.target.value)"
          />
        </rd-fieldset>
        <rd-fieldset
          class="wsl-proxy-fieldset"
          :legend-text="t('virtualMachine.proxy.authTitle', { }, true)"
        >
          <rd-input
            :placeholder="t('virtualMachine.proxy.username', { }, true)"
            :disabled="isFieldDisabled"
            :value="preferences.experimental.virtualMachine.proxy.username"
            :is-locked="isPreferenceLocked('experimental.virtualMachine.proxy.username')"
            @input="onChange('experimental.virtualMachine.proxy.username', $event.target.value)"
          />
          <rd-input
            type="password"
            :placeholder="t('virtualMachine.proxy.password', { }, true)"
            :disabled="isFieldDisabled"
            :value="preferences.experimental.virtualMachine.proxy.password"
            :is-locked="isPreferenceLocked('experimental.virtualMachine.proxy.password')"
            @input="onChange('experimental.virtualMachine.proxy.password', $event.target.value)"
          />
        </rd-fieldset>
      </div>
      <div class="proxy-col">
        <rd-fieldset
          :legend-text="t('virtualMachine.proxy.noproxy.legend', { }, true)"
          :is-locked="isPreferenceLocked('experimental.virtualMachine.proxy.noproxy')"
        >
          <string-list
            :placeholder="t('virtualMachine.proxy.noproxy.placeholder', { }, true)"
            :readonly="isNoProxyFieldReadOnly"
            :actions-position="'left'"
            :items="preferences.experimental.virtualMachine.proxy.noproxy"
            :error-messages="noproxyErrorMessages"
            bulk-addition-delimiter=","
            @change="onChange('experimental.virtualMachine.proxy.noproxy', $event)"
            @type:item="onType($event)"
            @errors="onDuplicate($event.duplicate)"
          />
        </rd-fieldset>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .proxy-row {
    display: flex;
    flex-direction: row;
    gap: 1rem;
  }
  .proxy-col {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: 50%;

    .string-list {
      :deep(.string-list-box) {
        min-height: unset;
        height: 195px;
      }

      :deep(.string-list-footer) {
        padding-right: 2rem;
      }

      :deep(.readonly) {
        background-color: var(--input-disabled-bg);
        color: var(--input-disabled-text);
        opacity: 1;
        cursor: not-allowed;
      }
    }
  }
  .wsl-proxy {
    display: flex;
    flex-direction: column;
  }
  .wsl-proxy-fieldset {
    display: flex;
    flex-direction: row;
    gap: .5rem;
  }
</style>

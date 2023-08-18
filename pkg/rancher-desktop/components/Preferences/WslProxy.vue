<script lang="ts">
import Vue from 'vue';
import { mapGetters } from 'vuex';

import RdInput from '@pkg/components/RdInput.vue';
import RdCheckbox from '@pkg/components/form/RdCheckbox.vue';
import RdFieldset from '@pkg/components/form/RdFieldset.vue';
import { Settings } from '@pkg/config/settings';
import { RecursiveTypes } from '@pkg/utils/typeUtils';

import type { PropType } from 'vue';

export default Vue.extend({
  name:       'preferences-wsl-proxy',
  components: {
    RdCheckbox, RdFieldset, RdInput,
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
    noProxyText: {
      get() {
        return this.preferences.experimental.virtualMachine.proxy.noproxy.join('\n');
      },
      set(value: String) {
        this.$store.dispatch('preferences/updatePreferencesData', { property: 'experimental.virtualMachine.proxy.noproxy', value: value.trim().split('\n') });
      },
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
            class="wsl-proxy-field"
            @input="onChange('experimental.virtualMachine.proxy.address', $event.target.value)"
          />
          <rd-input
            type="number"
            :placeholder="t('virtualMachine.proxy.port', { }, true)"
            :disabled="isFieldDisabled"
            :value="preferences.experimental.virtualMachine.proxy.port"
            :is-locked="isPreferenceLocked('experimental.virtualMachine.proxy.port')"
            class="wsl-proxy-field"
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
            class="wsl-proxy-field"
            @input="onChange('experimental.virtualMachine.proxy.username', $event.target.value)"
          />
          <rd-input
            type="password"
            :placeholder="t('virtualMachine.proxy.password', { }, true)"
            :disabled="isFieldDisabled"
            :value="preferences.experimental.virtualMachine.proxy.password"
            :is-locked="isPreferenceLocked('experimental.virtualMachine.proxy.password')"
            class="wsl-proxy-field"
            @input="onChange('experimental.virtualMachine.proxy.password', $event.target.value)"
          />
        </rd-fieldset>
      </div>
      <div class="proxy-col">
        <rd-fieldset
          :legend-text="t('virtualMachine.proxy.noproxyTitle', { }, true)"
          :style="{ height: '100%' }"
        >
          <textarea
            :placeholder="t('virtualMachine.proxy.noproxy', { }, true)"
            :disabled="isFieldDisabled"
            :value="preferences.experimental.virtualMachine.proxy.noproxy.join('\n')"
            class="wsl-proxy-textarea"
            @input="onChange('experimental.virtualMachine.proxy.noproxy', $event.target.value.split('\n'))"
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
  }
  .proxy-col {
    padding: 0rem .5rem;
    width: 50%;
    display: flex;
    flex-direction: column;
  }
  .wsl-proxy {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .wsl-proxy-fieldset {
    display: flex;
    flex-direction: row;
    gap: .5rem;
  }
  .wsl-proxy-field {
    width: 100%;
  }
  .wsl-proxy-textarea{
    width: 100%;
    height: 100%;
    padding: 2px;
  }
</style>

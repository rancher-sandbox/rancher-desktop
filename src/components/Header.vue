<script lang="ts">
import Vue from 'vue';

import { State } from '@/backend/k8s';
import PreferencesButton from '@/components/Preferences/ButtonOpen.vue';
import { isPreferencesEnabled } from '@/utils/preferences';

import type { PropType } from 'vue';

export default Vue.extend({
  name:       'rd-header',
  components: { PreferencesButton },
  props:      {
    kubernetesState: {
      type:    String as PropType<State>,
      default: State.STARTING,
    },
  },
  computed: {
    isDisabled(): boolean {
      return isPreferencesEnabled(this.kubernetesState);
    },
  },
  methods:    {
    openPreferences() {
      this.$emit('open-preferences');
    },
  },
});
</script>

<template>
  <header>
    <div alt="Rancher Desktop" class="logo">
      <img src="@/assets/images/logo.svg">
    </div>
    <div class="header-actions">
      <preferences-button
        :disabled="isDisabled"
        @open-preferences="openPreferences"
      />
    </div>
  </header>
</template>

<style lang="scss" scoped>
  header {
    height:  var(--header-height);
    background-color: var(--header-bg);
    position: relative;
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0 0.75rem 0 0.75rem;

    .logo {
    flex: 1;
    height: 40px;
    z-index: 2;
      img {
        height: 40px;
      }
    }

    .header-actions {
      display: flex;
      align-items: center;
    }
  }
</style>

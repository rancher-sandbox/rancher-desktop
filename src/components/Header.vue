<script lang="ts">
import Vue from 'vue';
import PreferencesButton from '@/components/PreferencesButton.vue';

export default Vue.extend({
  name:       'rd-header',
  components: { PreferencesButton },
  computed:   {
    showPreferences() {
      return this.$config.showPreferences;
    }
  },
  methods:    {
    openPreferences() {
      this.$emit('open-preferences');
    }
  }
});
</script>

<template>
  <header>
    <div alt="Rancher Desktop" class="logo">
      <img src="@/assets/images/logo.svg">
    </div>
    <div class="header-actions">
      <preferences-button
        v-if="showPreferences"
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

  }
</style>

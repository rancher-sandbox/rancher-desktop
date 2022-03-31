<!-- This layout is used by dialog boxes that do not want navigation -->

<template>
  <dialog ref="wrapper" class="wrapper" open>
    <Nuxt class="body" />
  </dialog>
</template>

<script lang="ts">
import Vue from 'vue';
export default Vue.extend({
  head() {
    // If dark-mode is set to auto (follow system-prefs) this is all we need
    // In a possible future with a three-way pref
    // (Always off // Always on // Follow system pref)
    // the "dark" part will be a dynamic pref.
    // See https://github.com/rancher/dashboard/blob/3454590ff6a825f7e739356069576fbae4afaebc/layouts/default.vue#L227 for an example
    return { bodyAttrs: { class: 'theme-dark' } };
  }
});
</script>

<style lang="scss">
  html {
    height: initial;
  }
</style>

<style lang="scss" scoped>
@import "@/assets/styles/app.scss";

.wrapper {
  background-color: var(--body-bg);
  border: none;
  color: var(--body-text);
}

.body {
  display: flex;
  flex-flow: column;
  gap: 1rem;
}

</style>

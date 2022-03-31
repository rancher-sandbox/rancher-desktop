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
  },
  mounted() {
    const wrapper = this.$refs.wrapper as HTMLDialogElement;

    // Dynamically resize the window to fit the contents.
    // We need a bit extra on the width to ensure we don't get scroll bars.
    window.resizeBy(
      wrapper.offsetWidth - document.documentElement.offsetWidth + 14,
      wrapper.offsetHeight - document.documentElement.offsetHeight);
  }
});
</script>

<style lang="scss" scoped>
@import "@/assets/styles/app.scss";

.wrapper {
  background-color: var(--body-bg);
  border: none;
  color: var(--body-text);
  height: 100vh;
}

.body {
  height: 100%;
  display: flex;
  flex-flow: column;
  gap: 1rem;
}

</style>

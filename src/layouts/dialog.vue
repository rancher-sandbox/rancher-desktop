<!-- This layout is used dialog boxes that do not want navigation -->

<template>
  <dialog ref="wrapper" class="wrapper" open>
    <Nuxt class="body" />
  </dialog>
</template>

<script lang="ts">
import Vue from 'vue';
export default Vue.extend({
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
  border: none;
}

</style>

<!-- This layout is used dialog boxes that do not want navigation -->

<template>
  <dialog class="wrapper" open>
    <Nuxt class="body" />
  </dialog>
</template>

<script>
export default {};
</script>

<style lang="scss" scoped>
@import "@/assets/styles/app.scss";

.wrapper {
  display: grid;
  width: 100vw;
  height: 100vh;
  border: none;
}

</style>

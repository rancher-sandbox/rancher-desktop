<script lang="ts">
export default {
  props: {
    icon: {
      type:    String,
      default: 'icon-flask',
    },
    tooltipText: {
      type:    String,
      default: 'prefs.experimental',
    },
    tooltipPlacement: {
      type:    String,
      default: 'right',
    },
  },
};
</script>

<template>
  <i
    v-tooltip="{
      content: t(tooltipText),
      placement: tooltipPlacement,
    }"
    :class="`icon ${icon}`"
  />
</template>

<style lang="scss" scoped>
  .icon {
    font-size: 0.75rem;
    background-color: var(--icon-circle);
    border-radius: 50%;
    text-align: center;
    padding: 0.25rem;
    width: 1.25rem;
    height: 1.25rem;
  }
</style>

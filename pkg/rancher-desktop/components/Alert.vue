<script lang="ts">
import { Banner } from '@rancher/components';
import Vue from 'vue';

export default Vue.extend({
  name:       'alert',
  components: { Banner },
  props:      {
    icon: {
      type:     String,
      required: true,
    },
    bannerText: {
      type:     String,
      required: true,
    },
    color: {
      type:     String,
      required: true,
    },
  },
});
</script>

<template>
  <transition
    name="fade"
    appear
  >
    <banner
      class="banner-notify"
      :color="color"
    >
      <span
        class="icon"
        :class="icon"
      />
      {{ bannerText }}
    </banner>
  </transition>
</template>

<style lang="scss" scoped>
  .banner-notify {
    margin: 0;
  }

  .fade-enter, .fade-leave-to {
    opacity: 0;
  }

  .fade-active {
    transition: all 0.25s ease-in;
  }
</style>

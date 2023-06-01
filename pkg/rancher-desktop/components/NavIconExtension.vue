<script lang="ts">
import Vue from 'vue';

import { hexEncode } from '@pkg/utils/string-encode';

const knownMonochromeIcons = [
  'ghcr.io/rancher-sandbox/epinio-desktop-extension',
  'julianb90/tachometer',
  'prakhar1989/dive-in',
  'joycelin79/newman-extension',
];

export default Vue.extend({
  name:  'nav-icon-extension',
  props: {
    extensionId: {
      type:     String,
      required: true,
    },
  },
  data() {
    return { imageError: false };
  },
  computed: {
    imageUri(): string {
      return `x-rd-extension://${ hexEncode(this.extensionId) }/icon.svg`;
    },
    isKnownMonochrome(): boolean {
      return !!this.extensionId && knownMonochromeIcons.includes(this.extensionId.split(':')[0]);
    },
  },
  methods: {
    handleImageError(): void {
      this.imageError = true;
    },
  },
});
</script>

<template>
  <img
    v-if="!imageError"
    class="extension-icon"
    :class="{
      'known-monochrome': isKnownMonochrome,
    }"
    :src="imageUri"
    @error="handleImageError"
  >
  <i
    v-else
    class="icon icon-extension icon-lg"
  />
</template>

<style lang="scss" scoped>
  /**
    * Change the icon colors by setting a class 'known-monochrome' containing dark theme properties.
    */
  @media (prefers-color-scheme: dark) {
    .known-monochrome {
      filter: brightness(0) invert(100%) grayscale(1) brightness(2);
    }
  }

  /**
    * Change the icon colors by setting a class 'known-monochrome' containing light theme properties.
    */
  @media (prefers-color-scheme: light) {
    .known-monochrome {
      filter: brightness(0) grayscale(1) brightness(4);
    }
  }
</style>

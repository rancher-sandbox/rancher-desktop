<template>
  <div class="image-input">
    <labeled-input
      id="imageToBuild"
      v-model="image"
      type="text"
      class="image"
      :disabled="isInputDisabled"
      :placeholder="t('images.manager.input.build.placeholder')"
      :label="t('images.manager.input.build.label')"
      @keyup.enter.native="doBuildAnImage"
    />
    <button
      class="btn role-primary btn-lg"
      :disabled="isButtonDisabled"
      @click="doBuildAnImage"
    >
      {{ t('images.manager.input.build.button') }}
    </button>
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import LabeledInput from './form/LabeledInput.vue';

export default Vue.extend({
  name: 'image-add-button-build',

  components: { LabeledInput },

  props: {
    currentCommand: {
      type:    String,
      default: ''
    },
    keepOutputWindowOpen: {
      type:    Boolean,
      default: false
    }
  },

  data() {
    return { image: '' };
  },

  computed: {
    isButtonDisabled(): boolean {
      return this.isInputDisabled || !this.image;
    },
    isInputDisabled(): boolean {
      return !~this.currentCommand || this.keepOutputWindowOpen;
    },
  },

  methods: {
    doBuildAnImage() {
      this.$emit('click', { action: 'build', image: this.image });
    }
  }
});
</script>

<style lang="scss" scoped>
  .image {
    min-width: 32rem;
  }

  .btn {
    margin-bottom: 14px;
  }
</style>

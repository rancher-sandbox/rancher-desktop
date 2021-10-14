<template>
  <div class="image-input">
    <labeled-input
      id="imageToBuild"
      v-model="image"
      type="text"
      class="image"
      :disabled="!~isInputDisabled"
      :placeholder="t('images.manager.input.build.placeholder')"
      :label="t('images.manager.input.build.label')"
    />
    <button
      class="btn role-primary btn-xl"
      :disabled="isButtonDisabled"
      @click="doBuildAnImage"
    >
      {{ t('images.manager.input.build.button') }}
    </button>
  </div>
</template>

<script>
import LabeledInput from './form/LabeledInput.vue';
export default {
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
    isButtonDisabled() {
      return this.isInputDisabled || !this.image;
    },
    isInputDisabled() {
      return this.currentCommand || this.keepOutputWindowOpen;
    },
  },

  methods: {
    doBuildAnImage() {
      this.$emit('click', { action: 'build', image: this.image});
    }
  }
};
</script>

<style lang="scss" scoped>
  .image {
    min-width: 24rem;
  }

  .btn-xl {
    margin-bottom: 14px;
    min-width: 6rem;
    height: 55px;
  }
</style>

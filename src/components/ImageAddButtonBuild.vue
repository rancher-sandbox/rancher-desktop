<template>
  <div class="image-input">
    <labeled-input
      id="imageToBuild"
      v-model="image"
      :disabled="!~isInputDisabled"
      type="text"
      :placeholder="t('images.manager.input.build.placeholder')"
      :label="t('images.manager.input.build.button')"
    />
    <button
      class="btn role-primary btn-large"
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

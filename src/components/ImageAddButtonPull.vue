<template>
  <div class="image-input">
    <labeled-input
      id="imageToPull"
      v-model="image"
      type="text"
      class="image"
      :disabled="isInputDisabled"
      :placeholder="t('images.manager.input.pull.placeholder')"
      :label="t('images.manager.input.pull.label')"
      @keyup.enter.native="doPullAnImage"
    />
    <button
      class="btn role-primary btn-lg"
      :disabled="isButtonDisabled"
      @click="doPullAnImage"
    >
      {{ t('images.manager.input.pull.button') }}
    </button>
  </div>
</template>

<script>
import LabeledInput from '@/components/form/LabeledInput.vue';
export default {
  name: 'image-add-button-pull',

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
      return !~this.currentCommand || this.keepOutputWindowOpen;
    },
  },

  methods: {
    doPullAnImage() {
      this.$emit('click', { action: 'pull', image: this.image });
    }
  }
};
</script>

<style lang="scss" scoped>
  .image {
    min-width: 32rem;
  }

  .btn {
    margin-bottom: 14px;
  }
</style>

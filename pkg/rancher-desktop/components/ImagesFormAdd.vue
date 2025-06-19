<template>
  <div class="image-input">
    <labeled-input
      v-model="image"
      v-focus
      type="text"
      class="image"
      :disabled="isInputDisabled"
      :placeholder="inputPlaceholder"
      :label="inputLabel"
      @keyup.enter="submit"
    />
    <button
      class="btn role-primary btn-lg"
      :disabled="isButtonDisabled"
      @click="submit"
    >
      {{ buttonText }}
    </button>
  </div>
</template>

<script lang="ts">
import { LabeledInput } from '@rancher/components';
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'images-form-add',

  components: { LabeledInput },

  props: {
    currentCommand: {
      type:    String,
      default: '',
    },
    keepOutputWindowOpen: {
      type:    Boolean,
      default: false,
    },
    action: {
      type:     String,
      required: true,
      validator(value: string) {
        return ['pull', 'build'].includes(value);
      },
    },
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
    isActionPull(): boolean {
      return this.action === 'pull';
    },
    buttonText(): string {
      return this.t(`images.manager.input.${ this.action }.button`);
    },
    inputLabel(): string {
      return this.t(`images.manager.input.${ this.action }.label`);
    },
    inputPlaceholder(): string {
      return this.t(`images.manager.input.${ this.action }.placeholder`);
    },
  },

  methods: {
    submit() {
      this.$emit('click', { action: this.action, image: this.image.trim() });
    },
  },
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

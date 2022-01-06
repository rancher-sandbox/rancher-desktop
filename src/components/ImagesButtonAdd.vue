<template>
  <button
    class="btn role-primary btn-sm"
    type="button"
    aria-label="Add an Image"
    @click="route"
  >
    <svg
      class="icon"
      viewBox="0 0 32 32"
    >
      <path
        class="icon-plus"
        d="M31 12h-11v-11c0-0.552-0.448-1-1-1h-6c-0.552 0-1 0.448-1 1v11h-11c-0.552 0-1 0.448-1 1v6c0 0.552 0.448 1 1 1h11v11c0 0.552 0.448 1 1 1h6c0.552 0 1-0.448 1-1v-11h11c0.552 0 1-0.448 1-1v-6c0-0.552-0.448-1-1-1z"
      />
    </svg>
  </button>
</template>

<script lang="ts">
import Vue from 'vue';

export default Vue.extend({
  name: 'images-button-add',

  methods: {
    route() {
      this.$router.push({ name: 'images-add' });
    }
  }
});
</script>

<style lang="scss" scoped>
button.btn {
  display: flex;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  align-items:center;
  justify-content:center;
}

.icon {
  width: 0.75rem;
  height: 0.75rem;
}

.icon-plus {
  fill: var(--primary-text)
}
</style>

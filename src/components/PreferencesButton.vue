<script lang="ts">
import Vue from 'vue';
export default Vue.extend({
  name:    'preferences-button',
  methods: {
    openPreferences() {
      this.$emit('open-preferences');
    }
  }
});
</script>

<template>
  <button
    class="btn role-primary btn-sm"
    type="button"
    aria-label="Open Preferences"
    @click="openPreferences"
  >
    <!--
      TODO: #2415 Fix off-centered icons in linux.
      NOTE: Custom svg is the gear icon from IcoMoon, which is used to generate
      other icons throughout Rancher Desktop.
    -->
    <svg
      class="icon"
      viewBox="0 0 32 32"
    >
      <path
        class="icon-gear"
        d="M29.181 19.070c-1.679-2.908-0.669-6.634 2.255-8.328l-3.145-5.447c-0.898 0.527-1.943 0.829-3.058 0.829-3.361 0-6.085-2.742-6.085-6.125h-6.289c0.008 1.044-0.252 2.103-0.811 3.070-1.679 2.908-5.411 3.897-8.339 2.211l-3.144 5.447c0.905 0.515 1.689 1.268 2.246 2.234 1.676 2.903 0.672 6.623-2.241 8.319l3.145 5.447c0.895-0.522 1.935-0.82 3.044-0.82 3.35 0 6.067 2.725 6.084 6.092h6.289c-0.003-1.034 0.259-2.080 0.811-3.038 1.676-2.903 5.399-3.894 8.325-2.219l3.145-5.447c-0.899-0.515-1.678-1.266-2.232-2.226zM16 22.479c-3.578 0-6.479-2.901-6.479-6.479s2.901-6.479 6.479-6.479c3.578 0 6.479 2.901 6.479 6.479s-2.901 6.479-6.479 6.479z"
      />
    </svg>
  </button>
</template>

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
    width: 1rem;
    height: 1rem;
  }

  .icon-gear{
    fill: var(--primary-text)
  }
</style>

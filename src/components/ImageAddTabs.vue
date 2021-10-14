<template>
  <div class="tabs">
    <button
      class="btn"
      :class="isPullActive"
      @click="tabSelected('pull')"
    >
      Pull
    </button>
    <button
      class="btn"
      :class="isBuildActive"
      @click="tabSelected('build')"
    >
      Build
    </button>
  </div>
</template>

<script>
export default {
  name: 'image-add-tabs',

  data() {
    return { activeTab: 'pull' };
  },

  computed: {
    isPullActive() {
      return [this.activeTab === 'pull' ? 'role-tab-active' : 'role-tab'];
    },
    isBuildActive() {
      return [this.activeTab === 'build' ? 'role-tab-active' : 'role-tab'];
    }
  },

  methods: {
    tabSelected(action) {
      this.activeTab = action;
      this.$emit('click', this.activeTab);
    }
  }
};
</script>

<style lang="scss" scoped>
  .role-tab {
    border-radius: 0;
    border-bottom: 0.25rem solid;
    border-color: var(--muted);
    color: var(--muted);
    background-color: transparent;
  }

  .role-tab-active {
    border-radius: 0;
    border-bottom: 0.25rem solid;
    border-color: var(--primary);
    color: var(--primary);
    background-color: transparent;
  }

  .btn:focus, .btn:active {
    outline-style: none;
    box-shadow: none;
  }

  .tabs {
    margin-bottom: 1rem;
  }
</style>

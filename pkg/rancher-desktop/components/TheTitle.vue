<script lang="ts">
import { defineComponent, markRaw } from 'vue';
import { mapState } from 'vuex';

const componentCache: Record<string, any> = {};

export default defineComponent({
  name: 'the-title',
  data() {
    return {
      isChild:          false,
      dynamicComponent: null,
    };
  },
  computed: {
    ...mapState<any, any>(
      'page',
      [
        'title',
        'description',
        'action',
        'icon',
      ]),
  },
  watch: {
    $route: {
      immediate: true,
      handler(current) {
        this.isChild = current.path.lastIndexOf('/') > 0;
      },
    },
    action: {
      async handler(componentName) {
        if (componentName) {
          componentCache[componentName] ||= (await import(`@pkg/components/${ componentName }.vue`)).default;
          this.dynamicComponent = markRaw(componentCache[componentName]);
        }
      },
      immediate: true,
    },
  },
  methods: {
    routeBack() {
      this.$router.back();
    },
  },
});
</script>

<template>
  <div class="title">
    <div class="title-top">
      <transition-group name="fade-group">
        <button
          v-if="isChild"
          key="back-btn"
          data-test="back-btn"
          class="btn role-link btn-sm btn-back fade-group-item"
          type="button"
          @click="routeBack"
        >
          <span
            class="icon icon-chevron-left"
          />
        </button>
        <h1
          key="mainTitle"
          data-test="mainTitle"
          class="fade-group-item"
          :class="icon ? 'main-title-icon' : ''"
        >
          <span
            v-if="icon"
            key="mainTitleIcon"
            :class="icon"
          />
          {{ title }}
        </h1>
      </transition-group>
      <transition
        name="fade"
        appear
      >
        <div
          v-if="action"
          key="actions"
          class="actions fade-actions"
        >
          <component :is="dynamicComponent" />
        </div>
      </transition>
    </div>
    <hr>
    <div
      v-show="description"
      class="description"
    >
      {{ description }}
    </div>
  </div>
</template>

<style lang="scss" scoped>
  .title {
    padding: 20px 20px 0 20px;
  }

  .title-top{
    display: flex;
  }

  .btn-back {
    height: 27px;
    font-weight: bolder;
    font-size: 1.5em;
  }

  .btn-back:focus {
    outline: none;
    box-shadow: none;
    background: var(--input-focus-bg);
  }

  .fade-group-item {
    display: inherit;
    transition: all 0.25s ease-out;
  }

  .fade-actions {
    transition: opacity 0.25s ease-out;
  }

  .fade-group-item-enter-from, .fade-group-leave-to
  {
    opacity: 0;
  }

  .fade-group-leave-active, .fade-group-item-enter-active {
    position: absolute;
  }

  .fade-enter, .fade-leave-to {
    opacity: 0;
  }

  .fade-active {
    transition: all 0.25s ease-in;
  }

  .main-title-icon {
    display: flex;
    gap: 0.5rem;

    span {
      font-size: 30px;
      color: var(--primary);
    }
  }

  .actions {
    margin-left: auto;
  }
</style>

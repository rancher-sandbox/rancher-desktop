<template>
  <div class="wrapper">
    <Header class="header" />
    <Nav class="nav" :items="routes" />
    <section class="title">
      <section class="title-top">
        <transition-group
          name="fade-group"
          class="title-group"
          appear
        >
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
          >
            {{ title }}
          </h1>
        </transition-group>
        <transition
          name="fade"
          appear
        >
          <section
            v-if="action"
            key="actions"
            class="actions fade-actions"
          >
            <component :is="action" />
          </section>
        </transition>
      </section>
      <hr>
      <section
        v-show="description"
        class="description"
      >
        {{ description }}
      </section>
    </section>
    <main class="body">
      <Nuxt />
    </main>
    <BackendProgress class="progress" />
    <!-- The ActionMenu is used by SortableTable for per-row actions. -->
    <ActionMenu />
  </div>
</template>

<script>
import os from 'os';

import { ipcRenderer } from 'electron';
import { mapState } from 'vuex';
import ActionMenu from '@/components/ActionMenu.vue';
import Header from '@/components/Header.vue';
import Nav from '@/components/Nav.vue';
import ImagesButtonAdd from '@/components/ImagesButtonAdd.vue';
import BackendProgress from '@/components/BackendProgress.vue';

export default {
  name:       'App',
  components: {
    ActionMenu,
    Nav,
    Header,
    BackendProgress,
    ImagesButtonAdd,
  },

  data() {
    return {
      routes: [
        '/General', '/K8s', '/Integrations', '/PortForwarding', '/Images', '/Troubleshooting'
      ],
      isChild: false
    };
  },

  head() {
    // If dark-mode is set to auto (follow system-prefs) this is all we need
    // In a possible future with a three-way pref
    // (Always off // Always on // Follow system pref)
    // the "dark" part will be a dynamic pref.
    // See https://github.com/rancher/dashboard/blob/3454590ff6a825f7e739356069576fbae4afaebc/layouts/default.vue#L227 for an example
    return { bodyAttrs: { class: 'theme-dark' } };
  },

  computed: {
    ...mapState('page', {
      title:       state => state.title,
      description: state => state.description,
      action:      state => state.action
    }),
  },

  watch: {
    $route: {
      immediate: true,
      handler(current, previous) {
        this.isChild = current.path.lastIndexOf('/') > 0;
      }
    }
  },

  methods: {
    routeBack() {
      this.$router.back();
    }
  }

};
</script>

<style lang="scss" scoped>
@import "@/assets/styles/app.scss";

.wrapper {
  display: grid;
  grid-template:
    "header   header"
    "nav      title"
    "nav      body"    1fr
    "progress body"
    / var(--nav-width) 1fr;
  background-color: var(--body-bg);
  width: 100vw;
  height: 100vh;

  .header {
    grid-area: header;
    border-bottom: var(--header-border-size) solid var(--header-border);
  }

  .nav {
    grid-area: nav;
    border-right: var(--nav-border-size) solid var(--nav-border);
  }

  .progress {
    grid-area: progress;
    background-color: var(--nav-bg);
    padding: 10px;
    border-right: var(--nav-border-size) solid var(--nav-border);
  }

  .body {
    display: grid;
    grid-area: body;
    grid-template-rows: auto 1fr;
    padding: 0 20px 20px 20px;
    overflow: auto;
  }

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

  .actions {
    margin-left: auto;
  }

  .title-group {
    display: inherit;
  }

  .fade-group-item {
    transition: all 0.25s ease-out;
  }

  .fade-actions{
    transition: opacity 0.25s ease-out;
  }

  .fade-group-enter, .fade-group-leave-to
  {
    opacity: 0;
  }

  .fade-group-leave-active, .fade-group-enter-active {
    position: absolute;
  }

  .fade-enter, .fade-leave-to {
    opacity: 0;
  }

  .fade-active {
    transition: all 0.25s ease-in;
  }
}

</style>

<template>
  <div class="wrapper">
    <Header class="header" />
    <Nav class="nav" :items="routes" />
    <main class="body">
      <section class="title">
        <section class="title-top">
          <button
            v-if="isChild"
            class="btn role-link btn-sm btn-back"
            type="button"
            @click="routeBack"
          >
            <span
              class="icon icon-chevron-left"
            />
          </button>
          <h1 data-test="mainTitle">
            {{ title }}
          </h1>
          <section
            v-if="action"
            class="actions"
          >
            <component :is="action" />
          </section>
        </section>
        <hr>
        <section
          v-show="description"
          class="description"
        >
          {{ description }}
        </section>
      </section>
      <Nuxt />
    </main>
    <BackendProgress class="progress" />
    <!-- The ActionMenu is used by SortableTable for per-row actions. -->
    <ActionMenu />
  </div>
</template>

<script>
import os from 'os';

import ActionMenu from '@/components/ActionMenu.vue';
import Header from '@/components/Header.vue';
import Nav from '@/components/Nav.vue';
import ImagesButtonAdd from '@/components/ImagesButtonAdd.vue';
import BackendProgress from '@/components/BackendProgress.vue';
import { ipcRenderer } from 'electron';
import { mapState } from 'vuex';

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
        '/General', '/K8s', '/Integrations', '/Images', '/Troubleshooting'
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

  mounted() {
    ipcRenderer.invoke('k8s-supports-port-forwarding').then((supported) => {
      if (supported) {
        this.$data.routes = ['/General', '/K8s', '/Integrations', '/PortForwarding', '/Images', '/Troubleshooting'];
      }
    });
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
    padding: 20px;
    overflow: auto;
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
}

</style>

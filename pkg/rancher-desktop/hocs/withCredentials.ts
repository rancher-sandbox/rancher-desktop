import Vue, { VueConstructor, VNode } from 'vue';

import type { ServerState } from '@pkg/main/commandServer/httpCommandServer';

interface WithCredentialsData {
  credentials: Omit<ServerState, 'pid'>;
}

interface WithCredentialsProps {
  credentials: Omit<ServerState, 'pid'>;
}

type WithCredentialsComponent = VueConstructor<Vue & WithCredentialsProps>;

export const withCredentials = (component: WithCredentialsComponent) => {
  return Vue.extend({
    name: `with-credentials-${ component.name }`,
    data(): WithCredentialsData {
      return {
        credentials: {
          user:     '',
          password: '',
          port:     0,
        },
      };
    },
    computed: {
      hasCredentials(): boolean {
        return !!this.credentials.user || !!this.credentials.password || !!this.credentials.port;
      },
    },
    async beforeMount() {
      this.credentials = await this.$store.dispatch('credentials/fetchCredentials');
    },
    /**
     * Aliasing createElement to h is a common convention you’ll see in the Vue
     * ecosystem and is actually required for JSX. We aren't using JSX here, but
     * following this convention allows us to easily make the switch in the
     * future if we so desire.
     *
     * https://v2.vuejs.org/v2/guide/render-function.html#JSX
     */
    render(h): VNode {
      if (!this.hasCredentials) {
        return h();
      }

      return h(
        component,
        {
          props: { credentials: this.credentials },
          on:    this.$listeners,
        },
      );
    },
  });
};

import { ref, computed, onBeforeMount } from 'vue';
import { useStore } from 'vuex';

import type { Credentials } from '@pkg/store/credentials';

export default function useCredentials() {
  const credentials = ref<Credentials>({
    user:     '',
    password: '',
    port:     0,
  });

  const hasCredentials = computed(() => {
    return !!credentials.value.user || !!credentials.value.password || !!credentials.value.port;
  });

  onBeforeMount(async() => {
    credentials.value = await useStore().dispatch('credentials/fetchCredentials');
  });

  return { credentials, hasCredentials };
}

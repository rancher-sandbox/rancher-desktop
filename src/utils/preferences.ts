import { State } from '@/backend/k8s';

/**
 * Determines if the preferences window can be opened based on the current
 * Kubernetes state.
 * @param kubernetesState The active Kubernetes state to test.
 * @returns True if the preferences window can be opened.
 */
export const isPreferencesEnabled = (kubernetesState: State) => {
  return (![State.STOPPING, State.STOPPED].includes(kubernetesState));
};

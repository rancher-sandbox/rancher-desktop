import type { RDXClient } from '@pkg/preload/extensions';

declare global {
  interface Window {
    ddClient: RDXClient;
  }
}

declare module '@docker/extension-api-client-types/dist/v1' {
  interface ExecOptions {
    stream?: never; // Ensure that if `stream` is set it takes the other overload.
  }
}

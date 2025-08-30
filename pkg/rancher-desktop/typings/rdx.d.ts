import type { RDXClient } from '@pkg/preload/extensions';

declare global {
  interface Window {
    ddClient: RDXClient;
  }
};

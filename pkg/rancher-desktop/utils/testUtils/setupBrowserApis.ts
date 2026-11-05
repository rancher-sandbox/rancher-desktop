/**
 * Jest preloads this file into every test file (see jest.config.js,
 * `setupFiles`) to supply browser APIs jsdom does not implement.
 */

import { TextDecoder, TextEncoder } from 'node:util';

// jsdom implements TextEncoder and TextDecoder as of v27.4.0; however,
// jest-environment-jsdom pins it to ^26.1.0, so that is never used.
globalThis.TextEncoder ??= TextEncoder;
globalThis.TextDecoder ??= TextDecoder as unknown as typeof globalThis.TextDecoder;

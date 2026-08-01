/** @jest-environment node */

import { Extension } from '../extension-data';

describe('Extension', () => {
  it('keeps a registry port when splitting an image reference', async() => {
    const extension = new Extension('registry.example:5000/org/image:tag', {});

    expect(extension.name).toBe('registry.example:5000/org/image');
    await expect(extension.currentVersion).resolves.toBe('tag');
  });
});

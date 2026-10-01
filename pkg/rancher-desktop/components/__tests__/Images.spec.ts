import { jest } from '@jest/globals';

import mockModules from '@pkg/utils/testUtils/mockModules';

const componentStub = { template: '<div />' };

mockModules({
  '@pkg/components/ImagesOutputWindow.vue': componentStub,
  '@pkg/components/SortableTable':          componentStub,
  '@pkg/entry/store':                       { mapTypedState: jest.fn(() => ({})) },
  '@pkg/utils/ipcRenderer':                 {
    ipcRenderer: {
      on:             jest.fn(),
      send:           jest.fn(),
      invoke:         jest.fn(),
      removeListener: jest.fn(),
    },
  },
  '@rancher/components': { Card: componentStub, Checkbox: componentStub },
});

const { default: Images } = await import('@pkg/components/Images.vue');
const { keyedImages } = (Images as any).computed;

describe('Images row keys', () => {
  function image(imageName: string, tag: string, imageID: string) {
    return {
      imageName, tag, imageID, size: '1MB',
    };
  }

  function keysOf(images: any[]) {
    return keyedImages.call({ images }).map((row: any) => row._key);
  }

  const app = image('app', '1.0', 'sha256:aaa');
  const retaggedApp = image('registry.example.com/app', '1.0', 'sha256:aaa');
  const pulledImage = image('alpine', 'latest', 'sha256:bbb');

  it('gives one image under two names two different keys', () => {
    const [appKey, retaggedKey] = keysOf([app, retaggedApp]);

    expect(appKey).not.toEqual(retaggedKey);
  });

  it('keeps a row key when images ahead of it in the list change', () => {
    const [, retaggedKeyBefore] = keysOf([app, retaggedApp]);
    const [, , retaggedKeyAfter] = keysOf([pulledImage, app, retaggedApp]);

    expect(retaggedKeyAfter).toEqual(retaggedKeyBefore);
  });

  it('separates an untagged image from one tagged latest', () => {
    const untagged = image('app', '<none>', 'sha256:aaa');
    const tagged = image('app', 'latest', 'sha256:aaa');

    const [untaggedKey, taggedKey] = keysOf([untagged, tagged]);

    expect(untaggedKey).not.toEqual(taggedKey);
  });

  it('still distinguishes rows an engine lists twice', () => {
    const keys = keysOf([app, app]);

    expect(new Set(keys).size).toEqual(2);
  });
});

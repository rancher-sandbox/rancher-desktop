import { MobyClient } from '@pkg/backend/containerClient/mobyClient';
import { NerdctlClient } from '@pkg/backend/containerClient/nerdctlClient';
import dockerRegistry from '@pkg/backend/containerClient/registry';
import { ContainerEngineClient } from '@pkg/backend/containerClient/types';
import MockBackend from '@pkg/backend/mock';

jest.mock('@pkg/backend/mock');
jest.mock('@pkg/backend/containerClient/registry');

describe.each(['nerdctl', 'moby'] as const)('%s', (clientName) => {
  let subject: ContainerEngineClient;

  beforeEach(() => {
    const executor = new MockBackend() as jest.Mocked<MockBackend>;

    switch (clientName) {
    case 'nerdctl':
      subject = new NerdctlClient(executor);
      break;
    case 'moby':
      subject = new MobyClient(executor, '');
      break;
    default:
      throw new Error(`Unexpected client name ${ clientName }`);
    }
  });

  describe('getTags', () => {
    const repository = 'registry.test/name';
    let registryTags: string[];
    let localTags: string[];
    let localExtras: string[];

    beforeEach(() => {
      registryTags = [];
      localTags = [];
      localExtras = [];

      jest.mocked(dockerRegistry).getTags.mockImplementation((name) => {
        expect(name).toEqual(repository);

        if (registryTags.length) {
          return Promise.resolve(registryTags);
        }

        return Promise.reject('Could not get tags from registry');
      });

      jest.spyOn(subject, 'runClient').mockImplementation((args, stdio) => {
        expect(args).toEqual(expect.arrayContaining(['image', 'list']));
        expect(stdio).toEqual('pipe');

        const results: string[] = [];

        if (localTags.length) {
          results.push(...localTags.map(t => `${ repository }:${ t }`));
        }
        if (localExtras.length) {
          results.push(...localExtras);
        }

        if (results.length) {
          return Promise.resolve({ stdout: results.join('\n') });
        }

        // We need the cast to any because `runClient()` is overloaded and
        // it's hard to convince TypeScript that the return value is fine.
        return Promise.reject('Could not get tags locally') as any;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
      jest.resetAllMocks();
    });

    it('should list tags from the registry', async() => {
      registryTags = ['apple', 'banana'];

      await expect(subject.getTags(repository)).resolves.toEqual(new Set(registryTags));
    });

    it('should list local tags', async() => {
      localTags = ['carrot', 'durian'];
      localExtras = ['irrelevant:grape', 'registry.invalid/other:honeydew'];

      await expect(subject.getTags(repository)).resolves.toEqual(new Set(localTags));
    });

    it('should merge tags', async() => {
      registryTags = ['jackfruit', 'kiwi'];
      localTags = ['kiwi', 'lemon'];

      await expect(subject.getTags(repository)).resolves.toEqual(new Set([...registryTags, ...localTags]));
    });

    it('should ignore errors', async() => {
      await expect(subject.getTags(repository)).resolves.toEqual(new Set());
    });
  });
});

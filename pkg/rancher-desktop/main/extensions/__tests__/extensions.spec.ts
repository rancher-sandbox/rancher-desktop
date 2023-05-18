import { ExtensionImpl } from '@pkg/main/extensions/extensions';

describe('ExtensionImpl', () => {
  describe('checkInstallAllowed', () => {
    const subject = ExtensionImpl['checkInstallAllowed'];

    it('should reject invalid image references', () => {
      expect(() => subject(undefined, '/')).toThrow();
    });

    it('should allow images if the allow list is not enabled', () => {
      expect(() => subject(undefined, 'image')).not.toThrow();
    });

    it('should disallow any images given an empty list', () => {
      expect(() => subject([], 'image')).toThrow();
    });

    it('should allow specified image', () => {
      expect(() => subject(['other', 'image'], 'image')).not.toThrow();
    });

    it('should reject unknown image', () => {
      expect(() => subject(['allowed'], 'image')).toThrow();
    });

    it('should support missing tags', () => {
      expect(() => subject(['image'], 'image:1.0.0')).not.toThrow();
    });

    it('should reject images with the wrong tag', () => {
      expect(() => subject(['image:0.1'], 'image:0.2')).toThrow();
    });

    it('should support image references with registries', () => {
      const ref = 'r.example.test:1234/org/name:tag';

      expect(() => subject([ref], ref)).not.toThrow();
    });

    it('should support org-level references', () => {
      expect(() => subject(['test.invalid/org/'], 'test.invalid/org/image:tag')).not.toThrow();
    });

    it('should support registry-level references', () => {
      expect(() => subject(['registry.test/'], 'registry.test/image:tag')).not.toThrow();
    });
  });
});

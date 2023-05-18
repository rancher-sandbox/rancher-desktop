import { imageInfo, parseImageReference } from '../dockerUtils';

describe('parseImageReference', () => {
  const dockerHub = new URL('https://index.docker.io');
  const testCases: Record<string, ReturnType<typeof parseImageReference>> = {
    component:                          new imageInfo(dockerHub, 'library/component'),
    'name:tag':                         new imageInfo(dockerHub, 'library/name', 'tag'),
    'dir/name':                         new imageInfo(dockerHub, 'dir/name'),
    'registry.test/thing':              new imageInfo(new URL('https://registry.test/'), 'thing' ),
    'registry.test:5000/org/thing:tag': new imageInfo(new URL('https://registry.test:5000/'), 'org/thing', 'tag'),
    _:                                  null,
    ':10/tag':                          null,
    [`xxx:${ Array(130).join('x') }`]:  null,
    'name:':                            null,
    'dir/':                             null,
    '':                                 null,
  };

  test.each(Object.entries(testCases))('%s', (input, expected) => {
    expect(parseImageReference(input)).toEqual(expected);
  });

  describe('when parsing for prefix', () => {
    const testCases: Record<string, ReturnType<typeof parseImageReference>> = {
      component:            new imageInfo(dockerHub, 'library/component'),
      'name:tag':           new imageInfo(dockerHub, 'library/name', 'tag'),
      'dir/':               new imageInfo(dockerHub, 'dir/'),
      'registry.test/':     new imageInfo(new URL('https://registry.test/'), ''),
      'registry.test/dir/': new imageInfo(new URL('https://registry.test/'), 'dir/'),
      '':                   null,
    };

    test.each(Object.entries(testCases))('%s', (input, expected) => {
      expect(parseImageReference(input, true)).toEqual(expected);
    });
  });
});

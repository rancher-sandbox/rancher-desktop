import { RDBinInShellPath } from '../rdBinInShell';

describe(RDBinInShellPath, () => {
  it('should remove trailing slashes', () => {
    expect(RDBinInShellPath.removeTrailingSlash('/Users/mikey/.rd/bin/')).toBe('/Users/mikey/.rd/bin');
    expect(RDBinInShellPath.removeTrailingSlash('/Users/mikey/.rd/bin////')).toBe('/Users/mikey/.rd/bin');
    expect(RDBinInShellPath.removeTrailingSlash('/Users/mikey/.rd/bin')).toBe('/Users/mikey/.rd/bin');
    expect(RDBinInShellPath.removeTrailingSlash('/')).toBe('/');
    expect(RDBinInShellPath.removeTrailingSlash('//')).toBe('/');
    expect(RDBinInShellPath.removeTrailingSlash('/////')).toBe('/');
    expect(RDBinInShellPath.removeTrailingSlash('')).toBe('');
  });
});

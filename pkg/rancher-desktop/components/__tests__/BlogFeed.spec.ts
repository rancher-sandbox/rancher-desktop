import { mount } from '@vue/test-utils';

import mockModules from '@pkg/utils/testUtils/mockModules';

mockModules({
  '@pkg/utils/ipcRenderer': {
    // Leave the feed fetch pending so `mounted` never overwrites the entries
    // the tests set directly.
    ipcRenderer: { invoke: () => new Promise(() => {}) },
  },
});

const { default: BlogFeed } = await import('../BlogFeed.vue');

const entries = [
  { title: 'First', link: 'https://example.test/1', summary: 'one', date: 'July 1, 2026' },
  { title: 'Second', link: 'https://example.test/2', summary: 'two', date: 'July 2, 2026' },
  { title: 'Third', link: 'https://example.test/3', summary: 'three', date: 'July 3, 2026' },
];

describe('BlogFeed.vue', () => {
  it('renders every entry', async() => {
    const wrapper = mount(BlogFeed);

    await wrapper.setData({ entries });

    expect(wrapper.findAll('.blog-entry')).toHaveLength(entries.length);
    expect(wrapper.get('.blog-entry-title').text()).toBe('First');
  });

  it('renders nothing until the feed has entries', () => {
    const wrapper = mount(BlogFeed);

    expect(wrapper.find('.blog-feed').exists()).toBe(false);
  });
});

const feedXML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <item>
      <title>First Post</title>
      <link>https://example.test/first</link>
      <pubDate>Wed, 01 Jul 2026 00:00:00 GMT</pubDate>
      <content:encoded><![CDATA[<p>The opening paragraph.</p><p>Second paragraph.</p>]]></content:encoded>
    </item>
    <item>
      <title>No Encoded</title>
      <link>https://example.test/second</link>
      <pubDate>not a date</pubDate>
      <description>&lt;p&gt;Summary with markup.&lt;/p&gt;</description>
    </item>
    <item>
      <title>Sneaky</title>
      <link>javascript:alert(1)</link>
      <pubDate>Fri, 03 Jul 2026 00:00:00 GMT</pubDate>
      <description>Plain text.</description>
    </item>
  </channel>
</rss>`;

describe('BlogFeed.parseFeed', () => {
  const parse = (xml: string) => mount(BlogFeed).vm.parseFeed(xml);

  it('extracts the title, link, and first paragraph of each item', () => {
    const parsed = parse(feedXML);

    expect(parsed[0]).toMatchObject({
      title:   'First Post',
      link:    'https://example.test/first',
      summary: 'The opening paragraph.',
    });
    expect(parsed[0].date).toContain('2026');
  });

  it('strips HTML from a description used as the summary fallback', () => {
    expect(parse(feedXML)[1].summary).toBe('Summary with markup.');
  });

  it('returns the raw pubDate when it cannot be parsed', () => {
    expect(parse(feedXML)[1].date).toBe('not a date');
  });

  it('drops an entry whose link is not http(s), so no javascript: href is bound', () => {
    const parsed = parse(feedXML);

    expect(parsed).toHaveLength(2);
    expect(parsed.map((entry: any) => entry.title)).not.toContain('Sneaky');
    expect(parsed.every((entry: any) => entry.link.startsWith('https://'))).toBe(true);
  });

  it('throws on XML it cannot parse', () => {
    expect(() => parse('<rss><channel><item></rss>')).toThrow();
  });
});

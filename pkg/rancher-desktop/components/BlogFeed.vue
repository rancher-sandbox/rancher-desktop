<script>
import { defineComponent } from 'vue';

import { ipcRenderer } from '@pkg/utils/ipcRenderer';

export default defineComponent({
  name: 'blog-feed',
  data() {
    return { entries: [] };
  },
  async mounted() {
    try {
      const xml = await ipcRenderer.invoke('get-blog-feed');

      this.entries = this.parseFeed(xml);
    } catch (error) {
      console.error('Failed to load the blog feed:', error);
    }
  },
  methods: {
    parseFeed(xml) {
      const doc = new DOMParser().parseFromString(xml, 'text/xml');

      if (doc.querySelector('parsererror')) {
        throw new Error('Could not parse the blog feed XML');
      }

      return Array.from(doc.querySelectorAll('item')).map(item => ({
        title:   item.querySelector('title')?.textContent ?? '',
        link:    this.safeLink(item.querySelector('link')?.textContent ?? ''),
        summary: this.firstParagraph(item),
        date:    this.formatDate(item.querySelector('pubDate')?.textContent ?? ''),
      }))
        // Drop entries whose link was rejected: the whole entry points at it, and
        // it also keys the v-for, so an empty link would break both.
        .filter(entry => entry.link);
    },
    firstParagraph(item) {
      // Prefer the first paragraph of the full post; fall back to the RSS summary.
      // Both may embed HTML, so read parsed text rather than raw markup.
      const encoded = item.getElementsByTagName('content:encoded')[0]?.textContent ?? '';
      const description = item.querySelector('description')?.textContent ?? '';
      const post = new DOMParser().parseFromString(encoded, 'text/html');
      const summary = new DOMParser().parseFromString(description, 'text/html');
      const text = post.querySelector('p')?.textContent || summary.body.textContent || '';

      return text.replace(/\s+/g, ' ').trim();
    },
    formatDate(pubDate) {
      const date = new Date(pubDate);

      if (isNaN(date.valueOf())) {
        return pubDate;
      }

      // Format in UTC so the day matches the feed's pubDate regardless of the local timezone.
      return date.toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
      });
    },
    safeLink(link) {
      // Bind only http(s) URLs: a javascript:/data: href would execute in this
      // Node-integrated renderer, and feed content is remote and untrusted.
      try {
        const url = new URL(link);

        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
      } catch {
        return '';
      }
    },
  },
});
</script>

<template>
  <div
    v-if="entries.length"
    class="blog-feed"
  >
    <h3>{{ t('blogFeed.title') }}</h3>
    <div class="blog-feed-entries">
      <article
        v-for="entry in entries"
        :key="entry.link"
        class="blog-entry"
      >
        <div class="blog-entry-heading">
          <a
            :href="entry.link"
            class="blog-entry-title"
          >{{ entry.title }}</a>
          <span class="blog-entry-date">{{ entry.date }}</span>
        </div>
        <p class="blog-entry-summary">
          {{ entry.summary }} <a
            :href="entry.link"
            class="blog-entry-more"
          >{{ t('blogFeed.readMore') }}</a>
        </p>
      </article>
    </div>
  </div>
</template>

<style scoped lang="scss">
.blog-feed {
  display: flex;
  flex-direction: column;
  // Fill the leftover space, but keep at least the heading and top story.
  flex: 1;
  min-height: 10rem;

  h3 {
    margin-bottom: 0.75rem;
  }
}

.blog-feed-entries {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 1rem;
  // Tint the feed so it reads as one imported widget, set apart from the
  // app's own content above it. Carry the same shadow as the update card.
  background: var(--box-bg);
  border: 1px solid var(--border);
  border-radius: var(--border-radius);
  box-shadow: 0 0 20px var(--shadow);
}

.blog-entry + .blog-entry {
  margin-top: 2rem;
}

.blog-entry-heading {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
}

.blog-entry-title {
  // Imported headlines: stand out by weight, not by size or a blue link
  // colour. "Read more" carries the blue link affordance instead.
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.2;
  color: var(--body-text);
  // Soften the bold title so it stands out without shouting. Opacity, not a
  // colour token: --muted reads as disabled, and the secondary tokens barely
  // differ from --body-text in dark mode.
  opacity: 0.75;
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
}

.blog-entry-date {
  font-size: 0.9rem;
  color: var(--muted);
  white-space: nowrap;
}

.blog-entry-summary {
  margin: 0.5rem 0 0;
  line-height: 1.6;
}

// Trails the summary's last line, so keep it on that line.
.blog-entry-more {
  white-space: nowrap;
  color: var(--link);
}
</style>

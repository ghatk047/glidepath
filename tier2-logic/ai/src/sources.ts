import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages';

/** A web page the model searched, fetched or cited (06 §2: every source list is kept for audit). */
export interface Source {
  url: string;
  title: string | null;
  /** How the source entered the reply: search result, fetched page, or citation. */
  via: ('search' | 'fetch' | 'citation')[];
  /** `page_age` from search results, when the API gives one. */
  pageAge: string | null;
  /** `retrieved_at` from web fetch, when the API gives one. */
  retrievedAt: string | null;
  /** Text the model quoted from the page (citations). */
  citedText: string[];
}

/** Collects the sources of one or more replies, deduplicated by URL, in first-seen order. */
export class SourceCollector {
  private readonly byUrl = new Map<string, Source>();

  add(content: readonly BetaContentBlock[]): void {
    for (const block of content) {
      switch (block.type) {
        case 'web_search_tool_result':
          // An error result is an object, a success a list (server-tool errors do not raise).
          if (Array.isArray(block.content)) {
            for (const r of block.content)
              this.touch(r.url, 'search', { title: r.title, pageAge: r.page_age });
          }
          break;
        case 'web_fetch_tool_result':
          if (block.content.type === 'web_fetch_result') {
            this.touch(block.content.url, 'fetch', {
              title: block.content.content.title ?? null,
              retrievedAt: block.content.retrieved_at,
            });
          }
          break;
        case 'text':
          for (const c of block.citations ?? []) {
            if (c.type === 'web_search_result_location') {
              this.touch(c.url, 'citation', { title: c.title, citedText: c.cited_text });
            }
          }
          break;
        default:
          break;
      }
    }
  }

  list(): Source[] {
    return [...this.byUrl.values()].map((s) => ({
      ...s,
      via: [...s.via],
      citedText: [...s.citedText],
    }));
  }

  private touch(
    url: string,
    via: Source['via'][number],
    extra: {
      title?: string | null;
      pageAge?: string | null;
      retrievedAt?: string | null;
      citedText?: string;
    },
  ): void {
    let s = this.byUrl.get(url);
    if (!s) {
      s = { url, title: null, via: [], pageAge: null, retrievedAt: null, citedText: [] };
      this.byUrl.set(url, s);
    }
    if (!s.via.includes(via)) s.via.push(via);
    s.title ??= extra.title ?? null;
    s.pageAge ??= extra.pageAge ?? null;
    s.retrievedAt ??= extra.retrievedAt ?? null;
    if (extra.citedText && !s.citedText.includes(extra.citedText))
      s.citedText.push(extra.citedText);
  }
}

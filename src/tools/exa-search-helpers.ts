/** Pure helpers for the Exa search tool, split out so they can be tested in isolation. */

export type ExaContentMode = "highlights" | "text" | "summary" | "full";

export interface ExaHelperParams {
  contentMode?: ExaContentMode;
  textMaxCharacters?: number;
  summaryQuery?: string;
}

export interface ExaHighlights {
  maxCharacters?: number;
  query?: string;
}

export interface ExaTextOpts {
  maxCharacters?: number;
}

export interface ExaSummaryOpts {
  query?: string;
}

export interface ExaContentsRequest {
  text?: boolean | ExaTextOpts;
  highlights?: boolean | ExaHighlights;
  summary?: boolean | ExaSummaryOpts;
}

export interface ExaSearchResult {
  id?: string;
  url?: string;
  title?: string | null;
  author?: string | null;
  publishedDate?: string | null;
  score?: number;
  text?: string;
  highlights?: string[];
  highlightScores?: number[];
  summary?: string;
}

export function buildContents(p: ExaHelperParams): ExaContentsRequest {
  const mode = p.contentMode ?? "highlights";
  const contents: ExaContentsRequest = {};

  const wantsHighlights = mode === "highlights" || mode === "full";
  const wantsText = mode === "text" || mode === "full";
  const wantsSummary = mode === "summary" || mode === "full";

  if (wantsHighlights) {
    contents.highlights = { maxCharacters: 500 };
  }
  if (wantsText) {
    contents.text = p.textMaxCharacters
      ? { maxCharacters: p.textMaxCharacters }
      : { maxCharacters: 2000 };
  }
  if (wantsSummary) {
    contents.summary = p.summaryQuery ? { query: p.summaryQuery } : {};
  }

  return contents;
}

/** Extract a human-readable snippet from a result, cascading through highlights → summary → text. */
export function extractSnippet(r: ExaSearchResult): string {
  if (r.highlights && r.highlights.length > 0) {
    return r.highlights.map((h) => h.trim()).filter(Boolean).join(" … ");
  }
  if (r.summary && r.summary.trim()) {
    return r.summary.trim();
  }
  if (r.text && r.text.trim()) {
    const t = r.text.trim();
    return t.length > 400 ? `${t.slice(0, 400)}...` : t;
  }
  return "";
}

/**
 * Tests for exa-search. Run with:
 *   node --test --experimental-strip-types src/tools/exa-search.test.ts
 *
 * Uses only node:test + node:assert so no npm install is required,
 * matching the plugin's zero-dependency philosophy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContents, extractSnippet, type ExaSearchResult } from "./exa-search-helpers.ts";

test("buildContents defaults to highlights", () => {
  const c = buildContents({});
  assert.ok(c.highlights, "highlights should be enabled by default");
  assert.equal(c.text, undefined);
  assert.equal(c.summary, undefined);
});

test("buildContents 'text' mode returns text options with default cap", () => {
  const c = buildContents({ contentMode: "text" });
  assert.deepEqual(c.text, { maxCharacters: 2000 });
  assert.equal(c.highlights, undefined);
  assert.equal(c.summary, undefined);
});

test("buildContents respects textMaxCharacters override", () => {
  const c = buildContents({ contentMode: "text", textMaxCharacters: 5000 });
  assert.deepEqual(c.text, { maxCharacters: 5000 });
});

test("buildContents 'summary' mode with query directive", () => {
  const c = buildContents({ contentMode: "summary", summaryQuery: "focus on dates" });
  assert.deepEqual(c.summary, { query: "focus on dates" });
});

test("buildContents 'summary' mode without query directive", () => {
  const c = buildContents({ contentMode: "summary" });
  assert.deepEqual(c.summary, {});
});

test("buildContents 'full' mode requests text, highlights, and summary simultaneously", () => {
  const c = buildContents({ contentMode: "full" });
  assert.ok(c.text);
  assert.ok(c.highlights);
  assert.ok(c.summary);
});

test("extractSnippet prefers highlights when present", () => {
  const r: ExaSearchResult = {
    highlights: ["first snippet", "second snippet"],
    summary: "a summary",
    text: "full text",
  };
  assert.equal(extractSnippet(r), "first snippet … second snippet");
});

test("extractSnippet falls back to summary when no highlights", () => {
  const r: ExaSearchResult = { summary: "a summary", text: "full text" };
  assert.equal(extractSnippet(r), "a summary");
});

test("extractSnippet falls back to text when no highlights or summary", () => {
  const r: ExaSearchResult = { text: "some page text" };
  assert.equal(extractSnippet(r), "some page text");
});

test("extractSnippet truncates long text fallback", () => {
  const r: ExaSearchResult = { text: "x".repeat(800) };
  const out = extractSnippet(r);
  assert.ok(out.length <= 410);
  assert.ok(out.endsWith("..."));
});

test("extractSnippet returns empty string when no content fields present", () => {
  const r: ExaSearchResult = { url: "https://example.com", title: "t" };
  assert.equal(extractSnippet(r), "");
});

test("extractSnippet skips empty-string highlights gracefully", () => {
  const r: ExaSearchResult = { highlights: [], summary: "fallback" };
  assert.equal(extractSnippet(r), "fallback");
});

/**
 * Parses a fixture shaped like a real Exa /search response to make sure
 * snippet extraction and the ExaSearchResult type line up with the API.
 */
test("extractSnippet parses a realistic Exa response result", () => {
  const fixture: ExaSearchResult = {
    id: "abc123",
    url: "https://exa.ai",
    title: "Exa",
    author: null,
    publishedDate: "2024-01-15T00:00:00.000Z",
    score: 0.87,
    highlights: ["Exa is a search engine built for AI."],
    highlightScores: [0.91],
  };
  assert.equal(extractSnippet(fixture), "Exa is a search engine built for AI.");
});

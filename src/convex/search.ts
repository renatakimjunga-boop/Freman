"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";

/**
 * Web search for Freman's built-in engine, powered by the Brave Search API
 * (privacy-first index — on brand for a Web3 browser).
 *
 * Reads BRAVE_API_KEY (set it in the project's Keys/API keys tab). When the
 * key is missing or the API fails, returns clearly-labelled sample results so
 * the browser experience still works end-to-end.
 */

interface WebResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

interface AnswerBox {
  title: string;
  answer: string;
  url: string | null;
}

interface SearchResponse {
  source: "live" | "sample";
  notice?: string;
  results: WebResult[];
  answerBox: AnswerBox | null;
}

function sampleResults(query: string): WebResult[] {
  const q = encodeURIComponent(query);
  return [
    {
      title: `${query} — Wikipedia`,
      url: `https://en.wikipedia.org/wiki/Special:Search?search=${q}`,
      snippet: `An encyclopedic overview of ${query}: background, history and related context.`,
      source: "en.wikipedia.org",
    },
    {
      title: `${query} — latest news`,
      url: `https://news.google.com/search?q=${q}`,
      snippet: `Recent coverage and stories about ${query} from publishers worldwide.`,
      source: "news.google.com",
    },
    {
      title: `${query} — GitHub`,
      url: `https://github.com/search?q=${q}`,
      snippet: `Repositories, code and issues matching ${query} across GitHub.`,
      source: "github.com",
    },
    {
      title: `${query} — discussions on Reddit`,
      url: `https://www.reddit.com/search/?q=${q}`,
      snippet: `Community threads and opinions about ${query}.`,
      source: "www.reddit.com",
    },
    {
      title: `${query} — video results`,
      url: `https://www.youtube.com/results?search_query=${q}`,
      snippet: `Talks, tutorials and walkthroughs related to ${query}.`,
      source: "www.youtube.com",
    },
  ];
}

export const searchWeb = action({
  args: { query: v.string() },
  handler: async (_ctx, { query }): Promise<SearchResponse> => {
    const q = query.trim();
    if (!q) {
      return { source: "sample", results: [], answerBox: null };
    }

    const apiKey =
      process.env.BRAVE_API_KEY ?? process.env.BRAVE_SEARCH_API_KEY;

    if (!apiKey) {
      return {
        source: "sample",
        notice:
          "Sample results — add BRAVE_API_KEY in the Keys tab to enable live web search.",
        results: sampleResults(q),
        answerBox: null,
      };
    }

    try {
      const endpoint = new URL("https://api.search.brave.com/res/v1/web/search");
      endpoint.searchParams.set("q", q);
      endpoint.searchParams.set("count", "10");

      const res = await fetch(endpoint, {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": apiKey,
        },
      });

      if (!res.ok) {
        return {
          source: "sample",
          notice: `Live search is unavailable (HTTP ${res.status}) — showing sample results.`,
          results: sampleResults(q),
          answerBox: null,
        };
      }

      const data = (await res.json()) as {
        web?: {
          results?: {
            title?: string;
            url?: string;
            description?: string;
            meta_url?: { hostname?: string };
          }[];
        };
        answerBox?: {
          title?: string;
          answer?: string;
          text?: string;
          url?: string;
        };
      };

      const results: WebResult[] = (data.web?.results ?? [])
        .slice(0, 10)
        .map((r) => ({
          title: r.title ?? "Untitled result",
          url: r.url ?? "",
          snippet: r.description ?? "",
          source: r.meta_url?.hostname ?? "",
        }))
        .filter((r) => r.url !== "");

      const ab = data.answerBox;
      const answerBox: AnswerBox | null =
        ab && (ab.answer ?? ab.text)
          ? {
              title: ab.title ?? "Quick answer",
              answer: (ab.answer ?? ab.text)!,
              url: ab.url ?? null,
            }
          : null;

      return { source: "live", results, answerBox };
    } catch {
      return {
        source: "sample",
        notice:
          "Live search failed — check BRAVE_API_KEY in the Keys tab. Showing sample results.",
        results: sampleResults(q),
        answerBox: null,
      };
    }
  },
});

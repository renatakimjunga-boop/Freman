"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";

/**
 * Web search for Freman's built-in engine.
 *
 * Priority order:
 *   1. Brave Search API when BRAVE_API_KEY is set (best quality, rate-limited
 *      by the key's plan). Selected when the user picks the "Google" engine;
 *      Brave powers search results behind the scenes and they are labelled
 *      accordingly.
 *   2. Keyless live aggregation — DuckDuckGo Instant Answers, Wikipedia and
 *      Hacker News (Algolia), all public official APIs with no key required.
 *      Results are real and merged by heuristic relevance.
 *   3. Clearly-labelled sample results, only when every live source fails.
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
  engine: string;
  notice?: string;
  results: WebResult[];
  answerBox: AnswerBox | null;
  page: number;
  hasMore: boolean;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function decode(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

async function fetchJson(url: string | URL, init?: RequestInit): Promise<unknown> {
  const target = url.toString();
  const res = await fetch(target, {
    ...init,
    headers: {
      Accept: "application/json",
      "User-Agent": "FremanBrowser/1.0 (web search aggregator)",
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${hostOf(target)}`);
  return res.json();
}

/* ------------------------------ Brave (keyed) ----------------------------- */

async function searchBrave(
  query: string,
  apiKey: string,
  page: number,
  count: number,
  safeSearch: boolean,
): Promise<SearchResponse> {
  const endpoint = new URL("https://api.search.brave.com/res/v1/web/search");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("count", String(count));
  endpoint.searchParams.set("offset", String(page - 1)); // Brave is zero-based
  if (safeSearch) endpoint.searchParams.set("safesearch", "strict");

  const data = (await fetchJson(endpoint, {
    headers: { "X-Subscription-Token": apiKey },
  })) as {
    web?: {
      results?: {
        title?: string;
        url?: string;
        description?: string;
        meta_url?: { hostname?: string };
      }[];
    };
    answerBox?: { title?: string; answer?: string; text?: string; url?: string };
  };

  const results: WebResult[] = (data.web?.results ?? [])
    .slice(0, 10)
    .map((r) => ({
      title: decode(r.title ?? "Untitled result"),
      url: r.url ?? "",
      snippet: decode(r.description ?? ""),
      source: r.meta_url?.hostname ?? hostOf(r.url ?? ""),
    }))
    .filter((r) => r.url !== "");

  const ab = data.answerBox;
  const answerBox: AnswerBox | null =
    ab && (ab.answer ?? ab.text)
      ? {
          title: ab.title ?? "Quick answer",
          answer: decode((ab.answer ?? ab.text)!),
          url: ab.url ?? null,
        }
      : null;

  return {
    source: "live",
    engine: "Brave Search",
    results,
    answerBox: page === 1 ? answerBox : null,
    page,
    hasMore: results.length === count,
  };
}

/* --------------------------- Keyless live sources ------------------------- */

interface Scored {
  result: WebResult;
  score: number;
}

async function searchDuckDuckGo(query: string): Promise<Scored[]> {
  const endpoint = new URL("https://api.duckduckgo.com/");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("no_html", "1");
  endpoint.searchParams.set("skip_disambig", "1");

  const data = (await fetchJson(endpoint)) as {
    AbstractText?: string;
    AbstractURL?: string;
    AbstractSource?: string;
    Heading?: string;
    RelatedTopics?: {
      Text?: string;
      FirstURL?: string;
      Topics?: { Text?: string; FirstURL?: string }[];
    }[];
  };

  const out: Scored[] = [];
  const push = (text: string | undefined, url: string | undefined, score: number) => {
    if (!text || !url) return;
    const clean = decode(text);
    const at = clean.indexOf(" - ");
    out.push({
      score,
      result: {
        title: at > 0 ? clean.slice(0, at) : clean.slice(0, 80),
        url,
        snippet: at > 0 ? clean.slice(at + 3) : clean,
        source: hostOf(url),
      },
    });
  };

  // The instant answer itself ranks highest when present.
  if (data.AbstractText && data.AbstractURL) {
    push(data.AbstractText, data.AbstractURL, 100);
  }
  for (const topic of data.RelatedTopics ?? []) {
    if (topic.Topics?.length) {
      for (const sub of topic.Topics) push(sub.Text, sub.FirstURL, 40);
    } else {
      push(topic.Text, topic.FirstURL, 45);
    }
  }
  return out;
}

async function searchWikipedia(query: string): Promise<Scored[]> {
  const endpoint = new URL("https://en.wikipedia.org/w/api.php");
  endpoint.searchParams.set("action", "query");
  endpoint.searchParams.set("list", "search");
  endpoint.searchParams.set("srsearch", query);
  endpoint.searchParams.set("srlimit", "5");
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("origin", "*");

  const data = (await fetchJson(endpoint)) as {
    query?: {
      search?: { title: string; snippet: string }[];
    };
  };

  return (data.query?.search ?? []).map((hit, i) => ({
    score: 90 - i * 5,
    result: {
      title: `${hit.title} — Wikipedia`,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(
        hit.title.replace(/ /g, "_"),
      )}`,
      snippet: decode(hit.snippet),
      source: "en.wikipedia.org",
    },
  }));
}

async function searchHackerNews(query: string): Promise<Scored[]> {
  return (await searchHackerNewsRaw(query, 0, 5)).hits;
}

interface HnHits {
  hits?: {
    title?: string;
    url?: string | null;
    objectID: string;
    points?: number;
    num_comments?: number;
    story_text?: string | null;
  }[];
  nbPages?: number;
}

/** Fetch one raw page of HN stories; shared by first-page merge + deep pages. */
async function searchHackerNewsRaw(
  query: string,
  pageIdx: number,
  perPage: number,
): Promise<{ hits: Scored[]; nbPages: number }> {
  const endpoint = new URL("https://hn.algolia.com/api/v1/search");
  endpoint.searchParams.set("query", query);
  endpoint.searchParams.set("page", String(pageIdx));
  endpoint.searchParams.set("hitsPerPage", String(perPage));
  endpoint.searchParams.set("tags", "story");

  const data = (await fetchJson(endpoint)) as HnHits;
  return { hits: mapHnHits(data), nbPages: data.nbPages ?? 1 };
}

function mapHnHits(data: HnHits): Scored[] {
  return (data.hits ?? [])
    .filter((h) => h.title)
    .map((hit) => {
      const url = hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`;
      const meta: string[] = [];
      if (hit.points) meta.push(`${hit.points} points`);
      if (hit.num_comments) meta.push(`${hit.num_comments} comments`);
      return {
        score: 25,
        result: {
          title: hit.title!,
          url,
          snippet: meta.length
            ? `Discussed on Hacker News · ${meta.join(" · ")}`
            : "Discussed on Hacker News.",
          source: hostOf(url),
        },
      };
    });
}

async function searchKeyless(
  query: string,
  page: number,
  engineLabel = "Freman live index",
): Promise<SearchResponse> {
  if (page > 1) {
    // The keyless sources only serve a first page; deeper pages come from
    // HN Algolia's pagination.
    return searchHackerNewsPage(query, page, engineLabel);
  }
  const settled = await Promise.allSettled([
    searchDuckDuckGo(query),
    searchWikipedia(query),
    searchHackerNews(query),
  ]);

  const all: Scored[] = [];
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") all.push(...outcome.value);
  }

  if (all.length === 0) {
    throw new Error("all live sources failed");
  }

  // Dedupe by URL keeping the highest score.
  const byUrl = new Map<string, Scored>();
  for (const item of all) {
    const existing = byUrl.get(item.result.url);
    if (!existing || item.score > existing.score) {
      byUrl.set(item.result.url, item);
    }
  }

  const results = [...byUrl.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((s) => s.result);

  const ddg = settled[0].status === "fulfilled" ? settled[0].value : [];
  const abstract = ddg.find((d) => d.score === 100);

  return {
    source: "live",
    engine: engineLabel,
    answerBox: abstract
      ? {
          title: "Instant answer",
          answer: abstract.result.snippet,
          url: abstract.result.url,
        }
      : null,
    results,
    page: 1,
    hasMore: true, // deeper pages continue via searchHackerNewsPage
  };
}

/** Deeper pages for the keyless index — HN Algolia supports pagination. */
async function searchHackerNewsPage(
  query: string,
  page: number,
  engineLabel = "Freman live index",
): Promise<SearchResponse> {
  const endpoint = new URL("https://hn.algolia.com/api/v1/search");
  endpoint.searchParams.set("query", query);
  endpoint.searchParams.set("hitsPerPage", "12");
  endpoint.searchParams.set("page", String(page - 1));
  endpoint.searchParams.set("tags", "story");

  const data = (await fetchJson(endpoint)) as {
    hits?: { title?: string; url?: string | null; objectID: string }[];
    nbPages?: number;
  };

  const results: WebResult[] = (data.hits ?? [])
    .filter((h) => h.title)
    .map((hit) => {
      const url = hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`;
      return {
        title: hit.title!,
        url,
        snippet: "Discussed on Hacker News.",
        source: hostOf(url),
      };
    });

  return {
    source: "live",
    engine: engineLabel,
    results,
    answerBox: null,
    page,
    hasMore: (data.nbPages ?? 1) > page,
  };
}

/* ------------------------------ sample fallback --------------------------- */

function sampleResults(query: string, page: number): SearchResponse {
  const q = encodeURIComponent(query);
  return {
    page,
    hasMore: false,
    source: "sample",
    engine: "Freman sample results",
    notice:
      "Live search is temporarily unavailable — showing sample links instead.",
    results: [
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
        title: `${query} — video results`,
        url: `https://www.youtube.com/results?search_query=${q}`,
        snippet: `Talks, tutorials and walkthroughs related to ${query}.`,
        source: "www.youtube.com",
      },
    ],
    answerBox: null,
  };
}

/* --------------------------------- action --------------------------------- */

export const searchWeb = action({
  args: {
    query: v.string(),
    page: v.optional(v.number()),
    count: v.optional(v.number()),
    safeSearch: v.optional(v.boolean()),
    // "freman" (default) uses the built-in index; "google" (Chrome's default
    // engine) routes through the Brave Search API when a key is configured;
    // "duckduckgo" always uses the keyless aggregation, which is powered by
    // DuckDuckGo's own Instant Answers API plus Wikipedia and Hacker News.
    engine: v.optional(
      v.union(
        v.literal("freman"),
        v.literal("google"),
        v.literal("duckduckgo"),
      ),
    ),
  },
  handler: async (
    _ctx,
    { query, page, count, safeSearch, engine },
  ): Promise<SearchResponse> => {
    const q = query.trim();
    const pageNum = Math.max(1, page ?? 1);
    const perPage = Math.min(30, Math.max(10, count ?? 10));
    if (!q) {
      return {
        source: "sample",
        engine: "Freman sample results",
        results: [],
        answerBox: null,
        page: pageNum,
        hasMore: false,
      };
    }

    const choice = engine ?? "freman";
    const apiKey =
      process.env.BRAVE_API_KEY ?? process.env.BRAVE_SEARCH_API_KEY;

    // DuckDuckGo always uses the keyless aggregation — its Instant Answers API
    // is one of the live sources — and never routes through Brave.
    if (apiKey && choice !== "duckduckgo") {
      try {
        const res = await searchBrave(
          q,
          apiKey,
          pageNum,
          perPage,
          safeSearch ?? false,
        );
        return choice === "google" ? { ...res, engine: "Google" } : res;
      } catch {
        // Fall through to keyless sources.
      }
    }

    const label =
      choice === "duckduckgo"
        ? "DuckDuckGo"
        : choice === "google"
          ? "Google"
          : "Freman live index";
    try {
      const res = await searchKeyless(q, pageNum, label);
      if (choice === "google" && !apiKey) {
        return {
          ...res,
          notice:
            "Google results use Freman's live index here — add BRAVE_API_KEY in the Keys tab for full Google-grade results.",
        };
      }
      return res;
    } catch {
      return { ...sampleResults(q, pageNum), engine: label };
    }
  },
});

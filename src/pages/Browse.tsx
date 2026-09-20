import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { FremanWordmark } from "@/components/FremanWordmark";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { EXTENSION_SAMPLES } from "@/lib/extension-samples";
import { DAPPS } from "@/lib/dapps";
import { useAction, useQuery } from "convex/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Globe,
  Home,
  Lock,
  MoreVertical,
  Paintbrush,
  Plus,
  Puzzle,
  RotateCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Star,
  Video,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

/* ----------------------------- search model ------------------------------ */

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

const FILTERS = [
  { id: "all", label: "All" },
  { id: "web3", label: "Web3" },
  { id: "docs", label: "Developer docs" },
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

function applyFilter(query: string, filter: FilterId): string {
  if (filter === "web3") return `${query} (web3 OR crypto OR blockchain)`;
  if (filter === "docs") {
    return `${query} (site:chromium.org OR site:developer.chrome.com OR site:github.com)`;
  }
  return query;
}

/* ------------------------------ navigation ------------------------------- */

interface SearchNav {
  kind: "search";
  query: string; // what the user typed
  sent: string; // what was sent to the engine (filter applied)
  filter: FilterId;
  status: "loading" | "done" | "error";
  source?: "live" | "sample";
  notice?: string;
  answerBox?: AnswerBox | null;
  results?: WebResult[];
  error?: string;
}

interface SiteNav {
  kind: "site";
  url: string;
}

interface NtpNav {
  kind: "ntp";
}

type Nav = SearchNav | SiteNav | NtpNav;

interface Tab {
  id: string;
  entries: Nav[];
  idx: number;
  loading: boolean; // site-level page load
}

const URL_RE = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/i;
const ETH_RE = /^[a-z0-9-]+\.eth$/i;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function shorten(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function normalizeUrl(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function faviconOf(url: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
    hostOf(url),
  )}&sz=64`;
}

function navDisplay(nav: Nav | undefined): string {
  if (!nav || nav.kind === "ntp") return "";
  if (nav.kind === "site") return nav.url;
  return nav.query;
}

function navTitle(nav: Nav): string {
  if (nav.kind === "ntp") return "New Tab";
  if (nav.kind === "site") return hostOf(nav.url);
  return nav.query;
}

const EXTENSION_ICONS: Record<string, typeof Puzzle> = {
  "wallet-provider": Wallet,
  "ens-resolver": Globe,
  "signature-guard": ShieldCheck,
  "tab-capture": Video,
  "page-redder": Paintbrush,
};

const DEFAULT_BOOKMARKS = [
  { label: "GitHub", url: "https://github.com" },
  { label: "Chrome Developers", url: "https://developer.chrome.com" },
  { label: "Chromium Source", url: "https://chromium.googlesource.com/chromium/src" },
  { label: "Uniswap", url: "https://app.uniswap.org" },
  { label: "Etherscan", url: "https://etherscan.io" },
];

function newTab(): Tab {
  return {
    id: Math.random().toString(36).slice(2),
    entries: [{ kind: "ntp" }],
    idx: 0,
    loading: false,
  };
}

function countMatches(text: string, term: string): number {
  if (!term) return 0;
  const haystack = text.toLowerCase();
  const needle = term.toLowerCase();
  let count = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    count += 1;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return count;
}

/* ------------------------------ the browser ------------------------------ */

export default function Browse() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const searchWeb = useAction(api.search.searchWeb);

  const installed = useQuery(api.extensions.listInstalled) ?? [];
  const accounts = useQuery(api.wallet.listAccounts) ?? [];

  const [tabs, setTabs] = useState<Tab[]>([newTab()]);
  const [activeId, setActiveId] = useState(() => tabs[0].id);
  const [draft, setDraft] = useState("");
  const [bookmarks, setBookmarks] = useState(DEFAULT_BOOKMARKS);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [now, setNow] = useState(() => new Date());
  const omniboxRef = useRef<HTMLInputElement>(null);

  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const current =
    activeTab.idx >= 0 ? activeTab.entries[activeTab.idx] : undefined;

  useEffect(() => {
    setDraft(navDisplay(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeTab.idx]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(timer);
  }, []);

  const enabledSampleIds = new Set(
    installed.filter((e) => e.enabled).map((e) => e.sampleId),
  );
  const activeExtensions = EXTENSION_SAMPLES.filter((s) =>
    enabledSampleIds.has(s.id),
  );
  const walletInstalled = enabledSampleIds.has("wallet-provider");
  const ensInstalled = enabledSampleIds.has("ens-resolver");

  /* ------------------------------ navigation ------------------------------ */

  function pushNav(tabId: string, nav: Nav) {
    setTabs((ts) =>
      ts.map((t) =>
        t.id === tabId
          ? {
              ...t,
              loading: nav.kind === "site",
              entries: [...t.entries.slice(0, t.idx + 1), nav],
              idx: t.idx + 1,
            }
          : t,
      ),
    );
  }

  function patchSearch(
    tabId: string,
    entryIndex: number,
    patch: Partial<SearchNav>,
  ) {
    setTabs((ts) =>
      ts.map((t) =>
        t.id === tabId
          ? {
              ...t,
              entries: t.entries.map((e, i) =>
                i === entryIndex && e.kind === "search"
                  ? ({ ...e, ...patch } as SearchNav)
                  : e,
              ),
            }
          : t,
      ),
    );
  }

  async function runSearch(tabId: string, rawQuery: string, filter: FilterId) {
    const query = rawQuery.trim();
    if (!query) return;

    const sent = applyFilter(query, filter);
    let entryIndex = -1;
    setTabs((ts) =>
      ts.map((t) => {
        if (t.id !== tabId) return t;
        const entries = [...t.entries.slice(0, t.idx + 1)];
        entries.push({
          kind: "search",
          query,
          sent,
          filter,
          status: "loading",
        });
        entryIndex = entries.length - 1;
        return { ...t, entries, idx: entries.length - 1 };
      }),
    );

    try {
      const res = await searchWeb({ query: sent });
      patchSearch(tabId, entryIndex, {
        status: "done",
        source: res.source,
        notice: res.notice,
        answerBox: res.answerBox,
        results: res.results,
      });
    } catch (err) {
      patchSearch(tabId, entryIndex, {
        status: "error",
        error:
          err instanceof Error
            ? err.message
            : "Search failed — please try again.",
      });
    }
  }

  /** Omnibox submit — classify like Chrome: URL, ENS name, address, or search. */
  function submitOmnibox() {
    const raw = draft.trim();
    if (!raw) return;
    const tabId = activeTab.id;
    if (ETH_RE.test(raw) || ADDRESS_RE.test(raw) || !URL_RE.test(raw)) {
      void runSearch(tabId, raw, "all");
    } else {
      pushNav(tabId, { kind: "site", url: normalizeUrl(raw) });
    }
  }

  function openInTab(url: string) {
    pushNav(activeTab.id, { kind: "site", url: normalizeUrl(url) });
  }

  function runQuery(query: string) {
    void runSearch(activeTab.id, query, "all");
  }

  function changeFilter(filter: FilterId) {
    if (current?.kind !== "search") return;
    void runSearch(activeTab.id, current.query, filter);
  }

  function reload() {
    if (!current) return;
    if (current.kind === "search") {
      void runSearch(activeTab.id, current.query, current.filter);
    } else if (current.kind === "site") {
      setTabs((ts) =>
        ts.map((t) => (t.id === activeTab.id ? { ...t, loading: true } : t)),
      );
    }
  }

  function goHome() {
    pushNav(activeTab.id, { kind: "ntp" });
  }

  function go(delta: number) {
    setTabs((ts) =>
      ts.map((t) =>
        t.id === activeId
          ? {
              ...t,
              idx: Math.min(Math.max(t.idx + delta, -1), t.entries.length - 1),
              loading: false,
            }
          : t,
      ),
    );
  }

  function openNewTab() {
    const tab = newTab();
    setTabs((ts) => [...ts, tab]);
    setActiveId(tab.id);
    setDraft("");
  }

  function closeTab(id: string) {
    setTabs((ts) => {
      const remaining = ts.filter((t) => t.id !== id);
      if (remaining.length === 0) {
        const fresh = newTab();
        setActiveId(fresh.id);
        setDraft("");
        return [fresh];
      }
      if (id === activeId) {
        const closedIndex = ts.findIndex((t) => t.id === id);
        const neighbor = remaining[Math.min(closedIndex, remaining.length - 1)];
        setActiveId(neighbor.id);
      }
      return remaining;
    });
  }

  /* ------------------------------ bookmarks ------------------------------- */

  const currentBookmarkUrl =
    current?.kind === "site"
      ? current.url
      : current?.kind === "search"
        ? `freman://search?q=${encodeURIComponent(current.query)}`
        : null;
  const bookmarked =
    currentBookmarkUrl !== null &&
    bookmarks.some((b) => b.url === currentBookmarkUrl);

  function toggleBookmark() {
    if (!currentBookmarkUrl || !current) return;
    setBookmarks((bs) => {
      if (bs.some((b) => b.url === currentBookmarkUrl)) {
        toast("Bookmark removed");
        return bs.filter((b) => b.url !== currentBookmarkUrl);
      }
      const label =
        current.kind === "site"
          ? hostOf(current.url)
          : current.kind === "search"
            ? `Search: ${current.query}`
            : "New Tab";
      toast.success("Bookmark added");
      return [...bs, { label, url: currentBookmarkUrl }];
    });
  }

  /* ---------------------------- find in page ------------------------------ */

  const findableText =
    current?.kind === "search"
      ? (current.results ?? [])
          .map((r) => `${r.title} ${r.snippet}`)
          .join("\n") + (current.answerBox ? ` ${current.answerBox.answer}` : "")
      : "";
  const findCount =
    findOpen && findQuery.trim().length >= 2
      ? countMatches(findableText, findQuery.trim())
      : 0;

  /* --------------------------- keyboard shortcuts -------------------------- */

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "t") {
        e.preventDefault();
        openNewTab();
      } else if (e.key === "w") {
        e.preventDefault();
        closeTab(activeId);
      } else if (e.key === "f") {
        e.preventDefault();
        setFindOpen(true);
      } else if (e.key === "d") {
        e.preventDefault();
        toggleBookmark();
      } else if (e.key === "l") {
        e.preventDefault();
        omniboxRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  /* --------------------------------- view --------------------------------- */

  const showLoadingBar =
    (current?.kind === "search" && current.status === "loading") ||
    (current?.kind === "site" && activeTab.loading);

  const omniboxIcon =
    current?.kind === "site" ? (
      <Lock className="size-3.5 text-muted-foreground" />
    ) : current?.kind === "search" ? (
      <Search className="size-3.5 text-muted-foreground" />
    ) : (
      <Globe className="size-3.5 text-muted-foreground" />
    );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-muted/40 text-foreground">
      {/* ── Tab strip ─────────────────────────────────────────────────── */}
      <div className="flex items-end gap-1 px-3 pt-2">
        <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const nav = tab.entries[tab.idx];
            const isActive = tab.id === activeId;
            return (
              <div
                key={tab.id}
                className={`group flex h-9 min-w-0 max-w-[220px] shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-3 text-xs transition-colors ${
                  isActive
                    ? "border-border bg-card text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-card/60"
                }`}
              >
                {nav && nav.kind === "site" ? (
                  <img
                    src={faviconOf(nav.url)}
                    alt=""
                    className="size-3.5 shrink-0 rounded-sm"
                    onError={(e) => {
                      e.currentTarget.style.visibility = "hidden";
                    }}
                  />
                ) : nav && nav.kind === "search" ? (
                  <Search className="size-3.5 shrink-0" />
                ) : (
                  <Home className="size-3.5 shrink-0" />
                )}
                <button
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => {
                    setActiveId(tab.id);
                    setDraft(navDisplay(tab.entries[tab.idx]));
                  }}
                  title={navTitle(nav ?? { kind: "ntp" })}
                >
                  {navTitle(nav ?? { kind: "ntp" })}
                </button>
                <button
                  aria-label="Close tab"
                  className="rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                  onClick={() => closeTab(tab.id)}
                >
                  <X className="size-3" />
                </button>
              </div>
            );
          })}
          <Button
            variant="ghost"
            size="icon"
            className="mb-0.5 size-7 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={openNewTab}
            title="New tab (⌘T)"
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </div>

      {/* ── Toolbar ───────────────────────────────────────────────────── */}
      <div className="relative flex items-center gap-1 border-b border-border bg-card px-3 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-foreground"
          disabled={activeTab.idx <= 0}
          onClick={() => go(-1)}
          title="Back"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-foreground"
          disabled={activeTab.idx >= activeTab.entries.length - 1}
          onClick={() => go(1)}
          title="Forward"
        >
          <ArrowRight className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-foreground"
          disabled={!current || current.kind === "ntp"}
          onClick={reload}
          title="Reload"
        >
          <RotateCw className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-foreground"
          onClick={goHome}
          title="Home"
        >
          <Home className="size-4" />
        </Button>

        {/* Omnibox */}
        <form
          className="mx-2 min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            submitOmnibox();
          }}
        >
          <div
            className={`flex h-9 items-center gap-2 rounded-full border bg-background px-3.5 transition-colors focus-within:border-foreground/50 ${
              current?.kind === "site" && !draft.startsWith("http")
                ? "border-border"
                : "border-border"
            }`}
          >
            {omniboxIcon}
            {current?.kind === "site" && (
              <span className="hidden shrink-0 items-center gap-1 border-r border-border pr-2 text-xs text-muted-foreground sm:flex">
                {hostOf(current.url)}
              </span>
            )}
            <input
              ref={omniboxRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="Search Freman or type a URL"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:text-muted-foreground/70"
            />
            <button
              type="button"
              title={bookmarked ? "Edit bookmark" : "Bookmark this tab (⌘D)"}
              className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
              disabled={!currentBookmarkUrl}
              onClick={toggleBookmark}
            >
              <Star
                className="size-4"
                fill={bookmarked ? "currentColor" : "none"}
              />
            </button>
          </div>
        </form>

        {/* Extensions */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              title="Extensions"
            >
              <Puzzle className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Extensions</DropdownMenuLabel>
            {activeExtensions.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                No extensions installed yet.
              </p>
            ) : (
              activeExtensions.map((ext) => {
                const Icon = EXTENSION_ICONS[ext.id] ?? Puzzle;
                return (
                  <DropdownMenuItem key={ext.id} className="gap-2.5">
                    <Icon className="size-4 text-muted-foreground" />
                    <span className="flex-1 truncate text-xs">{ext.name}</span>
                    <Check className="size-3.5 text-foreground" />
                  </DropdownMenuItem>
                );
              })
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate("/dashboard")}>
              Manage extensions
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {walletInstalled && <WalletPopover />}

        {/* Profile */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="ml-1 grid size-7 shrink-0 place-items-center rounded-full bg-foreground text-[11px] font-semibold text-background"
              title={user?.email ?? "Profile"}
            >
              {(user?.name ?? user?.email ?? "F").charAt(0).toUpperCase()}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <div className="flex items-center gap-3 px-2 py-2">
              <div className="grid size-9 place-items-center rounded-full bg-foreground text-sm font-semibold text-background">
                {(user?.name ?? user?.email ?? "F").charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {user?.name ?? "Freman user"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {user?.email ?? ""}
                </p>
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate("/dashboard")}>
              Open Studio
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate("/")}>
              Freman homepage
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                void signOut();
                navigate("/");
              }}
            >
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Main menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              title="Customize and control Freman"
            >
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onSelect={openNewTab}>
              New tab
              <DropdownMenuShortcut>⌘T</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => closeTab(activeId)}>
              Close tab
              <DropdownMenuShortcut>⌘W</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setFindOpen((open) => !open)}
              disabled={current?.kind !== "search"}
            >
              Find in page…
              <DropdownMenuShortcut>⌘F</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={toggleBookmark}
              disabled={!currentBookmarkUrl}
            >
              {bookmarked ? "Remove bookmark" : "Bookmark this tab"}
              <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate("/dashboard")}>
              Freman Studio
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                toast("Freman 1.0 — the Web3 browser, for everyone.")
              }
            >
              About Freman
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Page-load bar */}
        {showLoadingBar && (
          <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
            <div className="freman-loading-bar h-full w-1/3 bg-foreground/70" />
          </div>
        )}
      </div>

      {/* ── Bookmarks bar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-border bg-card px-3 py-1.5">
        {bookmarks.map((b) => (
          <button
            key={b.url}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => openInTab(b.url)}
          >
            <img
              src={faviconOf(b.url)}
              alt=""
              className="size-3.5 rounded-sm"
              onError={(e) => {
                e.currentTarget.style.visibility = "hidden";
              }}
            />
            {b.label}
          </button>
        ))}
      </div>

      {/* ── Find in page ──────────────────────────────────────────────── */}
      {findOpen && (
        <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-1.5">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setFindOpen(false);
            }}
            autoFocus
            placeholder="Find in page"
            className="h-6 flex-1 bg-transparent text-xs outline-none"
          />
          {findQuery.trim().length >= 2 && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {findCount} match{findCount === 1 ? "" : "es"}
            </span>
          )}
          <button
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setFindOpen(false);
              setFindQuery("");
            }}
            aria-label="Close find bar"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* ── Viewport ──────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-background">
        {!current || current.kind === "ntp" ? (
          <NewTabPage onSearch={runQuery} onNavigate={openInTab} userName={user?.name ?? undefined} />
        ) : current.kind === "site" ? (
          <SiteView
            url={current.url}
            onLoaded={() =>
              setTabs((ts) =>
                ts.map((t) =>
                  t.id === activeTab.id ? { ...t, loading: false } : t,
                ),
              )
            }
          />
        ) : current.status === "loading" ? (
          <LoadingView query={current.query} />
        ) : current.status === "error" ? (
          <div className="mx-auto max-w-3xl px-6 py-16 text-center">
            <p className="text-sm text-muted-foreground">{current.error}</p>
            <Button
              variant="outline"
              className="mt-6 rounded-full px-6"
              onClick={reload}
            >
              Try again
            </Button>
          </div>
        ) : (
          <ResultsView
            entry={current}
            ensInstalled={ensInstalled}
            onFilterChange={changeFilter}
            onRunSearch={runQuery}
            onNavigate={openInTab}
            findQuery={findOpen ? findQuery.trim() : ""}
          />
        )}
      </div>

      {/* ── Status bar ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-t border-border bg-card px-4 py-1 font-mono text-[11px] text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          ETH · Mainnet
          <span className="hidden text-border sm:inline">|</span>
          <span className="hidden sm:inline">Freman 1.0</span>
        </span>
        <span className="max-w-[50%] truncate">
          {current ? navDisplay(current) || "New Tab" : "New Tab"}
        </span>
        <span>
          {now.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------- new tab -------------------------------- */

function NewTabPage({
  onSearch,
  onNavigate,
  userName,
}: {
  onSearch: (query: string) => void;
  onNavigate: (url: string) => void;
  userName?: string;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  return (
    <div className="mx-auto w-full max-w-xl px-6 pb-16 pt-[10vh]">
      <div className="text-center">
        <FremanWordmark className="text-4xl" />
        <p className="mt-3 text-sm text-muted-foreground">
          {userName
            ? `Welcome back, ${userName}.`
            : "The web, with Web3 built in."}
        </p>
      </div>
      <form
        className="mt-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) onSearch(query.trim());
        }}
      >
        <div className="flex h-14 items-center gap-3 rounded-full border border-border bg-background px-5 transition-colors focus-within:border-foreground/50">
          <Search className="size-5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the web or type a URL"
            className="min-w-0 flex-1 bg-transparent font-mono text-base outline-none placeholder:text-muted-foreground/70"
          />
        </div>
      </form>

      <div className="mt-12">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Web3 shortcuts
        </p>
        <div className="mt-3 overflow-hidden rounded-xl border border-border">
          {DAPPS.slice(0, 4).map((dapp, i) => (
            <button
              key={dapp.origin}
              className={`flex w-full items-center justify-between px-4 py-3 text-sm transition-colors hover:bg-muted/60 ${
                i > 0 ? "border-t border-border" : ""
              }`}
              onClick={() => onNavigate(`https://${dapp.origin}`)}
            >
              <span>{dapp.name}</span>
              <span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                {dapp.origin}
                <ExternalLink className="size-3" />
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Developer
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            ["Chromium source", "https://chromium.googlesource.com/chromium/src"],
            [
              "Chromium docs",
              "https://chromium.googlesource.com/chromium/src/+/HEAD/docs",
            ],
            [
              "Extension samples",
              "https://github.com/GoogleChrome/chrome-extensions-samples",
            ],
          ].map(([label, href]) => (
            <button
              key={href}
              onClick={() => onNavigate(href)}
              className="rounded-full border border-border px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => navigate("/dashboard")}
            className="rounded-full border border-border px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            Open Studio
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- site view ------------------------------- */

function SiteView({ url, onLoaded }: { url: string; onLoaded: () => void }) {
  const [blocked, setBlocked] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setBlocked(false);
    const timer = setTimeout(() => setBlocked(true), 4000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, attempt]);

  if (blocked) {
    return (
      <div className="grid min-h-full place-items-center px-6 py-16">
        <div className="max-w-md text-center">
          <ShieldAlert className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-4 text-base font-medium">
            This site can’t be embedded
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {hostOf(url)} refuses to render inside another page
            (X-Frame-Options). Freman opens it externally instead — everything
            else keeps working right here.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Button asChild size="sm" className="rounded-full px-5">
              <a href={url} target="_blank" rel="noopener noreferrer">
                Open in a browser tab
                <ExternalLink className="ml-1.5 size-3.5" />
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full px-5"
              onClick={() => {
                setBlocked(false);
                setAttempt((a) => a + 1);
              }}
            >
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <iframe
      key={`${url}-${attempt}`}
      src={url}
      title={hostOf(url)}
      className="h-full min-h-[60vh] w-full border-0 bg-background"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer-when-downgrade"
      onLoad={() => {
        setBlocked(false);
        onLoaded();
      }}
    />
  );
}

/* ------------------------------- loading --------------------------------- */

function LoadingView({ query }: { query: string }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <p className="font-mono text-xs text-muted-foreground">
        Searching for “{query}”…
      </p>
      <div className="mt-8 flex flex-col gap-8">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2.5">
            <div className="h-3 w-32 animate-pulse rounded bg-muted" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-full animate-pulse rounded bg-muted/70" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------- highlight text ----------------------------- */

function HighlightText({ text, term }: { text: string; term: string }) {
  if (!term || term.length < 2) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const at = lower.indexOf(needle, i);
    if (at === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (at > i) parts.push(text.slice(i, at));
    parts.push(
      <mark
        key={key++}
        className="rounded-sm bg-amber-200/70 px-0.5 text-foreground dark:bg-amber-400/30"
      >
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    i = at + needle.length;
  }
  return <>{parts}</>;
}

/* ------------------------------- results --------------------------------- */

function ResultsView({
  entry,
  ensInstalled,
  onFilterChange,
  onRunSearch,
  onNavigate,
  findQuery,
}: {
  entry: SearchNav;
  ensInstalled: boolean;
  onFilterChange: (f: FilterId) => void;
  onRunSearch: (q: string) => void;
  onNavigate: (url: string) => void;
  findQuery: string;
}) {
  const navigate = useNavigate();

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      {/* filter chips + source meta */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => onFilterChange(f.id)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              entry.filter === f.id
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {entry.source === "live"
            ? "Live results · Brave Search"
            : "Sample results"}
        </span>
      </div>

      {entry.notice && (
        <div className="mt-4 rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
          {entry.notice}
        </div>
      )}

      {/* ENS name */}
      {ETH_RE.test(entry.query) && (
        <div className="mt-4 rounded-xl border border-border p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            {ensInstalled ? "Resolved via ENS Resolver" : "ENS name detected"}
          </p>
          <p className="mt-2 font-mono text-lg text-foreground">
            {entry.query}
          </p>
          {ensInstalled ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-3 rounded-full"
              onClick={() => onNavigate(`https://app.ens.domains/${entry.query}`)}
            >
              View on ENS
              <ExternalLink className="ml-1 size-3" />
            </Button>
          ) : (
            <div className="mt-3 flex items-center gap-3">
              <p className="text-xs text-muted-foreground">
                Install ENS Resolver from the Catalog to resolve .eth names
                directly.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 rounded-full"
                onClick={() => navigate("/dashboard")}
              >
                Open Catalog
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Wallet address */}
      {ADDRESS_RE.test(entry.query) && (
        <div className="mt-4 rounded-xl border border-border p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Wallet address
          </p>
          <p className="mt-2 break-all font-mono text-sm">{entry.query}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 rounded-full"
            onClick={() => onNavigate(`https://etherscan.io/address/${entry.query}`)}
          >
            View on Etherscan
            <ExternalLink className="ml-1 size-3" />
          </Button>
        </div>
      )}

      {/* Direct URL */}
      {URL_RE.test(entry.query) && !ETH_RE.test(entry.query) && (
        <div className="mt-4 rounded-xl border border-border p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Direct address
          </p>
          <p className="mt-2 break-all font-mono text-sm">{entry.query}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              className="rounded-full"
              onClick={() => onNavigate(entry.query)}
            >
              Open site
              <ExternalLink className="ml-1 size-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full text-muted-foreground"
              onClick={() => onRunSearch(entry.query)}
            >
              Search for this instead
            </Button>
          </div>
        </div>
      )}

      {/* Answer box */}
      {entry.answerBox && (
        <div className="mt-6 rounded-xl border border-border bg-muted/40 p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            {entry.answerBox.title || "Answer"}
          </p>
          <p className="mt-2 text-sm font-medium leading-6">
            <HighlightText text={entry.answerBox.answer} term={findQuery} />
          </p>
          {entry.answerBox.url && (
            <button
              onClick={() => onNavigate(entry.answerBox!.url!)}
              className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Source
              <ExternalLink className="size-3" />
            </button>
          )}
        </div>
      )}

      {/* Organic results */}
      <div className="mt-6">
        {(entry.results ?? []).length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No results for “{entry.query}”.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {(entry.results ?? []).map((result, i) => (
              <div key={`${result.url}-${i}`} className="py-4">
                <p className="font-mono text-[11px] text-muted-foreground">
                  {result.source}
                </p>
                <button
                  className="mt-1 block text-left text-[15px] font-medium leading-6 hover:underline"
                  onClick={() => onNavigate(result.url)}
                >
                  <HighlightText text={result.title} term={findQuery} />
                </button>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  <HighlightText text={result.snippet} term={findQuery} />
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------- wallet popover ----------------------------- */

function WalletPopover() {
  const navigate = useNavigate();
  const accounts = useQuery(api.wallet.listAccounts) ?? [];
  const connections = useQuery(api.wallet.listConnections) ?? [];
  const primary = accounts.find((a) => a.isPrimary) ?? accounts[0];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-foreground"
          title="Wallet — Wallet Provider"
        >
          <Wallet className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 rounded-xl">
        {primary ? (
          <>
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Wallet Provider
              </p>
              <span className="flex items-center gap-1.5 text-[11px] text-foreground">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Live
              </span>
            </div>
            <p className="mt-3 text-sm font-medium">{primary.label}</p>
            <button
              className="mt-1 flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
              title="Copy address"
              onClick={() => {
                navigator.clipboard
                  .writeText(primary.address)
                  .then(() => toast.success("Address copied"))
                  .catch(() => toast.error("Copy failed"));
              }}
            >
              {shorten(primary.address)}
              <Copy className="size-3" />
            </button>
            <div className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
              {connections.length} active dApp session
              {connections.length === 1 ? "" : "s"}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full rounded-full"
              onClick={() => navigate("/dashboard")}
            >
              Manage in Studio
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm font-medium">No wallet yet</p>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
              Create an account in the Studio to start connecting dApps and
              signing.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full rounded-full"
              onClick={() => navigate("/dashboard")}
            >
              Set up wallet
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

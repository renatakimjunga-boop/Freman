import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { FremanWordmark } from "@/components/FremanWordmark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Switch } from "@/components/ui/switch";
import { EXTENSION_SAMPLES } from "@/lib/extension-samples";
import { DAPPS } from "@/lib/dapps";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Globe,
  History,
  Home,
  Lock,
  Monitor,
  MonitorSmartphone,
  Moon,
  MoreVertical,
  Paintbrush,
  Plus,
  Puzzle,
  RotateCw,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Smartphone,
  Star,
  Store,
  Sun,
  Trash2,
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
  query: string;
  sent: string;
  filter: FilterId;
  page: number;
  hasMore: boolean;
  status: "loading" | "done" | "error";
  source?: "live" | "sample";
  engine?: string;
  notice?: string;
  answerBox?: AnswerBox | null;
  results?: WebResult[];
  error?: string;
}

interface SiteNav {
  kind: "site";
  url: string;
}

interface HomeNav {
  kind: "home";
}

interface SettingsNav {
  kind: "settings";
}

interface StoreNav {
  kind: "store";
}

type Nav = SearchNav | SiteNav | HomeNav | SettingsNav | StoreNav;

interface Tab {
  id: string;
  entries: Nav[];
  idx: number;
  loading: boolean;
  /** Per-tab device view: "desktop" renders full-width, "mobile" renders in a phone frame. */
  view: "desktop" | "mobile";
}

const URL_RE = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/i;
const ETH_RE = /^[a-z0-9-]+\.eth$/i;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** HTTP-actions host for the embeddable page proxy. */
const CONVEX_SITE_URL = ((import.meta.env.VITE_CONVEX_URL as string) ?? "").replace(
  ".convex.cloud",
  ".convex.site",
);

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

/** Proxy URL for a page, honoring the tab's device view. */
function proxiedUrl(url: string, view: "desktop" | "mobile"): string {
  const viewParam = view === "mobile" ? "&view=mobile" : "";
  return `${CONVEX_SITE_URL}/fetchProxy?url=${encodeURIComponent(url)}${viewParam}`;
}

function navDisplay(nav: Nav | undefined): string {
  if (!nav) return "";
  if (nav.kind === "site") return nav.url;
  if (nav.kind === "settings") return "freman://settings";
  if (nav.kind === "store") return "freman://store";
  if (nav.kind === "search") return nav.query;
  return "";
}

function navTitle(nav: Nav): string {
  if (nav.kind === "home") return "New Tab";
  if (nav.kind === "settings") return "Settings";
  if (nav.kind === "store") return "Chrome Web Store";
  if (nav.kind === "site") return hostOf(nav.url);
  return nav.query;
}

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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

function newTab(view: "desktop" | "mobile" = "desktop"): Tab {
  return {
    id: Math.random().toString(36).slice(2),
    entries: [{ kind: "home" }],
    idx: 0,
    loading: false,
    view,
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
  const settings = useQuery(api.settings.get);
  const history = useQuery(api.history.list, { limit: 12 }) ?? [];
  const bookmarks = useQuery(api.bookmarks.list) ?? [];

  const updateSettings = useMutation(api.settings.update);
  const recordVisit = useMutation(api.history.record);
  const clearHistory = useMutation(api.history.clear);
  const removeHistory = useMutation(api.history.remove);
  const addBookmark = useMutation(api.bookmarks.add);
  const removeBookmark = useMutation(api.bookmarks.remove);

  const [tabs, setTabs] = useState<Tab[]>([newTab()]);
  const [activeId, setActiveId] = useState(() => tabs[0].id);
  const [draft, setDraft] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [now, setNow] = useState(() => new Date());
  const omniboxRef = useRef<HTMLInputElement>(null);

  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const current =
    activeTab.idx >= 0 ? activeTab.entries[activeTab.idx] : undefined;

  /** New tabs open with the user's default device view, once settings arrive. */
  const defaultView = settings?.defaultView ?? "desktop";
  useEffect(() => {
    setTabs((ts) =>
      ts.map((t) =>
        t.entries.length === 1 && t.entries[0].kind === "home"
          ? { ...t, view: defaultView }
          : t,
      ),
    );
  }, [defaultView]);

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

  async function runSearch(
    tabId: string,
    rawQuery: string,
    filter: FilterId,
    page: number,
  ) {
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
          page,
          hasMore: false,
          status: "loading",
        });
        entryIndex = entries.length - 1;
        return { ...t, entries, idx: entries.length - 1 };
      }),
    );

    try {
      const res = await searchWeb({
        query: sent,
        page,
        count: Number(settings?.resultsPerPage ?? 10),
        safeSearch: settings?.safeSearch ?? false,
      });
      patchSearch(tabId, entryIndex, {
        status: "done",
        source: res.source,
        engine: res.engine,
        notice: res.notice,
        answerBox: res.answerBox,
        results: res.results,
        page: res.page,
        hasMore: res.hasMore,
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

  /** Omnibox submit — classify like Chrome: internal page, URL, or search. */
  function submitOmnibox() {
    const raw = draft.trim();
    if (!raw) return;
    const tabId = activeTab.id;
    if (raw === "freman://settings") {
      pushNav(tabId, { kind: "settings" });
    } else if (raw === "freman://store") {
      pushNav(tabId, { kind: "store" });
    } else if (raw === "freman://home") {
      pushNav(tabId, { kind: "home" });
    } else if (ETH_RE.test(raw) || ADDRESS_RE.test(raw) || !URL_RE.test(raw)) {
      void runSearch(tabId, raw, "all", 1);
    } else {
      pushNav(tabId, { kind: "site", url: normalizeUrl(raw) });
    }
  }

  function openInTab(url: string) {
    pushNav(activeTab.id, { kind: "site", url: normalizeUrl(url) });
  }

  function runQuery(query: string) {
    void runSearch(activeTab.id, query, "all", 1);
  }

  function changeFilter(filter: FilterId) {
    if (current?.kind !== "search") return;
    void runSearch(activeTab.id, current.query, filter, 1);
  }

  function gotoPage(page: number) {
    if (current?.kind !== "search") return;
    void runSearch(activeTab.id, current.query, current.filter, page);
  }

  function reload() {
    if (!current) return;
    if (current.kind === "search") {
      void runSearch(activeTab.id, current.query, current.filter, current.page);
    } else if (current.kind === "site") {
      setTabs((ts) =>
        ts.map((t) => (t.id === activeTab.id ? { ...t, loading: true } : t)),
      );
    }
  }

  function goHome() {
    const homepage = settings?.homepage ?? "freman://home";
    if (homepage === "freman://home") {
      pushNav(activeTab.id, { kind: "home" });
    } else {
      openInTab(homepage);
    }
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
    const tab = newTab(defaultView);
    setTabs((ts) => [...ts, tab]);
    setActiveId(tab.id);
    setDraft("");
  }

  /** Toggle the active tab between desktop and mobile device views. */
  function toggleView() {
    const next = activeTab.view === "desktop" ? "mobile" : "desktop";
    setTabs((ts) =>
      ts.map((t) => (t.id === activeTab.id ? { ...t, view: next } : t)),
    );
    toast(`View: ${next}`, { duration: 1200 });
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

  /* -------------------------------- theme --------------------------------- */

  const theme = settings?.theme ?? "dark";

  function cycleTheme() {
    const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    void updateSettings({ theme: next });
    toast(`Theme: ${next}`, { duration: 1200 });
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
    if (bookmarked) {
      const match = bookmarks.find((b) => b.url === currentBookmarkUrl);
      if (!match) return;
      void removeBookmark({ id: match._id });
      toast("Bookmark removed");
      return;
    }
    const label =
      current.kind === "site"
        ? hostOf(current.url)
        : current.kind === "search"
          ? `Search: ${current.query}`
          : "New Tab";
    void addBookmark({ label, url: currentBookmarkUrl });
    toast.success("Bookmark added");
  }

  /* ------------------------------- history -------------------------------- */

  // Record visits for real sites and completed searches.
  const visitKey = current
    ? `${current.kind}:${navDisplay(current)}:${
        current.kind === "search" ? current.status : ""
      }`
    : "none";
  useEffect(() => {
    if (!settings?.saveHistory || !current) return;
    if (current.kind === "site") {
      void recordVisit({ url: current.url, title: hostOf(current.url) });
    } else if (current.kind === "search" && current.status === "done") {
      void recordVisit({
        url: `freman://search?q=${encodeURIComponent(current.query)}`,
        title: current.query,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitKey, settings?.saveHistory]);

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
      } else if (e.key === "m" && e.shiftKey) {
        e.preventDefault();
        toggleView();
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
    ) : current?.kind === "settings" ? (
      <SettingsIcon className="size-3.5 text-muted-foreground" />
    ) : (
      <Globe className="size-3.5 text-muted-foreground" />
    );

  const ThemeIcon = theme === "dark" ? Moon : theme === "system" ? Monitor : Sun;
  const ViewIcon = activeTab.view === "mobile" ? Smartphone : MonitorSmartphone;

  const omnibox = (
    <form
      className="order-last w-full sm:order-none sm:mx-2 sm:w-auto sm:flex-1 sm:min-w-0 sm:max-w-2xl"
      onSubmit={(e) => {
        e.preventDefault();
        submitOmnibox();
      }}
    >
      <div className="flex h-9 items-center gap-2 rounded-full border border-border bg-background px-3.5 transition-colors focus-within:border-foreground/50">
        {omniboxIcon}
        {current?.kind === "site" && (
          <span className="hidden shrink-0 items-center gap-1 border-r border-border pr-2 text-xs text-muted-foreground lg:flex">
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
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-muted/40 text-foreground">
      {/* ── Tab strip (desktop) ───────────────────────────────────────── */}
      <div className="hidden items-end gap-1 px-3 pt-2 sm:flex">
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
                ) : nav && nav.kind === "settings" ? (
                  <SettingsIcon className="size-3.5 shrink-0" />
                ) : (
                  <Home className="size-3.5 shrink-0" />
                )}
                <button
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => {
                    setActiveId(tab.id);
                    setDraft(navDisplay(tab.entries[tab.idx]));
                  }}
                  title={navTitle(nav ?? { kind: "home" })}
                >
                  {navTitle(nav ?? { kind: "home" })}
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
      <div className="relative flex flex-wrap items-center gap-1 border-b border-border bg-card px-3 py-2 sm:flex-nowrap">
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
          className="hidden size-8 text-muted-foreground hover:text-foreground sm:inline-flex"
          disabled={activeTab.idx >= activeTab.entries.length - 1}
          onClick={() => go(1)}
          title="Forward"
        >
          <ArrowRight className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="hidden size-8 text-muted-foreground hover:text-foreground sm:inline-flex"
          disabled={!current || current.kind === "home" || current.kind === "settings"}
          onClick={reload}
          title="Reload"
        >
          <RotateCw className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="hidden size-8 text-muted-foreground hover:text-foreground sm:inline-flex"
          onClick={goHome}
          title="Home"
        >
          <Home className="size-4" />
        </Button>

        {omnibox}

        {/* Theme quick toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="hidden size-8 text-muted-foreground hover:text-foreground sm:inline-flex"
          onClick={cycleTheme}
          title={`Theme: ${theme} (light → dark → system)`}
        >
          <ThemeIcon className="size-4" />
        </Button>

        {/* Device view toggle: desktop ↔ mobile */}
        <Button
          variant="ghost"
          size="icon"
          className={`hidden size-8 hover:text-foreground sm:inline-flex ${
            activeTab.view === "mobile"
              ? "text-foreground"
              : "text-muted-foreground"
          }`}
          onClick={toggleView}
          title={`Device view: ${activeTab.view} (click to switch)`}
        >
          <ViewIcon className="size-4" />
        </Button>

        {/* Extensions (desktop) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="hidden size-8 text-muted-foreground hover:text-foreground sm:inline-flex"
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
            <DropdownMenuItem
              onSelect={() => pushNav(activeTab.id, { kind: "store" })}
              className="gap-2"
            >
              <Store className="size-4" />
              Browse the Chrome Web Store
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate("/dashboard")}>
              Manage extensions
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {walletInstalled && <WalletPopover />}

        {/* Store */}
        <Button
          variant="ghost"
          size="icon"
          className="hidden size-8 text-muted-foreground hover:text-foreground sm:inline-flex"
          title="Chrome Web Store"
          onClick={() => pushNav(activeTab.id, { kind: "store" })}
        >
          <Store className="size-4" />
        </Button>

        {/* Profile */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="grid size-7 shrink-0 place-items-center rounded-full bg-foreground text-[11px] font-semibold text-background"
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
            {/* Mobile-only: navigation + tab list */}
            <div className="sm:hidden">
              <DropdownMenuItem
                onSelect={() => go(-1)}
                disabled={activeTab.idx <= 0}
              >
                Back
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => go(1)}
                disabled={activeTab.idx >= activeTab.entries.length - 1}
              >
                Forward
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={reload}>Reload</DropdownMenuItem>
              <DropdownMenuItem onSelect={goHome}>Home</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Tabs</DropdownMenuLabel>
              {tabs.map((tab) => (
                <DropdownMenuCheckboxItem
                  key={tab.id}
                  checked={tab.id === activeId}
                  onCheckedChange={() => {
                    setActiveId(tab.id);
                    setDraft(navDisplay(tab.entries[tab.idx]));
                  }}
                  className="text-xs"
                >
                  <span className="truncate">{navTitle(tab.entries[tab.idx] ?? { kind: "home" })}</span>
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuItem onSelect={openNewTab}>
                <Plus className="size-3.5" /> New tab
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </div>

            <DropdownMenuItem onSelect={openNewTab}>
              New tab
              <DropdownMenuShortcut>⌘T</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setFindOpen((o) => !o)}>
              Find in page…
              <DropdownMenuShortcut>⌘F</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={goHome}>
              Browser home
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Appearance</DropdownMenuLabel>
            {(["light", "dark", "system"] as const).map((t) => (
              <DropdownMenuCheckboxItem
                key={t}
                checked={theme === t}
                onCheckedChange={() => void updateSettings({ theme: t })}
                className="capitalize"
              >
                {t} theme
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuItem onSelect={toggleView}>
              <ViewIcon className="size-3.5" />
              {activeTab.view === "desktop" ? "Mobile view" : "Desktop site"}
              <DropdownMenuShortcut>⇧⌘M</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Search</DropdownMenuLabel>
            {FILTERS.map((f) => (
              <DropdownMenuCheckboxItem
                key={f.id}
                checked={(settings?.searchFilter ?? "all") === f.id}
                onCheckedChange={() => void updateSettings({ searchFilter: f.id })}
              >
                {f.label} results
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuCheckboxItem
              checked={settings?.safeSearch ?? false}
              onCheckedChange={(v) => void updateSettings({ safeSearch: v })}
            >
              SafeSearch
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={settings?.saveHistory ?? true}
              onCheckedChange={(v) => void updateSettings({ saveHistory: v })}
            >
              Save browsing history
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => pushNav(activeTab.id, { kind: "settings" })}
            >
              <SettingsIcon className="size-3.5" /> Settings
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                void clearHistory();
                toast.success("Browsing history cleared");
              }}
            >
              <Trash2 className="size-3.5" /> Clear browsing data
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
            <div className="freman-loading-bar h-full w-1/3" />
          </div>
        )}
      </div>

      {/* ── Bookmarks bar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border bg-card px-3 py-1.5">
        {(bookmarks.length > 0
          ? bookmarks
          : DEFAULT_BOOKMARKS.map((b, i) => ({ ...b, _id: `default-${i}` }))
        ).map((b) => (
          <button
            key={b.url}
            className="flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
        {!current || current.kind === "home" ? (
          <BrowserHome
            onSearch={runQuery}
            onNavigate={openInTab}
            onOpenSettings={() => pushNav(activeTab.id, { kind: "settings" })}
            userName={user?.name ?? undefined}
            history={history}
            saveHistory={settings?.saveHistory ?? true}
            onRemoveHistory={(id) => void removeHistory({ id })}
            onClearHistory={() => {
              void clearHistory();
              toast.success("Browsing history cleared");
            }}
          />
        ) : current.kind === "settings" ? (
          <SettingsPage
            settings={settings}
            onUpdate={(patch) => void updateSettings(patch)}
            canSetHome={
              current.kind === "settings" ? null : null
            }
            onNavigate={openInTab}
            onGoHome={() => pushNav(activeTab.id, { kind: "home" })}
          />
        ) : current.kind === "store" ? (
          <StorePage onNavigate={openInTab} />
        ) : current.kind === "site" ? (
          <SiteView
            url={current.url}
            view={activeTab.view}
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
          <div className="px-6 py-16 text-center">
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
            onPageChange={gotoPage}
            findQuery={findOpen ? findQuery.trim() : ""}
          />
        )}
      </div>

      {/* ── Status bar (desktop) ──────────────────────────────────────── */}
      <div className="hidden items-center justify-between border-t border-border bg-card px-4 py-1 font-mono text-[11px] text-muted-foreground sm:flex">
        <span className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-red-500" />
          ETH · Mainnet
          <span className="text-border">|</span>
          Freman 1.0
        </span>
        <span className="max-w-[50%] truncate">
          {current ? navDisplay(current) || "New Tab" : "New Tab"}
        </span>
        <span>
          {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </div>
  );
}

/* ----------------------------- browser home ------------------------------ */

import type { Doc } from "@/convex/_generated/dataModel";

type HistoryEntry = Doc<"browserHistory">;

function BrowserHome({
  onSearch,
  onNavigate,
  onOpenSettings,
  userName,
  history,
  saveHistory,
  onRemoveHistory,
  onClearHistory,
}: {
  onSearch: (query: string) => void;
  onNavigate: (url: string) => void;
  onOpenSettings: () => void;
  userName?: string;
  history: HistoryEntry[];
  saveHistory: boolean;
  onRemoveHistory: (id: HistoryEntry["_id"]) => void;
  onClearHistory: () => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  return (
    <div className="w-full px-4 pb-16 pt-[8vh] sm:px-8 lg:px-14">
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

      {/* Recent activity — real-time from Convex */}
      <div className="mt-10">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Recent activity
          </p>
          {history.length > 0 && (
            <button
              onClick={onClearHistory}
              className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Clear all
            </button>
          )}
        </div>
        <div className="mt-3 overflow-hidden rounded-xl border border-border">
          {!saveHistory ? (
            <button
              onClick={onOpenSettings}
              className="flex w-full items-center justify-between px-4 py-3 text-xs text-muted-foreground transition-colors hover:bg-muted/60"
            >
              History is paused — turn it back on in Settings
              <SettingsIcon className="size-3.5" />
            </button>
          ) : history.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              Pages you visit will appear here.
            </p>
          ) : (
            history.map((entry, i) => (
              <div
                key={entry._id}
                className={`group flex items-center gap-3 px-4 py-2.5 ${
                  i > 0 ? "border-t border-border" : ""
                }`}
              >
                {entry.url.startsWith("http") ? (
                  <img
                    src={faviconOf(entry.url)}
                    alt=""
                    className="size-3.5 shrink-0 rounded-sm"
                    onError={(e) => {
                      e.currentTarget.style.visibility = "hidden";
                    }}
                  />
                ) : (
                  <Search className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <button
                  className="min-w-0 flex-1 truncate text-left text-sm transition-colors hover:text-foreground"
                  onClick={() =>
                    entry.url.startsWith("http")
                      ? onNavigate(entry.url)
                      : onSearch(
                          new URL(entry.url).searchParams.get("q") ?? "",
                        )
                  }
                  title={entry.url}
                >
                  {entry.title}
                </button>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {timeAgo(entry.visitedAt)}
                </span>
                <button
                  aria-label="Remove entry"
                  className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                  onClick={() => onRemoveHistory(entry._id)}
                >
                  <X className="size-3" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mt-8">
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

/* ------------------------------- settings -------------------------------- */

function SettingsPage({
  settings,
  onUpdate,
  onNavigate,
  onGoHome,
}: {
  settings:
    | {
        theme: "light" | "dark" | "system";
        searchFilter: "all" | "web3" | "docs";
        safeSearch: boolean;
        saveHistory: boolean;
        homepage: string;
        resultsPerPage: "10" | "20" | "30";
        defaultView: "desktop" | "mobile";
      }
    | undefined;
  onUpdate: (patch: {
    theme?: "light" | "dark" | "system";
    searchFilter?: "all" | "web3" | "docs";
    safeSearch?: boolean;
    saveHistory?: boolean;
    homepage?: string;
    resultsPerPage?: "10" | "20" | "30";
    defaultView?: "desktop" | "mobile";
  }) => void;
  canSetHome: string | null;
  onNavigate: (url: string) => void;
  onGoHome: () => void;
}) {
  const theme = settings?.theme ?? "light";

  const Row = ({
    title,
    description,
    children,
  }: {
    title: string;
    description: string;
    children: React.ReactNode;
  }) => (
    <div className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );

  const Segmented = <T extends string>({
    value,
    options,
    onChange,
  }: {
    value: T;
    options: { id: T; label: string }[];
    onChange: (id: T) => void;
  }) => (
    <div className="inline-flex overflow-hidden rounded-lg border border-border">
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => onChange(opt.id)}
          className={`px-3.5 py-1.5 text-xs transition-colors ${
            value === opt.id
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="w-full px-4 pb-16 pt-8 sm:px-8 lg:px-14">
      <div className="flex items-center gap-2.5">
        <SettingsIcon className="size-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Changes apply instantly, on every device you sign in from.
      </p>

      {/* Appearance */}
      <div className="mt-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Appearance
        </p>
        <div className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
          <Row
            title="Theme"
            description="Light, dark, or follow your operating system."
          >
            <Segmented
              value={theme}
              options={[
                { id: "light", label: "Light" },
                { id: "dark", label: "Dark" },
                { id: "system", label: "System" },
              ]}
              onChange={(id) => onUpdate({ theme: id })}
            />
          </Row>
        </div>
      </div>

      {/* Search */}
      <div className="mt-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Search engine
        </p>
        <div className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
          <Row
            title="Default filter"
            description="Applied to searches started from the home page."
          >
            <Segmented
              value={settings?.searchFilter ?? "all"}
              options={FILTERS.map((f) => ({ id: f.id, label: f.label }))}
              onChange={(id) => onUpdate({ searchFilter: id })}
            />
          </Row>
          <Row
            title="SafeSearch"
            description="Filter explicit content out of Brave results."
          >
            <Switch
              checked={settings?.safeSearch ?? false}
              onCheckedChange={(v) => onUpdate({ safeSearch: v })}
            />
          </Row>
          <Row
            title="Results per page"
            description="How many results to load per page."
          >
            <Segmented
              value={settings?.resultsPerPage ?? "10"}
              options={[
                { id: "10", label: "10" },
                { id: "20", label: "20" },
                { id: "30", label: "30" },
              ]}
              onChange={(id) => onUpdate({ resultsPerPage: id })}
            />
          </Row>
        </div>
      </div>

      {/* Privacy */}
      <div className="mt-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Privacy
        </p>
        <div className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border">
          <Row
            title="Save browsing history"
            description="Keep visited pages on your home page. Stored privately in your account."
          >
            <Switch
              checked={settings?.saveHistory ?? true}
              onCheckedChange={(v) => onUpdate({ saveHistory: v })}
            />
          </Row>
          <Row
            title="Default device view"
            description="New tabs open in desktop view, or in a phone-sized mobile view."
          >
            <Segmented
              value={settings?.defaultView ?? "desktop"}
              options={[
                { id: "desktop", label: "Desktop" },
                { id: "mobile", label: "Mobile" },
              ]}
              onChange={(id) => onUpdate({ defaultView: id })}
            />
          </Row>
          <Row
            title="Homepage"
            description={
              settings?.homepage && settings.homepage !== "freman://home"
                ? `Opens to ${hostOf(settings.homepage)}`
                : "Opens to the Freman home page."
            }
          >
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={onGoHome}
            >
              <Home className="size-3.5" />
              Preview
            </Button>
          </Row>
        </div>
      </div>

      {/* About */}
      <div className="mt-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          About
        </p>
        <div className="mt-3 overflow-hidden rounded-xl border border-border">
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <p className="text-sm font-medium">Freman 1.0</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                The Web3 browser, for everyone.
              </p>
            </div>
            <span className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 font-mono text-[11px] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-red-500" />
              Brave · live
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- site view ------------------------------- */

function SiteView({
  url,
  view,
  onLoaded,
}: {
  url: string;
  view: "desktop" | "mobile";
  onLoaded: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [showChip, setShowChip] = useState(true);
  const [attempt, setAttempt] = useState(0);

  // Pages are fetched through Freman's own proxy, which strips
  // X-Frame-Options / CSP frame-ancestors — so sites can't refuse to load.
  // Mobile view also sends a phone user-agent, so sites serve their mobile web.
  const proxiedSrc = proxiedUrl(url, view);

  useEffect(() => {
    setLoaded(false);
    setSlow(false);
    setShowChip(true);
    const timer = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(timer);
  }, [url, view, attempt]);

  const iframe = (
    <iframe
      key={`${url}-${view}-${attempt}`}
      src={proxiedSrc}
      title={hostOf(url)}
      className="h-full w-full border-0 bg-background transition-opacity"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer-when-downgrade"
      onLoad={() => {
        setLoaded(true);
        onLoaded();
      }}
    />
  );

  const loadingOverlay = (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="flex flex-col items-center gap-3">
        <img
          src={faviconOf(url)}
          alt=""
          className="size-6 rounded opacity-60"
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
        />
        <p className="font-mono text-xs text-muted-foreground">
          Loading {hostOf(url)}…
        </p>
      </div>
    </div>
  );

  const proxyChip = loaded && showChip && (
    <div className="absolute bottom-3 right-3 flex items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
      <ShieldCheck className="size-3.5" />
      <span className="hidden sm:inline">Opened through Freman’s proxy</span>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 transition-colors hover:text-foreground"
      >
        Open original
        <ExternalLink className="size-3" />
      </a>
      <button
        aria-label="Dismiss"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => setShowChip(false)}
      >
        <X className="size-3" />
      </button>
    </div>
  );

  const slowChip = slow && !loaded && (
    <div className="absolute bottom-3 right-3 flex items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
      Still loading — some sites are slow through the proxy.
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 transition-colors hover:text-foreground"
      >
        Open directly
        <ExternalLink className="size-3" />
      </a>
    </div>
  );

  // Mobile view: the page renders inside a phone frame with a device status
  // bar, and was fetched with a mobile user-agent (via ?view=mobile).
  if (view === "mobile") {
    return (
      <div className="flex h-full min-h-[70vh] w-full justify-center bg-muted/40 p-3 sm:p-6">
        <div className="h-fit w-full max-w-[392px]">
          <div className="overflow-hidden rounded-[2.4rem] border border-border bg-black shadow-2xl">
            {/* Status bar */}
            <div className="relative flex h-10 items-center justify-center bg-black">
              <span className="absolute left-6 text-[11px] font-semibold text-white">
                9:41
              </span>
              <span className="h-6 w-24 rounded-full bg-white" />
              <span className="absolute right-5 flex items-center gap-1.5 text-white">
                <svg viewBox="0 0 18 12" className="h-3 w-4 fill-current">
                  <rect x="0" y="8" width="3" height="4" rx="0.5" />
                  <rect x="5" y="5.5" width="3" height="6.5" rx="0.5" />
                  <rect x="10" y="3" width="3" height="9" rx="0.5" />
                  <rect x="15" y="0" width="3" height="12" rx="0.5" />
                </svg>
                <svg viewBox="0 0 25 12" className="h-3 w-6">
                  <rect
                    x="0.5"
                    y="0.5"
                    width="21"
                    height="11"
                    rx="3"
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity="0.5"
                  />
                  <rect x="2" y="2" width="18" height="8" rx="1.8" fill="currentColor" />
                  <rect x="23" y="4" width="2" height="4" rx="1" fill="currentColor" fillOpacity="0.5" />
                </svg>
              </span>
            </div>
            {/* Screen */}
            <div className="relative h-[68vh] max-h-[720px] min-h-[440px]">
              {!loaded && loadingOverlay}
              {iframe}
              {slowChip}
            </div>
            {/* Home indicator */}
            <div className="flex h-6 items-center justify-center bg-black">
              <span className="h-1 w-28 rounded-full bg-white/80" />
            </div>
          </div>
          {proxyChip}
        </div>
      </div>
    );
  }

  // Desktop view: the page uses the full width of the browser window.
  return (
    <div className="relative h-full min-h-[60vh] w-full">
      {!loaded && loadingOverlay}
      {iframe}
      {proxyChip}
      {slowChip}
    </div>
  );
}

/* --------------------------- chrome web store ---------------------------- */

interface StoreCard {
  id: string;
  name: string;
  publisher: string | null;
  rating: number | null;
  icon: string | null;
  url: string;
}

const STORE_DEFAULT_QUERIES = [
  "web3 wallet",
  "blockchain",
  "nft",
  "crypto",
  "defi",
];

function StorePage({ onNavigate }: { onNavigate: (url: string) => void }) {
  const searchStore = useAction(api.webstore.search);

  const [query, setQuery] = useState("");
  const [term, setTerm] = useState<string | null>(null);
  const [results, setResults] = useState<StoreCard[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const run = (q: string) => {
    setTerm(q);
    setStatus("loading");
    setError(null);
    searchStore({ query: q, limit: 18 })
      .then((res) => {
        setResults((res as { results: StoreCard[] }).results);
        setStatus("done");
      })
      .catch((e: unknown) => {
        setError(
          e instanceof Error ? e.message : "Could not reach the Chrome Web Store",
        );
        setStatus("error");
      });
  };

  useEffect(() => {
    run("web3 wallet");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="w-full px-4 py-8 sm:px-8 sm:py-10 lg:px-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Chrome Web Store
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live from Google — every extension listed in the store, rated and
            ranked exactly as the store ranks them.
          </p>
        </div>
        <form
          className="flex w-full max-w-md items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const q = query.trim();
            if (q) run(q);
          }}
        >
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search extensions, themes…"
            className="h-10 flex-1"
          />
          <Button type="submit" className="h-10 rounded-full px-5">
            Search
          </Button>
        </form>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {STORE_DEFAULT_QUERIES.map((q) => (
          <button
            key={q}
            onClick={() => {
              setQuery(q);
              run(q);
            }}
            className={`rounded-full border px-3.5 py-1.5 text-xs transition-colors ${
              term === q
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            }`}
          >
            {q}
          </button>
        ))}
      </div>

      {status === "loading" && (
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-xl border border-border bg-muted/40"
            />
          ))}
        </div>
      )}

      {status === "error" && (
        <div className="mt-10 rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button
            variant="outline"
            className="mt-6 rounded-full px-6"
            onClick={() => term && run(term)}
          >
            Try again
          </Button>
        </div>
      )}

      {status === "done" && (
        <>
          <p className="mt-8 font-mono text-[11px] text-muted-foreground">
            {results.length} live result{results.length === 1 ? "" : "s"}
            {term ? ` for “${term}”` : ""} · chromewebstore.google.com
          </p>
          {results.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
              No store results for “{term}”.
            </div>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((card) => (
                <div
                  key={card.id}
                  className="flex flex-col rounded-xl border border-border p-5 transition-colors hover:border-foreground/30"
                >
                  <div className="flex items-start gap-3">
                    {card.icon ? (
                      <img
                        src={card.icon}
                        alt=""
                        className="size-12 rounded-lg"
                        onError={(e) => {
                          e.currentTarget.style.visibility = "hidden";
                        }}
                      />
                    ) : (
                      <div className="grid size-12 shrink-0 place-items-center rounded-lg bg-muted">
                        <Puzzle className="size-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-medium" title={card.name}>
                        {card.name}
                      </h3>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {card.publisher ?? "Unknown publisher"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                    {card.rating !== null ? (
                      <>
                        <Star className="size-3.5 fill-current" />
                        {card.rating.toFixed(1)}
                      </>
                    ) : (
                      <span>No ratings yet</span>
                    )}
                  </div>
                  <div className="mt-5 flex items-center gap-2 border-t border-border pt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 rounded-full"
                      onClick={() => onNavigate(card.url)}
                    >
                      View in browser
                    </Button>
                    <a
                      href={card.url}
                      target="_blank"
                      rel="noreferrer"
                      className="grid size-8 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
                      title="Open on chromewebstore.google.com"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------- loading --------------------------------- */

function LoadingView({ query }: { query: string }) {
  return (
    <div className="w-full px-4 py-10 sm:px-8">
      <p className="font-mono text-xs text-muted-foreground">
        Searching for “{query}”…
      </p>
      <div className="mt-8 flex flex-col gap-8">
        {[0, 1, 2, 3, 4].map((i) => (
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
  onPageChange,
  findQuery,
}: {
  entry: SearchNav;
  ensInstalled: boolean;
  onFilterChange: (f: FilterId) => void;
  onRunSearch: (q: string) => void;
  onNavigate: (url: string) => void;
  onPageChange: (page: number) => void;
  findQuery: string;
}) {
  const navigate = useNavigate();

  return (
    <div className="w-full px-4 py-6 sm:px-8 sm:py-8">
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
            ? `Live results · ${entry.engine ?? "Freman live index"}`
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
            <div className="mt-3 flex flex-wrap items-center gap-3">
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

      {/* Pagination */}
      {(entry.results ?? []).length > 0 && (
        <div className="mt-8 flex items-center justify-between border-t border-border pt-4">
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            disabled={entry.page <= 1}
            onClick={() => onPageChange(entry.page - 1)}
          >
            <ChevronLeft className="size-3.5" />
            Previous
          </Button>
          <span className="font-mono text-xs text-muted-foreground">
            Page {entry.page}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            disabled={!entry.hasMore}
            onClick={() => onPageChange(entry.page + 1)}
          >
            Next
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------- wallet popover ----------------------------- */

function WalletPopover() {
  const navigate = useNavigate();
  const accounts = useQuery(api.wallet.listAccounts) ?? [];
  const connections = useQuery(api.wallet.listConnections) ?? [];
  const getBalance = useAction(api.custodialWallet.getBalance);
  const primary = accounts.find((a) => a.isPrimary) ?? accounts[0];
  const [balance, setBalance] = useState<string | null>(null);

  useEffect(() => {
    if (!primary) return;
    let cancelled = false;
    getBalance({ address: primary.address, chain: "sepolia" })
      .then((res) => {
        if (!cancelled) setBalance(Number(res.balanceEth).toFixed(5));
      })
      .catch(() => {
        if (!cancelled) setBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [primary, getBalance]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="hidden size-8 text-muted-foreground hover:text-foreground sm:inline-flex"
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
                <span className="size-1.5 rounded-full bg-red-500" />
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
            <p className="mt-3 font-mono text-lg">
              {balance === null ? "…" : balance + " ETH"}
            </p>
            <p className="text-[11px] text-muted-foreground">Live balance · Sepolia testnet</p>
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
              Send & manage in Studio
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm font-medium">No wallet yet</p>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
              Create a custodial account in the Studio — Freman generates a real
              keypair and encrypts the private key before storing.
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

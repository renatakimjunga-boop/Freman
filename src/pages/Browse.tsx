import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { FremanWordmark } from "@/components/FremanWordmark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Copy,
  ExternalLink,
  Globe,
  Paintbrush,
  Plus,
  Puzzle,
  RotateCw,
  Search,
  ShieldCheck,
  Video,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

/* ------------------------------ search model ----------------------------- */

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

interface SearchEntry {
  query: string; // what the user typed (displayed)
  sent: string; // what was sent to the engine (filter applied)
  status: "loading" | "done" | "error";
  source?: "live" | "sample";
  notice?: string;
  answerBox?: AnswerBox | null;
  results?: WebResult[];
  error?: string;
}

interface Tab {
  id: string;
  entries: SearchEntry[];
  idx: number; // -1 = new tab page
}

const FILTERS = [
  { id: "all", label: "All" },
  { id: "web3", label: "Web3" },
  { id: "docs", label: "Developer docs" },
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

function applyFilter(query: string, filter: FilterId): string {
  if (filter === "web3") {
    return `${query} (web3 OR crypto OR blockchain)`;
  }
  if (filter === "docs") {
    return `${query} (site:chromium.org OR site:developer.chrome.com OR site:github.com)`;
  }
  return query;
}

const URL_RE = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/i;
const ETH_RE = /^[a-z0-9-]+\.eth$/i;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function shorten(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const EXTENSION_ICONS: Record<string, typeof Puzzle> = {
  "wallet-provider": Wallet,
  "ens-resolver": Globe,
  "signature-guard": ShieldCheck,
  "tab-capture": Video,
  "page-redder": Paintbrush,
};

function newTab(): Tab {
  return {
    id: Math.random().toString(36).slice(2),
    entries: [],
    idx: -1,
  };
}

/* ------------------------------ the browser ------------------------------ */

export default function Browse() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const searchWeb = useAction(api.search.searchWeb);

  const installed = useQuery(api.extensions.listInstalled) ?? [];
  const accounts = useQuery(api.wallet.listAccounts) ?? [];
  const connections = useQuery(api.wallet.listConnections) ?? [];

  const [tabs, setTabs] = useState<Tab[]>([newTab()]);
  const [activeId, setActiveId] = useState(() => tabs[0].id);
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");

  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const current =
    activeTab.idx >= 0 ? activeTab.entries[activeTab.idx] : undefined;

  // Keep the omnibox in sync with the active entry (back/forward/tab switch).
  useEffect(() => {
    setDraft(activeTab.idx >= 0 ? (activeTab.entries[activeTab.idx]?.query ?? "") : "");
  }, [activeId, activeTab.idx, activeTab.entries]); // eslint-disable-line react-hooks/exhaustive-deps

  const enabledSampleIds = new Set(
    installed.filter((e) => e.enabled).map((e) => e.sampleId),
  );
  const activeExtensions = EXTENSION_SAMPLES.filter((s) =>
    enabledSampleIds.has(s.id),
  );
  const ensInstalled = enabledSampleIds.has("ens-resolver");
  const walletInstalled = enabledSampleIds.has("wallet-provider");
  const primaryAccount = accounts.find((a) => a.isPrimary) ?? accounts[0];

  async function runSearch(rawQuery: string) {
    const query = rawQuery.trim();
    if (!query) return;

    const tabId = activeId;
    const entry: SearchEntry = {
      query,
      sent: applyFilter(query, filter),
      status: "loading",
    };

    setTabs((ts) =>
      ts.map((t) =>
        t.id === tabId
          ? {
              ...t,
              entries: [...t.entries.slice(0, t.idx + 1), entry],
              idx: t.idx + 1,
            }
          : t,
      ),
    );

    try {
      const res = await searchWeb({ query: entry.sent });
      setTabs((ts) =>
        ts.map((t) =>
          t.id === tabId
            ? {
                ...t,
                entries: t.entries.map((e, i) =>
                  i === t.idx
                    ? {
                        ...e,
                        status: "done",
                        source: res.source,
                        notice: res.notice,
                        answerBox: res.answerBox,
                        results: res.results,
                      }
                    : e,
                ),
              }
            : t,
        ),
      );
    } catch (err) {
      setTabs((ts) =>
        ts.map((t) =>
          t.id === tabId
            ? {
                ...t,
                entries: t.entries.map((e, i) =>
                  i === t.idx
                    ? {
                        ...e,
                        status: "error",
                        error:
                          err instanceof Error
                            ? err.message
                            : "Search failed — please try again.",
                      }
                    : e,
                ),
              }
            : t,
        ),
      );
    }
  }

  function reload() {
    if (!current) return;
    void runSearch(current.query);
  }

  function go(delta: number) {
    setTabs((ts) =>
      ts.map((t) =>
        t.id === activeId
          ? { ...t, idx: Math.min(Math.max(t.idx + delta, -1), t.entries.length - 1) }
          : t,
      ),
    );
  }

  function openNewTab() {
    const tab = newTab();
    setTabs((ts) => [...ts, tab]);
    setActiveId(tab.id);
  }

  function closeTab(id: string) {
    setTabs((ts) => {
      const remaining = ts.filter((t) => t.id !== id);
      if (remaining.length === 0) {
        const fresh = newTab();
        setActiveId(fresh.id);
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

  const searchForm = (large = false) => (
    <form
      className="relative w-full"
      onSubmit={(e) => {
        e.preventDefault();
        void runSearch(draft);
      }}
    >
      <Search
        className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground ${
          large ? "size-5" : "size-4"
        }`}
      />
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Search the web or type a URL"
        autoFocus={large}
        className={`rounded-full pl-11 font-mono ${
          large ? "h-14 text-base" : "h-9 text-sm"
        }`}
      />
    </form>
  );

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Tab strip */}
      <div className="flex items-end gap-1 border-b border-border px-4 pt-3">
        <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const title =
              tab.idx >= 0
                ? tab.entries[tab.idx]?.query ?? "New Tab"
                : "New Tab";
            const isActive = tab.id === activeId;
            return (
              <div
                key={tab.id}
                className={`group flex min-w-0 max-w-[220px] shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-3 py-2 text-xs transition-colors ${
                  isActive
                    ? "border-border bg-card text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-muted/60"
                }`}
              >
                <button
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => setActiveId(tab.id)}
                  title={title}
                >
                  {title}
                </button>
                <button
                  aria-label="Close tab"
                  className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                  onClick={() => closeTab(tab.id)}
                >
                  <X className="size-3" />
                </button>
              </div>
            );
          })}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-foreground"
          onClick={openNewTab}
          title="New tab"
        >
          <Plus className="size-4" />
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-foreground"
          disabled={activeTab.idx < 0}
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
          disabled={!current}
          onClick={reload}
          title="Reload"
        >
          <RotateCw className="size-4" />
        </Button>

        <div className="mx-2 min-w-0 flex-1">{searchForm(false)}</div>

        <span className="hidden items-center gap-1.5 rounded-full border border-border px-3 py-1 font-mono text-[11px] text-muted-foreground md:flex">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          ETH · Mainnet
        </span>

        {/* Extension icons — installed & enabled samples */}
        {activeExtensions.map((ext) => {
          const Icon = EXTENSION_ICONS[ext.id] ?? Puzzle;
          if (ext.id === "wallet-provider" && walletInstalled) {
            return <WalletPopover key={ext.id} />;
          }
          return (
            <Button
              key={ext.id}
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              title={`${ext.name} — running`}
              onClick={() => toast.success(`${ext.name} is running`)}
            >
              <Icon className="size-4" />
            </Button>
          );
        })}
        {activeExtensions.length === 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground"
            title="No extensions installed"
            onClick={() =>
              toast("No extensions installed — browse the Catalog in the Studio")
            }
          >
            <Puzzle className="size-4" />
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!current ? (
          <NewTabPage
            searchForm={searchForm(true)}
            userName={user?.name ?? undefined}
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
            filter={filter}
            onFilterChange={(f) => {
              setFilter(f);
              if (current.query) void runSearch(current.query);
            }}
            ensInstalled={ensInstalled}
            onRunSearch={(q) => void runSearch(q)}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------- new tab -------------------------------- */

function NewTabPage({
  searchForm,
  userName,
}: {
  searchForm: React.ReactNode;
  userName?: string;
}) {
  const navigate = useNavigate();

  return (
    <div className="mx-auto w-full max-w-xl px-6 pb-16 pt-[10vh]">
      <div className="text-center">
        <FremanWordmark className="text-4xl" />
        <p className="mt-3 text-sm text-muted-foreground">
          {userName ? `Welcome back, ${userName}.` : "The web, with Web3 built in."}
        </p>
      </div>
      <div className="mt-8">{searchForm}</div>

      <div className="mt-12">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Web3 shortcuts
        </p>
        <div className="mt-3 overflow-hidden rounded-xl border border-border">
          {DAPPS.slice(0, 4).map((dapp, i) => (
            <a
              key={dapp.origin}
              href={`https://${dapp.origin}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center justify-between px-4 py-3 text-sm transition-colors hover:bg-muted/60 ${
                i > 0 ? "border-t border-border" : ""
              }`}
            >
              <span>{dapp.name}</span>
              <span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                {dapp.origin}
                <ExternalLink className="size-3" />
              </span>
            </a>
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
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-border px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
            >
              {label}
            </a>
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

/* ------------------------------- results --------------------------------- */

function ResultsView({
  entry,
  filter,
  onFilterChange,
  ensInstalled,
  onRunSearch,
}: {
  entry: SearchEntry;
  filter: FilterId;
  onFilterChange: (f: FilterId) => void;
  ensInstalled: boolean;
  onRunSearch: (q: string) => void;
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
              filter === f.id
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {entry.source === "live" ? "Live results · Brave Search" : "Sample results"}
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
          <p className="mt-2 font-mono text-lg text-foreground">{entry.query}</p>
          {ensInstalled ? (
            <Button asChild variant="outline" size="sm" className="mt-3 rounded-full">
              <a
                href={`https://app.ens.domains/${entry.query}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on ENS
                <ExternalLink className="ml-1 size-3" />
              </a>
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
          <Button asChild variant="outline" size="sm" className="mt-3 rounded-full">
            <a
              href={`https://etherscan.io/address/${entry.query}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View on Etherscan
              <ExternalLink className="ml-1 size-3" />
            </a>
          </Button>
        </div>
      )}

      {/* Direct URL */}
      {URL_RE.test(entry.query) && (
        <div className="mt-4 rounded-xl border border-border p-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Direct address
          </p>
          <p className="mt-2 break-all font-mono text-sm">{entry.query}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild size="sm" className="rounded-full">
              <a
                href={
                  entry.query.startsWith("http")
                    ? entry.query
                    : `https://${entry.query}`
                }
                target="_blank"
                rel="noopener noreferrer"
              >
                Open site
                <ExternalLink className="ml-1 size-3" />
              </a>
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
            {entry.answerBox.answer}
          </p>
          {entry.answerBox.url && (
            <a
              href={entry.answerBox.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Source
              <ExternalLink className="size-3" />
            </a>
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
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block text-[15px] font-medium leading-6 hover:underline"
                >
                  {result.title}
                </a>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {result.snippet}
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

import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { BrowserMark } from "@/components/BrowserMark";
import { FremanWordmark } from "@/components/FremanWordmark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  EXTENSION_CATEGORIES,
  EXTENSION_SAMPLES,
} from "@/lib/extension-samples";
import { DAPPS } from "@/lib/dapps";
import {
  accountFamily,
  DEFAULT_NETWORKS,
  FAMILY_LABELS,
  isValidRecipient,
  networkMeta,
  networksForFamily,
  type ChainFamily,
} from "@/lib/networks";
import { useAction, useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowUpRight,
  Blocks,
  BookOpen,
  Bookmark,
  Copy,
  ExternalLink,
  Globe,
  Hammer,
  History,
  Keyboard,
  LayoutGrid,
  LogOut,
  Palette,
  Puzzle,
  Search,
  ShieldCheck,
  Star,
  Store,
  Trash2,
  UserCircle,
  Wallet,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

const CHROMIUM_SRC = "https://chromium.googlesource.com/chromium/src";
const CHROMIUM_DOCS =
  "https://chromium.googlesource.com/chromium/src/+/HEAD/docs";
const SAMPLES_REPO = "https://github.com/GoogleChrome/chrome-extensions-samples";

type SectionId =
  | "overview"
  | "extensions"
  | "web3"
  | "dapps"
  | "builds"
  | "history"
  | "bookmarks"
  | "appearance"
  | "privacy"
  | "account"
  | "shortcuts"
  | "source";

const SECTIONS: { id: SectionId; label: string; icon: typeof Puzzle }[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "extensions", label: "Extensions", icon: Puzzle },
  { id: "web3", label: "Web3 Wallet", icon: Wallet },
  { id: "dapps", label: "dApp Directory", icon: Blocks },
  { id: "builds", label: "Builds", icon: Hammer },
  { id: "history", label: "History", icon: History },
  { id: "bookmarks", label: "Bookmarks", icon: Bookmark },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "privacy", label: "Privacy & Search", icon: ShieldCheck },
  { id: "account", label: "Account", icon: UserCircle },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "source", label: "Source & Docs", icon: BookOpen },
];

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="border-b border-border pb-6">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function StatBlock({
  value,
  label,
}: {
  value: string | number;
  label: string;
}) {
  return (
    <div className="border-l border-border py-1 pl-4 first:border-l-0 first:pl-0">
      <p className="font-mono text-2xl tracking-tight">{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

/* --------------------------- Web Store trends ---------------------------- */

interface TrendPoint {
  date: string;
  value: number;
}

interface TrendItem {
  itemId: string;
  name: string;
  status: string;
  version: string | null;
  lastInstalled: number | null;
  prevInstalled: number | null;
  change: number | null;
  averageRating: number | null;
  ratingCount: number | null;
  reviewsTruncated: boolean;
  trend: TrendPoint[];
}

/** Tiny monochrome sparkline for install counts over time. */
function Sparkline({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Not enough daily data for a trend yet.
      </p>
    );
  }
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 200;
  const h = 40;
  const step = w / (points.length - 1);
  const path = points
    .map((p, i) => {
      const x = (i * step).toFixed(1);
      const y = (h - 3 - ((p.value - min) / span) * (h - 6)).toFixed(1);
      return `${i === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");
  const last = points[points.length - 1];
  const lastY = h - 3 - ((last.value - min) / span) * (h - 6);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-full" preserveAspectRatio="none">
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        className="text-muted-foreground"
      />
      <circle
        cx={w}
        cy={lastY}
        r="2.5"
        className="fill-red-500"
      />
    </svg>
  );
}

const TREND_RANGES = [
  { days: 7 as const, label: "7 days" },
  { days: 14 as const, label: "14 days" },
  { days: 30 as const, label: "30 days" },
  { days: 60 as const, label: "60 days" },
];

function WebStoreTrendsPanel({
  onNavigate,
}: {
  onNavigate: (s: SectionId) => void;
}) {
  const connection = useQuery(api.publisherState.get);
  const loadTrends = useAction(api.publisher.statsTrends);
  const [days, setDays] = useState<7 | 14 | 30 | 60>(14);
  const [items, setItems] = useState<TrendItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    (range: 7 | 14 | 30 | 60) => {
      setBusy(true);
      setError(null);
      loadTrends({ days: range })
        .then((res) => {
          const typed = res as { items: TrendItem[]; generatedAt: number };
          setItems(typed.items);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "Could not load stats");
        })
        .finally(() => setBusy(false));
    },
    [loadTrends],
  );

  // Load automatically once the connection is known and present.
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (connection && !autoLoaded.current) {
      autoLoaded.current = true;
      refresh(days);
    }
  }, [connection, days, refresh]);

  if (connection === undefined) return null;

  if (connection === null) {
    return (
      <div className="rounded-xl border border-border px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Web Store publisher stats</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Connect a Chrome Web Store publisher account to see install
              trends and ratings for your published extensions here.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="rounded-full px-4 text-xs"
            onClick={() => onNavigate("extensions")}
          >
            Connect publisher
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <span className="text-sm font-medium">Web Store publisher stats</span>
        {connection.publisherId && (
          <span className="font-mono text-[11px] text-muted-foreground">
            {connection.publisherId}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-border">
            {TREND_RANGES.map((r) => (
              <button
                key={r.days}
                onClick={() => {
                  setDays(r.days);
                  refresh(r.days);
                }}
                className={`px-2.5 py-1 text-[11px] transition-colors ${
                  days === r.days
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px] text-muted-foreground hover:text-foreground"
            disabled={busy}
            onClick={() => refresh(days)}
          >
            {busy ? "Loading…" : "Refresh"}
          </Button>
        </div>
      </div>
      <div className="px-5 py-4">
        {error ? (
          <p className="text-xs text-red-500">{error}</p>
        ) : items === null ? (
          <p className="text-xs text-muted-foreground">
            {busy ? "Loading stats from the Web Store…" : "No data loaded yet."}
          </p>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No published items yet — upload an extension in Extensions →
            Publisher mode to start collecting stats.
          </p>
        ) : (
          <div className="grid gap-px overflow-hidden rounded-lg bg-border sm:grid-cols-2">
            {items.map((item) => {
              const change = item.change;
              return (
                <div key={item.itemId} className="bg-card px-5 py-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-sm font-medium" title={item.name}>
                      {item.name}
                    </p>
                    <Badge
                      variant="outline"
                      className="shrink-0 rounded-full font-normal text-muted-foreground"
                    >
                      {item.status}
                    </Badge>
                  </div>
                  <div className="mt-3 flex items-end gap-4">
                    <div>
                      <p className="font-mono text-xl tracking-tight">
                        {item.lastInstalled != null
                          ? item.lastInstalled.toLocaleString()
                          : "—"}
                      </p>
                      <p className="mt-0.5 text-[11px] uppercase tracking-widest text-muted-foreground">
                        Installed
                      </p>
                    </div>
                    {change != null && (
                      <p
                        className={`pb-0.5 font-mono text-xs ${
                          change > 0
                            ? "text-green-600 dark:text-green-500"
                            : change < 0
                              ? "text-red-500"
                              : "text-muted-foreground"
                        }`}
                      >
                        {change > 0 ? "+" : ""}
                        {change} over {days}d
                      </p>
                    )}
                    {item.averageRating != null && (
                      <p className="ml-auto flex items-center gap-1 pb-0.5 text-xs text-muted-foreground">
                        <Star className="size-3 fill-current text-red-500" />
                        {item.averageRating.toFixed(2)}
                        {item.ratingCount != null && ` (${item.ratingCount})`}
                      </p>
                    )}
                  </div>
                  <div className="mt-3">
                    <Sparkline points={item.trend} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- Overview ------------------------------- */

function OverviewSection({ onNavigate }: { onNavigate: (s: SectionId) => void }) {
  const navigate = useNavigate();
  const installed = useQuery(api.extensions.listInstalled) ?? [];
  const accounts = useQuery(api.wallet.listAccounts) ?? [];
  const connections = useQuery(api.wallet.listConnections) ?? [];
  const builds = useQuery(api.builds.list) ?? [];

  const enabledCount = installed.filter((e) => e.enabled).length;

  return (
    <div className="flex flex-col gap-10">
      <SectionHeading
        title="Overview"
        description="Your Freman workspace at a glance — the extension catalog, wallet sessions and builds in one quiet place."
      />

      <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        <StatBlock value={enabledCount} label="Extensions active" />
        <StatBlock value={accounts.length} label="Wallet accounts" />
        <StatBlock value={connections.length} label="dApp sessions" />
        <StatBlock value={builds.length} label="Builds queued" />
      </div>

      <WebStoreTrendsPanel onNavigate={onNavigate} />

      <div className="rounded-xl border border-border">
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <BrowserMark className="size-4 text-muted-foreground" />
          <span className="font-mono text-xs text-muted-foreground">
            freman://studio — current profile
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-xs">
            <span className="size-1.5 rounded-full bg-red-500" />
            Ready
          </span>
        </div>
        <div className="grid gap-px overflow-hidden rounded-b-xl bg-border sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              { key: "browse", title: "Browser", copy: "Search the web with Freman's built-in engine.", onClick: () => navigate("/browse") },
              { key: "catalog", title: "Catalog", copy: "Browse and search the Freman extension catalog.", onClick: () => onNavigate("extensions") },
              { key: "wallet", title: "Web3 Wallet", copy: "Create accounts and review dApp sessions.", onClick: () => onNavigate("web3") },
              { key: "builds", title: "Builds", copy: "Queue Chromium builds for any channel.", onClick: () => onNavigate("builds") },
            ] as const
          ).map(({ key, title, copy, onClick }) => (
            <button
              key={key}
              onClick={onClick}
              className="group bg-card px-5 py-5 text-left transition-colors hover:bg-muted/60"
            >
              <p className="flex items-center gap-1.5 text-sm font-medium">
                {title}
                <ArrowUpRight className="size-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </p>
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                {copy}
              </p>
            </button>
          ))}
        </div>
      </div>

      {builds.length > 0 && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Latest build
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-5 py-4">
            <div className="flex items-baseline gap-4">
              <span className="font-mono text-sm">
                {builds[0].chromiumVersion}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {builds[0].revision}
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <Badge variant="outline" className="rounded-full font-normal">
                {builds[0].channel}
              </Badge>
              <span>{builds[0].platform}</span>
              <span className="hidden sm:inline">
                {formatDistanceToNow(new Date(builds[0].createdAt), {
                  addSuffix: true,
                })}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Extensions ------------------------------ */

function ExtensionsSection() {
  const installed = useQuery(api.extensions.listInstalled);
  const install = useMutation(api.extensions.install);
  const remove = useMutation(api.extensions.remove);
  const setEnabled = useMutation(api.extensions.setEnabled);

  const [filter, setFilter] = useState<string>("All");
  const [query, setQuery] = useState("");

  const bySampleId = useMemo(
    () => new Map((installed ?? []).map((e) => [e.sampleId, e])),
    [installed],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return EXTENSION_SAMPLES.filter((sample) => {
      const inCategory = filter === "All" || sample.category === filter;
      if (!inCategory) return false;
      if (!q) return true;
      return [
        sample.name,
        sample.description,
        sample.id,
        sample.category,
        ...sample.apis,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [filter, query]);

  return (
    <div className="flex flex-col gap-8">
      <SectionHeading
        title="Catalog"
        description="Browse and search the full Freman catalog — official Chrome samples next to the Web3-native extensions that ship with the browser."
      />

      <div className="flex flex-col gap-4">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, API or category"
            className="h-10 pl-9 text-sm"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {["All", ...EXTENSION_CATEGORIES].map((category) => (
            <button
              key={category}
              onClick={() => setFilter(category)}
              className={`rounded-full border px-3.5 py-1.5 text-xs transition-colors ${
                filter === category
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
              }`}
            >
              {category}
            </button>
          ))}
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            {visible.length} of {EXTENSION_SAMPLES.length}
          </span>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          No extensions match “{query}”. Try a different name, API or
          category.
        </div>
      ) : (
      <div className="grid gap-4 md:grid-cols-2">
        {visible.map((sample) => {
          const state = bySampleId.get(sample.id);
          return (
            <div
              key={sample.id}
              className="flex flex-col rounded-xl border border-border p-5 transition-colors hover:border-foreground/30"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">{sample.name}</h3>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    {sample.id}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground">
                  {sample.category}
                </span>
              </div>

              <p className="mt-3 flex-1 text-xs leading-5 text-muted-foreground">
                {sample.description}
              </p>

              <div className="mt-4 flex flex-wrap gap-1.5">
                {sample.apis.map((apiName) => (
                  <span
                    key={apiName}
                    className="rounded-md bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                  >
                    {apiName}
                  </span>
                ))}
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
                {state ? (
                  <>
                    <div className="flex items-center gap-2.5">
                      <Switch
                        checked={state.enabled}
                        onCheckedChange={(enabled) =>
                          setEnabled({ sampleId: sample.id, enabled })
                        }
                      />
                      <span className="text-xs text-muted-foreground">
                        {state.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        remove({ sampleId: sample.id })
                          .then(() =>
                            toast.success(`${sample.name} removed`),
                          )
                          .catch(() => toast.error("Could not remove"))
                      }
                    >
                      Remove
                    </Button>
                  </>
                ) : (
                  <>
                    <a
                      href={sample.source}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      View source
                      <ArrowUpRight className="size-3" />
                    </a>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-full px-4 text-xs"
                      onClick={() =>
                        install({ sampleId: sample.id })
                          .then(() =>
                            toast.success(`${sample.name} installed`),
                          )
                          .catch(() => toast.error("Could not install"))
                      }
                    >
                      Install
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Live Chrome Web Store search */}
      <StoreSearchSection />

      {/* Publisher mode — connect, upload, publish */}
      <PublisherPanel />
    </div>
  );
}

/* ------------------------- Publisher (official API) ---------------------- */

interface PublisherItem {
  id: string;
  name: string;
  status: string;
  version: string | null;
  installs: number | null;
}

const PUBLISH_STATES: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: "Draft", tone: "text-muted-foreground" },
  PENDING_REVIEW: { label: "Pending review", tone: "text-amber-500" },
  IN_REVIEW: { label: "In review", tone: "text-amber-500" },
  PUBLISHED: { label: "Published", tone: "text-emerald-500" },
  REJECTED: { label: "Rejected", tone: "text-red-500" },
  UNPUBLISHED: { label: "Unpublished", tone: "text-muted-foreground" },
};

function PublisherPanel() {
  const { isAuthenticated } = useAuth();
  const connection = useQuery(api.publisherState.get);
  const disconnect = useMutation(api.publisherState.disconnect);
  const setPublisherId = useMutation(api.publisherState.setPublisherId);
  const startConnect = useAction(api.publisher.startConnect);
  const listItemsAction = useAction(api.publisher.listItems);
  const uploadAction = useAction(api.publisher.upload);
  const publishAction = useAction(api.publisher.publish);

  const [connecting, setConnecting] = useState(false);
  const [items, setItems] = useState<PublisherItem[] | null>(null);
  const [itemsBusy, setItemsBusy] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [publishTarget, setPublishTarget] = useState<"default" | "trustedTesters">(
    "default",
  );
  const [pubIdDraft, setPubIdDraft] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Listen for the popup completing the OAuth flow.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "freman-publisher-connected") {
        setConnecting(false);
        toast.success(
          e.data.email
            ? `Publisher connected — ${e.data.email}`
            : "Publisher account connected",
        );
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const connect = async () => {
    setConnecting(true);
    try {
      const url = await startConnect({ appOrigin: window.location.origin });
      window.open(url, "freman-publisher-oauth", "width=520,height=680");
      // If the popup is blocked, fall back to same-tab navigation.
      setTimeout(() => {
        if (!window.closed) setConnecting(false);
      }, 2000);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the connect flow");
      setConnecting(false);
    }
  };

  const refreshItems = () => {
    setItemsBusy(true);
    setItemsError(null);
    listItemsAction({})
      .then((res) => {
        setItems((res as { items: PublisherItem[] }).items);
      })
      .catch((e: unknown) => {
        setItemsError(e instanceof Error ? e.message : "Could not list items");
      })
      .finally(() => setItemsBusy(false));
  };

  const onUpload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      toast.error("Choose an extension .zip file");
      return;
    }
    setUploading(true);
    try {
      const zipBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.slice(result.indexOf(",") + 1));
        };
        reader.onerror = () => reject(new Error("Could not read the file"));
        reader.readAsDataURL(file);
      });
      const res = (await uploadAction({ zipBase64, publishTarget })) as {
        itemId: string | null;
        uploadState: string;
      };
      toast.success(
        res.itemId
          ? `Uploaded (${res.uploadState}) — item ${res.itemId}`
          : `Uploaded (${res.uploadState})`,
      );
      refreshItems();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const doPublish = async (itemId: string) => {
    try {
      const res = (await publishAction({ itemId, publishTarget })) as {
        status: string;
      };
      toast.success(`Publish submitted (${res.status}) — review pending at Google`);
      refreshItems();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Publish failed");
    }
  };

  const card = (children: React.ReactNode) => (
    <div className="rounded-2xl border border-border p-6">{children}</div>
  );

  if (!isAuthenticated) {
    return card(
      <p className="text-sm text-muted-foreground">
        Sign in to connect your Chrome Web Store publisher account.
      </p>,
    );
  }

  return (
    <div className="rounded-2xl border border-border p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-lg bg-muted">
            <ShieldCheck className="size-4" />
          </span>
          <div>
            <h3 className="text-sm font-medium">Publisher mode — official Web Store API</h3>
            <p className="text-xs text-muted-foreground">
              Upload zips, publish updates, and track review status — straight to Google.
            </p>
          </div>
        </div>
        {connection ? (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-red-500" />
              {connection.googleEmail ?? "Connected"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-full px-3 text-xs text-muted-foreground"
              onClick={() => {
                void disconnect({});
                setItems(null);
                toast.success("Publisher account disconnected");
              }}
            >
              Disconnect
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            className="h-9 rounded-full px-4"
            disabled={connecting}
            onClick={() => void connect()}
          >
            {connecting ? "Connecting…" : "Connect Google account"}
          </Button>
        )}
      </div>

      {connection ? (
        <div className="mt-6 space-y-5">
          {/* Publisher id */}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <label className="text-xs font-medium text-muted-foreground">
                Publisher ID
              </label>
              <Input
                value={pubIdDraft || connection.publisherId || ""}
                onChange={(e) => setPubIdDraft(e.target.value)}
                placeholder="e.g. 4812597… (from the developer dashboard URL)"
                className="mt-1 h-9 font-mono text-sm"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-full px-4"
              disabled={!pubIdDraft || pubIdDraft === connection.publisherId}
              onClick={() => {
                void setPublisherId({ publisherId: pubIdDraft })
                  .then(() => toast.success("Publisher ID saved"))
                  .finally(() => setPubIdDraft(""));
              }}
            >
              Save
            </Button>
          </div>

          {/* Upload + target */}
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onUpload(f);
              }}
            />
            <Button
              size="sm"
              className="h-9 rounded-full px-4"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? "Uploading…" : "Upload extension zip"}
            </Button>
            <Select
              value={publishTarget}
              onValueChange={(v) => setPublishTarget(v as "default" | "trustedTesters")}
            >
              <SelectTrigger className="h-9 w-56 rounded-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Publish publicly</SelectItem>
                <SelectItem value="trustedTesters">Trusted testers only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Items */}
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Your items {connection.itemCount != null ? `· ${connection.itemCount}` : ""}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-full px-3 text-xs"
              disabled={itemsBusy}
              onClick={refreshItems}
            >
              {itemsBusy ? "Loading…" : "Refresh from Google"}
            </Button>
          </div>

          {itemsError && (
            <p className="text-sm text-muted-foreground">{itemsError}</p>
          )}

          {items === null && !itemsError ? (
            <p className="text-sm text-muted-foreground">
              Load your items to see live review status and install counts.
            </p>
          ) : items?.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No items yet — upload a zip above to create your first draft.
            </p>
          ) : (
            <div className="divide-y divide-border rounded-xl border border-border">
              {(items ?? []).map((it) => {
                const tone = PUBLISH_STATES[it.status]?.tone ?? "text-muted-foreground";
                const label = PUBLISH_STATES[it.status]?.label ?? it.status;
                return (
                  <div
                    key={it.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{it.name}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {it.id}
                        {it.version ? ` · v${it.version}` : ""}
                        {it.installs != null ? ` · ${it.installs.toLocaleString()} installs` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-medium ${tone}`}>{label}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-full px-3 text-xs"
                        onClick={() => void doPublish(it.id)}
                      >
                        Publish
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <p className="mt-5 text-sm leading-6 text-muted-foreground">
          Connecting opens Google in a popup and grants Freman the
          {" "}
          <span className="font-mono text-xs">chromewebstore</span> scope. Tokens
          are encrypted at rest; nothing is stored in the browser.
        </p>
      )}
    </div>
  );
}

/* ---------------------- Chrome Web Store (live) ------------------------- */

interface StoreCard {
  id: string;
  name: string;
  publisher: string | null;
  rating: number | null;
  icon: string | null;
  url: string;
}

function StoreSearchSection() {
  const searchStore = useAction(api.webstore.search);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StoreCard[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const run = (q: string) => {
    setStatus("loading");
    setError(null);
    searchStore({ query: q, limit: 9 })
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
    <div className="rounded-2xl border border-border p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-lg bg-muted">
            <Store className="size-4" />
          </span>
          <div>
            <h3 className="text-sm font-medium">Chrome Web Store — live</h3>
            <p className="text-xs text-muted-foreground">
              Real store data, straight from Google.
            </p>
          </div>
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const q = query.trim();
            if (q) run(q);
          }}
        >
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the store…"
            className="h-9 w-56 text-sm"
          />
          <Button type="submit" size="sm" className="h-9 rounded-full px-4">
            Search
          </Button>
        </form>
      </div>

      {status === "loading" && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-36 animate-pulse rounded-xl border border-border bg-muted/40"
            />
          ))}
        </div>
      )}

      {status === "error" && (
        <p className="mt-6 text-sm text-muted-foreground">
          {error} —{" "}
          <button
            className="underline underline-offset-2"
            onClick={() => run("web3 wallet")}
          >
            retry
          </button>
        </p>
      )}

      {status === "done" && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((card) => (
            <a
              key={card.id}
              href={card.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col rounded-xl border border-border p-4 transition-colors hover:border-foreground/30"
            >
              <div className="flex items-start gap-3">
                {card.icon ? (
                  <img
                    src={card.icon}
                    alt=""
                    className="size-10 rounded-lg"
                    onError={(e) => {
                      e.currentTarget.style.visibility = "hidden";
                    }}
                  />
                ) : (
                  <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted">
                    <Puzzle className="size-4 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={card.name}>
                    {card.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
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
                  <span>Unrated</span>
                )}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- Web3 --------------------------------- */

function shorten(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Trim long token decimals for display: 681961921687.14… → 681.96B. */
function compactAmount(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n === 0) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(3);
}

function Web3Section() {
  const accounts = useQuery(api.wallet.listAccounts) ?? [];
  const connections = useQuery(api.wallet.listConnections) ?? [];
  const transactions = useQuery(api.transactions.list) ?? [];
  const createCustodial = useAction(api.custodialWallet.createAccount);
  const removeAccount = useMutation(api.wallet.removeAccount);
  const setPrimary = useMutation(api.wallet.setPrimary);
  const connectDapp = useMutation(api.wallet.connectDapp);
  const disconnectDapp = useMutation(api.wallet.disconnectDapp);
  const [family, setFamily] = useState<ChainFamily>("evm");
  const [networkByFamily, setNetworkByFamily] = useState<Record<ChainFamily, string>>(
    DEFAULT_NETWORKS,
  );
  const [sendTarget, setSendTarget] = useState<Doc<"walletAccounts"> | null>(null);
  const network = networkByFamily[family];
  const setNetwork = (id: string) =>
    setNetworkByFamily((prev) => ({ ...prev, [family]: id }));
  const activeNetwork = networkMeta(network);

  const connectionByOrigin = useMemo(
    () => new Map(connections.map((c) => [c.origin, c])),
    [connections],
  );
  const activeAccount = accounts.find((a) => a.isPrimary) ?? accounts[0];
  const recentTxs = useMemo(
    () =>
      [...transactions]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 6),
    [transactions],
  );

  return (
    <div className="flex flex-col gap-10">
      <SectionHeading
        title="Web3 Wallet"
        description="A real custodial wallet — Freman generates each keypair server-side and stores the private key AES-256-GCM encrypted. Balances are live on-chain; sends are signed and broadcast for real."
      />

      {/* Chain family + network switch */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex overflow-hidden rounded-lg border border-border">
            {(["evm", "solana", "tron"] as ChainFamily[]).map((f) => (
              <button
                key={f}
                onClick={() => setFamily(f)}
                className={`px-4 py-1.5 text-xs transition-colors ${
                  family === f
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {FAMILY_LABELS[f]}
              </button>
            ))}
          </div>
          <Select
            value={network}
            onValueChange={(id) => setNetwork(id)}
          >
            <SelectTrigger className="h-9 w-[200px] rounded-lg text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {networksForFamily(family).map((n) => (
                <SelectItem key={n.id} value={n.id} className="text-xs">
                  {n.label}
                  {n.testnet ? " (test)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {activeNetwork && !activeNetwork.testnet && (
          <p className="flex items-center gap-2 text-xs text-red-500">
            <span className="size-1.5 rounded-full bg-red-500" />
            {activeNetwork.label} moves real funds — test on a testnet first.
          </p>
        )}
      </div>

      {/* Accounts */}
      <div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Accounts
          </p>
          <Button
            size="sm"
            className="h-9 rounded-full px-4 text-xs"
            onClick={() =>
              createCustodial({ label: "", chainType: family })
                .then(() =>
                  toast.success(
                    `${FAMILY_LABELS[family]} account created — key encrypted at rest`,
                  ),
                )
                .catch(() => toast.error("Could not create account"))
            }
          >
            Create {FAMILY_LABELS[family]} account
          </Button>
        </div>

        {accounts.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              No accounts yet. Create one to get a real on-chain address.
            </p>
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-border">
            {accounts
              .filter((a: Doc<"walletAccounts">) => accountFamily(a) === family)
              .map((account: Doc<"walletAccounts">, i: number) => (
              <WalletAccountRow
                key={account._id}
                account={account}
                isFirst={i === 0}
                network={network}
                onSend={() => setSendTarget(account)}
                onRemove={() =>
                  removeAccount({ accountId: account._id })
                    .then(() => toast.success("Account removed"))
                    .catch(() => toast.error("Could not remove account"))
                }
                onMakePrimary={() =>
                  setPrimary({ accountId: account._id })
                    .then(() => toast.success(`${account.label} is now primary`))
                    .catch(() => toast.error("Could not set primary"))
                }
              />))}
          </div>
        )}
      </div>

      {/* Send dialog */}
      {sendTarget && (
        <SendDialog
          account={sendTarget}
          network={network}
          onClose={() => setSendTarget(null)}
        />
      )}

      {/* Recent on-chain activity */}
      {recentTxs.length > 0 && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Recent on-chain activity
          </p>
          <div className="mt-4 overflow-hidden rounded-xl border border-border">
            {recentTxs.map((tx, i) => (
              <div
                key={tx._id}
                className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 ${
                  i > 0 ? "border-t border-border" : ""
                }`}
              >
                <a
                  href={
                    tx.chain === "mainnet"
                      ? `https://etherscan.io/tx/${tx.hash}`
                      : `https://sepolia.etherscan.io/tx/${tx.hash}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-foreground hover:underline"
                >
                  {tx.hash.slice(0, 10)}…{tx.hash.slice(-6)}
                </a>
                <span className="font-mono text-xs text-muted-foreground">
                  {shorten(tx.to)}
                </span>
                <Badge
                  variant="outline"
                  className={`rounded-full font-normal ${
                    tx.status === "confirmed"
                      ? "text-foreground"
                      : tx.status === "failed"
                        ? "text-red-500"
                        : "text-muted-foreground"
                  }`}
                >
                  {tx.status}
                </Badge>
                <span className="font-mono text-xs">
                  {(Number(BigInt(tx.valueWei)) / 1e18).toFixed(5)} ETH
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {tx.chain === "mainnet" ? "Mainnet" : "Sepolia"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* dApp sessions */}
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          dApp sessions
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {DAPPS.map((dapp) => {
            const connection = connectionByOrigin.get(dapp.origin);
            const linkedAccount = connection
              ? accounts.find((a) => a._id === connection.accountId)
              : undefined;
            const canConnect = Boolean(activeAccount);
            return (
              <div
                key={dapp.origin}
                className={`flex flex-col rounded-xl border p-5 transition-colors ${
                  connection ? "border-foreground/30" : "border-border"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium">{dapp.name}</h3>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {dapp.origin}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="shrink-0 rounded-full font-normal text-muted-foreground"
                  >
                    {dapp.chain}
                  </Badge>
                </div>
                <p className="mt-3 flex-1 text-xs leading-5 text-muted-foreground">
                  {dapp.blurb}
                </p>
                <div className="mt-4 border-t border-border pt-4">
                  {connection ? (
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-xs">
                        <span className="size-1.5 rounded-full bg-red-500" />
                        <span className="text-muted-foreground">
                          {linkedAccount
                            ? `${linkedAccount.label} · ${shorten(linkedAccount.address)}`
                            : "Connected"}
                        </span>
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          disconnectDapp({ connectionId: connection._id })
                            .then(() =>
                              toast.success(`${dapp.name} disconnected`),
                            )
                            .catch(() => toast.error("Could not disconnect"))
                        }
                      >
                        Disconnect
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {canConnect
                          ? `Connects to ${activeAccount.label}`
                          : "Create an account first"}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-full px-4 text-xs"
                        disabled={!canConnect}
                        onClick={() =>
                          activeAccount &&
                          connectDapp({
                            origin: dapp.origin,
                            name: dapp.name,
                            accountId: activeAccount._id,
                            chainId: dapp.chainId,
                          })
                            .then(() =>
                              toast.success(
                                `${dapp.name} connected to ${activeAccount.label}`,
                              ),
                            )
                            .catch(() => toast.error("Could not connect"))
                        }
                      >
                        Connect
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- Builds -------------------------------- */

const CHANNELS = ["Stable", "Beta", "Dev", "Canary"];
const PLATFORMS = ["Linux x64", "macOS ARM64", "Windows x64", "ChromeOS"];

function BuildsSection() {
  const builds = useQuery(api.builds.list) ?? [];
  const create = useMutation(api.builds.create);
  const remove = useMutation(api.builds.remove);

  const [channel, setChannel] = useState("Stable");
  const [platform, setPlatform] = useState("Linux x64");

  return (
    <div className="flex flex-col gap-8">
      <SectionHeading
        title="Builds"
        description="Queue Freman builds tracked against upstream Chromium — pick a channel and platform, and the Studio handles the rest."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select value={channel} onValueChange={setChannel}>
          <SelectTrigger className="h-9 w-36 rounded-lg text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHANNELS.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={platform} onValueChange={setPlatform}>
          <SelectTrigger className="h-9 w-40 rounded-lg text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PLATFORMS.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          className="h-9 rounded-full px-5 text-xs"
          onClick={() =>
            create({ channel, platform })
              .then(() => toast.success(`Build queued — ${channel} · ${platform}`))
              .catch(() => toast.error("Could not queue build"))
          }
        >
          <Hammer className="size-3.5" />
          New build
        </Button>
      </div>

      {builds.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          No builds yet. Queue your first Chromium build above.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          {builds.map((build, i) => (
            <div
              key={build._id}
              className={`flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3.5 ${
                i > 0 ? "border-t border-border" : ""
              }`}
            >
              <span className="flex items-center gap-2 text-xs">
                <span className="size-1.5 rounded-full bg-red-500" />
                {build.status}
              </span>
              <span className="font-mono text-sm">{build.chromiumVersion}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {build.revision}
              </span>
              <Badge
                variant="outline"
                className="rounded-full font-normal text-muted-foreground"
              >
                {build.channel}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {build.platform}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(build.createdAt), {
                  addSuffix: true,
                })}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive"
                onClick={() =>
                  remove({ buildId: build._id })
                    .then(() => toast.success("Build removed"))
                    .catch(() => toast.error("Could not remove build"))
                }
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------- Source & Docs ----------------------------- */

const SOURCE_LINKS = [
  {
    title: "Chromium source",
    copy: "The full Chromium source tree — clone it and build Freman's core your way.",
    href: CHROMIUM_SRC,
  },
  {
    title: "Chromium docs",
    copy: "Upstream documentation for the source tree, including build instructions.",
    href: CHROMIUM_DOCS,
  },
  {
    title: "Extension samples",
    copy: "GoogleChrome's official repository of working extension samples.",
    href: SAMPLES_REPO,
  },
];

function SourceSection() {
  const cloneCommand =
    "git clone https://chromium.googlesource.com/chromium/src";

  return (
    <div className="flex flex-col gap-8">
      <SectionHeading
        title="Source & Docs"
        description="Everything Freman is built on is public. Clone the tree, read the docs, study the samples."
      />

      <div className="grid gap-4 md:grid-cols-3">
        {SOURCE_LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col rounded-xl border border-border p-5 transition-colors hover:border-foreground/30"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">{link.title}</h3>
              <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </div>
            <p className="mt-2 flex-1 text-xs leading-5 text-muted-foreground">
              {link.copy}
            </p>
          </a>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-muted/40 p-5">
        <div className="flex items-center justify-between gap-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Clone the tree
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() =>
              navigator.clipboard
                .writeText(cloneCommand)
                .then(() => toast.success("Clone command copied"))
                .catch(() => toast.error("Copy failed"))
            }
          >
            <Copy className="size-3.5" />
            Copy
          </Button>
        </div>
        <p className="mt-3 overflow-x-auto whitespace-nowrap font-mono text-xs text-foreground">
          {cloneCommand}
        </p>
        <p className="mt-2 font-mono text-[10px] text-muted-foreground">
          tree 85e50f9e8eeb9f19e06e8802987f8989b58fcde3
        </p>
      </div>
    </div>
  );
}

/* --------------------------- custodial wallet ---------------------------- */

/** One account row with a live on-chain balance. */
function WalletAccountRow({
  account,
  isFirst,
  network,
  onSend,
  onRemove,
  onMakePrimary,
}: {
  account: Doc<"walletAccounts">;
  isFirst: boolean;
  network: string;
  onSend: () => void;
  onRemove: () => void;
  onMakePrimary: () => void;
}) {
  const getBalance = useAction(api.custodialWallet.getBalance);
  const getTokenBalances = useAction(api.custodialWallet.getTokenBalances);
  const [balance, setBalance] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("");
  const [tokens, setTokens] = useState<
    Array<{ symbol: string; formatted: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    getBalance({ address: account.address, network })
      .then((res) => {
        if (!cancelled) {
          setBalance(Number(res.formatted).toFixed(5));
          setSymbol(res.symbol);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [account.address, network, getBalance]);

  useEffect(() => {
    let cancelled = false;
    setTokens([]);
    getTokenBalances({ address: account.address, network })
      .then((res) => {
        if (!cancelled)
          setTokens(
            res.map((t) => ({ symbol: t.symbol, formatted: t.formatted })),
          );
      })
      .catch(() => {
        // Token list is best-effort; native balance already covers the row.
      });
    return () => {
      cancelled = true;
    };
  }, [account.address, network, getTokenBalances]);

  const copyAddress = (address: string) => {
    navigator.clipboard
      .writeText(address)
      .then(() => toast.success("Address copied"))
      .catch(() => toast.error("Copy failed"));
  };

  return (
    <div
      className={`flex flex-wrap items-center gap-3 px-5 py-3.5 ${
        isFirst ? "" : "border-t border-border"
      }`}
    >
      <span
        className={`size-1.5 shrink-0 rounded-full ${
          account.isPrimary ? "bg-red-500" : "bg-border"
        }`}
      />
      <span className="text-sm font-medium">{account.label}</span>
      {account.chainType && account.chainType !== "evm" && (
        <Badge
          variant="outline"
          className="rounded-full font-normal capitalize text-muted-foreground"
        >
          {account.chainType}
        </Badge>
      )}
      <button
        onClick={() => copyAddress(account.address)}
        className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
        title="Copy address"
      >
        {shorten(account.address)}
        <Copy className="size-3" />
      </button>
      {!account.encryptedPrivateKey && (
        <Badge
          variant="outline"
          className="rounded-full font-normal text-muted-foreground"
        >
          legacy — receive only
        </Badge>
      )}
      <span className="ml-auto font-mono text-sm">
        {loading
          ? "…"
          : error
            ? "—"
            : `${balance} ${symbol}`}
      </span>
      {tokens.length > 0 && (
        <div className="flex w-full flex-wrap items-center gap-1.5">
          {tokens.map((t) => (
            <span
              key={t.symbol}
              className="rounded-full border border-border bg-muted/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
              title={`${t.formatted} ${t.symbol}`}
            >
              {t.symbol} {compactAmount(t.formatted)}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1">
        {account.encryptedPrivateKey && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground hover:text-foreground"
            onClick={onSend}
          >
            Send
          </Button>
        )}
        {!account.isPrimary && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground hover:text-foreground"
            onClick={onMakePrimary}
          >
            Make primary
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

/** Send dialog: real signed broadcast through the custodial backend. */
function SendDialog({
  account,
  network,
  onClose,
}: {
  account: Doc<"walletAccounts">;
  network: string;
  onClose: () => void;
}) {
  const sendTransaction = useAction(api.custodialWallet.sendTransaction);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    hash: string;
    explorerUrl: string;
    status: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const family = accountFamily(account);
  const meta = networkMeta(network);
  const valid = isValidRecipient(family, to) && Number(amount) > 0;
  const isMainnet = meta ? !meta.testnet : false;
  const symbol = meta?.symbol ?? "";

  function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    sendTransaction({
      accountId: account._id,
      to,
      amount,
      network,
      confirmed: isMainnet,
    })
      .then((res) => {
        setResult(res);
        toast.success(
          res.status === "confirmed"
            ? "Transaction confirmed on-chain"
            : "Transaction broadcast",
        );
      })
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : "Transaction failed",
        );
      })
      .finally(() => setBusy(false));
  }

  return (
    <div className="rounded-xl border border-border">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <p className="text-sm font-medium">
          Send from {account.label}
        </p>
        <button
          onClick={onClose}
          className="text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex flex-col gap-4 px-5 py-5">
        {result ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              Broadcast {result.status} · {(Number(amount) || 0).toString()} {symbol} →{" "}
              <span className="font-mono text-xs text-muted-foreground">
                {shorten(to || "")}
              </span>
            </p>
            <a
              href={result.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {result.hash.slice(0, 18)}…{result.hash.slice(-8)}
              <ExternalLink className="size-3" />
            </a>
            <Button
              variant="outline"
              size="sm"
              className="self-start rounded-full px-4 text-xs"
              onClick={onClose}
            >
              Done
            </Button>
          </div>
        ) : (
          <>
            {isMainnet && (
              <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-xs leading-5 text-red-500">
                You're sending real {symbol} on {meta?.label}. This is
                irreversible. Freman signs and broadcasts it immediately.
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Recipient ({FAMILY_LABELS[family]} address)
              </label>
              <Input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder={family === "evm" ? "0x…" : family === "tron" ? "T…" : "Base58 address"}
                className="h-9 font-mono text-xs"
                spellCheck={false}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Amount ({symbol})
              </label>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.001"
                className="h-9 font-mono text-xs"
                inputMode="decimal"
              />
            </div>
            {error && (
              <p className="text-xs text-red-500">{error}</p>
            )}
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] text-muted-foreground">
                {meta?.label}
              </span>
              <Button
                size="sm"
                className="rounded-full px-5 text-xs"
                disabled={!valid || busy}
                onClick={submit}
              >
                {busy ? "Signing…" : "Sign & send"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------------------- dApp Directory ----------------------------- */

function DappsSection() {
  const connections = useQuery(api.wallet.listConnections) ?? [];
  const accounts = useQuery(api.wallet.listAccounts) ?? [];
  const connectDapp = useMutation(api.wallet.connectDapp);
  const disconnectDapp = useMutation(api.wallet.disconnectDapp);
  const activeAccount = accounts.find((a) => a.isPrimary) ?? accounts[0];

  return (
    <div className="flex flex-col gap-8">
      <SectionHeading
        title="dApp Directory"
        description="Every dApp Freman knows about, with live session status. Connect from here or from inside the browser — it's the same sessions."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {DAPPS.map((dapp) => {
          const connection = connections.find((c) => c.origin === dapp.origin);
          const linked = connection
            ? accounts.find((a) => a._id === connection.accountId)
            : undefined;
          return (
            <div
              key={dapp.origin}
              className={`flex flex-col rounded-xl border p-5 transition-colors ${
                connection ? "border-red-500/40" : "border-border"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">{dapp.name}</h3>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    {dapp.origin}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="shrink-0 rounded-full font-normal text-muted-foreground"
                >
                  {dapp.chain}
                </Badge>
              </div>
              <p className="mt-3 flex-1 text-xs leading-5 text-muted-foreground">
                {dapp.blurb}
              </p>
              <div className="mt-4 border-t border-border pt-4">
                {connection ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-xs">
                      <span className="size-1.5 shrink-0 rounded-full bg-red-500" />
                      <span className="truncate text-muted-foreground">
                        {linked ? linked.label : "Connected"}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 shrink-0 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        disconnectDapp({ connectionId: connection._id })
                          .then(() => toast.success(`${dapp.name} disconnected`))
                          .catch(() => toast.error("Could not disconnect"))
                      }
                    >
                      Disconnect
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-muted-foreground">
                      {activeAccount ? `→ ${activeAccount.label}` : "No account yet"}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 rounded-full px-4 text-xs"
                      disabled={!activeAccount}
                      onClick={() =>
                        activeAccount &&
                        connectDapp({
                          origin: dapp.origin,
                          name: dapp.name,
                          accountId: activeAccount._id,
                          chainId: dapp.chainId,
                        })
                          .then(() => toast.success(`${dapp.name} connected`))
                          .catch(() => toast.error("Could not connect"))
                      }
                    >
                      Connect
                    </Button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------- History -------------------------------- */

function HistorySection() {
  const history = useQuery(api.history.list, { limit: 50 }) ?? [];
  const remove = useMutation(api.history.remove);
  const clear = useMutation(api.history.clear);
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-8">
      <SectionHeading
        title="History"
        description="Everything you've visited from the Freman browser, newest first — the same data the browser home page shows."
      />
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          className="rounded-full px-4 text-xs"
          onClick={() =>
            clear()
              .then(() => toast.success("History cleared"))
              .catch(() => toast.error("Could not clear history"))
          }
        >
          <Trash2 className="size-3.5" />
          Clear all history
        </Button>
      </div>
      {history.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          No history yet. Visit pages in the browser and they'll show up here.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          {history.map((entry, i) => (
            <div
              key={entry._id}
              className={`group flex items-center gap-3 px-5 py-3 ${
                i > 0 ? "border-t border-border" : ""
              }`}
            >
              <button
                className="min-w-0 flex-1 truncate text-left text-sm transition-colors hover:text-foreground"
                onClick={() => navigate("/browse")}
                title={entry.url}
              >
                {entry.title}
              </button>
              <span className="hidden max-w-[280px] truncate font-mono text-[11px] text-muted-foreground sm:block">
                {entry.url}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {formatDistanceToNow(new Date(entry.visitedAt), {
                  addSuffix: true,
                })}
              </span>
              <button
                aria-label="Remove entry"
                className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                onClick={() => void remove({ id: entry._id })}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Bookmarks ------------------------------- */

function BookmarksSection() {
  const bookmarks = useQuery(api.bookmarks.list) ?? [];
  const add = useMutation(api.bookmarks.add);
  const remove = useMutation(api.bookmarks.remove);

  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");

  return (
    <div className="flex flex-col gap-8">
      <SectionHeading
        title="Bookmarks"
        description="Saved pages, synced live with the browser's bookmarks bar — add one here and it appears there instantly."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Name"
          className="h-9 w-40 text-xs"
        />
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          className="h-9 w-64 flex-1 font-mono text-xs"
        />
        <Button
          size="sm"
          className="h-9 rounded-full px-4 text-xs"
          onClick={() =>
            add({ label, url })
              .then(() => {
                setLabel("");
                setUrl("");
                toast.success("Bookmark added");
              })
              .catch(() => toast.error("Could not add bookmark"))
          }
        >
          Add bookmark
        </Button>
      </div>

      {bookmarks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          No bookmarks yet. Add one above, or star a page in the browser.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          {bookmarks.map((bookmark, i) => (
            <div
              key={bookmark._id}
              className={`group flex items-center gap-3 px-5 py-3 ${
                i > 0 ? "border-t border-border" : ""
              }`}
            >
              <Bookmark className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium">{bookmark.label}</span>
              <a
                href={bookmark.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden max-w-[320px] truncate font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground sm:block"
              >
                {bookmark.url}
              </a>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => toast("Open it from the browser's bookmarks bar")}
                >
                  Open in browser
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  onClick={() => void remove({ id: bookmark._id })}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Appearance ------------------------------ */

function AppearanceSection() {
  const settings = useQuery(api.settings.get);
  const update = useMutation(api.settings.update);

  const theme = settings?.theme ?? "dark";
  const Row = ({
    title,
    description,
    children,
  }: {
    title: string;
    description: string;
    children: React.ReactNode;
  }) => (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );

  return (
    <div className="flex flex-col gap-8">
      <SectionHeading
        title="Appearance"
        description="Freman's black / white / red identity, tuned your way. Changes apply everywhere instantly."
      />
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        <Row
          title="Theme"
          description="Light, dark, or follow your operating system."
        >
          <div className="inline-flex overflow-hidden rounded-lg border border-border">
            {(["light", "dark", "system"] as const).map((t) => (
              <button
                key={t}
                onClick={() => void update({ theme: t })}
                className={`px-3.5 py-1.5 text-xs capitalize transition-colors ${
                  theme === t
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </Row>
      </div>
      <div className="rounded-xl border border-border bg-muted/40 p-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Brand palette
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {["#000000", "#ffffff", "#f42a17"].map((hex) => (
            <span
              key={hex}
              className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 font-mono text-xs"
            >
              <span
                className="size-3.5 rounded-full border border-border"
                style={{ background: hex }}
              />
              {hex}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- Privacy & Search --------------------------- */

function PrivacySection() {
  const settings = useQuery(api.settings.get);
  const update = useMutation(api.settings.update);
  const clearHistory = useMutation(api.history.clear);

  const Row = ({
    title,
    description,
    children,
  }: {
    title: string;
    description: string;
    children: React.ReactNode;
  }) => (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );

  return (
    <div className="flex flex-col gap-8">
      <SectionHeading
        title="Privacy & Search"
        description="Control what Freman remembers and how its engine behaves — the same settings the browser uses, in real time."
      />
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        <Row
          title="Default search filter"
          description="Applied to searches started from the browser home page."
        >
          <div className="inline-flex overflow-hidden rounded-lg border border-border">
            {(
              [
                ["all", "All"],
                ["web3", "Web3"],
                ["docs", "Developer docs"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => void update({ searchFilter: id })}
                className={`px-3.5 py-1.5 text-xs transition-colors ${
                  (settings?.searchFilter ?? "all") === id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </Row>
        <Row
          title="SafeSearch"
          description="Filter explicit content out of Brave results."
        >
          <Switch
            checked={settings?.safeSearch ?? false}
            onCheckedChange={(v) => void update({ safeSearch: v })}
          />
        </Row>
        <Row
          title="Results per page"
          description="How many results each search page loads."
        >
          <div className="inline-flex overflow-hidden rounded-lg border border-border">
            {["10", "20", "30"].map((n) => (
              <button
                key={n}
                onClick={() =>
                  void update({ resultsPerPage: n as "10" | "20" | "30" })
                }
                className={`px-3.5 py-1.5 text-xs transition-colors ${
                  (settings?.resultsPerPage ?? "10") === n
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </Row>
        <Row
          title="Save browsing history"
          description="Keep visited pages on the browser home page. Stored privately in your account."
        >
          <Switch
            checked={settings?.saveHistory ?? true}
            onCheckedChange={(v) => void update({ saveHistory: v })}
          />
        </Row>
        <Row
          title="Clear browsing data"
          description="Delete your entire browsing history right now."
        >
          <Button
            variant="outline"
            size="sm"
            className="rounded-full px-4 text-xs"
            onClick={() =>
              clearHistory()
                .then(() => toast.success("History cleared"))
                .catch(() => toast.error("Could not clear history"))
            }
          >
            <Trash2 className="size-3.5" />
            Clear history
          </Button>
        </Row>
      </div>
    </div>
  );
}

/* -------------------------------- Account -------------------------------- */

function AccountSection() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const history = useQuery(api.history.list, { limit: 1000 }) ?? [];
  const bookmarks = useQuery(api.bookmarks.list) ?? [];
  const installed = useQuery(api.extensions.listInstalled) ?? [];
  const builds = useQuery(api.builds.list) ?? [];

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="flex flex-col gap-8">
      <SectionHeading
        title="Account"
        description="Your Freman identity and everything attached to it."
      />
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border p-5">
        <div className="grid size-12 place-items-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
          {(user?.name ?? user?.email ?? "F").charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium">{user?.name ?? "Freman user"}</p>
          <p className="truncate text-xs text-muted-foreground">
            {user?.email ?? "—"}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="rounded-full px-4 text-xs"
            onClick={() => navigate("/browse")}
          >
            Open browser
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="rounded-full px-4 text-xs"
            onClick={handleSignOut}
          >
            <LogOut className="size-3.5" />
            Sign out
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        <StatBlock value={history.length} label="Pages in history" />
        <StatBlock value={bookmarks.length} label="Bookmarks" />
        <StatBlock value={installed.length} label="Extensions installed" />
        <StatBlock value={builds.length} label="Builds queued" />
      </div>
    </div>
  );
}

/* ------------------------------- Shortcuts ------------------------------- */

const SHORTCUTS: [string, string][] = [
  ["⌘ T", "New tab"],
  ["⌘ W", "Close tab"],
  ["⌘ L", "Focus the omnibox"],
  ["⌘ D", "Bookmark the current page"],
  ["⌘ F", "Find in page"],
];

function ShortcutsSection() {
  return (
    <div className="flex flex-col gap-8">
      <SectionHeading
        title="Shortcuts"
        description="Keyboard controls inside the Freman browser — the same muscle memory as Chrome."
      />
      <div className="overflow-hidden rounded-xl border border-border">
        {SHORTCUTS.map(([keys, description], i) => (
          <div
            key={keys}
            className={`flex items-center justify-between px-5 py-3.5 ${
              i > 0 ? "border-t border-border" : ""
            }`}
          >
            <span className="text-sm text-muted-foreground">{description}</span>
            <kbd className="rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs">
              {keys}
            </kbd>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        On Windows and Linux, use Ctrl in place of ⌘.
      </p>
    </div>
  );
}

/* --------------------------------- Shell -------------------------------- */

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [section, setSection] = useState<SectionId>("overview");

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl gap-12 px-6 py-10 lg:py-14">
        {/* Sidebar */}
        <aside className="hidden w-52 shrink-0 flex-col lg:flex">
          <a href="/" aria-label="Freman home">
            <FremanWordmark className="text-lg" />
          </a>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Studio v145
          </p>

          <nav className="mt-10 flex flex-col">
            <Link
              to="/browse"
              className="flex items-center gap-3 border-l-2 border-transparent px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <Globe className="size-4" />
              Browser
            </Link>
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setSection(id)}
                className={`flex items-center gap-3 border-l-2 px-4 py-2.5 text-sm transition-colors ${
                  section === id
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </nav>

          <div className="mt-auto border-t border-border pt-5">
            <p className="truncate px-4 text-xs text-muted-foreground">
              {user?.email ?? user?.name ?? "Signed in"}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full justify-start gap-2 px-4 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleSignOut}
            >
              <LogOut className="size-3.5" />
              Sign out
            </Button>
          </div>
        </aside>

        {/* Main column */}
        <main className="min-w-0 flex-1">
          {/* Mobile header + nav */}
          <div className="lg:hidden">
            <div className="flex items-center justify-between">
              <a href="/" aria-label="Freman home">
                <FremanWordmark className="text-lg" />
              </a>
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 text-xs text-muted-foreground"
                onClick={handleSignOut}
              >
                <LogOut className="size-3.5" />
                Sign out
              </Button>
            </div>
            <nav className="mt-6 flex gap-2 overflow-x-auto pb-1">
              <Link
                to="/browse"
                className="shrink-0 rounded-full border border-border px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
              >
                Browser
              </Link>
              {SECTIONS.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setSection(id)}
                  className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs transition-colors ${
                    section === id
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>

          <div className="mt-8 lg:mt-0">
            {section === "overview" && (
              <OverviewSection onNavigate={setSection} />
            )}
            {section === "extensions" && <ExtensionsSection />}
            {section === "web3" && <Web3Section />}
            {section === "dapps" && <DappsSection />}
            {section === "builds" && <BuildsSection />}
            {section === "history" && <HistorySection />}
            {section === "bookmarks" && <BookmarksSection />}
            {section === "appearance" && <AppearanceSection />}
            {section === "privacy" && <PrivacySection />}
            {section === "account" && <AccountSection />}
            {section === "shortcuts" && <ShortcutsSection />}
            {section === "source" && <SourceSection />}
          </div>
        </main>
      </div>
    </div>
  );
}

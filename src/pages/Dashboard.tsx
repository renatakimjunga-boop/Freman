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
import { useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowUpRight,
  BookOpen,
  Copy,
  Globe,
  Hammer,
  LayoutGrid,
  LogOut,
  Puzzle,
  Search,
  Wallet,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

const CHROMIUM_SRC = "https://chromium.googlesource.com/chromium/src";
const CHROMIUM_DOCS =
  "https://chromium.googlesource.com/chromium/src/+/HEAD/docs";
const SAMPLES_REPO = "https://github.com/GoogleChrome/chrome-extensions-samples";

type SectionId = "overview" | "extensions" | "web3" | "builds" | "source";

const SECTIONS: { id: SectionId; label: string; icon: typeof Puzzle }[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "extensions", label: "Extensions", icon: Puzzle },
  { id: "web3", label: "Web3 Wallet", icon: Wallet },
  { id: "builds", label: "Builds", icon: Hammer },
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

      <div className="rounded-xl border border-border">
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <BrowserMark className="size-4 text-muted-foreground" />
          <span className="font-mono text-xs text-muted-foreground">
            freman://studio — current profile
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-xs">
            <span className="size-1.5 rounded-full bg-emerald-500" />
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
    </div>
  );
}

/* --------------------------------- Web3 --------------------------------- */

function shorten(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function Web3Section() {
  const accounts = useQuery(api.wallet.listAccounts) ?? [];
  const connections = useQuery(api.wallet.listConnections) ?? [];
  const createAccount = useMutation(api.wallet.createAccount);
  const removeAccount = useMutation(api.wallet.removeAccount);
  const setPrimary = useMutation(api.wallet.setPrimary);
  const connectDapp = useMutation(api.wallet.connectDapp);
  const disconnectDapp = useMutation(api.wallet.disconnectDapp);

  const [newLabel, setNewLabel] = useState("");

  const connectionByOrigin = useMemo(
    () => new Map(connections.map((c) => [c.origin, c])),
    [connections],
  );
  const activeAccount = accounts.find((a) => a.isPrimary) ?? accounts[0];

  const copyAddress = (address: string) => {
    navigator.clipboard
      .writeText(address)
      .then(() => toast.success("Address copied"))
      .catch(() => toast.error("Copy failed"));
  };

  return (
    <div className="flex flex-col gap-10">
      <SectionHeading
        title="Web3 Wallet"
        description="Freman's built-in wallet speaks EIP-1193. Create accounts, choose a primary, and review every dApp session."
      />

      {/* Accounts */}
      <div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Accounts
          </p>
          <div className="flex items-center gap-2">
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Account label"
              className="h-9 w-40 text-xs"
            />
            <Button
              size="sm"
              className="h-9 rounded-full px-4 text-xs"
              onClick={() =>
                createAccount({ label: newLabel })
                  .then(() => {
                    setNewLabel("");
                    toast.success("Account created");
                  })
                  .catch(() => toast.error("Could not create account"))
              }
            >
              Create account
            </Button>
          </div>
        </div>

        {accounts.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              No accounts yet. Create one to start connecting dApps.
            </p>
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-border">
            {accounts.map((account: Doc<"walletAccounts">, i: number) => (
              <div
                key={account._id}
                className={`flex flex-wrap items-center gap-3 px-5 py-3.5 ${
                  i > 0 ? "border-t border-border" : ""
                }`}
              >
                <span
                  className={`size-1.5 shrink-0 rounded-full ${
                    account.isPrimary ? "bg-emerald-500" : "bg-border"
                  }`}
                />
                <span className="text-sm font-medium">{account.label}</span>
                <button
                  onClick={() => copyAddress(account.address)}
                  className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
                  title="Copy address"
                >
                  {shorten(account.address)}
                  <Copy className="size-3" />
                </button>
                <div className="ml-auto flex items-center gap-1">
                  {!account.isPrimary && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setPrimary({ accountId: account._id })
                          .then(() => toast.success(`${account.label} is now primary`))
                          .catch(() => toast.error("Could not set primary"))
                      }
                    >
                      Make primary
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      removeAccount({ accountId: account._id })
                        .then(() => toast.success("Account removed"))
                        .catch(() => toast.error("Could not remove account"))
                    }
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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
                        <span className="size-1.5 rounded-full bg-emerald-500" />
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
                <span className="size-1.5 rounded-full bg-emerald-500" />
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
            {section === "builds" && <BuildsSection />}
            {section === "source" && <SourceSection />}
          </div>
        </main>
      </div>
    </div>
  );
}

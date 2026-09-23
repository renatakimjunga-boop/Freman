import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { FremanWordmark } from "@/components/FremanWordmark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  EXPLORERS,
  FAMILY_LABELS,
  DEFAULT_NETWORKS,
  NATIVE_PRICE_IDS,
  NETWORK_TOKENS,
  TOKEN_PRICE_IDS,
  accountFamily,
  formatChainAmount,
  isValidRecipient,
  networkMeta,
  networksForFamily,
  shortenAddress,
  type ChainFamily,
} from "@/lib/networks";
import { useAction, useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpRight,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { QRCodeSVG } from "qrcode.react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

type Account = Doc<"walletAccounts">;
type Tx = Doc<"walletTransactions">;

interface NativeBalance {
  formatted: string;
  symbol: string;
}

interface TokenRow {
  symbol: string;
  name: string;
  contract: string;
  formatted: string;
}

interface ChartState {
  current: number;
  change24h: number;
  points: Array<{ t: number; p: number }>;
}

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function copyText(text: string, label = "Copied to clipboard") {
  void navigator.clipboard
    .writeText(text)
    .then(() => toast.success(label))
    .catch(() => toast.error("Could not copy"));
}

function explorerFor(chain: string, hash: string): string | null {
  const tpl = EXPLORERS[chain];
  return tpl ? tpl.replace("$TX", hash) : null;
}

/* --------------------------------- page ---------------------------------- */

export default function WalletPage() {
  const accounts = useQuery(api.wallet.listAccounts) ?? [];
  const allTxs = useQuery(api.transactions.list) ?? [];
  const createAccount = useAction(api.custodialWallet.createAccount);
  const getNativeBalance = useAction(api.custodialWallet.getBalance);
  const getTokenBalances = useAction(api.custodialWallet.getTokenBalances);
  const priceHistoryAction = useAction(api.market.priceHistory);
  const tokenPricesAction = useAction(api.market.tokenPrices);
  const refreshStatuses = useAction(api.custodialWallet.refreshPendingStatuses);
  const getPortfolio = useAction(api.portfolio.getPortfolio);
  const addTokenAction = useAction(api.tokens.addToken);
  const removeToken = useMutation(api.tokenStore.removeToken);

  const [family, setFamily] = useState<ChainFamily>("evm");
  const [network, setNetwork] = useState<string>(DEFAULT_NETWORKS.evm);
  const [native, setNative] = useState<NativeBalance | null>(null);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [chart, setChart] = useState<ChartState | null>(null);
  const [chartDays, setChartDays] = useState<"1" | "7" | "30">("7");
  const [prices, setPrices] = useState<Record<string, { usd: number; change24h: number }>>({});
  const [dialog, setDialog] = useState<null | "send" | "receive" | "swap" | "security" | "add">(null);
  const [view, setView] = useState<"network" | "all">("network");
  const [portfolio, setPortfolio] = useState<{
    rows: Array<{
      network: string;
      address: string;
      accountId: string;
      chainType: string;
      symbol: string;
      formatted: string;
      testnet: boolean;
    }>;
    failed: string[];
  } | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [portfolioPrices, setPortfolioPrices] = useState<
    Record<string, { usd: number; change24h: number }>
  >({});

  const meta = networkMeta(network);
  const familyAccounts = accounts.filter((a) => accountFamily(a) === family);
  const account: Account | undefined =
    familyAccounts.find((a) => a.isPrimary) ?? familyAccounts[0];

  // User-added tokens for the current EVM network (manage/remove UI).
  const customTokens =
    useQuery(
      api.tokenStore.listForNetwork,
      family === "evm" ? { network } : "skip",
    ) ?? [];

  function changeFamily(f: ChainFamily) {
    setFamily(f);
    setNetwork(DEFAULT_NETWORKS[f]);
    setNative(null);
    setTokens([]);
    setChart(null);
  }

  /* Balances: live from chain whenever account or network changes. */
  useEffect(() => {
    if (!account) {
      setNative(null);
      setTokens([]);
      return;
    }
    let cancelled = false;
    setBalancesLoading(true);
    Promise.all([
      getNativeBalance({ address: account.address, network }),
      getTokenBalances({ address: account.address, network }),
    ])
      .then(([nb, tb]) => {
        if (cancelled) return;
        setNative({ formatted: nb.formatted, symbol: nb.symbol });
        setTokens(tb);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Balance check failed");
          setNative(null);
          setTokens([]);
        }
      })
      .finally(() => {
        if (!cancelled) setBalancesLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?._id, network]);

  /* Refresh balances after any dialog action closes. */
  const refreshBalances = useCallback(() => {
    if (!account) return;
    setBalancesLoading(true);
    Promise.all([
      getNativeBalance({ address: account.address, network }),
      getTokenBalances({ address: account.address, network }),
    ])
      .then(([nb, tb]) => {
        setNative({ formatted: nb.formatted, symbol: nb.symbol });
        setTokens(tb);
      })
      .catch(() => undefined)
      .finally(() => setBalancesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?._id, network]);

  /* USD prices for the native asset and listed tokens. */
  useEffect(() => {
    const nativeId = NATIVE_PRICE_IDS[network];
    const tokenIds = [
      ...new Set(tokens.map((t) => TOKEN_PRICE_IDS[t.symbol]).filter((x) => x)),
    ];
    const ids = nativeId ? [nativeId, ...tokenIds] : tokenIds;
    if (ids.length === 0) {
      setPrices({});
      return;
    }
    let cancelled = false;
    tokenPricesAction({ ids })
      .then((p) => {
        if (!cancelled) setPrices(p);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network, tokens]);

  const loadChart = useCallback(
    (days: "1" | "7" | "30") => {
      setChartDays(days);
      priceHistoryAction({ network, days })
        .then(setChart)
        .catch((err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Price data unavailable"),
        );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [network],
  );

  useEffect(() => {
    loadChart(chartDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);

  /* Poll on-chain status while any transaction is still pending; the set of
     pending hashes (not the query identity) drives re-arming the interval. */
  const pendingKey = allTxs
    .filter((t: Tx) => t.status === "pending")
    .map((t: Tx) => t.hash)
    .join(",");
  useEffect(() => {
    if (!pendingKey) return;
    const tick = () => {
      refreshStatuses({}).catch(() => undefined);
    };
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey]);

  /* Portfolio (All networks view): load per visit + on account changes. */
  const loadPortfolio = useCallback(() => {
    setPortfolioLoading(true);
    getPortfolio({})
      .then(setPortfolio)
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Portfolio check failed"),
      )
      .finally(() => setPortfolioLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (view === "all") loadPortfolio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, accounts.length]);

  /* USD prices for every network represented in the portfolio. */
  useEffect(() => {
    if (view !== "all" || !portfolio) return;
    const ids = [
      ...new Set(portfolio.rows.map((r) => NATIVE_PRICE_IDS[r.network]).filter(Boolean)),
    ];
    if (ids.length === 0) {
      setPortfolioPrices({});
      return;
    }
    let cancelled = false;
    tokenPricesAction({ ids })
      .then((p) => {
        if (!cancelled) setPortfolioPrices(p);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, portfolio]);

  const nativePrice = prices[NATIVE_PRICE_IDS[network] ?? ""]?.usd ?? 0;
  const nativeChange = prices[NATIVE_PRICE_IDS[network] ?? ""]?.change24h ?? 0;
  const tokensUsd = tokens.reduce(
    (sum, t) => sum + (prices[TOKEN_PRICE_IDS[t.symbol]]?.usd ?? 0) * Number(t.formatted),
    0,
  );
  const totalUsd = (native ? Number(native.formatted) * nativePrice : 0) + tokensUsd;

  const txs = allTxs
    .filter((t: Tx) => t.accountId === account?._id)
    .sort((a: Tx, b: Tx) => b.createdAt - a.createdAt)
    .slice(0, 12);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-4">
            <FremanWordmark className="text-lg" />
            <span className="hidden text-[11px] uppercase tracking-[0.2em] text-muted-foreground sm:inline">
              Web3 Wallet
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/dashboard"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              ← Studio
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {/* Chain family + network */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex overflow-hidden rounded-lg border border-border">
              <button
                onClick={() => setView("network")}
                className={`px-3 py-1.5 text-xs transition-colors ${
                  view === "network"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Single network
              </button>
              <button
                onClick={() => setView("all")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
                  view === "all"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Layers className="size-3" />
                All networks
              </button>
            </div>
            {view === "network" && (
              <>
            <div className="inline-flex overflow-hidden rounded-lg border border-border">
              {(["evm", "solana", "tron"] as ChainFamily[]).map((f) => (
                <button
                  key={f}
                  onClick={() => changeFamily(f)}
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
            <Select value={network} onValueChange={setNetwork}>
              <SelectTrigger className="h-9 w-[210px] rounded-lg text-xs">
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
              </>
            )}
          </div>
          {account && (
            <button
              onClick={() => copyText(account.address, "Address copied")}
              className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              {shortenAddress(account.address)}
              <Copy className="size-3" />
            </button>
          )}
        </div>

        {meta && !meta.testnet && (
          <p className="mt-4 flex items-center gap-2 text-xs text-red-500">
            <span className="size-1.5 rounded-full bg-red-500" />
            {meta.label} moves real funds — double-check everything.
          </p>
        )}

        {!account ? (
          <div className="mt-10 rounded-xl border border-dashed border-border px-6 py-14 text-center">
            <p className="text-sm text-muted-foreground">
              No {FAMILY_LABELS[family]} account yet. Create one to get a real
              on-chain address — keys derive from your encrypted master seed.
            </p>
            <Button
              className="mt-6 rounded-full px-6"
              onClick={() =>
                createAccount({ label: "", chainType: family })
                  .then(() =>
                    toast.success(
                      `${FAMILY_LABELS[family]} account created`,
                    ),
                  )
                  .catch((err: unknown) =>
                    toast.error(
                      err instanceof Error ? err.message : "Could not create account",
                    ),
                  )
              }
            >
              <Plus className="mr-2 size-4" />
              Create {FAMILY_LABELS[family]} account
            </Button>
          </div>
        ) : view === "all" ? (
          <PortfolioView
            rows={portfolio?.rows ?? []}
            failed={portfolio?.failed ?? []}
            loading={portfolioLoading && !portfolio}
            prices={portfolioPrices}
            onSwitch={(net) => {
              const m = networkMeta(net);
              if (!m) return;
              changeFamily(m.family);
              setNetwork(net);
              setView("network");
            }}
            onRefresh={loadPortfolio}
          />
        ) : (
          <>
            {/* Balance + chart */}
            <section className="mt-8 overflow-hidden rounded-xl border border-border">
              <div className="flex flex-wrap items-end justify-between gap-6 px-6 pt-6">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    {meta?.label ?? network} balance
                  </p>
                  <div className="mt-2 flex flex-wrap items-baseline gap-3">
                    {balancesLoading && !native ? (
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    ) : (
                      <span className="text-4xl font-semibold tracking-tight">
                        {native
                          ? `${Number(native.formatted).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${native.symbol}`
                          : `0 ${meta?.symbol ?? ""}`}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-sm">
                    <span className="text-muted-foreground">
                      ≈ {usd(totalUsd)} total
                    </span>
                    {nativePrice > 0 && (
                      <Badge
                        variant="outline"
                        className={`font-mono text-[11px] ${
                          nativeChange >= 0
                            ? "border-emerald-500/40 text-emerald-500"
                            : "border-red-500/40 text-red-500"
                        }`}
                      >
                        {nativeChange >= 0 ? "▲" : "▼"}{" "}
                        {Math.abs(nativeChange).toFixed(2)}% 24h
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="inline-flex overflow-hidden rounded-lg border border-border">
                  {(["1", "7", "30"] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => loadChart(d)}
                      className={`px-3 py-1.5 text-xs transition-colors ${
                        chartDays === d
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-4 h-44 px-2 pb-2">
                {chart && chart.points.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chart.points} margin={{ top: 8, right: 16, bottom: 0, left: 16 }}>
                      <defs>
                        <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f42a17" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="#f42a17" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="t"
                        tick={{ fontSize: 10 }}
                        stroke="currentColor"
                        opacity={0.4}
                        tickFormatter={(t: number) =>
                          chartDays === "1"
                            ? new Date(t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
                            : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                        }
                        minTickGap={48}
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        stroke="currentColor"
                        opacity={0.4}
                        width={64}
                        tickFormatter={(p: number) => usd(p)}
                        domain={["auto", "auto"]}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "var(--card, #111)",
                          border: "1px solid var(--border, #333)",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        labelFormatter={(t) => new Date(Number(t)).toLocaleString("en-US")}
                        formatter={(value) => [usd(Number(value)), "Price"]}
                      />
                      <Area
                        type="monotone"
                        dataKey="p"
                        stroke="#f42a17"
                        strokeWidth={1.5}
                        fill="url(#priceFill)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    <Loader2 className="mr-2 size-4 animate-spin" /> Loading price history…
                  </div>
                )}
              </div>
            </section>

            {/* Actions */}
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Button
                variant="outline"
                className="h-14 flex-col gap-1 rounded-xl"
                onClick={() => setDialog("send")}
              >
                <ArrowUpRight className="size-4" />
                <span className="text-xs">Send</span>
              </Button>
              <Button
                variant="outline"
                className="h-14 flex-col gap-1 rounded-xl"
                onClick={() => setDialog("receive")}
              >
                <ArrowDownToLine className="size-4" />
                <span className="text-xs">Receive</span>
              </Button>
              <Button
                variant="outline"
                className="h-14 flex-col gap-1 rounded-xl"
                onClick={() => setDialog("swap")}
              >
                <ArrowLeftRight className="size-4" />
                <span className="text-xs">Swap</span>
              </Button>
              <Button
                variant="outline"
                className="h-14 flex-col gap-1 rounded-xl"
                onClick={() => setDialog("security")}
              >
                <KeyRound className="size-4" />
                <span className="text-xs">Seed & Keys</span>
              </Button>
            </div>

            {/* Tokens */}
            <section className="mt-8">
              <div className="flex items-center justify-between">
                <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  Coins & tokens
                </h2>
                <div className="flex items-center gap-1">
                  {family === "evm" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-muted-foreground"
                      onClick={() => setDialog("add")}
                    >
                      <Plus className="mr-1.5 size-3" />
                      Add token
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs text-muted-foreground"
                    onClick={refreshBalances}
                    disabled={balancesLoading}
                  >
                    <RefreshCw className={`mr-1.5 size-3 ${balancesLoading ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                </div>
              </div>
              <div className="mt-3 overflow-hidden rounded-xl border border-border">
                <TokenRowView
                  symbol={native?.symbol ?? meta?.symbol ?? ""}
                  name={`${meta?.label ?? "Native"} (native)`}
                  amount={native ? Number(native.formatted) : 0}
                  usdValue={native ? Number(native.formatted) * nativePrice : 0}
                />
                {tokens.map((t) => {
                  const custom = customTokens.find(
                    (c) => c.contract.toLowerCase() === t.contract.toLowerCase(),
                  );
                  return (
                    <TokenRowView
                      key={t.contract}
                      symbol={t.symbol}
                      name={t.name}
                      amount={Number(t.formatted)}
                      usdValue={(prices[TOKEN_PRICE_IDS[t.symbol]]?.usd ?? 0) * Number(t.formatted)}
                      onRemove={
                        custom
                          ? () =>
                              removeToken({ tokenId: custom._id })
                                .then(() => toast.success(`Removed ${custom.symbol}`))
                                .catch((err: unknown) =>
                                  toast.error(
                                    err instanceof Error ? err.message : "Remove failed",
                                  ),
                                )
                          : undefined
                      }
                    />
                  );
                })}
                {balancesLoading && (
                  <div className="flex items-center gap-2 border-t border-border px-6 py-3 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" /> Reading on-chain balances…
                  </div>
                )}
              </div>
            </section>

            {/* History */}
            <section className="mt-8">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Transaction history
              </h2>
              {txs.length === 0 ? (
                <div className="mt-3 rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
                  No transactions yet for this account.
                </div>
              ) : (
                <div className="mt-3 overflow-hidden rounded-xl border border-border">
                  {txs.map((t: Tx) => {
                    // EVM addresses are case-insensitive; Solana/Tron base58 are not.
                    const outgoing =
                      accountFamily(account) === "evm"
                        ? t.from.toLowerCase() === account.address.toLowerCase()
                        : t.from === account.address;
                    const explorer = explorerFor(t.chain, t.hash);
                    return (
                      <div
                        key={t._id}
                        className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4 last:border-b-0"
                      >
                        <div className="flex items-center gap-4">
                          <div
                            className={`flex size-9 items-center justify-center rounded-full border ${
                              outgoing
                                ? "border-border text-muted-foreground"
                                : "border-emerald-500/40 text-emerald-500"
                            }`}
                          >
                            {outgoing ? (
                              <ArrowUpRight className="size-4" />
                            ) : (
                              <ArrowDownToLine className="size-4" />
                            )}
                          </div>
                          <div>
                            <p className="text-sm font-medium">
                              {outgoing ? "Sent" : "Received"}{" "}
                              <span className="text-muted-foreground">
                                {formatChainAmount(t.chain, t.valueWei)}{" "}
                                {networkMeta(t.chain)?.symbol ?? ""}
                              </span>
                            </p>
                            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                              {networkMeta(t.chain)?.label ?? t.chain} ·{" "}
                              {shortenAddress(outgoing ? t.to : t.from)} ·{" "}
                              {formatDistanceToNow(new Date(t.createdAt), { addSuffix: true })}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge
                            variant="outline"
                            className={`text-[10px] uppercase tracking-wider ${
                              t.status === "confirmed"
                                ? "border-emerald-500/40 text-emerald-500"
                                : t.status === "failed"
                                  ? "border-red-500/40 text-red-500"
                                  : "text-muted-foreground"
                            }`}
                          >
                            {t.status}
                          </Badge>
                          {explorer && (
                            <a
                              href={explorer}
                              target="_blank"
                              rel="noreferrer"
                              className="text-muted-foreground transition-colors hover:text-foreground"
                              aria-label="View on explorer"
                            >
                              <ExternalLink className="size-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* Dialogs */}
      {dialog === "send" && account && (
        <SendDialog
          account={account}
          network={network}
          onClose={() => {
            setDialog(null);
            refreshBalances();
          }}
        />
      )}
      {dialog === "receive" && account && (
        <ReceiveDialog account={account} onClose={() => setDialog(null)} />
      )}
      {dialog === "swap" && account && (
        <SwapDialog
          account={account}
          network={network}
          onClose={() => {
            setDialog(null);
            refreshBalances();
          }}
        />
      )}
      {dialog === "security" && account && (
        <SecurityDialog account={account} onClose={() => setDialog(null)} />
      )}
      {dialog === "add" && (
        <AddTokenDialog
          network={network}
          onClose={() => {
            setDialog(null);
            refreshBalances();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------- sub-views -------------------------------- */

function TokenRowView({
  symbol,
  name,
  amount,
  usdValue,
  onRemove,
}: {
  symbol: string;
  name: string;
  amount: number;
  usdValue: number;
  onRemove?: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border px-6 py-4 last:border-b-0">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-full border border-border text-xs font-semibold">
          {symbol.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <p className="text-sm font-medium">{symbol}</p>
          <p className="text-[11px] text-muted-foreground">{name}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="font-mono text-sm">
            {amount.toLocaleString("en-US", { maximumFractionDigits: 9 })}
          </p>
          {usdValue > 0 && (
            <p className="text-[11px] text-muted-foreground">{usd(usdValue)}</p>
          )}
        </div>
        {onRemove && (
          <button
            onClick={onRemove}
            aria-label={`Remove ${symbol}`}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-red-500"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/* --------------------------------- send ----------------------------------- */

function SendDialog({
  account,
  network,
  onClose,
}: {
  account: Account;
  network: string;
  onClose: () => void;
}) {
  const send = useAction(api.custodialWallet.sendTransaction);
  const meta = networkMeta(network);
  const isMainnet = meta ? !meta.testnet : true;
  const family = accountFamily(account);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const recipientOk = isValidRecipient(family, to.trim());
  const amountOk = Number(amount) > 0;
  const ready = recipientOk && amountOk && (!isMainnet || confirmed);

  function submit() {
    if (!ready) return;
    setBusy(true);
    send({
      accountId: account._id,
      to: to.trim(),
      amount: amount.trim(),
      network,
      confirmed: isMainnet ? confirmed : true,
    })
      .then((res) => {
        toast.success("Transaction broadcast", {
          description: `${amount} ${meta?.symbol ?? ""} → ${shortenAddress(res.to)}`,
          action: res.explorerUrl
            ? { label: "Explorer", onClick: () => window.open(res.explorerUrl, "_blank") }
            : undefined,
        });
        onClose();
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Send failed"),
      )
      .finally(() => setBusy(false));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send {meta?.symbol}</DialogTitle>
          <DialogDescription>
            From {account.label} ({shortenAddress(account.address)}) on{" "}
            {meta?.label ?? network}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">Recipient</label>
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={family === "evm" ? "0x…" : family === "tron" ? "T…" : "Base58 address"}
              className="mt-1.5 font-mono text-xs"
            />
            {to.length > 0 && !recipientOk && (
              <p className="mt-1.5 text-xs text-red-500">Invalid {family} address.</p>
            )}
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Amount</label>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              type="number"
              min="0"
              step="any"
              placeholder={`0.00 ${meta?.symbol ?? ""}`}
              className="mt-1.5"
            />
          </div>
          {isMainnet && (
            <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-red-500" />
              <div className="flex-1">
                <p className="text-xs font-medium text-red-500">
                  {meta?.label} moves real funds
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  I have verified the recipient and understand this transfer is
                  irreversible.
                </p>
              </div>
              <Switch checked={confirmed} onCheckedChange={setConfirmed} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!ready || busy}>
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------- receive --------------------------------- */

function ReceiveDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Receive</DialogTitle>
          <DialogDescription>
            Share this address to receive {FAMILY_LABELS[accountFamily(account)]}{" "}
            assets. Only send assets on matching networks.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="rounded-xl border border-border bg-white p-4">
            <QRCodeSVG value={account.address} size={168} />
          </div>
          <p className="break-all text-center font-mono text-xs text-muted-foreground">
            {account.address}
          </p>
        </div>
        <DialogFooter>
          <Button
            className="w-full"
            onClick={() => {
              copyText(account.address, "Address copied");
              setCopied(true);
            }}
          >
            {copied ? <Check className="mr-2 size-4" /> : <Copy className="mr-2 size-4" />}
            Copy address
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------- swap ---------------------------------- */

function SwapDialog({
  account,
  network,
  onClose,
}: {
  account: Account;
  network: string;
  onClose: () => void;
}) {
  const quoteAction = useAction(api.custodialWallet.swapQuote);
  const swapAction = useAction(api.custodialWallet.swapTokens);
  const meta = networkMeta(network);
  const isMainnet = meta ? !meta.testnet : false;

  const options = [
    { value: "native", label: `${meta?.symbol ?? "Native"} (native)` },
    ...NETWORK_TOKENS[network].map((t) => ({ value: t.address, label: t.symbol })),
  ];
  const defaultBuy = NETWORK_TOKENS[network][0]?.address ?? "native";

  const [sell, setSell] = useState("native");
  const [buy, setBuy] = useState(defaultBuy);
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [confirmed, setConfirmed] = useState(false);
  const [quote, setQuote] = useState<{
    provider: string;
    buyAmountRaw: string;
    buyDecimals: number;
  } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [swapping, setSwapping] = useState(false);

  const amountOk = Number(amount) > 0 && sell !== buy;
  const ready = amountOk && (!isMainnet || confirmed);

  function getQuote() {
    if (!amountOk) return;
    setQuoting(true);
    setQuote(null);
    quoteAction({
      accountId: account._id,
      network,
      sellToken: sell,
      buyToken: buy,
      amount: amount.trim(),
      slippageBps,
    })
      .then(setQuote)
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Quote failed"),
      )
      .finally(() => setQuoting(false));
  }

  function execute() {
    if (!ready) return;
    setSwapping(true);
    swapAction({
      accountId: account._id,
      network,
      sellToken: sell,
      buyToken: buy,
      amount: amount.trim(),
      slippageBps,
      confirmed: true,
    })
      .then((res) => {
        toast.success("Swap broadcast", {
          description: `≈ ${(
            Number(BigInt(res.buyAmountRaw || "0")) /
            10 ** res.buyDecimals
          ).toLocaleString("en-US", { maximumFractionDigits: 9 })} received (est.)`,
          action: { label: "Explorer", onClick: () => window.open(res.explorerUrl, "_blank") },
        });
        onClose();
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Swap failed"),
      )
      .finally(() => setSwapping(false));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Swap</DialogTitle>
          <DialogDescription>
            Executed via on-chain liquidity aggregators (Jupiter on Solana, 0x on
            EVM). Mainnet only.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">You pay</label>
            <div className="mt-1.5 flex gap-2">
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                type="number"
                min="0"
                step="any"
                placeholder="0.00"
                className="flex-1"
              />
              <Select value={sell} onValueChange={setSell}>
                <SelectTrigger className="w-36 rounded-lg text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">You receive</label>
            <div className="mt-1.5 flex gap-2">
              <Input
                value={
                  quote
                    ? (
                        Number(BigInt(quote.buyAmountRaw || "0")) /
                        10 ** quote.buyDecimals
                      ).toLocaleString("en-US", { maximumFractionDigits: 9 })
                    : ""
                }
                readOnly
                placeholder="Get quote"
                className="flex-1 font-mono text-xs text-muted-foreground"
              />
              <Select value={buy} onValueChange={setBuy}>
                <SelectTrigger className="w-36 rounded-lg text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem
                      key={o.value}
                      value={o.value}
                      disabled={o.value === sell}
                      className="text-xs"
                    >
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground">Slippage</label>
            <div className="inline-flex overflow-hidden rounded-lg border border-border">
              {[50, 100, 200].map((bps) => (
                <button
                  key={bps}
                  onClick={() => setSlippageBps(bps)}
                  className={`px-3 py-1.5 text-xs transition-colors ${
                    slippageBps === bps
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {bps / 100}%
                </button>
              ))}
            </div>
          </div>
          {quote && (
            <p className="rounded-lg border border-border px-4 py-2.5 text-[11px] text-muted-foreground">
              Quoted via <span className="font-medium">{quote.provider}</span> — the
              executed rate is re-quoted at swap time.
            </p>
          )}
          {!isMainnet && (
            <p className="text-[11px] text-muted-foreground">
              {meta?.label} is a testnet — switch to a mainnet network to swap.
            </p>
          )}
          {isMainnet && (
            <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-red-500" />
              <div className="flex-1">
                <p className="text-xs font-medium text-red-500">Real funds</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  This swap trades real value on {meta?.label}.
                </p>
              </div>
              <Switch checked={confirmed} onCheckedChange={setConfirmed} />
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={getQuote}
            disabled={!amountOk || quoting || !isMainnet}
          >
            {quoting ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Get quote
          </Button>
          <Button onClick={execute} disabled={!ready || swapping}>
            {swapping ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Swap
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------- security -------------------------------- */

function SecurityDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const revealSeedAction = useAction(api.custodialWallet.revealVaultSeed);
  const revealKeyAction = useAction(api.custodialWallet.revealAccountKey);
  const [ack, setAck] = useState("");
  const [seed, setSeed] = useState<string | null>(null);
  const [keyInfo, setKeyInfo] = useState<{
    encoding: string;
    privateKey: string;
  } | null>(null);
  const [busy, setBusy] = useState<"seed" | "key" | null>(null);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Seed & wallet keys</DialogTitle>
          <DialogDescription>
            Freman is fully custodial of your own vault: a 32-byte master seed
            encrypted at rest (AES-256-GCM) derives every account key. Anyone with
            these secrets controls your funds — never share them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Master recovery seed */}
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm font-medium">Master recovery seed</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Back this up offline. It restores every account on every chain.
              Type <span className="font-mono">I understand</span> to reveal.
            </p>
            <Input
              value={ack}
              onChange={(e) => setAck(e.target.value)}
              placeholder="I understand"
              className="mt-3 h-9 text-xs"
            />
            {seed ? (
              <div className="mt-3 rounded-md border border-border bg-muted/40 p-3">
                <div className="grid grid-cols-2 gap-1 font-mono text-[10px] leading-4 break-all">
                  {seed.match(/.{1,32}/g)?.map((chunk, i) => (
                    <span key={i} className="text-muted-foreground">
                      {chunk}
                    </span>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 h-7 text-xs"
                  onClick={() => copyText(seed, "Recovery seed copied — store it safely")}
                >
                  <Copy className="mr-1.5 size-3" /> Copy seed
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                disabled={ack.trim().toLowerCase() !== "i understand" || busy === "seed"}
                onClick={() => {
                  setBusy("seed");
                  revealSeedAction({ confirmed: true })
                    .then((r) => setSeed(r.seedHex))
                    .catch((err: unknown) =>
                      toast.error(err instanceof Error ? err.message : "Could not reveal seed"),
                    )
                    .finally(() => setBusy(null));
                }}
              >
                {busy === "seed" ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <KeyRound className="mr-2 size-4" />
                )}
                Reveal recovery seed
              </Button>
            )}
          </div>

          {/* Account private key */}
          <div className="rounded-lg border border-border p-4">
            <p className="text-sm font-medium">
              Account private key{" "}
              <span className="font-normal text-muted-foreground">
                — {account.label} ({shortenAddress(account.address)})
              </span>
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Imports into MetaMask (EVM), TronLink (Tron) or any Solana wallet
              (32-byte base58 key).
            </p>
            {keyInfo ? (
              <div className="mt-3 rounded-md border border-border bg-muted/40 p-3">
                <p className="break-all font-mono text-[11px] leading-5">
                  {keyInfo.privateKey}
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  encoding: {keyInfo.encoding}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 h-7 text-xs"
                  onClick={() => copyText(keyInfo.privateKey, "Private key copied")}
                >
                  <Copy className="mr-1.5 size-3" /> Copy key
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                disabled={ack.trim().toLowerCase() !== "i understand" || busy === "key"}
                onClick={() => {
                  setBusy("key");
                  revealKeyAction({ accountId: account._id, confirmed: true })
                    .then((r) =>
                      setKeyInfo({ encoding: r.encoding, privateKey: r.privateKey }),
                    )
                    .catch((err: unknown) =>
                      toast.error(err instanceof Error ? err.message : "Could not export key"),
                    )
                    .finally(() => setBusy(null));
                }}
              >
                {busy === "key" ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <KeyRound className="mr-2 size-4" />
                )}
                Export this account's key
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- portfolio -------------------------------- */

function PortfolioView({
  rows,
  failed,
  loading,
  prices,
  onSwitch,
  onRefresh,
}: {
  rows: Array<{
    network: string;
    address: string;
    accountId: string;
    chainType: string;
    symbol: string;
    formatted: string;
    testnet: boolean;
  }>;
  failed: string[];
  loading: boolean;
  prices: Record<string, { usd: number; change24h: number }>;
  onSwitch: (network: string) => void;
  onRefresh: () => void;
}) {
  const totalUsd = rows.reduce(
    (sum, r) => sum + Number(r.formatted) * (prices[NATIVE_PRICE_IDS[r.network] ?? ""]?.usd ?? 0),
    0,
  );
  const sorted = [...rows].sort((a, b) => {
    if (a.testnet !== b.testnet) return a.testnet ? 1 : -1;
    return a.network.localeCompare(b.network);
  });

  return (
    <section className="mt-8 overflow-hidden rounded-xl border border-border">
      <div className="flex flex-wrap items-end justify-between gap-4 px-6 pt-6">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            All networks — total value
          </p>
          <div className="mt-2">
            {loading ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            ) : (
              <span className="text-4xl font-semibold tracking-tight">{usd(totalUsd)}</span>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Native balances across {rows.length} account-network pair
            {rows.length === 1 ? "" : "s"} ·{" "}
            <button onClick={onRefresh} className="underline-offset-2 hover:underline">
              refresh
            </button>
          </p>
        </div>
      </div>

      {failed.length > 0 && (
        <p className="mx-6 mt-4 flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-[11px] text-muted-foreground">
          <TriangleAlert className="size-3.5 shrink-0" />
          Could not read: {failed.map((f) => networkMeta(f)?.label ?? f).join(", ")}
        </p>
      )}

      <div className="mt-6">
        {sorted.length === 0 && !loading ? (
          <div className="px-6 pb-10 text-center text-sm text-muted-foreground">
            No balances found yet. Create an account to get started.
          </div>
        ) : (
          sorted.map((r) => {
            const m = networkMeta(r.network);
            const p = prices[NATIVE_PRICE_IDS[r.network] ?? ""]?.usd ?? 0;
            const amount = Number(r.formatted);
            return (
              <button
                key={`${r.network}:${r.address}`}
                onClick={() => onSwitch(r.network)}
                className="flex w-full items-center justify-between border-t border-border px-6 py-4 text-left transition-colors hover:bg-muted/50"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-full border border-border text-[10px] font-semibold uppercase">
                    {r.chainType.slice(0, 3)}
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      {m?.label ?? r.network}
                      {r.testnet && (
                        <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                          test
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      {shortenAddress(r.address)}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm">
                    {amount.toLocaleString("en-US", { maximumFractionDigits: 9 })} {r.symbol}
                  </p>
                  {p > 0 && amount > 0 && (
                    <p className="text-[11px] text-muted-foreground">{usd(amount * p)}</p>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

/* ------------------------------ add token --------------------------------- */

function AddTokenDialog({ network, onClose }: { network: string; onClose: () => void }) {
  const addTokenAction = useAction(api.tokens.addToken);
  const [contract, setContract] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = /^0x[0-9a-fA-F]{40}$/.test(contract.trim());

  function submit() {
    if (!valid) return;
    setBusy(true);
    addTokenAction({ network, contract: contract.trim() })
      .then((r) => {
        toast.success(`Added ${r.symbol}`, { description: r.name });
        onClose();
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Could not add token"),
      )
      .finally(() => setBusy(false));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add token</DialogTitle>
          <DialogDescription>
            Paste an ERC-20 contract address on {networkMeta(network)?.label ?? network}. Freman
            reads decimals, symbol and name from the chain before saving.
          </DialogDescription>
        </DialogHeader>
        <div>
          <label className="text-xs text-muted-foreground">Contract address</label>
          <Input
            value={contract}
            onChange={(e) => setContract(e.target.value)}
            placeholder="0x…"
            className="mt-1.5 font-mono text-xs"
          />
          {contract.length > 0 && !valid && (
            <p className="mt-1.5 text-xs text-red-500">Invalid contract address.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || busy}>
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Plus className="mr-2 size-4" />}
            Add token
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

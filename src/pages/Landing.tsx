import { motion } from "framer-motion";
import { ArrowRight, ArrowUpRight, Copy } from "lucide-react";
import { toast } from "sonner";
import { FremanWordmark } from "@/components/FremanWordmark";
import { Button } from "@/components/ui/button";
import { EXTENSION_SAMPLES } from "@/lib/extension-samples";
import { useAuth } from "@/hooks/use-auth";

const CHROMIUM_SRC = "https://chromium.googlesource.com/chromium/src";
const CHROMIUM_DOCS =
  "https://chromium.googlesource.com/chromium/src/+/HEAD/docs";
const SAMPLES_REPO = "https://github.com/GoogleChrome/chrome-extensions-samples";

function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, delay, ease: [0.21, 0.47, 0.32, 0.98] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
      {children}
    </p>
  );
}

function BrowserMock() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/* window chrome */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full border border-foreground/40" />
          <span className="size-2.5 rounded-full border border-foreground/40" />
          <span className="size-2.5 rounded-full border border-foreground/40" />
        </div>
        <div className="mx-auto flex w-full max-w-xs items-center justify-center rounded-md border border-border px-3 py-1 font-mono text-[11px] text-muted-foreground">
          freman://search?q=web3+browser
        </div>
        <div className="w-10" />
      </div>
      {/* content */}
      <div className="grid grid-cols-[120px_1fr] gap-px bg-border sm:grid-cols-[160px_1fr]">
        <div className="flex flex-col gap-2 bg-card p-4">
          {["Overview", "Catalog", "Wallet", "Builds"].map((item, i) => (
            <div
              key={item}
              className={`rounded-md px-2.5 py-1.5 text-[11px] ${
                i === 2
                  ? "bg-foreground text-background"
                  : "text-muted-foreground"
              }`}
            >
              {item}
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-3 bg-card p-4 sm:p-6">
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
                Wallet
              </span>
              <span className="flex items-center gap-1.5 text-[11px] text-foreground">
                <span className="size-1.5 rounded-full bg-red-500" />
                Connected
              </span>
            </div>
            <p className="mt-3 font-mono text-xs text-foreground">
              0x7f3a…c42e
            </p>
            <div className="mt-1 h-1.5 w-24 rounded-full bg-muted" />
          </div>
          <div className="flex flex-col gap-2">
            {["Wallet Provider", "ENS Resolver", "Signature Guard"].map(
              (name) => (
                <div
                  key={name}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                >
                  <span className="text-[11px] text-foreground">{name}</span>
                  <span className="h-3.5 w-6 rounded-full bg-foreground/80" />
                </div>
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function WalletMock() {
  return (
    <div className="rounded-xl border border-border bg-card p-6 sm:p-8">
      <div className="flex items-center justify-between">
        <Eyebrow>Primary account</Eyebrow>
        <span className="flex items-center gap-1.5 text-xs text-foreground">
          <span className="size-1.5 rounded-full bg-red-500" />
          Live
        </span>
      </div>
      <p className="mt-6 font-mono text-sm text-foreground sm:text-base">
        0x7f3a9d84e21b6c05f8a1d3e74b9c2f56a80c42e
      </p>
      <div className="mt-6 grid grid-cols-3 divide-x divide-border border-t border-border pt-6 text-center">
        {[
          ["Balance", "2.401 ETH"],
          ["Network", "Ethereum"],
          ["Sessions", "3 active"],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
              {label}
            </p>
            <p className="mt-1.5 font-mono text-sm text-foreground">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function TerminalMock() {
  const lines = [
    "$ git clone https://chromium.googlesource.com/chromium/src",
    "$ cd src && gn gen out/freman",
    "$ autoninja -C out/freman chrome",
    "✔ build ready — 145.0.7049.0",
  ];
  return (
    <div className="rounded-xl border border-border bg-card p-6 font-mono text-xs leading-6 text-muted-foreground sm:p-8">
      {lines.map((line, i) => (
        <p
          key={line}
          className={i === lines.length - 1 ? "text-foreground" : undefined}
        >
          {line}
        </p>
      ))}
    </div>
  );
}

const FEATURE_INDEX = [
  {
    number: "01",
    title: "Built on Chromium",
    copy: "Freman tracks the upstream Chromium source tree — the same rendering engine, network stack and security model the modern web expects.",
  },
  {
    number: "02",
    title: "A catalog, not a store",
    copy: "Browse and search a curated catalog of extensions. Official Chrome samples sit alongside Web3-native tools, each installable in a click.",
  },
  {
    number: "03",
    title: "Web3, built in",
    copy: "An EIP-1193 wallet lives in the browser's core. Resolve .eth names in the address bar and read every signature request in plain language.",
  },
];

export default function Landing() {
  const { isAuthenticated } = useAuth();
  const studioHref = isAuthenticated ? "/dashboard" : "/auth";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <a href="/" aria-label="Freman home">
            <FremanWordmark className="text-lg" />
          </a>
          <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">
              Features
            </a>
            <a href="#catalog" className="transition-colors hover:text-foreground">
              Catalog
            </a>
            <a href="#web3" className="transition-colors hover:text-foreground">
              Web3
            </a>
            <a href="#build" className="transition-colors hover:text-foreground">
              Build
            </a>
          </nav>
          <Button asChild variant="outline" size="sm" className="rounded-full">
            <a href={studioHref}>Open Studio</a>
          </Button>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto w-full max-w-6xl px-6 pb-24 pt-20 sm:pt-28">
          <div className="grid items-center gap-16 lg:grid-cols-[1.1fr_1fr]">
            <Reveal>
              <Eyebrow>Web3 browser · Search engine · For everyone</Eyebrow>
              <h1 className="mt-6 text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
                The Web3 browser,
                <br />
                for everyone.
              </h1>
              <p className="mt-6 max-w-md text-base leading-7 text-muted-foreground">
                Freman ships a built-in, privacy-first search engine, a
                searchable extension catalog, and a wallet that lives in the
                browser's core. Search, install, sign — no jargon required.
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-3">
                <Button asChild size="lg" className="rounded-full px-7">
                  <a href="/browse">
                    Open the browser
                    <ArrowRight className="ml-1 size-4" />
                  </a>
                </Button>
                <Button asChild size="lg" variant="ghost" className="rounded-full px-5">
                  <a href={CHROMIUM_SRC} target="_blank" rel="noopener noreferrer">
                    Chromium source
                    <ArrowUpRight className="ml-1 size-4" />
                  </a>
                </Button>
              </div>
            </Reveal>
            <Reveal delay={0.15}>
              <BrowserMock />
            </Reveal>
          </div>
        </section>

        {/* Stats strip */}
        <section className="border-y border-border">
          <div className="mx-auto grid w-full max-w-6xl grid-cols-2 divide-border px-6 sm:grid-cols-4 sm:divide-x">
            {[
              ["145", "Chromium baseline"],
              ["12", "Catalog samples"],
              ["EIP-1193", "Native wallet"],
              ["100%", "Open source"],
            ].map(([value, label], i) => (
              <Reveal
                key={label}
                delay={i * 0.05}
                className="py-10 text-center sm:py-12"
              >
                <p className="font-mono text-2xl tracking-tight sm:text-3xl">
                  {value}
                </p>
                <p className="mt-2 text-xs uppercase tracking-widest text-muted-foreground">
                  {label}
                </p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto w-full max-w-6xl px-6 py-24 sm:py-32">
          <Reveal>
            <Eyebrow>Why Freman</Eyebrow>
            <h2 className="mt-5 max-w-xl text-3xl font-semibold tracking-tight sm:text-4xl">
              Three ideas, held together.
            </h2>
          </Reveal>
          <div className="mt-16 grid gap-12 md:grid-cols-3 md:gap-10">
            {FEATURE_INDEX.map((feature, i) => (
              <Reveal key={feature.number} delay={i * 0.1}>
                <div className="border-t border-border pt-6">
                  <span className="font-mono text-xs text-muted-foreground">
                    {feature.number}
                  </span>
                  <h3 className="mt-3 text-lg font-medium tracking-tight">
                    {feature.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {feature.copy}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Extension catalog */}
        <section id="catalog" className="border-y border-border bg-muted/40">
          <div className="mx-auto w-full max-w-6xl px-6 py-24 sm:py-32">
            <Reveal className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <Eyebrow>Extension catalog</Eyebrow>
                <h2 className="mt-5 max-w-lg text-3xl font-semibold tracking-tight sm:text-4xl">
                  Browse it. Search it. Install it.
                </h2>
                <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground">
                  Every entry in the catalog is searchable by name, extension
                  API or category — from the official samples to Freman's
                  Web3-native tools.
                </p>
              </div>
              <Button asChild variant="ghost" className="rounded-full">
                <a href={SAMPLES_REPO} target="_blank" rel="noopener noreferrer">
                  chrome-extensions-samples
                  <ArrowUpRight className="ml-1 size-4" />
                </a>
              </Button>
            </Reveal>
            <Reveal className="mt-12 overflow-hidden rounded-xl border border-border bg-card">
              {EXTENSION_SAMPLES.slice(0, 6).map((sample, i) => (
                <div
                  key={sample.id}
                  className={`flex flex-col gap-1 px-6 py-4 sm:flex-row sm:items-center sm:justify-between ${
                    i > 0 ? "border-t border-border" : ""
                  }`}
                >
                  <div className="flex items-baseline gap-4">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-sm font-medium">{sample.name}</span>
                    <span className="hidden font-mono text-[11px] text-muted-foreground md:inline">
                      {sample.apis.join(" · ")}
                    </span>
                  </div>
                  <span className="pl-8 text-xs uppercase tracking-widest text-muted-foreground sm:pl-0">
                    {sample.category}
                  </span>
                </div>
              ))}
              <div className="border-t border-border bg-muted/40 px-6 py-3 text-center text-xs text-muted-foreground">
                The full catalog — all {EXTENSION_SAMPLES.length} entries,
                searchable — lives in the Studio
              </div>
            </Reveal>
          </div>
        </section>

        {/* Web3 */}
        <section id="web3" className="mx-auto w-full max-w-6xl px-6 py-24 sm:py-32">
          <div className="grid items-center gap-16 lg:grid-cols-2">
            <Reveal>
              <Eyebrow>Web3, built in</Eyebrow>
              <h2 className="mt-5 max-w-md text-3xl font-semibold tracking-tight sm:text-4xl">
                The wallet is part of the browser.
              </h2>
              <p className="mt-6 max-w-md text-sm leading-7 text-muted-foreground">
                There's nothing to install and nothing to vet. Freman ships its
                wallet in the core, so dApps get a provider they can rely on —
                and you stay in control of every session.
              </p>
              <ul className="mt-8 space-y-3 text-sm text-muted-foreground">
                {[
                  "EIP-1193 provider available to every page you open",
                  "Plain-language previews for every signature request",
                  "Per-origin dApp sessions, revocable in one click",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="mt-[9px] size-1 shrink-0 rounded-full bg-foreground" />
                    {item}
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal delay={0.15}>
              <WalletMock />
            </Reveal>
          </div>
        </section>

        {/* Build */}
        <section id="build" className="border-t border-border bg-muted/40">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-16 px-6 py-24 sm:py-32 lg:grid-cols-2">
            <Reveal>
              <Eyebrow>Build it yourself</Eyebrow>
              <h2 className="mt-5 max-w-md text-3xl font-semibold tracking-tight sm:text-4xl">
                From source to binary.
              </h2>
              <p className="mt-6 max-w-md text-sm leading-7 text-muted-foreground">
                Freman tracks upstream Chromium. Queue a build for any channel
                and platform from the Studio — or clone the tree and compile it
                your way.
              </p>
              <div className="mt-8 flex items-center gap-2">
                <Button asChild className="rounded-full px-6">
                  <a href={studioHref}>
                    Queue a build
                    <ArrowRight className="ml-1 size-4" />
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  className="rounded-full px-4"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(
                        "git clone https://chromium.googlesource.com/chromium/src",
                      )
                      .then(() => toast.success("Clone command copied"))
                      .catch(() => toast.error("Copy failed"));
                  }}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </Reveal>
            <Reveal delay={0.15}>
              <TerminalMock />
            </Reveal>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="mx-auto w-full max-w-6xl px-6 py-28 sm:py-36">
          <Reveal className="text-center">
            <h2 className="mx-auto max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
              Meet Freman.
            </h2>
            <p className="mx-auto mt-5 max-w-md text-sm leading-7 text-muted-foreground">
              Open the browser to search the web, browse the catalog and create
              a wallet — all in one quiet place.
            </p>
            <Button asChild size="lg" className="mt-10 rounded-full px-8">
              <a href="/browse">
                Open the browser
                <ArrowRight className="ml-1 size-4" />
              </a>
            </Button>
          </Reveal>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <FremanWordmark className="text-sm" />
            <span className="text-sm text-muted-foreground">
              — the Web3 browser for everyone.
            </span>
          </div>
          <nav className="flex flex-wrap gap-x-8 gap-y-2 text-sm text-muted-foreground">
            <a
              href={CHROMIUM_SRC}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-foreground"
            >
              Chromium src
            </a>
            <a
              href={CHROMIUM_DOCS}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-foreground"
            >
              Chromium docs
            </a>
            <a
              href={SAMPLES_REPO}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-foreground"
            >
              Extension samples
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

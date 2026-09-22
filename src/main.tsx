import { Toaster } from "@/components/ui/sonner";
import { api } from "@/convex/_generated/api";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/hooks/use-auth";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient, useQuery } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { toast } from "sonner";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import {
  applyServiceWorkerUpdate,
  clearProtoQuery,
  extractProtoDestination,
  registerProtocolHandler,
  registerServiceWorker,
} from "@/lib/pwa";
import "./index.css";

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const WalletPage = lazy(() => import("./pages/Wallet.tsx"));
const Browse = lazy(() => import("./pages/Browse.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

/** Applies the user's browser theme (light/dark/system) globally in real time. */
function ThemeSync() {
  const { isAuthenticated } = useAuth();
  const settings = useQuery(api.settings.get);
  const theme = isAuthenticated ? (settings?.theme ?? "dark") : "dark";

  useEffect(() => {
    const root = document.documentElement;
    const dark =
      theme === "dark" ||
      (theme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    root.classList.toggle("dark", dark);
    root.style.colorScheme = dark ? "dark" : "light";
  }, [theme]);

  // Follow OS changes while in system mode.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      document.documentElement.classList.toggle("dark", mq.matches);
      document.documentElement.style.colorScheme = mq.matches ? "dark" : "light";
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return null;
}

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in WebContainer environment). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[WebContainer preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);



/**
 * PWA bootstrap: service-worker registration/update handling and the
 * "web+freman" protocol handler. Runs once, outside the router.
 */
function PwaBootstrap() {
  useEffect(() => {
    void registerServiceWorker();

    const onReady = () => {
      toast.info("A new version of Freman is installed.", {
        description: "It will apply on next launch — or reload now.",
        action: { label: "Reload", onClick: () => void applyServiceWorkerUpdate() },
        duration: 10000,
      });
    };
    window.addEventListener("freman:sw-update-ready", onReady);
    return () => window.removeEventListener("freman:sw-update-ready", onReady);
  }, []);

  useEffect(() => {
    // Protocol handling: both the manifest-registered handler and the
    // runtime registration route to /?proto=<destination>.
    const destination = extractProtoDestination(window.location.search);
    if (destination) {
      sessionStorage.setItem("freman:proto-launch", destination);
      clearProtoQuery();
    }
    registerProtocolHandler();
  }, []);

  return null;
}

/**
 * Consumes a pending web+freman protocol launch by sending the browser to
 * /browse, where the existing navigation system picks the destination up
 * from sessionStorage (Browse owns consuming + clearing it).
 */
function ProtocolLaunchSync() {
  const navigate = useNavigate();
  const location = useLocation();

  // Re-check whenever the route changes: protocol launches can arrive while
  // the app is already open (focus-existing client mode), not just at boot.
  useEffect(() => {
    if (
      sessionStorage.getItem("freman:proto-launch") &&
      location.pathname !== "/browse"
    ) {
      navigate("/browse", { replace: true });
    }
  }, [location.pathname, navigate]);

  return null;
}

function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <ConvexAuthProvider client={convex}>
        <ThemeSync />
        <PwaBootstrap />
        <BrowserRouter>
          <RouteSyncer />
          <ProtocolLaunchSync />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route
                path="/auth"
                element={<AuthPage redirectAfterAuth="/dashboard" />}
              />
              <Route
                path="/dashboard"
                element={
                  <RequireAuth>
                    <Dashboard />
                  </RequireAuth>
                }
              />
              <Route
                path="/wallet"
                element={
                  <RequireAuth>
                    <WalletPage />
                  </RequireAuth>
                }
              />
              <Route
                path="/browse"
                element={
                  <RequireAuth>
                    <Browse />
                  </RequireAuth>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
);

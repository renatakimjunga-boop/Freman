"use node";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api, internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";

/** URL-safe base64 for PKCE/state values. */
function base64url(b: Buffer): string {
  return b
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Chrome Web Store publisher API — the official, OAuth-secured surface.
 *
 * With a connected publisher account (see publisherState.ts + the /publisher
 * HTTP routes), Freman can do everything the real developer dashboard does:
 *   • upload a new item            (POST …/items:upload)
 *   • upload a new version         (POST …/items:upload?itemId=…)
 *   • publish                      (POST …/items/{id}:publish)
 *   • read item status and review state
 *   • list items with live install statistics
 *
 * Refresh tokens are stored AES-256-GCM encrypted with WALLET_ENCRYPTION_KEY
 * (same scheme as the custodial wallet) and never leave the server.
 */

const ENC_KEY_ENV = "WALLET_ENCRYPTION_KEY";

function encryptionKey(): Buffer {
  const hex = process.env[ENC_KEY_ENV];
  if (!hex || hex.length !== 64) {
    throw new Error(`${ENC_KEY_ENV} is not set (32-byte hex string required)`);
  }
  return Buffer.from(hex, "hex");
}

function encryptSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [
    "v2",
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    enc.toString("hex"),
  ].join(":");
}

function decryptSecret(blob: string): string {
  const [version, ivHex, tagHex, dataHex] = blob.split(":");
  if (version !== "v2") throw new Error("Unsupported encryption version");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

/* ------------------------------ credentials ------------------------------- */

interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

function oauthClient(): OAuthClient {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the Keys tab to use publisher features",
    );
  }
  return { clientId, clientSecret };
}

interface Connection {
  encryptedRefreshToken: string;
  clientId: string;
  publisherId?: string;
}

/** Connection row for the signed-in user, or null. */
async function currentConnection(
  ctx: ActionCtx,
): Promise<Connection | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const row = (await ctx.runQuery(internal.publisherState.internalGet, {
    userId,
  })) as Connection | null;
  return row ?? null;
}

/** Fresh access token for the signed-in user's publisher connection. */
async function accessTokenFor(ctx: ActionCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Sign in to use publisher features");

  const conn = await currentConnection(ctx);
  if (!conn) throw new Error("Connect your Chrome Web Store account first");

  const client = oauthClient();
  // The stored client id must still match the configured one.
  if (conn.clientId !== client.clientId) {
    throw new Error(
      "The connected OAuth client changed — reconnect your publisher account",
    );
  }

  const refreshToken = decryptSecret(conn.encryptedRefreshToken);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json()) as {
    access_token?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description ?? "Google token refresh failed");
  }
  await ctx.runMutation(internal.publisherState.internalTouch, { userId });
  return { token: json.access_token, publisherId: conn.publisherId, userId };
}

/* --------------------------------- actions -------------------------------- */

/**
 * Build the Google consent URL for the signed-in Freman user. The PKCE
 * verifier + state are stored server-side (publisherOauthStates), so the
 * callback can complete the exchange without any browser-held secrets.
 */
export const startConnect = action({
  args: { appOrigin: v.optional(v.string()) },
  returns: v.string(),
  handler: async (ctx, { appOrigin }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to connect a publisher account");
    // Validates both client id and secret — fail before sending the user
    // into a consent flow that could never complete.
    const { clientId } = oauthClient();

    const verifier = base64url(randomBytes(32));
    const state = base64url(randomBytes(24));
    await ctx.runMutation(internal.publisherState.createPendingState, {
      state,
      verifier,
      userId,
      appOrigin,
    });

    const siteUrl = process.env.CONVEX_SITE_URL;
    const redirectUri = siteUrl
      ? `${siteUrl.replace(/\/$/, "")}/publisher/oauth/callback`
      : "/publisher/oauth/callback";

    const challenge = base64url(createHash("sha256").update(verifier).digest());
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/chromewebstore",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  },
});

/**
 * Called from the /publisher/oauth/callback HTTP route (which carries no
 * Freman session — the user id comes from the server-side state row).
 * Exchanges the code, encrypts the refresh token, and binds the connection.
 */
export const exchangeOnCallback = internalAction({
  args: { state: v.string(), code: v.string(), redirectUri: v.string() },
  returns: v.any(),
  handler: async (
    ctx,
    { state, code, redirectUri },
  ): Promise<{
    ok: boolean;
    error?: string;
    email?: string | null;
    appOrigin?: string | null;
  }> => {
    const client = oauthClient();
    const pending = (await ctx.runMutation(
      internal.publisherState.consumePendingState,
      { state },
    )) as {
      verifier: string;
      userId: import("./_generated/dataModel").Id<"users">;
      appOrigin?: string | null;
    } | null;
    if (!pending) {
      return { ok: false as const, error: "expired" as const };
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: pending.verifier,
      }),
    });
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      error_description?: string;
    };
    if (!tokenRes.ok || !tokenJson.refresh_token) {
      return {
        ok: false as const,
        error:
          tokenJson.error_description ??
          "Google did not return a refresh token — make sure consent was granted for the chromewebstore scope",
      };
    }

    // Who connected? (for display in the Studio)
    let email: string | undefined;
    try {
      const infoRes = await fetch(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        { headers: { Authorization: `Bearer ${tokenJson.access_token}` } },
      );
      if (infoRes.ok) {
        const info = (await infoRes.json()) as { email?: string };
        email = info.email ?? undefined;
      }
    } catch {
      // Non-fatal.
    }

    await ctx.runMutation(internal.publisherState.upsertForUser, {
      userId: pending.userId,
      encryptedRefreshToken: encryptSecret(tokenJson.refresh_token),
      clientId: client.clientId,
      googleEmail: email,
    });

    return { ok: true as const, email: email ?? null, appOrigin: pending.appOrigin };
  },
});

/**
 * Live items for the connected publisher, with install stats when the
 * publisher id is known. This is the Studio's "your extensions" list.
 */
export const listItems = action({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const { token, publisherId, userId } = await accessTokenFor(ctx);

    const itemsRes = await fetch(
      `https://chromewebstore.googleapis.com/v2/publishers/${publisherId ?? "-"}/items`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const itemsJson = (await itemsRes.json()) as {
      items?: Array<Record<string, unknown>>;
      error?: { message?: string };
    };
    if (!itemsRes.ok) {
      throw new Error(
        itemsJson.error?.message ??
          (publisherId
            ? `Web Store API returned ${itemsRes.status}`
            : `Web Store API returned ${itemsRes.status} — confirm your publisher id in the connection card`),
      );
    }

    const rows = itemsJson.items ?? [];
    await ctx.runMutation(internal.publisherState.setItemCount, {
      userId,
      count: rows.length,
    });

    // Install counts are a separate stats call; enrich best-effort.
    const installs = new Map<string, number>();
    if (publisherId) {
      const now = new Date();
      const ymd =
        `${now.getUTCFullYear()}` +
        `${String(now.getUTCMonth() + 1).padStart(2, "0")}` +
        `${String(now.getUTCDate()).padStart(2, "0")}`;
      try {
        const statsRes = await fetch(
          `https://chromewebstore.googleapis.com/v2/stats?metric=INSTALLATION_COUNT&date=${ymd}&dimension=ITEM`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (statsRes.ok) {
          const statsJson = (await statsRes.json()) as {
            rows?: Array<{
              dimensions?: { item?: string };
              value?: string | number;
            }>;
          };
          for (const r of statsJson.rows ?? []) {
            const item = r.dimensions?.item;
            if (item) installs.set(item, Number(r.value ?? 0));
          }
        }
      } catch {
        // Stats are optional enrichment.
      }
    }

    return {
      items: rows.map((it) => {
        const id = String(it.itemId ?? it.id ?? "");
        return {
          id,
          name: String(
            it.displayName ?? it.name ?? it.localizedText ?? (id || "Untitled item"),
          ),
          status: String(it.publishState ?? it.status ?? "UNKNOWN"),
          version: it.version ? String(it.version) : null,
          installs: installs.get(id) ?? null,
        };
      }),
    };
  },
});

/**
 * Upload an extension zip. `zipBase64` is the exact zip file the Studio reads
 * with a file input (browser-side base64). `itemId` uploads a new version of
 * an existing item; omit it to create a new item draft.
 */
export const upload = action({
  args: {
    zipBase64: v.string(),
    itemId: v.optional(v.string()),
    publishTarget: v.optional(v.string()), // "default" | "trustedTesters"
  },
  returns: v.any(),
  handler: async (ctx, { zipBase64, itemId, publishTarget }) => {
    const { token, publisherId } = await accessTokenFor(ctx);
    const target = publishTarget === "trustedTesters" ? "trustedTesters" : "default";

    const params = new URLSearchParams({ publishTarget: target });
    if (itemId) params.set("itemId", itemId);

    const buffer = Buffer.from(zipBase64, "base64");
    if (buffer.length < 8) throw new Error("The selected file is not a valid zip");

    const res = await fetch(
      `https://chromewebstore.googleapis.com/v2/publishers/${publisherId ?? "-"}/items:upload?${params}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "x-goog-api-version": "2",
          "Content-Type": "application/octet-stream",
        },
        body: new Uint8Array(buffer),
      },
    );
    const json = (await res.json()) as {
      itemId?: string;
      uploadState?: string;
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(json.error?.message ?? `Upload failed (${res.status})`);
    }
    return {
      itemId: json.itemId ?? itemId ?? null,
      uploadState: json.uploadState ?? "UNKNOWN",
    };
  },
});

/**
 * Publish an uploaded item (status moves to pending review).
 * publishTarget "default" = public, "trustedTesters" = staged rollout.
 */
export const publish = action({
  args: {
    itemId: v.string(),
    publishTarget: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { itemId, publishTarget }) => {
    const { token, publisherId } = await accessTokenFor(ctx);
    const target = publishTarget === "trustedTesters" ? "trustedTesters" : "default";

    const res = await fetch(
      `https://chromewebstore.googleapis.com/v2/publishers/${publisherId ?? "-"}/items/${itemId}:publish?publishTarget=${target}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "x-goog-api-version": "2",
          "Content-Length": "0",
        },
      },
    );
    const json = (await res.json()) as {
      status?: Array<{ status?: string }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(json.error?.message ?? `Publish failed (${res.status})`);
    }
    return { status: json.status?.[0]?.status ?? "SUCCESS" };
  },
});

/** Read one item's live record (status, version, review state). */
export const item = action({
  args: { itemId: v.string() },
  returns: v.any(),
  handler: async (ctx, { itemId }) => {
    const { token, publisherId } = await accessTokenFor(ctx);
    const res = await fetch(
      `https://chromewebstore.googleapis.com/v2/publishers/${publisherId ?? "-"}/items/${itemId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const err = json as { error?: { message?: string } };
      throw new Error(err.error?.message ?? `Fetch failed (${res.status})`);
    }
    return {
      id: String(json.itemId ?? itemId),
      name: String(json.displayName ?? json.name ?? "Untitled item"),
      status: String(json.publishState ?? json.status ?? "UNKNOWN"),
      version: json.version ? String(json.version) : null,
    };
  },
});

/** Probe: true when the signed-in user has a working publisher connection. */
export const connected = action({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    try {
      await accessTokenFor(ctx);
      return true;
    } catch {
      return false;
    }
  },
});

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import type { AccountProfile, ApiFailure } from "@kimono/account";
import { discover, requestTokens, revoke, TokenRefused, type Tokens } from "./oidc";
import { keep, readKept } from "./store";

/**
 * 鍵 Signing in, staying signed in, and talking to the Portal.
 *
 * The person types their Kimono's address once. The Portal says where to sign
 * in; the app opens that page in a private browser sheet (so nothing lingers
 * in Safari), and keeps only the refresh token, in the Keychain. Access tokens
 * live in memory for their ten minutes and are renewed as needed.
 */

WebBrowser.maybeCompleteAuthSession();

type SignInConfig = { issuer: string; clientId: string; scopes: string[] };
type Kept = { server: string; issuer: string; clientId: string; refreshToken: string };

export type SessionStatus = "loading" | "signed-out" | "signed-in";

type SessionValue = {
  status: SessionStatus;
  /** The Kimono this phone is signed in to, or was last. */
  server: string | null;
  me: AccountProfile | null;
  signIn: (address: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Calls /api/v1 as the signed-in person. Throws an Error a person can read. */
  api: <T>(path: string, init?: ApiInit) => Promise<T>;
  /** Re-reads the account, after it changes. */
  refreshMe: () => Promise<void>;
};

/* Expo's fetch, the global one on phones, sends bytes as they are; React
   Native's own types just don't list them. */
type ApiInit = Omit<RequestInit, "body"> & { body?: RequestInit["body"] | Uint8Array };

const SessionContext = createContext<SessionValue | null>(null);

const keys = { server: "kimono.server", issuer: "kimono.issuer", clientId: "kimono.clientId", refresh: "kimono.refresh" };
const redirectUri = AuthSession.makeRedirectUri({ scheme: "kimono", path: "auth" });

/** "kimono.example" → "https://kimono.example". A scheme typed out is kept. */
export function normaliseAddress(address: string): string {
  const trimmed = address.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Enter your Kimono's address.");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return url.origin;
  } catch {
    throw new Error("That doesn't look like an address.");
  }
}

async function readFailure(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as Partial<ApiFailure>;
    if (typeof body.error === "string" && body.error) return body.error;
  } catch { /* not JSON */ }
  return fallback;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [server, setServer] = useState<string | null>(null);
  const [me, setMe] = useState<AccountProfile | null>(null);
  const kept = useRef<Kept | null>(null);
  const access = useRef<{ token: string; expiresAt: number } | null>(null);
  const renewing = useRef<Promise<string> | null>(null);

  const forget = useCallback(async () => {
    kept.current = null;
    access.current = null;
    setMe(null);
    await keep(keys.refresh, null);
    setStatus("signed-out");
  }, []);

  /* One renewal at a time: a burst of calls waits on the same refresh. */
  const renew = useCallback((): Promise<string> => {
    if (renewing.current) return renewing.current;
    renewing.current = (async () => {
      const current = kept.current;
      if (!current) throw new Error("Sign in to Kimono first.");
      let tokens: Tokens;
      try {
        tokens = await requestTokens(await discover(current.issuer), { grant_type: "refresh_token", client_id: current.clientId, refresh_token: current.refreshToken });
      } catch (error) {
        /* A refused refresh means this sign-in is over: signed out elsewhere,
           expired, or the account switched off. A network error is not that. */
        if (error instanceof TokenRefused) {
          await forget();
          throw new Error("You've been signed out. Sign in again.");
        }
        throw new Error("Kimono isn't answering. Check your connection and try again.");
      }
      if (tokens.refreshToken && tokens.refreshToken !== current.refreshToken) {
        kept.current = { ...current, refreshToken: tokens.refreshToken };
        await keep(keys.refresh, tokens.refreshToken);
      }
      access.current = { token: tokens.accessToken, expiresAt: Date.now() + tokens.expiresIn * 1000 };
      return tokens.accessToken;
    })().finally(() => { renewing.current = null; });
    return renewing.current;
  }, [forget]);

  const token = useCallback(async () => {
    const current = access.current;
    if (current && current.expiresAt - Date.now() > 60_000) return current.token;
    return renew();
  }, [renew]);

  const api = useCallback(async <T,>(path: string, init: ApiInit = {}): Promise<T> => {
    const base = kept.current?.server;
    if (!base) throw new Error("Sign in to Kimono first.");
    const send = async (bearer: string) => fetch(`${base}${path}`, { ...init, body: init.body as RequestInit["body"], headers: { Accept: "application/json", ...init.headers, Authorization: `Bearer ${bearer}` } });
    let response: Response;
    try {
      response = await send(await token());
      /* Refused with a token that looked fresh: renew once and try again. */
      if (response.status === 401) response = await send(await renew());
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("You've been signed out")) throw error;
      throw new Error("Kimono isn't answering. Check your connection and try again.");
    }
    if (response.status === 401) {
      await forget();
      throw new Error("You've been signed out. Sign in again.");
    }
    if (!response.ok) throw new Error(await readFailure(response, "Something went wrong. Try again."));
    return await response.json() as T;
  }, [forget, renew, token]);

  const refreshMe = useCallback(async () => {
    setMe(await api<AccountProfile>("/api/v1/me"));
  }, [api]);

  /* On launch: a kept sign-in is renewed straight away, so a revoked one is
     found out before the person sees anything as theirs. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [savedServer, issuer, clientId, refreshToken] = await Promise.all([readKept(keys.server), readKept(keys.issuer), readKept(keys.clientId), readKept(keys.refresh)]);
      if (cancelled) return;
      setServer(savedServer);
      if (!savedServer || !issuer || !clientId || !refreshToken) { setStatus("signed-out"); return; }
      kept.current = { server: savedServer, issuer, clientId, refreshToken };
      try {
        const profile = await api<AccountProfile>("/api/v1/me");
        if (cancelled) return;
        setMe(profile);
        setStatus("signed-in");
      } catch {
        /* Offline at launch: stay signed in and try again when asked. */
        if (!cancelled) setStatus(kept.current ? "signed-in" : "signed-out");
      }
    })();
    return () => { cancelled = true; };
  }, [api]);

  const signIn = useCallback(async (address: string) => {
    const base = normaliseAddress(address);
    let config: SignInConfig;
    try {
      const response = await fetch(`${base}/api/v1/sign-in`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(await readFailure(response, "There's no Kimono at that address."));
      config = await response.json() as SignInConfig;
    } catch (error) {
      throw error instanceof Error && !(error instanceof TypeError) ? error : new Error("There's no Kimono at that address.");
    }
    let endpoints: Awaited<ReturnType<typeof discover>>;
    try {
      endpoints = await discover(config.issuer);
    } catch {
      throw new Error("Kimono's sign-in page isn't answering. Try again in a moment.");
    }
    const request = new AuthSession.AuthRequest({ clientId: config.clientId, scopes: config.scopes, redirectUri, usePKCE: true });
    const result = await request.promptAsync(endpoints, { preferEphemeralSession: true });
    if (result.type !== "success") {
      if (result.type === "error") throw new Error(result.error?.description || "Signing in didn't finish. Try again.");
      return;
    }
    let tokens: Tokens;
    try {
      tokens = await requestTokens(endpoints, { grant_type: "authorization_code", client_id: config.clientId, code: result.params.code, redirect_uri: redirectUri, code_verifier: request.codeVerifier ?? "" });
    } catch {
      throw new Error("Signing in didn't finish. Try again.");
    }
    if (!tokens.refreshToken) throw new Error("Signing in didn't finish. Try again.");
    kept.current = { server: base, issuer: config.issuer, clientId: config.clientId, refreshToken: tokens.refreshToken };
    access.current = { token: tokens.accessToken, expiresAt: Date.now() + tokens.expiresIn * 1000 };
    await Promise.all([keep(keys.server, base), keep(keys.issuer, config.issuer), keep(keys.clientId, config.clientId), keep(keys.refresh, tokens.refreshToken)]);
    setServer(base);
    setMe(await api<AccountProfile>("/api/v1/me"));
    setStatus("signed-in");
  }, [api]);

  const signOut = useCallback(async () => {
    const current = kept.current;
    /* Revoke first, so the token is dead even if this phone is later read. */
    if (current) {
      try {
        await revoke(await discover(current.issuer), current.clientId, current.refreshToken);
      } catch { /* offline: the token is forgotten here and expires on its own */ }
    }
    await forget();
  }, [forget]);

  const value = useMemo(() => ({ status, server, me, signIn, signOut, api, refreshMe }), [status, server, me, signIn, signOut, api, refreshMe]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}

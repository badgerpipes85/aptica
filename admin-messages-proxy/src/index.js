const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const CSRF_COOKIE = "__Host-map_admin_csrf";

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function decodeJson(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function validateAccess(request, env) {
  const token = request.headers.get("cf-access-jwt-assertion") || "";
  const parts = token.split(".");
  if (parts.length !== 3 || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.ADMIN_EMAILS) return null;
  try {
    const header = decodeJson(parts[0]);
    const claims = decodeJson(parts[1]);
    if (header.alg !== "RS256" || !header.kid) return null;
    const teamDomain = env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const certResponse = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, { cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!certResponse.ok) return null;
    const certs = await certResponse.json();
    const jwk = (certs.keys || []).find(key => key.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decodeBase64Url(parts[2]), signed);
    if (!valid) return null;
    const now = Math.floor(Date.now() / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const issuer = String(claims.iss || "").replace(/\/$/, "");
    if (!audiences.includes(env.ACCESS_AUD) || issuer !== `https://${teamDomain}` || claims.exp <= now || (claims.nbf && claims.nbf > now)) return null;
    const allowed = env.ADMIN_EMAILS.split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
    const email = String(claims.email || "").toLowerCase();
    if (!email || !allowed.includes(email)) return { denied: true };
    return { email };
  } catch {
    return null;
  }
}

function cookie(request, name) {
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function validCsrf(request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return false;
  const header = request.headers.get("x-csrf-token") || "";
  const stored = cookie(request, CSRF_COOKIE);
  if (!header || header.length !== stored.length) return false;
  let difference = 0;
  for (let index = 0; index < header.length; index += 1) difference |= header.charCodeAt(index) ^ stored.charCodeAt(index);
  return difference === 0;
}

async function proxy(request, env, upstreamPath, method = "GET", body) {
  if (!env.ADMIN_SECRET) return json({ error: "admin_proxy_not_configured" }, 503);
  try {
    const response = await fetch(`${env.UPSTREAM_ORIGIN}${upstreamPath}`, {
      method,
      redirect: "error",
      headers: { Accept: "application/json", "Content-Type": "application/json", "x-admin-secret": env.ADMIN_SECRET },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return new Response(text, { status: response.status, headers: JSON_HEADERS });
  } catch {
    return json({ error: "admin_messages_unavailable" }, 503);
  }
}

export default {
  async fetch(request, env) {
    const identity = await validateAccess(request, env);
    if (!identity) return json({ error: "access_required" }, 401);
    if (identity.denied) return json({ error: "admin_not_allowed" }, 403);
    const url = new URL(request.url);
    const base = "/map-energy/admin-messages/api";
    const path = url.pathname.slice(base.length) || "/";

    if (request.method === "GET" && path === "/session") {
      const csrf = randomToken();
      return json({ authenticated: true, email: identity.email, csrf_token: csrf, environment: "staging" }, 200, {
        "Set-Cookie": `${CSRF_COOKIE}=${csrf}; Path=/; Secure; SameSite=Strict; Max-Age=28800`,
      });
    }
    if (request.method === "GET" && path === "/messages") return proxy(request, env, "/admin/messages");
    if (request.method === "POST" && path === "/messages/preview") {
      if (!validCsrf(request)) return json({ error: "invalid_csrf" }, 403);
      let body;
      try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
      return proxy(request, env, "/admin/messages/preview", "POST", body);
    }
    const messageMatch = path.match(/^\/messages\/([0-9a-f-]{36})$/i);
    if (request.method === "GET" && messageMatch) return proxy(request, env, `/admin/messages/${messageMatch[1]}`);
    const sendMatch = path.match(/^\/messages\/([0-9a-f-]{36})\/send$/i);
    if (request.method === "POST" && sendMatch) {
      if (!validCsrf(request)) return json({ error: "invalid_csrf" }, 403);
      return proxy(request, env, `/admin/messages/${sendMatch[1]}/send`, "POST");
    }
    return json({ error: "not_found" }, 404);
  },
};

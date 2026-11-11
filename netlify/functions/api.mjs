// The calendar's backend: login, events/pool/config storage, uploads, and Claude.
import { COLLECTIONS, env, listDocs, getDoc, mutate, filesStore, makeSession, readSession, safeEq } from "../lib/core.mjs";

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const fail = (message, status = 400, error = "bad_request") => json({ error, message }, status);
const ID = /^[A-Za-z0-9_\-.:@+~]{1,128}$/;
const MAX_UPLOAD = 4.4 * 1024 * 1024; // Netlify function request limit

export default async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "";
  const post = req.method === "POST";
  if (post && req.headers.get("x-requested-with") !== "calendar") return fail("Bad request");
  const role = readSession(req);
  const need = (r) => {
    if (!role) return fail("Please log in", 401, "login");
    if (r === "editor" && role !== "editor") return fail("View-only access", 403, "invalid_argument");
    return null;
  };
  const body = async () => { try { return await req.json(); } catch (_) { return {}; } };
  const coll = (c) => (COLLECTIONS.includes(c) ? c : null);

  try {
    switch (action) {
      case "login": {
        const { password = "" } = await body();
        await new Promise(r => setTimeout(r, 300));
        const ed = env("EDITOR_PASSWORD"), vw = env("VIEWER_PASSWORD");
        let r = "";
        if (ed && safeEq(ed, password)) r = "editor"; else if (vw && safeEq(vw, password)) r = "viewer";
        if (!r) return fail("Wrong password", 401, "login");
        return json({ role: r }, 200, { "set-cookie": `apcal_s=${encodeURIComponent(makeSession(r))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}` });
      }
      case "logout":
        return json({ ok: true }, 200, { "set-cookie": "apcal_s=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" });
      case "me":
        return json({ role, ai: !!env("ANTHROPIC_API_KEY"), configured: !!env("EDITOR_PASSWORD") });

      case "list": {
        const e = need("viewer"); if (e) return e;
        const c = coll(url.searchParams.get("c")); if (!c) return fail("Unknown collection");
        return json({ docs: await listDocs(c) });
      }
      case "get": {
        const e = need("viewer"); if (e) return e;
        const c = coll(url.searchParams.get("c")), id = url.searchParams.get("id") || "";
        if (!c || !ID.test(id)) return fail("Bad request");
        const d = await getDoc(c, id);
        return json({ exists: d !== null, data: d });
      }
      case "set": case "update": case "delete": {
        const e = need("editor"); if (e) return e;
        const b = await body();
        const c = coll(b.c), id = String(b.id || "");
        if (!c || !ID.test(id)) return fail("Bad request");
        if (action !== "delete" && (typeof b.data !== "object" || !b.data || JSON.stringify(b.data).length > 256 * 1024)) return fail("Bad data");
        let missing = false;
        await mutate(c, (docs) => {
          if (action === "delete") { delete docs[id]; return; }
          if (action === "set") { docs[id] = b.data; return; }
          if (!docs[id]) { missing = true; return; }
          for (const [k, v] of Object.entries(b.data)) { if (v === null) delete docs[id][k]; else docs[id][k] = v; }
        });
        if (missing) return fail("Not found", 400, "invalid_argument");
        return json({ ok: true });
      }

      case "upload": {
        const e = need("editor"); if (e) return e;
        const form = await req.formData();
        const file = form.get("file");
        if (!file || typeof file === "string") return fail("Upload failed");
        if (file.size > MAX_UPLOAD) return fail("File too large (max 4 MB here)", 400, "too_large");
        const type = String(form.get("type") || file.type || "");
        if (!/^(image|video|audio)\/[\w.+-]+$|^application\/pdf$/.test(type)) return fail("Unsupported file type", 400, "unsupported_type");
        const id = crypto.randomUUID().replace(/-/g, "");
        await filesStore().set(id, file, { metadata: { type, name: String(file.name || "upload").slice(0, 200), size: file.size } });
        return json({ id, url: `api.php?action=file&id=${id}`, sizeBytes: file.size, contentType: type });
      }
      case "file": {
        const e = need("viewer"); if (e) return e;
        const id = url.searchParams.get("id") || "";
        if (!ID.test(id)) return new Response("Not found", { status: 404 });
        const entry = await filesStore().getWithMetadata(id, { type: "arrayBuffer" });
        if (entry === null) return new Response("Not found", { status: 404 });
        const m = entry.metadata || {};
        return new Response(entry.data, { headers: {
          "content-type": m.type || "application/octet-stream", "cache-control": "private, max-age=86400",
          "x-content-type-options": "nosniff",
          "content-disposition": `inline; filename="${String(m.name || "file").replace(/[^\w.\- ]/g, "_")}"`,
        } });
      }
      case "file_delete": {
        const e = need("editor"); if (e) return e;
        const { id = "" } = await body();
        if (!ID.test(id)) return fail("Bad id");
        await filesStore().delete(id);
        return json({ deleted: true });
      }

      case "ai": {
        const e = need("editor"); if (e) return e;
        const key = env("ANTHROPIC_API_KEY");
        if (!key) return fail("Claude is not set up", 400, "not_granted");
        const form = await req.formData();
        const prompt = String(form.get("prompt") || "");
        if (!prompt || prompt.length > 200000) return fail("Bad prompt");
        const content = [];
        const imageId = String(form.get("imageId") || "");
        if (ID.test(imageId)) {
          const entry = await filesStore().getWithMetadata(imageId, { type: "arrayBuffer" });
          const t = entry?.metadata?.type;
          if (entry && ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(t) && entry.data.byteLength < 5 * 1024 * 1024)
            content.push({ type: "image", source: { type: "base64", media_type: t, data: Buffer.from(entry.data).toString("base64") } });
        }
        content.push({ type: "text", text: prompt });
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: env("ANTHROPIC_MODEL", "claude-sonnet-5-5"), max_tokens: 800, messages: [{ role: "user", content }] }),
        });
        const j = await r.json().catch(() => null);
        const text = j?.content?.find?.(b => b.type === "text")?.text;
        if (!r.ok || !text) return fail(`Claude did not answer (${r.status})`, 502, r.status === 429 ? "rate_limited" : "upstream_error");
        return json({ text });
      }
      default:
        return fail("Unknown action", 404);
    }
  } catch (err) {
    console.error(err);
    return fail("Server error – try again", 500, "upstream_error");
  }
};

export const config = { path: "/api.php" };

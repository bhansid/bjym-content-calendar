// Hostinger adapter: gives the calendar page the same "claude" API it uses on claude.ai,
// backed by api.php on your own server.
(() => {
  "use strict";
  const API = "api.php";
  let me = null;
  const H = {"Content-Type":"application/json","X-Requested-With":"calendar"};
  async function call(action, {method="GET", body, query="", form} = {}) {
    const opt = {method, credentials:"same-origin", headers: form ? {"X-Requested-With":"calendar"} : H};
    if (form) opt.body = form; else if (body !== undefined) opt.body = JSON.stringify(body);
    const r = await fetch(`${API}?action=${action}${query}`, opt);
    let j = null; try { j = await r.json(); } catch(_) {}
    if (r.status === 401 && action !== "login") { showLogin(); throw {code:"invalid_argument", message:"login"}; }
    if (!r.ok) throw {code:(j && j.error) || "upstream_error", message:(j && j.message) || ("HTTP " + r.status)};
    return j;
  }

  // ---------- login ----------
  let readyResolve; const ready = new Promise(r => readyResolve = r);
  function showLogin(msg) {
    let o = document.getElementById("loginOverlay");
    if (!o) {
      o = document.createElement("div"); o.id = "loginOverlay";
      o.innerHTML = `<form style="background:#fff;border-radius:14px;padding:28px;width:min(360px,92vw);box-shadow:0 20px 60px rgba(0,0,0,.25);display:flex;flex-direction:column;gap:12px;font-family:Inter,system-ui,sans-serif">
        <div style="font-size:12px;letter-spacing:.12em;color:#c2500f;font-weight:700">BJYM J&amp;K · CONTENT CALENDAR</div>
        <div style="font-size:22px;font-weight:800">Log in</div>
        <input type="password" id="lgPass" placeholder="Team password" autocomplete="current-password" style="border:1px solid #e7e2d8;border-radius:8px;padding:11px;font-size:15px">
        <button style="background:#f26a1b;color:#fff;border:none;border-radius:8px;padding:11px;font-weight:700;font-size:15px;cursor:pointer">Open calendar</button>
        <div id="lgMsg" style="font-size:13px;color:#b91c1c;min-height:16px"></div></form>`;
      Object.assign(o.style, {position:"fixed", inset:"0", background:"rgba(28,25,23,.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:"100"});
      document.body.appendChild(o);
      o.querySelector("form").onsubmit = async e => {
        e.preventDefault();
        try { await call("login", {method:"POST", body:{password: document.getElementById("lgPass").value}}); location.reload(); }
        catch (err) { document.getElementById("lgMsg").textContent = "Wrong password"; }
      };
    }
    o.style.display = "flex";
    if (msg) document.getElementById("lgMsg").textContent = msg;
    setTimeout(() => document.getElementById("lgPass")?.focus(), 50);
  }
  async function boot() {
    try { me = await call("me"); } catch (_) { me = {role:""}; }
    if (!me.role) { showLogin(); return; }
    const a = document.querySelector(".actions");
    if (a) {
      const b = document.createElement("button"); b.className = "btn ghost"; b.textContent = me.role === "editor" ? "Log out" : "Log out (view-only)";
      b.onclick = async () => { await call("logout", {method:"POST", body:{}}).catch(()=>{}); location.reload(); };
      a.appendChild(b);
    }
    readyResolve();
  }
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", boot) : boot();

  // ---------- db (polling document store) ----------
  const subs = {};            // collection -> [cb]
  const docSubs = {};         // "c/id" -> [cb]
  const snapDoc = (id, data) => ({id, exists:true, data:() => data, metadata:{fromCache:false, hasPendingWrites:false}});
  async function refresh(c) {
    if (subs[c]?.length) {
      const j = await call("list", {query:"&c=" + encodeURIComponent(c)});
      const docs = j.docs.map(d => snapDoc(d.id, d.data));
      const snap = {docs, size:docs.length, empty:!docs.length, metadata:{fromCache:false}, docChanges:() => []};
      subs[c].forEach(cb => { try { cb(snap); } catch (e) { console.error(e); } });
    }
    for (const key of Object.keys(docSubs)) if (key.startsWith(c + "/") && docSubs[key].length) {
      const id = key.slice(c.length + 1);
      const j = await call("get", {query:`&c=${encodeURIComponent(c)}&id=${encodeURIComponent(id)}`});
      const s = j.exists ? snapDoc(id, j.data) : {id, exists:false, data:() => undefined, metadata:{fromCache:false}};
      docSubs[key].forEach(cb => { try { cb(s); } catch (e) { console.error(e); } });
    }
  }
  setInterval(() => { if (document.visibilityState === "visible") Object.keys({...subs, ...Object.fromEntries(Object.keys(docSubs).map(k => [k.split("/")[0], 1]))}).forEach(c => refresh(c).catch(()=>{})); }, 20000);
  function docRef(c, id) {
    return {
      id, path: c + "/" + id,
      async get() { const j = await call("get", {query:`&c=${c}&id=${encodeURIComponent(id)}`}); return j.exists ? snapDoc(id, j.data) : {id, exists:false, data:() => undefined}; },
      async set(data) { await call("set", {method:"POST", body:{c, id, data}}); refresh(c).catch(()=>{}); },
      async update(data) { await call("update", {method:"POST", body:{c, id, data}}); refresh(c).catch(()=>{}); },
      async delete() { await call("delete", {method:"POST", body:{c, id}}); refresh(c).catch(()=>{}); },
      onSnapshot(cb, err) { const k = c + "/" + id; (docSubs[k] = docSubs[k] || []).push(cb); refresh(c).catch(e => err && err(e)); return () => { docSubs[k] = docSubs[k].filter(x => x !== cb); }; },
    };
  }
  const db = {
    collection(c) {
      return {
        path: c,
        doc: (id) => docRef(c, id || ("d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6))),
        onSnapshot(cb, err) { (subs[c] = subs[c] || []).push(cb); refresh(c).catch(e => err && err(e)); return () => { subs[c] = subs[c].filter(x => x !== cb); }; },
      };
    },
    doc(path) { const [c, id] = path.split("/"); return docRef(c, id); },
  };

  // ---------- files ----------
  const assets = {
    any: true,
    async upload(file, opts = {}) {
      const f = new FormData(); f.append("file", file, file.name || "upload"); f.append("type", opts.type || file.type || "application/octet-stream");
      return call("upload", {method:"POST", form:f});
    },
    async delete(id) { return call("file_delete", {method:"POST", body:{id}}); },
  };

  // ---------- Claude via api.php ----------
  function makeSample() {
    const sample = async () => { throw {code:"capability_removed"}; };
    sample.limits = async () => ({images:{maxCount:1}});
    sample.json = async (prompt, opts = {}) => {
      const f = new FormData(); f.append("prompt", prompt); if (opts.imageId) f.append("imageId", opts.imageId);
      const j = await call("ai", {method:"POST", form:f});
      const t = String(j.text || "");
      try { return JSON.parse(t); } catch (_) {}
      const m = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (m) { try { return JSON.parse(m[1]); } catch (_) {} }
      const a = t.indexOf("{"), b = t.lastIndexOf("}"); if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
      throw {code:"invalid_json", text:t};
    };
    return sample;
  }

  // ---------- downloads ----------
  const downloads = {
    async save({filename, data}) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob); const a = document.createElement("a");
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000); return {status:"saved"};
    },
  };

  // ---------- dictation (browser speech recognition) ----------
  function makeDictation() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    let rec = null, state = "idle"; const P = [], F = [], S = [];
    const setState = (s, reason) => { state = s; S.forEach(h => h(reason ? {state:s, reason} : {state:s})); };
    return {
      start() {
        if (rec) return Promise.resolve();
        rec = new SR(); rec.continuous = true; rec.interimResults = true;
        try { rec.lang = localStorage.getItem("apcal.lang") || "hi-IN"; } catch (_) { rec.lang = "hi-IN"; }
        rec.onresult = e => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) F.forEach(h => h({text:" " + r[0].transcript.trim()})); else interim += r[0].transcript;
          }
          P.forEach(h => h({text:interim}));
        };
        rec.onerror = e => { const reason = e.error === "not-allowed" ? "not_granted" : "upstream_error"; rec = null; setState("idle", reason); };
        rec.onend = () => { if (rec) { rec = null; setState("idle", "stopped"); } };
        setState("starting");
        try { rec.start(); setState("listening"); } catch (e) { rec = null; setState("idle", "upstream_error"); return Promise.reject({code:"upstream_error"}); }
        return Promise.resolve();
      },
      stop() { if (rec) { const r = rec; rec = null; r.stop(); setState("idle", "stopped"); } return Promise.resolve(); },
      active() { return state !== "idle"; },
      onPartial(h) { P.push(h); return () => {}; }, onFinal(h) { F.push(h); return () => {}; }, onState(h) { S.push(h); return () => {}; },
    };
  }

  const user = { can: async (n) => n === "data.write" ? me?.role === "editor" : null, isOwner: () => me?.role === "editor", canEdit: () => me?.role === "editor" };

  window.claude = {
    async use(name) {
      await ready;
      switch (name) {
        case "db": return db;
        case "user": return user;
        case "assets": return me.role === "editor" ? assets : null;
        case "sample": return me.ai && me.role === "editor" ? makeSample() : null;
        case "downloads": return downloads;
        case "dictation": return makeDictation();
        default: return null;
      }
    },
  };
})();

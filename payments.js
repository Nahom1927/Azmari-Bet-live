(function () {
  var sb = supabase.createClient("https://rnqizccrzbolsynfsxbu.supabase.co", "sb_publishable_1pbzO1FOGTjIjjE-yF7d1A__OFPESB2", { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  window.azSupabase = sb;

  // Supabase customer authentication
  window.azAuthSignUp = function (email, password) {
    return sb.auth.signUp({
      email: email,
      password: password,
      options: {
        emailRedirectTo: "https://nahom1927.github.io/Azmari-Bet/"
      }
    });
  };

  window.azAuthSignIn = function (email, password) {
    return sb.auth.signInWithPassword({
      email: email,
      password: password
    });
  };

  window.azAuthSignOut = function () {
    return sb.auth.signOut();
  };

  window.azAuthSession = function () {
    return sb.auth.getSession();
  };

  var CODES = {1599:"band_profile",15000:"course_3mo",5998:"event_platinum",2998:"event_gold",1598:"event_silver",798:"event_bronze",398:"event_basic"};
  window.azCode = function (amount, isStore) {
    if (amount === 100) return isStore ? "post" : "seeker_profile";
    return CODES[amount] || null;
  };
  var TOKEN_KEY = "az_order_tokens";

  function getTokens() {
    try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || "[]"); }
    catch (e) { return []; }
  }

  function saveToken(token, code) {
    var tokens = getTokens();
    tokens.push({ token: token, code: code, created: Date.now() });
    localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens.slice(-50)));
  }

  function makeToken() {
    if (!window.crypto || !window.crypto.getRandomValues || !window.crypto.subtle) {
      throw new Error("Secure token generation is unavailable");
    }
    var bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes).map(function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }

  async function hashToken(token) {
    var bytes = new TextEncoder().encode(token);
    var digest = await window.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map(function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }

  window.azOrder = async function (code, label, ref, acct, method, ptime) {
    var token = null;
    var rpcStarted = false;
    try {
      if (!acct || !acct.name || !acct.phone)
        return { ok: false, msg: "Add your name and phone in your account first" };

      token = makeToken();
      var trackingHash = await hashToken(token);

      // Save the tracking token before sending the order.
      saveToken(token, code);

      rpcStarted = true;
      var r = await sb.rpc("submit_order", {
        p_code: code,
        p_ref: ref,
        p_name: acct.name,
        p_phone: acct.phone,
        p_item: String(label).slice(0, 120),
        p_method: method || "",
        p_time: ptime || null,
        p_tracking_hash: trackingHash
      });

      if (r.error) {
        // The database rejected the order, so remove its unused token.
        var tokens = getTokens().filter(function (x) {
          return x && x.token !== token;
        });
        localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));

        var m = r.error.message || "";
        if (r.error.code === "23505")
          return { ok: false, msg: "That transaction ID was already submitted." };
        if (m.indexOf("too many") >= 0)
          return { ok: false, msg: "Too many orders from this phone. Try again later." };
        if (m.indexOf("bad phone") >= 0)
          return { ok: false, msg: "Your phone number looks invalid. Edit your profile." };
        if (m.indexOf("bad name") >= 0)
          return { ok: false, msg: "Your name looks invalid. Edit your profile." };
        if (m.indexOf("bad time") >= 0)
          return { ok: false, msg: "The receipt time looks invalid." };
        return { ok: false, msg: "Could not send. Try again." };
      }

      return { ok: true };
    } catch (e) {
      // Keep the token after an uncertain network failure.
      return {
        ok: false,
        msg: rpcStarted
          ? "Could not confirm the order. Check your order status before trying again."
          : "Could not prepare your order securely. Please try again."
      };
    }
  };


  var QK = "az_rec_queue";
  function qget() { try { return JSON.parse(localStorage.getItem(QK) || "[]"); } catch (e) { return []; } }
  function qset(a) { try { localStorage.setItem(QK, JSON.stringify(a.slice(-20))); } catch (e) {} }
  async function sendRec(rec) {
    var r = await sb.rpc("save_customer", rec);
    if (r.error) return /bad/.test(r.error.message || "");
    return true;
  }
  window.azSaveCustomer = async function (name, phone, email, desc) {
    var rec = { p_name: name || "", p_phone: phone || "", p_email: email || "", p_desc: desc || "" };
    var ok = false;
    try { ok = await sendRec(rec); } catch (e) {}
    if (!ok) { var q = qget(); q.push(rec); qset(q); }
  };
  async function flush() {
    var q = qget();
    if (!q.length) return;
    var rest = [];
    for (var i = 0; i < q.length; i++) {
      var ok = false;
      try { ok = await sendRec(q[i]); } catch (e) {}
      if (!ok) rest.push(q[i]);
    }
    qset(rest);
  }

  async function status(code) {
    var tokens = getTokens()
      .filter(function (x) { return x && x.code === code && /^[0-9a-f]{64}$/i.test(x.token || ""); })
      .sort(function (a, b) { return b.created - a.created; });

    var newestStatus = null;

    for (var i = 0; i < tokens.length; i++) {
      var r = await sb.rpc("order_status_by_token", {
        p_token: tokens[i].token,
        p_code: code
      });
      if (r.error) throw r.error;

      if (r.data && r.data[0]) {
        var order = r.data[0];

        if (newestStatus === null) newestStatus = order.status;

        if (order.status === "approved" &&
            (!order.expires_at || Date.parse(order.expires_at) > Date.now())) {
          return "approved";
        }
      }
    }

    return newestStatus || "none";
  }
  var synced = false;
  window.azSync = async function (r, acct, render) {
    if (synced || !acct || !acct.phone) return;
    synced = true;
    try {
      var s = await status("course_3mo");
      var next = s === "approved" ? "paid" : s === "pending" ? "waiting" : "none";
      if (r.status !== next) { r.status = next; render(); }
    } catch (e) { synced = false; }
  };
  window.azCheckAcademy = async function (r, acct, render, toast, t) {
    if (!acct || !acct.phone) { toast("Add your account first"); return; }
    try {
      var s = await status("course_3mo");
      if (s === "approved") { r.status = "paid"; toast(t("paid")); render(); }
      else if (s === "pending") { toast(t("waiting")); }
      else if (s === "rejected") { r.status = "none"; render(); toast("Payment was not accepted. Please contact us."); }
      else { toast("No payment found yet"); }
    } catch (e) { toast("Network problem. Try again."); }
  };

  function dayKey() { try { return new Date().toLocaleDateString("en-CA"); } catch (e) { return String(new Date().getDate()); } }
  var GO = { course_3mo: "academy", post: "store" };
  function mkbtn(text) {
    var b = document.createElement("button");
    b.type = "button"; b.textContent = text;
    b.style.cssText = "padding:8px 12px;border:0;border-radius:8px;font-size:14px;color:#000;background:#fff";
    return b;
  }
  async function reminders() {
    var a = null;
    try { a = JSON.parse(localStorage.getItem("acct") || "null"); } catch (e) {}
    if (!a) return;
    var tokens = getTokens()
      .filter(function (x) { return x && /^[0-9a-f]{64}$/i.test(x.token || ""); })
      .map(function (x) { return x.token; })
      .slice(-50);
    if (!tokens.length) return;
    var r = await sb.rpc("my_expiring_by_tokens", { p_tokens: tokens });
    if (r.error || !r.data || !r.data.length) return;
    var urgent = r.data.some(function (x) { return x.days_left <= 2; });
    var seen = "";
    try { seen = localStorage.getItem("az_rem_day") || ""; } catch (e) {}
    if (!urgent && seen === dayKey()) return;
    try { localStorage.setItem("az_rem_day", dayKey()); } catch (e) {}
    var bar = document.createElement("div");
    bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:30;background:#b45309;color:#fff;padding:calc(env(safe-area-inset-top,0px) + 10px) 14px 10px;font:14px system-ui,sans-serif;display:flex;gap:8px;align-items:center;flex-wrap:wrap";
    var txt = document.createElement("div");
    txt.style.cssText = "flex:1;min-width:200px";
    txt.textContent = "Reminder: " + r.data.map(function (x) {
      return x.product_name + " ends in " + x.days_left + (x.days_left === 1 ? " day" : " days");
    }).join(" · ");
    bar.appendChild(txt);
    var go = GO[r.data[0].product_code];
    if (go) {
      var b1 = mkbtn("Renew");
      b1.onclick = function () { var n = document.querySelector('[data-go="' + go + '"]'); if (n) n.click(); bar.remove(); };
      bar.appendChild(b1);
    }
    var b2 = mkbtn("Close");
    b2.onclick = function () { bar.remove(); };
    bar.appendChild(b2);
    document.body.appendChild(bar);
  }
  function boot() {
    setTimeout(function () {
      flush().catch(function () {});
      reminders().catch(function () {});
    }, 1500);
  }
  if (document.readyState === "complete") boot(); else window.addEventListener("load", boot);
})();


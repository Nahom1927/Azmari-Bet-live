(function () {
  var URL = "https://rnqizccrzbolsynfsxbu.supabase.co/rest/v1/user_entries";
  var KEY = "sb_publishable_1pbzO1FOGTjIjjE-yF7d1A__OFPESB2";
  var HEADERS = {
    apikey: KEY,
    Authorization: "Bearer " + KEY,
    "Content-Type": "application/json"
  };
  var last = {};

  function normPhone(p) {
    return String(p || "").replace(/\s+/g, "").trim();
  }

  function upsertAccount(phone, name, data) {
    var cleanPhone = normPhone(phone);
    if (!cleanPhone) return Promise.resolve();
    var payload = Object.assign({}, data, {
      phone: cleanPhone,
      name: name || data.name || "",
      locked: true,
      saved_at: data.saved_at || new Date().toISOString()
    });
    var s = JSON.stringify(payload);
    if (last["account_" + cleanPhone] === s) return Promise.resolve(payload);
    last["account_" + cleanPhone] = s;

    var q = URL + "?kind=eq.account&phone=eq." + encodeURIComponent(cleanPhone) + "&select=id&limit=1";
    return fetch(q, { headers: HEADERS })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        if (rows && rows.length > 0) {
          return fetch(URL + "?id=eq." + rows[0].id, {
            method: "PATCH",
            headers: Object.assign({}, HEADERS, { Prefer: "return=minimal" }),
            body: JSON.stringify({ name: payload.name, data: payload })
          });
        } else {
          return fetch(URL, {
            method: "POST",
            headers: Object.assign({}, HEADERS, { Prefer: "return=minimal" }),
            body: JSON.stringify({ kind: "account", phone: cleanPhone, name: payload.name, data: payload })
          });
        }
      })
      .catch(function () {});
  }

  function send(kind, phone, name, data) {
    if (kind === "account") return upsertAccount(phone, name, data);
    var s = JSON.stringify(data);
    if (last[kind] === s) return;
    last[kind] = s;
    fetch(URL, {
      method: "POST",
      headers: Object.assign({}, HEADERS, { Prefer: "return=minimal" }),
      body: JSON.stringify({ kind: kind, phone: normPhone(phone) || null, name: name || null, data: data })
    }).catch(function () {});
  }

  var origSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    origSet.apply(this, arguments);
    try {
      var o = JSON.parse(v);
      if (k === "acct" && o) {
        var a = Object.assign({}, o);
        delete a.pic;
        send("account", a.phone, a.name, a);
      } else if (k === "ab_jobs" && o && o[0]) {
        var ac = JSON.parse(localStorage.getItem("acct") || "null") || {};
        send("job", ac.phone, ac.name, o[0]);
      }
    } catch (e) {}
  };

  function hydrateAccount(phone) {
    var cleanPhone = normPhone(phone);
    if (!cleanPhone) return Promise.resolve(null);
    var q = URL + "?kind=eq.account&phone=eq." + encodeURIComponent(cleanPhone) + "&order=id.desc&limit=1";
    return fetch(q, { headers: HEADERS })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        if (rows && rows[0] && rows[0].data) {
          var existing = {};
          try { existing = JSON.parse(localStorage.getItem("acct") || "null") || {}; } catch (e) {}
          var merged = Object.assign({}, existing, rows[0].data, { locked: true });
          last["account_" + cleanPhone] = JSON.stringify(merged);
          origSet.call(localStorage, "acct", JSON.stringify(merged));
          window.dispatchEvent(new CustomEvent("az:profile-hydrated", { detail: merged }));
          return merged;
        }
        return null;
      })
      .catch(function () { return null; });
  }

  window.azLoadProfile = hydrateAccount;

  try {
    var saved = JSON.parse(localStorage.getItem("acct") || "null");
    if (saved && saved.phone) {
      hydrateAccount(saved.phone);
    }
  } catch (e) {}
})();

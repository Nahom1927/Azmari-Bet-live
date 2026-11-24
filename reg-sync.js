(function () {
  var URL = "https://rnqizccrzbolsynfsxbu.supabase.co/rest/v1/rpc/";
  var KEY = "sb_publishable_1pbzO1FOGTjIjjE-yF7d1A__OFPESB2";
  var QK = "az_reg_queue", waitPay = null;
  function call(fn, body) {
    return fetch(URL + fn, {
      method: "POST",
      headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r; });
  }
  function qget() { try { return JSON.parse(localStorage.getItem(QK) || "[]"); } catch (e) { return []; } }
  function qset(a) { try { localStorage.setItem(QK, JSON.stringify(a)); } catch (e) {} }
  function enqueue(fn, body) { var q = qget(); q.push({ fn: fn, body: body }); qset(q.slice(-10)); }
  function flush() {
    var q = qget(); if (!q.length) return;
    qset([]);
    q.forEach(function (it) { call(it.fn, it.body).catch(function () { enqueue(it.fn, it.body); }); });
  }
  function readForm() {
    var r = {};
    try { if (typeof S !== "undefined" && S.reg) r = S.reg; } catch (e) {}
    var o = {
      name: r.name, phone: r.phone, region: r.region, grade: r.grade, inst: r.inst, ses: r.ses, desc: r.desc, loc: r.loc
    };
    document.querySelectorAll("[data-f]").forEach(function (i) { if (!o[i.dataset.f] && i.value) o[i.dataset.f] = i.value; });
    return o;
  }
  function submit() {
    var f = readForm();
    var name = (f.name || "").trim(), phone = (f.phone || "").trim();
    if (!name || !phone || !(f.desc || "").trim() || !(f.loc || "").trim()) return;
    if (!/^[0-9+ ]{9,16}$/.test(phone)) return;
    var body = {
      p_name: name, p_phone: phone, p_instrument: f.inst || "", p_session: f.ses || "", p_region: f.region || "",
      p_grade: f.grade || "", p_description: f.desc || "", p_location: f.loc || ""
    };
    waitPay = { phone: phone, t: Date.now() };
    call("submit_registration", body).catch(function () { enqueue("submit_registration", body); });
  }
  document.addEventListener("click", function (e) {
    var t = e.target; if (!t || !t.closest) return;
    var act = t.closest("[data-act]");
    if (act) {
      var a = act.dataset.act;
      if (a === "regpay") submit();
      else if (["postitem", "seekpay", "bandpay", "evpay"].indexOf(a) >= 0) waitPay = null;
      return;
    }
    if (t.id === "go" && t.closest(".sheet") && waitPay && Date.now() - waitPay.t < 600000) {
      var rf = document.getElementById("rf"), ref = rf ? rf.value.trim() : "";
      if (ref) {
        var body = { p_phone: waitPay.phone, p_ref: ref };
        call("set_registration_payment", body).catch(function () { enqueue("set_registration_payment", body); });
      }
      waitPay = null;
    }
  }, true);
  window.addEventListener("load", function () { setTimeout(flush, 2000); });
  window.addEventListener("online", flush);
})();

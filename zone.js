(function () {
  var PORTAL = "portal/";
  function openPortal() {
    if (document.getElementById("az-portal")) return;
    var w = document.createElement("div");
    w.id = "az-portal";
    w.style.cssText = "position:fixed;inset:0;z-index:50;background:#060B1A;display:flex;flex-direction:column";
    var bar = document.createElement("div");
    bar.style.cssText = "display:flex;align-items:center;gap:8px;padding:calc(env(safe-area-inset-top,0px) + 8px) 12px 8px;border-bottom:1px solid #22305a";
    var t = document.createElement("b"); t.textContent = "Azmari portal"; t.style.cssText = "flex:1;color:#eef2ff";
    var x = document.createElement("button"); x.type = "button"; x.textContent = "Close";
    x.style.cssText = "background:#5ee38a;color:#04210f;border:0;border-radius:10px;padding:8px 14px;font-weight:700";
    x.onclick = function () { w.remove(); };
    bar.appendChild(t); bar.appendChild(x);
    var f = document.createElement("iframe");
    f.src = PORTAL; f.title = "Azmari portal";
    f.style.cssText = "flex:1;border:0;width:100%";
    w.appendChild(bar); w.appendChild(f); document.body.appendChild(w);
  }
  function inject() {
    var v = document.getElementById("view");
    var on = document.querySelector('#nav [data-go="academy"].on');
    if (!v || !on || v.querySelector("[data-az-portal]")) return;
    var c = document.createElement("div");
    c.className = "card"; c.setAttribute("data-az-portal", "1");
    var h = document.createElement("h3"); h.textContent = "Student zone portal · የተማሪ ማዕከል";
    var p = document.createElement("p"); p.className = "mu";
    p.textContent = "Log in as student, teacher or admin: grades, attendance, code-unlocked lessons and live classes.";
    var b = document.createElement("button"); b.type = "button"; b.className = "btn"; b.textContent = "Open portal";
    b.onclick = openPortal;
    c.appendChild(h); c.appendChild(p); c.appendChild(b);
    v.insertBefore(c, v.firstChild);
  }
  function start() {
    var v = document.getElementById("view");
    if (!v) return;
    var busy = false;
    new MutationObserver(function () {
      if (busy) return; busy = true;
      try { inject(); } finally { busy = false; }
    }).observe(v, { childList: true });
    inject();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();

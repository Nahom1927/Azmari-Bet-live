(function () {
  "use strict";

  var SB_URL = "https://rnqizccrzbolsynfsxbu.supabase.co";
  var SB_KEY = "sb_publishable_1pbzO1FOGTjIjjE-yF7d1A__OFPESB2";
  var PROFILE_KEY = "azmari_embedded_profile_v220";
  var LEGEND_LOCAL_KEY = "azmari_legend_posts_v220";
  var ADMIN_PASSKEY = "AZMARI-ADMIN";

  function sbHeaders() {
    return {
      apikey: SB_KEY,
      Authorization: "Bearer " + SB_KEY,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    };
  }

  function normPhone(v) {
    var raw = String(v || "").trim();
    if (!raw) return "";
    var digits = raw.replace(/[^\d]/g, "");
    if (!digits) return raw;
    if (digits.startsWith("251") && digits.length >= 12) return "+" + digits;
    if (digits.startsWith("0") && digits.length >= 10) return "+251" + digits.slice(1);
    return raw.startsWith("+") ? "+" + digits : digits;
  }

  function getEmbeddedProfile() {
    try {
      return JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
    } catch (e) {
      return null;
    }
  }

  function lockEmbeddedProfile(profile) {
    var existing = getEmbeddedProfile();
    if (existing && existing.locked && existing.name && existing.phone) {
      return existing;
    }
    var clean = {
      name: String((profile && profile.name) || "").trim(),
      phone: normPhone(profile && profile.phone),
      role: String((profile && profile.role) || "Member").trim(),
      locked: true,
      saved_at: new Date().toISOString()
    };
    if (!clean.name || !clean.phone) return null;
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(clean));
    } catch (e) {}
    return clean;
  }

  function loadLocalLegends() {
    try {
      var arr = JSON.parse(localStorage.getItem(LEGEND_LOCAL_KEY) || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function saveLocalLegends(posts) {
    try {
      localStorage.setItem(LEGEND_LOCAL_KEY, JSON.stringify(posts));
    } catch (e) {}
  }

  async function fetchRemoteLegends() {
    try {
      var res = await fetch(
        SB_URL + "/rest/v1/user_entries?kind=eq.legend_post&order=id.desc&limit=100",
        { headers: sbHeaders() }
      );
      if (!res.ok) return [];
      var rows = await res.json();
      if (!Array.isArray(rows)) return [];
      return rows.map(function (r) {
        var d = r.data || {};
        return {
          id: "sb-" + r.id,
          legend_name: d.legend_name || "Azmari Legend",
          era_or_style: d.era_or_style || "",
          admin_name: d.admin_name || r.name || "Admin",
          admin_phone: normPhone(d.admin_phone || r.phone),
          story: d.story || "",
          free_admin_post: true,
          created_at: d.created_at || ""
        };
      });
    } catch (e) {
      return [];
    }
  }

  async function publishFreeLegendPost(post) {
    var res = await fetch(SB_URL + "/rest/v1/user_entries", {
      method: "POST",
      headers: sbHeaders(),
      body: JSON.stringify({
        kind: "legend_post",
        phone: post.admin_phone,
        name: post.admin_name,
        data: Object.assign({}, post, { free_admin_post: true })
      })
    });
    if (!res.ok) {
      throw new Error("Could not publish Legend post (" + res.status + ")");
    }
    return res.json();
  }

  function renderLegendSection() {
    if (document.getElementById("azmari-legend-section")) return;

    var isAdminUnlocked = false;

    var container = document.createElement("section");
    container.id = "azmari-legend-section";
    container.style.cssText = "max-width:860px;margin:20px auto;padding:16px;border:1px solid currentColor;border-radius:8px;";

    container.innerHTML = [
      "<div style='display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;'>",
      "  <h2 style='margin:0;font-size:20px;'>Legend Page (Free Admin Posting)</h2>",
      "  <div style='display:flex;gap:8px;align-items:center;flex-wrap:wrap;'>",
      "    <input id='legend-admin-key' type='password' placeholder='Admin Passkey' style='padding:6px 8px;' />",
      "    <button type='button' id='legend-admin-toggle' style='padding:6px 12px;cursor:pointer;'>Unlock Admin Free Post</button>",
      "    <button type='button' id='legend-refresh-btn' style='padding:6px 12px;cursor:pointer;'>Refresh Legends</button>",
      "  </div>",
      "</div>",
      "<div id='legend-embedded-profile' style='padding:10px;border:1px solid currentColor;border-radius:6px;margin-bottom:14px;'></div>",
      "<form id='legend-post-form' style='display:none;gap:8px;padding:12px;border:1px solid currentColor;border-radius:6px;margin-bottom:16px;'>",
      "  <strong>Admin Free Legend Post (No Fee • Publishes Directly to Legend Page)</strong>",
      "  <input id='leg-admin-name' type='text' placeholder='Admin Name (locks once registered)' style='padding:8px;' />",
      "  <input id='leg-admin-phone' type='tel' placeholder='Admin Phone Number (locks once registered)' style='padding:8px;' />",
      "  <div style='display:grid;grid-template-columns:1fr 1fr;gap:8px;'>",
      "    <input id='leg-name' type='text' placeholder='Legend Name / Title' required style='padding:8px;' />",
      "    <input id='leg-era' type='text' placeholder='Era / Tradition (e.g. Begena, Azmari, Krar)' style='padding:8px;' />",
      "  </div>",
      "  <textarea id='leg-story' rows='3' placeholder='Historical notes, tribute, or legacy details...' style='padding:8px;'></textarea>",
      "  <button type='submit' style='padding:8px 14px;cursor:pointer;'>Publish Free Legend Post (Admin)</button>",
      "  <div id='legend-form-status' style='font-size:13px;'></div>",
      "</form>",
      "<div id='legend-locked-note' style='padding:10px;border:1px solid currentColor;border-radius:6px;margin-bottom:14px;font-size:13px;'>",
      "  Legend posting is a free admin-side page. Enter the admin passkey above to open the free post form, or browse published legends below.",
      "</div>",
      "<h3 style='margin:0 0 8px;font-size:16px;'>Published Legends</h3>",
      "<div id='legend-list' style='display:grid;gap:10px;'></div>"
    ].join("");

    document.body.appendChild(container);

    var formEl = container.querySelector("#legend-post-form");
    var lockedNote = container.querySelector("#legend-locked-note");
    var keyInput = container.querySelector("#legend-admin-key");
    var listBox = container.querySelector("#legend-list");
    var statusEl = container.querySelector("#legend-form-status");
    var nameInput = container.querySelector("#leg-admin-name");
    var phoneInput = container.querySelector("#leg-admin-phone");

    function syncEmbeddedProfileUI() {
      var prof = getEmbeddedProfile();
      if (prof && prof.locked) {
        nameInput.value = prof.name;
        phoneInput.value = prof.phone;
        nameInput.readOnly = true;
        phoneInput.readOnly = true;

      } else {

          "<div><strong>Profile Status:</strong> Enter your name and phone once—once saved, your profile stays embedded as read-only text forever.</div>";
      }
    }

    function renderLegends(items) {
      if (!items.length) {
        listBox.innerHTML = "<p style='font-size:13px;'>No Legend posts published yet.</p>";
        return;
      }
      listBox.innerHTML = items.map(function (item) {
        return (
          "<article style='padding:10px;border:1px solid currentColor;border-radius:6px;'>" +
          "  <div style='display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;'>" +
          "    <strong>" + item.legend_name + "</strong>" +
          "    <span>" + (item.era_or_style || "Legend") + " • Free Admin Post</span>" +
          "  </div>" +
          "  <div style='font-size:12px;margin-top:4px;'>Published by Admin: " + item.admin_name + " (" + item.admin_phone + ")</div>" +
          "  <p style='margin:6px 0 0;font-size:13px;'>" + (item.story || "") + "</p>" +
          "</article>"
        );
      }).join("");
    }

    async function loadLegends() {
      var remote = await fetchRemoteLegends();
      var local = loadLocalLegends();
      var merged = [].concat(remote, local);
      renderLegends(merged);
    }

    container.querySelector("#legend-admin-toggle").addEventListener("click", function () {
      if (isAdminUnlocked) {
        isAdminUnlocked = false;
        formEl.style.display = "none";
        lockedNote.style.display = "block";
        container.querySelector("#legend-admin-toggle").textContent = "Unlock Admin Free Post";
        return;
      }
      if (keyInput.value.trim() === ADMIN_PASSKEY) {
        isAdminUnlocked = true;
        formEl.style.display = "grid";
        lockedNote.style.display = "none";
        container.querySelector("#legend-admin-toggle").textContent = "Lock Admin Form";
        statusEl.textContent = "Admin mode unlocked: free posting enabled.";
      } else {
        lockedNote.textContent = "Invalid admin passkey. Use the configured admin passkey to open the free post form.";
      }
    });

    container.querySelector("#legend-refresh-btn").addEventListener("click", loadLegends);

    formEl.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      if (!isAdminUnlocked) {
        statusEl.textContent = "Unlock admin mode first.";
        return;
      }
      var locked = lockEmbeddedProfile({
        name: nameInput.value,
        phone: phoneInput.value,
        role: "Admin"
      });
      if (!locked) {

        return;
      }
      syncEmbeddedProfileUI();

      var newLegend = {
        id: "local-" + Date.now(),
        legend_name: container.querySelector("#leg-name").value.trim(),
        era_or_style: container.querySelector("#leg-era").value.trim(),
        admin_name: locked.name,
        admin_phone: locked.phone,
        story: container.querySelector("#leg-story").value.trim(),
        free_admin_post: true,
        created_at: new Date().toISOString()
      };

      var localList = loadLocalLegends();
      localList.unshift(newLegend);
      saveLocalLegends(localList);

      try {
        await publishFreeLegendPost(newLegend);
        statusEl.textContent = "Free Legend post published! Your profile remains locked as embedded text.";
      } catch (e) {
        statusEl.textContent = "Saved locally; sync note: " + e.message;
      }

      container.querySelector("#leg-name").value = "";
      container.querySelector("#leg-era").value = "";
      container.querySelector("#leg-story").value = "";
      loadLegends();
    });

    syncEmbeddedProfileUI();
    loadLegends();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderLegendSection);
  } else {
    renderLegendSection();
  }
})();

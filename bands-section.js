(function () {
  "use strict";

  var SB_URL = "https://rnqizccrzbolsynfsxbu.supabase.co";
  var SB_KEY = "sb_publishable_1pbzO1FOGTjIjjE-yF7d1A__OFPESB2";
  var PROFILE_KEY = "azmari_embedded_profile_v220";
  var BANDS_LOCAL_KEY = "azmari_band_posts_v220";

  var TIER_RANK = {
    platinum: 4,
    gold: 3,
    silver: 2,
    basic: 1
  };

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

  function normalizeTier(tier) {
    var t = String(tier || "basic").trim().toLowerCase();
    return TIER_RANK[t] ? t : "basic";
  }

  function tierLabel(tier) {
    var t = normalizeTier(tier);
    return t.charAt(0).toUpperCase() + t.slice(1);
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

  function loadLocalBands() {
    try {
      var arr = JSON.parse(localStorage.getItem(BANDS_LOCAL_KEY) || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function saveLocalBands(posts) {
    try {
      localStorage.setItem(BANDS_LOCAL_KEY, JSON.stringify(posts));
    } catch (e) {}
  }

  async function fetchRemoteBands() {
    try {
      var res = await fetch(
        SB_URL + "/rest/v1/user_entries?kind=eq.band_post&order=id.desc&limit=100",
        { headers: sbHeaders() }
      );
      if (!res.ok) return [];
      var rows = await res.json();
      if (!Array.isArray(rows)) return [];
      return rows.map(function (r) {
        var d = r.data || {};
        return {
          id: "sb-" + r.id,
          band_name: d.band_name || "Band",
          tier: normalizeTier(d.tier),
          genre_or_style: d.genre_or_style || "",
          city: d.city || "",
          leader_name: d.leader_name || r.name || "Band Leader",
          leader_phone: normPhone(d.leader_phone || r.phone),
          bio: d.bio || "",
          approved: Boolean(d.approved === true)
        };
      });
    } catch (e) {
      return [];
    }
  }

  async function publishBandPost(band) {
    var res = await fetch(SB_URL + "/rest/v1/user_entries", {
      method: "POST",
      headers: sbHeaders(),
      body: JSON.stringify({
        kind: "band_post",
        phone: band.leader_phone,
        name: band.leader_name,
        data: Object.assign({}, band, { approved: false })
      })
    });
    if (!res.ok) {
      throw new Error("Could not submit band post (" + res.status + ")");
    }
    return res.json();
  }

  function sortPlatinumToBasic(list) {
    return list.slice().sort(function (a, b) {
      var diff = (TIER_RANK[normalizeTier(b.tier)] || 1) - (TIER_RANK[normalizeTier(a.tier)] || 1);
      if (diff !== 0) return diff;
      return String(a.band_name || "").localeCompare(String(b.band_name || ""));
    });
  }

  function renderBandsSection() {
    if (document.getElementById("azmari-bands-section")) return;

    var container = document.createElement("section");
    container.id = "azmari-bands-section";
    container.style.cssText = "max-width:860px;margin:20px auto;padding:16px;border:1px solid currentColor;border-radius:8px;";

    container.innerHTML = [
      "<div style='display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;'>",
      "  <h2 style='margin:0;font-size:20px;'>Bands (Platinum to Basic • Admin Approved)</h2>",
      "  <button type='button' id='bands-refresh-btn' style='padding:6px 12px;cursor:pointer;'>Refresh Bands</button>",
      "</div>",
      "<div id='bands-embedded-profile' style='padding:10px;border:1px solid currentColor;border-radius:6px;margin-bottom:14px;'></div>",
      "<div id='bands-slideshow-box' style='padding:12px;border:1px solid currentColor;border-radius:6px;margin-bottom:16px;'>",
      "  <div style='display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;'>",
      "    <strong>Random Approved Bands Slideshow</strong>",
      "    <div style='display:flex;gap:6px;'>",
      "      <button type='button' id='bands-slide-prev' style='padding:4px 10px;cursor:pointer;'>Prev</button>",
      "      <button type='button' id='bands-slide-random' style='padding:4px 10px;cursor:pointer;'>Randomize</button>",
      "      <button type='button' id='bands-slide-next' style='padding:4px 10px;cursor:pointer;'>Next</button>",
      "    </div>",
      "  </div>",
      "  <div id='bands-slide-content'></div>",
      "</div>",
      "<form id='bands-post-form' style='display:grid;gap:8px;padding:12px;border:1px solid currentColor;border-radius:6px;margin-bottom:16px;'>",
      "  <strong>Post a Band (Visible to All Users After Admin Approval)</strong>",
      "  <input id='band-leader-name' type='text' placeholder='Your Full Name (locks once registered)' style='padding:8px;' />",
      "  <input id='band-leader-phone' type='tel' placeholder='Your Phone Number (locks once registered)' style='padding:8px;' />",
      "  <input id='band-name' type='text' placeholder='Band Name' required style='padding:8px;' />",
      "  <div style='display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;'>",
      "    <select id='band-tier' style='padding:8px;'>",
      "      <option value='platinum'>Platinum Privilege (Top)</option>",
      "      <option value='gold'>Gold Privilege</option>",
      "      <option value='silver'>Silver Privilege</option>",
      "      <option value='basic' selected>Basic Privilege</option>",
      "    </select>",
      "    <input id='band-style' type='text' placeholder='Style / Genre (e.g. Ethio-Jazz, Azmari)' style='padding:8px;' />",
      "    <input id='band-city' type='text' placeholder='City / Base' style='padding:8px;' />",
      "  </div>",
      "  <textarea id='band-bio' rows='2' placeholder='Band lineup, booking details, and sound profile...' style='padding:8px;'></textarea>",
      "  <button type='submit' style='padding:8px 14px;cursor:pointer;'>Submit Band for Admin Approval</button>",
      "  <div id='bands-form-status' style='font-size:13px;'></div>",
      "</form>",
      "<h3 style='margin:0 0 8px;font-size:16px;'>Approved Bands (Sorted Platinum → Basic)</h3>",
      "<div id='bands-list' style='display:grid;gap:10px;'></div>"
    ].join("");

    document.body.appendChild(container);

    var slideContent = container.querySelector("#bands-slide-content");
    var listBox = container.querySelector("#bands-list");
    var statusEl = container.querySelector("#bands-form-status");
    var nameInput = container.querySelector("#band-leader-name");
    var phoneInput = container.querySelector("#band-leader-phone");

    var approvedRanked = [];
    var slideIndex = 0;

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

    function renderSlide() {
      if (!approvedRanked.length) {
        slideContent.innerHTML = "<p style='margin:0;font-size:13px;'>No admin-approved bands in the slideshow yet.</p>";
        return;
      }
      var item = approvedRanked[((slideIndex % approvedRanked.length) + approvedRanked.length) % approvedRanked.length];
      slideContent.innerHTML =
        "<div style='padding:10px;border:1px solid currentColor;border-radius:6px;'>" +
        "  <div style='font-size:16px;font-weight:700;'>[" + tierLabel(item.tier) + "] " + item.band_name + "</div>" +
        "  <div style='font-size:12px;margin-top:4px;'>" + (item.genre_or_style || "Ensemble") + (item.city ? " • " + item.city : "") + " | Lead: " + item.leader_name + "</div>" +
        "  <p style='margin:6px 0 0;font-size:13px;'>" + (item.bio || "") + "</p>" +
        "</div>";
    }

    function renderList() {
      if (!approvedRanked.length) {
        listBox.innerHTML = "<p style='font-size:13px;'>No admin-approved bands available for all users yet.</p>";
        return;
      }
      listBox.innerHTML = approvedRanked.map(function (item) {
        return (
          "<article style='padding:10px;border:1px solid currentColor;border-radius:6px;'>" +
          "  <div style='display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;'>" +
          "    <strong>" + item.band_name + "</strong>" +
          "    <span>Privilege: <strong>" + tierLabel(item.tier) + "</strong></span>" +
          "  </div>" +
          "  <div style='font-size:12px;margin-top:4px;'>" + (item.genre_or_style || "Ensemble") + (item.city ? " • " + item.city : "") + " • Lead: " + item.leader_name + " (" + item.leader_phone + ")</div>" +
          "  <p style='margin:6px 0 0;font-size:13px;'>" + (item.bio || "") + "</p>" +
          "</article>"
        );
      }).join("");
    }

    async function loadBands() {
      var remote = await fetchRemoteBands();
      var local = loadLocalBands();
      var merged = [].concat(remote, local).filter(function (b) { return b && b.approved === true; });
      approvedRanked = sortPlatinumToBasic(merged);
      slideIndex = approvedRanked.length > 1 ? Math.floor(Math.random() * approvedRanked.length) : 0;
      renderSlide();
      renderList();
    }

    container.querySelector("#bands-slide-prev").addEventListener("click", function () {
      if (!approvedRanked.length) return;
      slideIndex = (slideIndex - 1 + approvedRanked.length) % approvedRanked.length;
      renderSlide();
    });

    container.querySelector("#bands-slide-next").addEventListener("click", function () {
      if (!approvedRanked.length) return;
      slideIndex = (slideIndex + 1) % approvedRanked.length;
      renderSlide();
    });

    container.querySelector("#bands-slide-random").addEventListener("click", function () {
      if (!approvedRanked.length) return;
      slideIndex = Math.floor(Math.random() * approvedRanked.length);
      renderSlide();
    });

    container.querySelector("#bands-refresh-btn").addEventListener("click", loadBands);

    container.querySelector("#bands-post-form").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var locked = lockEmbeddedProfile({
        name: nameInput.value,
        phone: phoneInput.value
      });
      if (!locked) {

        return;
      }
      syncEmbeddedProfileUI();

      var newBand = {
        id: "local-" + Date.now(),
        band_name: container.querySelector("#band-name").value.trim(),
        tier: normalizeTier(container.querySelector("#band-tier").value),
        genre_or_style: container.querySelector("#band-style").value.trim(),
        city: container.querySelector("#band-city").value.trim(),
        leader_name: locked.name,
        leader_phone: locked.phone,
        bio: container.querySelector("#band-bio").value.trim(),
        approved: false
      };

      var localList = loadLocalBands();
      localList.unshift(newBand);
      saveLocalBands(localList);

      try {
        await publishBandPost(newBand);
        statusEl.textContent = "Band submitted! Your profile is locked as embedded text, and the post will appear to all users after admin approval.";
      } catch (e) {
        statusEl.textContent = "Saved locally; pending admin approval before public display (" + e.message + ").";
      }

      container.querySelector("#band-name").value = "";
      container.querySelector("#band-style").value = "";
      container.querySelector("#band-city").value = "";
      container.querySelector("#band-bio").value = "";
      loadBands();
    });

    syncEmbeddedProfileUI();
    loadBands();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderBandsSection);
  } else {
    renderBandsSection();
  }
})();

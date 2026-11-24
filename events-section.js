(function () {
  "use strict";

  var SB_URL = "https://rnqizccrzbolsynfsxbu.supabase.co";
  var SB_KEY = "sb_publishable_1pbzO1FOGTjIjjE-yF7d1A__OFPESB2";
  var PROFILE_KEY = "azmari_embedded_profile_v220";
  var EVENTS_LOCAL_KEY = "azmari_event_posts_v220";

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

  function loadLocalEvents() {
    try {
      var arr = JSON.parse(localStorage.getItem(EVENTS_LOCAL_KEY) || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function saveLocalEvents(posts) {
    try {
      localStorage.setItem(EVENTS_LOCAL_KEY, JSON.stringify(posts));
    } catch (e) {}
  }

  async function fetchRemoteEvents() {
    try {
      var res = await fetch(
        SB_URL + "/rest/v1/user_entries?kind=eq.event_post&order=id.desc&limit=100",
        { headers: sbHeaders() }
      );
      if (!res.ok) return [];
      var rows = await res.json();
      if (!Array.isArray(rows)) return [];
      return rows.map(function (r) {
        var d = r.data || {};
        return {
          id: "sb-" + r.id,
          title: d.title || "Event",
          tier: normalizeTier(d.tier),
          event_date: d.event_date || "",
          venue: d.venue || "",
          organizer_name: d.organizer_name || r.name || "Organizer",
          organizer_phone: normPhone(d.organizer_phone || r.phone),
          notes: d.notes || "",
          approved: Boolean(d.approved === true)
        };
      });
    } catch (e) {
      return [];
    }
  }

  async function publishEventPost(post) {
    var res = await fetch(SB_URL + "/rest/v1/user_entries", {
      method: "POST",
      headers: sbHeaders(),
      body: JSON.stringify({
        kind: "event_post",
        phone: post.organizer_phone,
        name: post.organizer_name,
        data: Object.assign({}, post, { approved: false })
      })
    });
    if (!res.ok) {
      throw new Error("Could not submit event (" + res.status + ")");
    }
    return res.json();
  }

  function sortPlatinumToBasic(list) {
    return list.slice().sort(function (a, b) {
      var diff = (TIER_RANK[normalizeTier(b.tier)] || 1) - (TIER_RANK[normalizeTier(a.tier)] || 1);
      if (diff !== 0) return diff;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
  }

  function renderEventsSection() {
    if (document.getElementById("azmari-events-section")) return;

    var container = document.createElement("section");
    container.id = "azmari-events-section";
    container.style.cssText = "max-width:860px;margin:20px auto;padding:16px;border:1px solid currentColor;border-radius:8px;";

    container.innerHTML = [
      "<div style='display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;'>",
      "  <h2 style='margin:0;font-size:20px;'>Events (Platinum to Basic • Admin Approved)</h2>",
      "  <button type='button' id='events-refresh-btn' style='padding:6px 12px;cursor:pointer;'>Refresh Events</button>",
      "</div>",
      "<div id='events-embedded-profile' style='padding:10px;border:1px solid currentColor;border-radius:6px;margin-bottom:14px;'></div>",
      "<div id='events-slideshow-box' style='padding:12px;border:1px solid currentColor;border-radius:6px;margin-bottom:16px;'>",
      "  <div style='display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;'>",
      "    <strong>Random Approved Events Slideshow</strong>",
      "    <div style='display:flex;gap:6px;'>",
      "      <button type='button' id='events-slide-prev' style='padding:4px 10px;cursor:pointer;'>Prev</button>",
      "      <button type='button' id='events-slide-random' style='padding:4px 10px;cursor:pointer;'>Randomize</button>",
      "      <button type='button' id='events-slide-next' style='padding:4px 10px;cursor:pointer;'>Next</button>",
      "    </div>",
      "  </div>",
      "  <div id='events-slide-content'></div>",
      "</div>",
      "<form id='events-post-form' style='display:grid;gap:8px;padding:12px;border:1px solid currentColor;border-radius:6px;margin-bottom:16px;'>",
      "  <strong>Submit an Event (Visible to All Users After Admin Approval)</strong>",
      "  <input id='ev-organizer-name' type='text' placeholder='Your Full Name (locks once registered)' style='padding:8px;' />",
      "  <input id='ev-organizer-phone' type='tel' placeholder='Your Phone Number (locks once registered)' style='padding:8px;' />",
      "  <input id='ev-title' type='text' placeholder='Event Title (e.g. Azmari Night, Krar Showcase)' required style='padding:8px;' />",
      "  <div style='display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;'>",
      "    <select id='ev-tier' style='padding:8px;'>",
      "      <option value='platinum'>Platinum Privilege (Top)</option>",
      "      <option value='gold'>Gold Privilege</option>",
      "      <option value='silver'>Silver Privilege</option>",
      "      <option value='basic' selected>Basic Privilege</option>",
      "    </select>",
      "    <input id='ev-date' type='text' placeholder='Date / Time' style='padding:8px;' />",
      "    <input id='ev-venue' type='text' placeholder='Venue / City' style='padding:8px;' />",
      "  </div>",
      "  <textarea id='ev-notes' rows='2' placeholder='Lineup, ticket info, or event summary...' style='padding:8px;'></textarea>",
      "  <button type='submit' style='padding:8px 14px;cursor:pointer;'>Submit Event for Admin Approval</button>",
      "  <div id='events-form-status' style='font-size:13px;'></div>",
      "</form>",
      "<h3 style='margin:0 0 8px;font-size:16px;'>Approved Events (Sorted Platinum → Basic)</h3>",
      "<div id='events-list' style='display:grid;gap:10px;'></div>"
    ].join("");

    document.body.appendChild(container);

    var slideContent = container.querySelector("#events-slide-content");
    var listBox = container.querySelector("#events-list");
    var statusEl = container.querySelector("#events-form-status");
    var nameInput = container.querySelector("#ev-organizer-name");
    var phoneInput = container.querySelector("#ev-organizer-phone");

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
        slideContent.innerHTML = "<p style='margin:0;font-size:13px;'>No admin-approved events in the slideshow yet.</p>";
        return;
      }
      var item = approvedRanked[((slideIndex % approvedRanked.length) + approvedRanked.length) % approvedRanked.length];
      slideContent.innerHTML =
        "<div style='padding:10px;border:1px solid currentColor;border-radius:6px;'>" +
        "  <div style='font-size:16px;font-weight:700;'>[" + tierLabel(item.tier) + "] " + item.title + "</div>" +
        "  <div style='font-size:12px;margin-top:4px;'>" + (item.event_date || "TBA") + (item.venue ? " • " + item.venue : "") + " | Host: " + item.organizer_name + "</div>" +
        "  <p style='margin:6px 0 0;font-size:13px;'>" + (item.notes || "") + "</p>" +
        "</div>";
    }

    function renderList() {
      if (!approvedRanked.length) {
        listBox.innerHTML = "<p style='font-size:13px;'>No admin-approved events available for all users yet.</p>";
        return;
      }
      listBox.innerHTML = approvedRanked.map(function (item) {
        return (
          "<article style='padding:10px;border:1px solid currentColor;border-radius:6px;'>" +
          "  <div style='display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;'>" +
          "    <strong>" + item.title + "</strong>" +
          "    <span>Privilege: <strong>" + tierLabel(item.tier) + "</strong></span>" +
          "  </div>" +
          "  <div style='font-size:12px;margin-top:4px;'>" + (item.event_date || "TBA") + (item.venue ? " • " + item.venue : "") + " • Organizer: " + item.organizer_name + " (" + item.organizer_phone + ")</div>" +
          "  <p style='margin:6px 0 0;font-size:13px;'>" + (item.notes || "") + "</p>" +
          "</article>"
        );
      }).join("");
    }

    async function loadEvents() {
      var remote = await fetchRemoteEvents();
      var local = loadLocalEvents();
      var merged = [].concat(remote, local).filter(function (ev) { return ev && ev.approved === true; });
      approvedRanked = sortPlatinumToBasic(merged);
      slideIndex = approvedRanked.length > 1 ? Math.floor(Math.random() * approvedRanked.length) : 0;
      renderSlide();
      renderList();
    }

    container.querySelector("#events-slide-prev").addEventListener("click", function () {
      if (!approvedRanked.length) return;
      slideIndex = (slideIndex - 1 + approvedRanked.length) % approvedRanked.length;
      renderSlide();
    });

    container.querySelector("#events-slide-next").addEventListener("click", function () {
      if (!approvedRanked.length) return;
      slideIndex = (slideIndex + 1) % approvedRanked.length;
      renderSlide();
    });

    container.querySelector("#events-slide-random").addEventListener("click", function () {
      if (!approvedRanked.length) return;
      slideIndex = Math.floor(Math.random() * approvedRanked.length);
      renderSlide();
    });

    container.querySelector("#events-refresh-btn").addEventListener("click", loadEvents);

    container.querySelector("#events-post-form").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var locked = lockEmbeddedProfile({
        name: nameInput.value,
        phone: phoneInput.value
      });
      if (!locked) {

        return;
      }
      syncEmbeddedProfileUI();

      var newEvent = {
        id: "local-" + Date.now(),
        title: container.querySelector("#ev-title").value.trim(),
        tier: normalizeTier(container.querySelector("#ev-tier").value),
        event_date: container.querySelector("#ev-date").value.trim(),
        venue: container.querySelector("#ev-venue").value.trim(),
        organizer_name: locked.name,
        organizer_phone: locked.phone,
        notes: container.querySelector("#ev-notes").value.trim(),
        approved: false
      };

      var localList = loadLocalEvents();
      localList.unshift(newEvent);
      saveLocalEvents(localList);

      try {
        await publishEventPost(newEvent);
        statusEl.textContent = "Event submitted! Your profile is locked as embedded text, and the post will show to all users after admin approval.";
      } catch (e) {
        statusEl.textContent = "Saved locally; pending admin approval before public display (" + e.message + ").";
      }

      container.querySelector("#ev-title").value = "";
      container.querySelector("#ev-date").value = "";
      container.querySelector("#ev-venue").value = "";
      container.querySelector("#ev-notes").value = "";
      loadEvents();
    });

    syncEmbeddedProfileUI();
    loadEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderEventsSection);
  } else {
    renderEventsSection();
  }
})();

(function () {
  "use strict";

  var SB_URL = "https://rnqizccrzbolsynfsxbu.supabase.co";
  var SB_KEY = "sb_publishable_1pbzO1FOGTjIjjE-yF7d1A__OFPESB2";
  var PROFILE_KEY = "azmari_embedded_profile_v220";
  var JOBS_LOCAL_KEY = "azmari_job_offers_v220";

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

  function loadLocalJobs() {
    try {
      var arr = JSON.parse(localStorage.getItem(JOBS_LOCAL_KEY) || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function saveLocalJobs(posts) {
    try {
      localStorage.setItem(JOBS_LOCAL_KEY, JSON.stringify(posts));
    } catch (e) {}
  }

  async function fetchRemoteJobs() {
    try {
      var res = await fetch(
        SB_URL + "/rest/v1/user_entries?kind=eq.job_offer&order=id.desc&limit=100",
        { headers: sbHeaders() }
      );
      if (!res.ok) return [];
      var rows = await res.json();
      if (!Array.isArray(rows)) return [];
      return rows.map(function (r) {
        var d = r.data || {};
        return {
          id: "sb-" + r.id,
          role_title: d.role_title || "Music Opportunity",
          venue_or_org: d.venue_or_org || "",
          pay_info: d.pay_info || "Negotiable",
          location: d.location || "",
          poster_name: d.poster_name || r.name || "Employer",
          poster_phone: normPhone(d.poster_phone || r.phone),
          details: d.details || "",
          approved: Boolean(d.approved === true)
        };
      });
    } catch (e) {
      return [];
    }
  }

  async function publishJobOffer(job) {
    var res = await fetch(SB_URL + "/rest/v1/user_entries", {
      method: "POST",
      headers: sbHeaders(),
      body: JSON.stringify({
        kind: "job_offer",
        phone: job.poster_phone,
        name: job.poster_name,
        data: Object.assign({}, job, { approved: false })
      })
    });
    if (!res.ok) {
      throw new Error("Could not submit job offer (" + res.status + ")");
    }
    return res.json();
  }

  function renderJobsSection() {
    if (document.getElementById("azmari-jobs-section")) return;

    var container = document.createElement("section");
    container.id = "azmari-jobs-section";
    container.style.cssText = "max-width:860px;margin:20px auto;padding:16px;border:1px solid currentColor;border-radius:8px;";

    container.innerHTML = [
      "<div style='display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;'>",
      "  <h2 style='margin:0;font-size:20px;'>Job Offers (Admin Approved for All Users)</h2>",
      "  <button type='button' id='jobs-refresh-btn' style='padding:6px 12px;cursor:pointer;'>Refresh Job Offers</button>",
      "</div>",
      "<div id='jobs-embedded-profile' style='padding:10px;border:1px solid currentColor;border-radius:6px;margin-bottom:14px;'></div>",
      "<form id='jobs-post-form' style='display:grid;gap:8px;padding:12px;border:1px solid currentColor;border-radius:6px;margin-bottom:16px;'>",
      "  <strong>Post a Job Offer (Visible to All Users After Admin Approval)</strong>",
      "  <input id='job-poster-name' type='text' placeholder='Your Full Name (locks once registered)' style='padding:8px;' />",
      "  <input id='job-poster-phone' type='tel' placeholder='Your Phone Number (locks once registered)' style='padding:8px;' />",
      "  <input id='job-role-title' type='text' placeholder='Role Title (e.g. Krar Player, Sound Engineer, Session Vocalist)' required style='padding:8px;' />",
      "  <div style='display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;'>",
      "    <input id='job-org' type='text' placeholder='Venue / Band / Studio' style='padding:8px;' />",
      "    <input id='job-pay' type='text' placeholder='Pay / Rate (e.g. ETB 1,500/night)' style='padding:8px;' />",
      "    <input id='job-location' type='text' placeholder='Location / City' style='padding:8px;' />",
      "  </div>",
      "  <textarea id='job-details' rows='2' placeholder='Schedule, requirements, and how applicants reach out...' style='padding:8px;'></textarea>",
      "  <button type='submit' style='padding:8px 14px;cursor:pointer;'>Submit Job Offer for Admin Approval</button>",
      "  <div id='jobs-form-status' style='font-size:13px;'></div>",
      "</form>",
      "<h3 style='margin:0 0 8px;font-size:16px;'>Approved Job Offers</h3>",
      "<div id='jobs-list' style='display:grid;gap:10px;'></div>"
    ].join("");

    document.body.appendChild(container);

    var listBox = container.querySelector("#jobs-list");
    var statusEl = container.querySelector("#jobs-form-status");
    var nameInput = container.querySelector("#job-poster-name");
    var phoneInput = container.querySelector("#job-poster-phone");

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

    function renderApprovedJobs(approvedJobs) {
      if (!approvedJobs.length) {
        listBox.innerHTML = "<p style='font-size:13px;'>No admin-approved job offers available for all users yet.</p>";
        return;
      }
      listBox.innerHTML = approvedJobs.map(function (job) {
        return (
          "<article style='padding:10px;border:1px solid currentColor;border-radius:6px;'>" +
          "  <div style='display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;'>" +
          "    <strong>" + job.role_title + "</strong>" +
          "    <strong>" + job.pay_info + "</strong>" +
          "  </div>" +
          "  <div style='font-size:12px;margin-top:4px;'>" + (job.venue_or_org || "Employer") + (job.location ? " • " + job.location : "") + " • Contact: " + job.poster_name + " (" + job.poster_phone + ")</div>" +
          "  <p style='margin:6px 0 0;font-size:13px;'>" + (job.details || "") + "</p>" +
          "</article>"
        );
      }).join("");
    }

    async function loadJobs() {
      var remote = await fetchRemoteJobs();
      var local = loadLocalJobs();
      var merged = [].concat(remote, local).filter(function (j) { return j && j.approved === true; });
      renderApprovedJobs(merged);
    }

    container.querySelector("#jobs-refresh-btn").addEventListener("click", loadJobs);

    container.querySelector("#jobs-post-form").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var locked = lockEmbeddedProfile({
        name: nameInput.value,
        phone: phoneInput.value
      });
      if (!locked) {

        return;
      }
      syncEmbeddedProfileUI();

      var newJob = {
        id: "local-" + Date.now(),
        role_title: container.querySelector("#job-role-title").value.trim(),
        venue_or_org: container.querySelector("#job-org").value.trim(),
        pay_info: container.querySelector("#job-pay").value.trim() || "Negotiable",
        location: container.querySelector("#job-location").value.trim(),
        poster_name: locked.name,
        poster_phone: locked.phone,
        details: container.querySelector("#job-details").value.trim(),
        approved: false
      };

      var localList = loadLocalJobs();
      localList.unshift(newJob);
      saveLocalJobs(localList);

      try {
        await publishJobOffer(newJob);
        statusEl.textContent = "Job offer submitted! Your profile is locked as embedded text, and the post will appear to all users after admin approval.";
      } catch (e) {
        statusEl.textContent = "Saved locally; pending admin approval before public display (" + e.message + ").";
      }

      container.querySelector("#job-role-title").value = "";
      container.querySelector("#job-org").value = "";
      container.querySelector("#job-pay").value = "";
      container.querySelector("#job-location").value = "";
      container.querySelector("#job-details").value = "";
      loadJobs();
    });

    syncEmbeddedProfileUI();
    loadJobs();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderJobsSection);
  } else {
    renderJobsSection();
  }
})();

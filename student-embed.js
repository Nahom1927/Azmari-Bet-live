(function () {
  "use strict";

  var SUPABASE_URL = "https://rnqizccrzbolsynfsxbu.supabase.co/rest/v1/user_entries";
  var SUPABASE_KEY = "sb_publishable_1pbzO1FOGTjIjjE-yF7d1A__OFPESB2";
  var LOCAL_KEY = "azmari_student_embedded_v220";
  var LAST_PHONE_KEY = "azmari_student_last_phone_v220";

  function normalizePhone(raw) {
    var digits = String(raw || "").replace(/[^\d+]/g, "");
    if (!digits) return "";
    if (digits.startsWith("+")) return digits;
    if (digits.startsWith("251")) return "+" + digits;
    if (digits.startsWith("0")) return "+251" + digits.slice(1);
    return digits;
  }

  function readLocalStudent(phone) {
    try {
      var map = JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}");
      var norm = normalizePhone(phone || localStorage.getItem(LAST_PHONE_KEY) || "");
      if (norm && map[norm]) return map[norm];
      var keys = Object.keys(map);
      return keys.length ? map[keys[keys.length - 1]] : null;
    } catch (e) {
      return null;
    }
  }

  function writeLocalStudent(record) {
    try {
      var norm = normalizePhone(record.phone);
      var map = JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}");
      if (norm) {
        map[norm] = record;
        localStorage.setItem(LAST_PHONE_KEY, norm);
      }
      map[record.student_id || "latest"] = record;
      localStorage.setItem(LOCAL_KEY, JSON.stringify(map));
    } catch (e) {}
  }

  function fetchRemoteStudent(phone) {
    var norm = normalizePhone(phone);
    var url = SUPABASE_URL + "?kind=eq.student&order=id.desc&limit=10";
    if (norm) {
      url = SUPABASE_URL + "?kind=eq.student&phone=eq." + encodeURIComponent(norm) + "&order=id.desc&limit=1";
    }
    return fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: "Bearer " + SUPABASE_KEY
      }
    })
      .then(function (res) { return res.ok ? res.json() : []; })
      .then(function (rows) {
        if (!Array.isArray(rows) || !rows.length) return null;
        var row = rows[0];
        var d = (row && typeof row.data === "object" && row.data) ? row.data : {};
        return {
          student_id: d.student_id || ("STU-" + (row.id || Date.now())),
          name: d.name || row.name || "",
          phone: normalizePhone(d.phone || row.phone || norm),
          instrument: d.instrument || d.course || "Azmari Music",
          level: d.level || "Registered",
          region: d.region || "Addis Ababa",
          locked: true,
          saved_at: d.saved_at || row.created_at || new Date().toISOString()
        };
      })
      .catch(function () {
        return null;
      });
  }

  function saveRemoteStudent(record) {
    var payload = {
      kind: "student",
      phone: normalizePhone(record.phone),
      name: record.name,
      data: record
    };
    return fetch(SUPABASE_URL, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: "Bearer " + SUPABASE_KEY,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.ok ? res.json() : null;
    }).catch(function () {
      return null;
    });
  }

  function ensureEmbeddedContainer() {
    var box = document.getElementById("student-embedded-record");
    if (box) return box;
    box = document.createElement("section");
    box.id = "student-embedded-record";
    box.setAttribute("data-student-embedded", "true");
    box.style.cssText = "margin:16px 0;padding:14px 16px;border:1px solid #d0d7de;border-radius:8px;background:#f8fafc;color:#0f172a;font-family:inherit;";
    var form = document.querySelector("form");
    if (form && form.parentNode) {
      form.parentNode.insertBefore(box, form.nextSibling);
    } else {
      document.body.appendChild(box);
    }
    return box;
  }

  function lockFormFields() {
    var inputs = document.querySelectorAll("form input, form select, form textarea");
    inputs.forEach(function (el) {
      if (el.type === "submit" || el.type === "button") {
        el.style.display = "none";
        return;
      }
      el.setAttribute("readonly", "readonly");
      el.setAttribute("disabled", "disabled");
      el.setAttribute("data-locked-forever", "true");
    });
  }

  function renderEmbeddedStudent(record) {
    if (!record || (!record.name && !record.phone)) return;
    writeLocalStudent(record);
    lockFormFields();

    var box = ensureEmbeddedContainer();
    box.innerHTML = "";

    var title = document.createElement("div");
    title.style.cssText = "font-weight:700;margin-bottom:8px;";
    title.textContent = "Registered Student Record (Permanent Embedded Text)";
    box.appendChild(title);

    var fields = [
      ["Student ID", record.student_id || "STU-LOCKED"],
      ["Full Name", record.name || ""],
      ["Phone", record.phone || ""],
      ["Instrument / Course", record.instrument || ""],
      ["Level", record.level || ""],
      ["Region", record.region || ""],
    ];

    fields.forEach(function (pair) {
      var line = document.createElement("p");
      line.setAttribute("data-student-field", pair[0].toLowerCase().replace(/[^a-z0-9]+/g, "_"));
      line.style.cssText = "margin:4px 0;user-select:text;";
      var label = document.createElement("strong");
      label.textContent = pair[0] + ": ";
      var val = document.createElement("span");
      val.textContent = pair[1];
      line.appendChild(label);
      line.appendChild(val);
      box.appendChild(line);
    });
  }

  function extractFromForm(form) {
    function pick(selectors) {
      for (var i = 0; i < selectors.length; i++) {
        var el = form.querySelector(selectors[i]);
        if (el && String(el.value || "").trim()) return String(el.value).trim();
      }
      return "";
    }
    var name = pick(['[name*="name" i]', '#name', '#studentName', '#full_name', 'input[type="text"]']);
    var phone = normalizePhone(pick(['[name*="phone" i]', '#phone', '#studentPhone', 'input[type="tel"]']));
    var instrument = pick(['[name*="instrument" i]', '[name*="course" i]', '#instrument', '#course', 'select']);
    var level = pick(['[name*="level" i]', '#level']) || "Registered";
    var region = pick(['[name*="region" i]', '[name*="city" i]', '#region']) || "Addis Ababa";
    var studentId = pick(['[name*="student_id" i]', '[name*="id" i]', '#studentId']) || ("STU-" + Date.now().toString().slice(-6));

    return {
      student_id: studentId,
      name: name,
      phone: phone,
      instrument: instrument || "Krar",
      level: level,
      region: region,
      locked: true,
      saved_at: new Date().toISOString()
    };
  }

  function bindFormSubmit() {
    var forms = document.querySelectorAll("form");
    forms.forEach(function (form) {
      if (form.getAttribute("data-azmari-bound")) return;
      form.setAttribute("data-azmari-bound", "true");
      form.addEventListener("submit", function (ev) {
        var rec = extractFromForm(form);
        if (!rec.name && !rec.phone) return;
        renderEmbeddedStudent(rec);
        saveRemoteStudent(rec).then(function (saved) {
          if (Array.isArray(saved) && saved[0] && saved[0].data) {
            renderEmbeddedStudent(Object.assign({}, rec, saved[0].data, { locked: true }));
          }
        });
      }, true);
    });
  }

  function hydrateOnLoad() {
    bindFormSubmit();
    var localRec = readLocalStudent();
    if (localRec) {
      renderEmbeddedStudent(localRec);
    }
    var targetPhone = (localRec && localRec.phone) || localStorage.getItem(LAST_PHONE_KEY) || "";
    fetchRemoteStudent(targetPhone).then(function (remoteRec) {
      if (remoteRec) {
        renderEmbeddedStudent(remoteRec);
      }
    });
  }

  window.AzmariStudentEmbed = {
    saveAndLock: function (input) {
      var rec = Object.assign({
        student_id: "STU-" + Date.now().toString().slice(-6),
        name: "",
        phone: "",
        instrument: "Krar",
        level: "Registered",
        region: "Addis Ababa",
        locked: true,
        saved_at: new Date().toISOString()
      }, input, { phone: normalizePhone(input.phone), locked: true });
      renderEmbeddedStudent(rec);
      return saveRemoteStudent(rec);
    },
    hydrate: hydrateOnLoad
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hydrateOnLoad);
  } else {
    hydrateOnLoad();
  }
})();

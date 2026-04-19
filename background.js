chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "RUN_SCAN") {
    runScan(message.payload)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "DOWNLOAD_CSV") {
    downloadCsv(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function runScan(config) {
  const departDates = dateRange(config.departStart, config.departEnd);
  const returnDates = dateRange(config.returnStart, config.returnEnd);

  const pairs = [];
  for (const depart of departDates) {
    for (const ret of returnDates) {
      if (new Date(ret) <= new Date(depart)) {
        continue;
      }
      pairs.push({ depart, ret });
    }
  }

  if (!pairs.length) {
    throw new Error("No valid round-trip date pairs. Return date must be after departure date.");
  }

  const allFlights = [];
  const skippedPairs = [];
  let globalLowest = null;

  for (const pair of pairs) {
    const url = withUpdatedDates(config.searchUrl, pair.depart, pair.ret);
    const flights = await scanDatePair(url, pair.depart, pair.ret);

    if (!flights.length) {
      skippedPairs.push({ ...pair, reason: "No prices found on page" });
      continue;
    }

    const cheapest = Math.min(...flights.map((f) => f.price));
    if (globalLowest === null || cheapest < globalLowest) {
      globalLowest = cheapest;
    }

    for (const flight of flights) {
      allFlights.push(flight);
    }
  }

  let keptFlights = [];
  if (globalLowest !== null) {
    const max = globalLowest + config.threshold;
    keptFlights = dedupeFlights(allFlights)
      .filter((f) => f.price >= globalLowest && f.price <= max)
      .sort((a, b) => a.price - b.price || a.departDate.localeCompare(b.departDate));
  }

  return {
    scannedAt: new Date().toISOString(),
    totalPairs: pairs.length,
    globalLowest,
    threshold: config.threshold,
    keptFlights,
    skippedPairs
  };
}

async function scanDatePair(url, departDate, returnDate) {
  const tab = await chrome.tabs.create({ url, active: false });

  try {
    await waitForTabComplete(tab.id);
    await sleep(1800);

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectFlightsFromDom
    });

    const rows = Array.isArray(result?.result) ? result.result : [];
    return rows.map((row) => ({
      departDate,
      returnDate,
      airline: row.airline || "Unknown",
      price: row.price,
      bookingLink: row.bookingLink || url,
      lastChecked: new Date().toISOString(),
      sourceUrl: url
    }));
  } finally {
    if (tab.id !== undefined) {
      await chrome.tabs.remove(tab.id);
    }
  }
}

function collectFlightsFromDom() {
  const priceRegex = /\$(\d[\d,]*)/;
  const nodes = Array.from(document.querySelectorAll("body *"));
  const candidates = [];

  for (const el of nodes) {
    if (!(el instanceof HTMLElement)) {
      continue;
    }

    const text = (el.innerText || "").trim();
    if (!text || text.length > 120) {
      continue;
    }

    const priceMatch = text.match(priceRegex);
    if (!priceMatch) {
      continue;
    }

    const parsed = Number(priceMatch[1].replaceAll(",", ""));
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10000) {
      continue;
    }

    const container = el.closest("article, li, div, tr") || el;
    const containerText = (container.innerText || "").replace(/\s+/g, " ").trim();
    const airlineMatch = containerText.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(Airlines|Airways|Air|JetBlue|Delta|United|Frontier|Spirit|Southwest|American)/i);
    const airline = airlineMatch ? `${airlineMatch[1]} ${airlineMatch[2]}` : "Unknown";

    const linkEl = container.querySelector("a[href]") || el.closest("a[href]");
    const bookingLink = linkEl ? linkEl.href : location.href;

    candidates.push({ price: parsed, airline, bookingLink });
  }

  const dedup = new Map();
  for (const row of candidates) {
    const key = `${row.price}|${row.airline}|${row.bookingLink}`;
    if (!dedup.has(key)) {
      dedup.set(key, row);
    }
  }

  return Array.from(dedup.values()).slice(0, 80);
}

function dedupeFlights(flights) {
  const map = new Map();
  for (const f of flights) {
    const key = `${f.departDate}|${f.returnDate}|${f.price}|${f.airline}|${f.bookingLink}`;
    if (!map.has(key)) {
      map.set(key, f);
    }
  }
  return Array.from(map.values());
}

function dateRange(start, end) {
  const out = [];
  const current = new Date(start);
  const endDate = new Date(end);

  while (current <= endDate) {
    out.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }

  return out;
}

function withUpdatedDates(baseUrl, depart, ret) {
  const url = new URL(baseUrl);
  const departCandidates = ["depart", "departure", "outbound", "fromDate", "d1", "startDate"];
  const returnCandidates = ["return", "inbound", "toDate", "d2", "endDate"];

  let didSetDepart = false;
  for (const key of departCandidates) {
    if (url.searchParams.has(key)) {
      url.searchParams.set(key, depart);
      didSetDepart = true;
      break;
    }
  }

  let didSetReturn = false;
  for (const key of returnCandidates) {
    if (url.searchParams.has(key)) {
      url.searchParams.set(key, ret);
      didSetReturn = true;
      break;
    }
  }

  if (!didSetDepart || !didSetReturn) {
    const replaced = url.toString().replace(/\d{4}-\d{2}-\d{2}/g, (m, offset, full) => {
      const matches = full.match(/\d{4}-\d{2}-\d{2}/g) || [];
      if (matches.length < 2) {
        return m;
      }

      const first = full.indexOf(matches[0]);
      const second = full.indexOf(matches[1], first + 1);

      if (offset === first) {
        return depart;
      }
      if (offset === second) {
        return ret;
      }
      return m;
    });

    if (replaced !== url.toString()) {
      return replaced;
    }

    throw new Error("Could not detect depart/return date params in URL. Use a URL that already contains both dates.");
  }

  return url.toString();
}

async function waitForTabComplete(tabId, timeoutMs = 45000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") {
      return;
    }
    await sleep(350);
  }

  throw new Error("Timed out waiting for page load.");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadCsv(scanResult) {
  const rows = scanResult.keptFlights || [];
  if (!rows.length) {
    throw new Error("No flights available to export.");
  }

  const headers = ["departDate", "returnDate", "airline", "priceUsd", "bookingLink", "lastChecked", "sourceUrl"];
  const lines = [headers.join(",")];

  for (const row of rows) {
    const values = [
      row.departDate,
      row.returnDate,
      row.airline,
      row.price,
      row.bookingLink,
      row.lastChecked,
      row.sourceUrl
    ].map(csvEscape);

    lines.push(values.join(","));
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  await chrome.downloads.download({
    url,
    filename: `skiplagged_results_${stamp}.csv`,
    saveAs: true
  });

  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }
  return text;
}

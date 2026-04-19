const els = {
  searchUrl: document.getElementById("searchUrl"),
  departStart: document.getElementById("departStart"),
  departEnd: document.getElementById("departEnd"),
  returnStart: document.getElementById("returnStart"),
  returnEnd: document.getElementById("returnEnd"),
  threshold: document.getElementById("threshold"),
  scanBtn: document.getElementById("scanBtn"),
  csvBtn: document.getElementById("csvBtn"),
  status: document.getElementById("status"),
  summary: document.getElementById("summary")
};

init();

async function init() {
  const saved = await chrome.storage.local.get(["scannerConfig", "scanResult"]);
  if (saved.scannerConfig) {
    const cfg = saved.scannerConfig;
    els.searchUrl.value = cfg.searchUrl || "";
    els.departStart.value = cfg.departStart || "";
    els.departEnd.value = cfg.departEnd || "";
    els.returnStart.value = cfg.returnStart || "";
    els.returnEnd.value = cfg.returnEnd || "";
    els.threshold.value = cfg.threshold ?? 50;
  }

  if (saved.scanResult) {
    renderSummary(saved.scanResult);
  }

  els.scanBtn.addEventListener("click", runScan);
  els.csvBtn.addEventListener("click", downloadCsv);
}

async function runScan() {
  const config = readConfig();
  if (!config) {
    return;
  }

  setStatus("Running scan...", false);
  await chrome.storage.local.set({ scannerConfig: config });

  try {
    const result = await chrome.runtime.sendMessage({ type: "RUN_SCAN", payload: config });
    if (!result?.ok) {
      throw new Error(result?.error || "Scan failed.");
    }

    await chrome.storage.local.set({ scanResult: result.data });
    setStatus("Scan completed.", false);
    renderSummary(result.data);
  } catch (err) {
    setStatus(err.message || "Unexpected error.", true);
  }
}

function readConfig() {
  const config = {
    searchUrl: els.searchUrl.value.trim(),
    departStart: els.departStart.value,
    departEnd: els.departEnd.value,
    returnStart: els.returnStart.value,
    returnEnd: els.returnEnd.value,
    threshold: Number(els.threshold.value)
  };

  if (!config.searchUrl || !config.departStart || !config.departEnd || !config.returnStart || !config.returnEnd) {
    setStatus("All fields are required.", true);
    return null;
  }

  if (Number.isNaN(config.threshold) || config.threshold < 0) {
    setStatus("Threshold must be a non-negative number.", true);
    return null;
  }

  const departStart = new Date(config.departStart);
  const departEnd = new Date(config.departEnd);
  const returnStart = new Date(config.returnStart);
  const returnEnd = new Date(config.returnEnd);

  if (departStart > departEnd) {
    setStatus("Depart start must be before or equal to depart end.", true);
    return null;
  }

  if (returnStart > returnEnd) {
    setStatus("Return start must be before or equal to return end.", true);
    return null;
  }

  return config;
}

function setStatus(text, isError) {
  els.status.textContent = text;
  els.status.classList.toggle("err", Boolean(isError));
}

function renderSummary(result) {
  if (!result) {
    els.summary.classList.add("hidden");
    return;
  }

  const { totalPairs, scannedAt, globalLowest, threshold, keptFlights, skippedPairs } = result;
  const lowText = typeof globalLowest === "number" ? `$${globalLowest}` : "No prices found";

  els.summary.innerHTML = `
    <div><strong>Scanned pairs:</strong> ${totalPairs}</div>
    <div><strong>Global lowest:</strong> ${lowText}</div>
    <div><strong>Threshold:</strong> $${threshold}</div>
    <div><strong>Flights saved:</strong> ${keptFlights.length}</div>
    <div><strong>Pairs with no prices:</strong> ${skippedPairs.length}</div>
    <div><strong>Scan time:</strong> ${new Date(scannedAt).toLocaleString()}</div>
  `;

  els.summary.classList.remove("hidden");
}

async function downloadCsv() {
  const { scanResult } = await chrome.storage.local.get(["scanResult"]);
  if (!scanResult?.keptFlights?.length) {
    setStatus("No saved flights yet. Run a scan first.", true);
    return;
  }

  const response = await chrome.runtime.sendMessage({ type: "DOWNLOAD_CSV", payload: scanResult });
  if (!response?.ok) {
    setStatus(response?.error || "CSV export failed.", true);
    return;
  }

  setStatus("CSV download started.", false);
}

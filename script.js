const els = {
  fileA: document.getElementById("fileA"),
  fileB: document.getElementById("fileB"),
  fileAName: document.getElementById("fileAName"),
  fileBName: document.getElementById("fileBName"),
  fileACount: document.getElementById("fileACount"),
  fileBCount: document.getElementById("fileBCount"),
  statusTitle: document.getElementById("statusTitle"),
  statusSub: document.getElementById("statusSub"),
  footerLeft: document.getElementById("footerLeft"),
  statA: document.getElementById("statA"),
  statB: document.getElementById("statB"),
  statAdded: document.getElementById("statAdded"),
  statRemoved: document.getElementById("statRemoved"),
  statDiffFrames: document.getElementById("statDiffFrames"),
  safetyPercent: document.getElementById("safetyPercent"),
  safetyBar: document.getElementById("safetyBar"),
  safetyNote: document.getElementById("safetyNote"),
  addedCount: document.getElementById("addedCount"),
  removedCount: document.getElementById("removedCount"),
  diffFrameCount: document.getElementById("diffFrameCount"),
  addedTable: document.getElementById("addedTable"),
  removedTable: document.getElementById("removedTable"),
  diffFrameTable: document.getElementById("diffFrameTable"),
  summaryText: document.getElementById("summaryText"),
  btnCompare: document.getElementById("btnCompare"),
  btnClear: document.getElementById("btnClear"),
  btnSwap: document.getElementById("btnSwap"),
  btnExport: document.getElementById("btnExport"),
  btnAbout: document.getElementById("btnAbout"),
  dropzones: [...document.querySelectorAll(".dropzone")],
};

const state = {
  a: null,
  b: null,
  report: ""
};

function normalizeEvent(raw) {
  if (!raw || typeof raw !== "object") return null;
  const frame = Number(raw.frame ?? raw.f ?? raw.time ?? raw.tick);
  const down = Boolean(raw.down);
  const p2 = Boolean(raw.p2);
  if (!Number.isFinite(frame)) return null;
  return { frame, down, p2 };
}

function extractEvents(data) {
  if (Array.isArray(data)) {
    return data.map(normalizeEvent).filter(Boolean);
  }
  if (data && Array.isArray(data.events)) {
    return data.events.map(normalizeEvent).filter(Boolean);
  }
  if (data && Array.isArray(data.inputs)) {
    return data.inputs.map(normalizeEvent).filter(Boolean);
  }
  return [];
}

function parseTextMacro(text) {
  const cleaned = text.trim();
  if (!cleaned) return [];

  if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
    try {
      const json = JSON.parse(cleaned);
      return extractEvents(json);
    } catch {}
  }

  const events = [];
  const lines = cleaned.split(/\r?\n/);

  for (const line of lines) {
    const s = line.trim();
    if (!s || s.startsWith("//") || s.startsWith("#")) continue;

    if (s.startsWith("{") && s.endsWith("}")) {
      try {
        const obj = JSON.parse(s);
        const ev = normalizeEvent(obj);
        if (ev) events.push(ev);
        continue;
      } catch {}
    }

    const nums = s.match(/-?\d+/g)?.map(Number) ?? [];
    if (nums.length === 0) continue;

    const bools = [...s.matchAll(/\b(true|false)\b/gi)].map(m => m[1].toLowerCase() === "true");
    const frame = nums[0];
    const down = bools.length ? bools[0] : /down\s*[:=]?\s*1/i.test(s) || /\bpress\b/i.test(s);
    const p2 = /(^|\b)p2(\b|[:=])/i.test(s) || bools.length > 1 ? bools[1] : false;

    events.push({ frame, down, p2: Boolean(p2) });
  }

  return events;
}

async function parseFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  const text = await file.text();

  if (ext === "json" || ext === "mhr") {
    try {
      const data = JSON.parse(text);
      return extractEvents(data);
    } catch {
      return parseTextMacro(text);
    }
  }

  return parseTextMacro(text);
}

function keyExact(e) {
  return `${e.frame}|${e.down ? 1 : 0}|${e.p2 ? 1 : 0}`;
}

function keyShape(e) {
  return `${e.down ? 1 : 0}|${e.p2 ? 1 : 0}`;
}

function lcsPairs(arrA, arrB, keyFn) {
  const aKeys = arrA.map(keyFn);
  const bKeys = arrB.map(keyFn);
  const n = aKeys.length;
  const m = bKeys.length;
  const cols = m + 1;
  const dp = new Uint16Array((n + 1) * cols);

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const idx = i * cols + j;
      if (aKeys[i - 1] === bKeys[j - 1]) {
        dp[idx] = dp[(i - 1) * cols + (j - 1)] + 1;
      } else {
        const up = dp[(i - 1) * cols + j];
        const left = dp[i * cols + (j - 1)];
        dp[idx] = up >= left ? up : left;
      }
    }
  }

  const pairs = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (aKeys[i - 1] === bKeys[j - 1]) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else {
      const up = dp[(i - 1) * cols + j];
      const left = dp[i * cols + (j - 1)];
      if (up >= left) i--;
      else j--;
    }
  }

  return pairs.reverse();
}

function renderRows(items, mode) {
  if (!items.length) {
    return mode === "diff"
      ? `<tr><td colspan="5" class="empty">No different frames</td></tr>`
      : `<tr><td colspan="5" class="empty">No ${mode} inputs</td></tr>`;
  }

  return items.map((item, idx) => {
    if (mode === "added" || mode === "removed") {
      const e = item.event;
      return `
        <tr>
          <td>${idx + 1}</td>
          <td>${e.frame}</td>
          <td>${e.down ? "Press" : "Release"}</td>
          <td>${e.p2 ? "Yes" : "No"}</td>
          <td>down: ${e.down}</td>
        </tr>
      `;
    }

    return `
      <tr>
        <td>${idx + 1}</td>
        <td>${item.frameA}</td>
        <td>${item.frameB}</td>
        <td>${item.type}</td>
        <td>${item.p2 ? "Yes" : "No"}</td>
      </tr>
    `;
  }).join("");
}

function updateFileSlot(slot, file, count) {
  const nameEl = slot === "A" ? els.fileAName : els.fileBName;
  const countEl = slot === "A" ? els.fileACount : els.fileBCount;
  nameEl.textContent = file ? file.name : "No file selected";
  countEl.textContent = `Size: ${count} events`;
}

function setSummary(report) {
  els.summaryText.innerHTML = `
    <div>File A: ${report.nameA}</div>
    <div>File B: ${report.nameB}</div>
    <div>Events A: ${report.countA}</div>
    <div>Events B: ${report.countB}</div>
    <div>Added Inputs: ${report.added.length}</div>
    <div>Removed Inputs: ${report.removed.length}</div>
    <div>Different Frames: ${report.diffFrames.length}</div>
    <div>Safety Score: ${report.safety.toFixed(2)}%</div>
    <div>Compatibility: ${report.compatibility.toFixed(0)}%</div>
  `;
}

function renderAll(report) {
  els.statA.textContent = report.countA;
  els.statB.textContent = report.countB;
  els.statAdded.textContent = report.added.length;
  els.statRemoved.textContent = report.removed.length;
  els.statDiffFrames.textContent = report.diffFrames.length;

  els.addedCount.textContent = report.added.length;
  els.removedCount.textContent = report.removed.length;
  els.diffFrameCount.textContent = report.diffFrames.length;

  els.addedTable.innerHTML = renderRows(report.added, "added");
  els.removedTable.innerHTML = renderRows(report.removed, "removed");
  els.diffFrameTable.innerHTML = renderRows(report.diffFrames, "diff");

  els.safetyPercent.textContent = `${report.safety.toFixed(2)}%`;
  els.safetyBar.style.width = `${Math.max(0, Math.min(100, report.safety))}%`;
  els.safetyNote.textContent = report.note;

  els.statusTitle.textContent = report.compatibility === 100 ? "COMPARISON COMPLETE" : "COMPARISON COMPLETE";
  els.statusSub.textContent = `Finished in ${report.timeMs.toFixed(3)}s`;
  els.footerLeft.textContent = "READY";
  setSummary(report);

  state.report = buildReportText(report);
}

function buildReportText(report) {
  const lines = [];
  lines.push("GD Macro Compare v2.0");
  lines.push("=".repeat(32));
  lines.push(`File A: ${report.nameA}`);
  lines.push(`File B: ${report.nameB}`);
  lines.push(`Events A: ${report.countA}`);
  lines.push(`Events B: ${report.countB}`);
  lines.push(`Added Inputs: ${report.added.length}`);
  lines.push(`Removed Inputs: ${report.removed.length}`);
  lines.push(`Different Frames: ${report.diffFrames.length}`);
  lines.push(`Safety Score: ${report.safety.toFixed(2)}%`);
  lines.push(`Compatibility: ${report.compatibility.toFixed(0)}%`);
  lines.push("");
  lines.push("ADDED INPUTS:");
  if (report.added.length) {
    report.added.forEach((x, i) => {
      lines.push(`${i + 1}. frame=${x.event.frame}, type=${x.event.down ? "Press" : "Release"}, p2=${x.event.p2}`);
    });
  } else {
    lines.push("None");
  }
  lines.push("");
  lines.push("REMOVED INPUTS:");
  if (report.removed.length) {
    report.removed.forEach((x, i) => {
      lines.push(`${i + 1}. frame=${x.event.frame}, type=${x.event.down ? "Press" : "Release"}, p2=${x.event.p2}`);
    });
  } else {
    lines.push("None");
  }
  lines.push("");
  lines.push("DIFFERENT FRAMES:");
  if (report.diffFrames.length) {
    report.diffFrames.forEach((x, i) => {
      lines.push(`${i + 1}. A=${x.frameA}, B=${x.frameB}, type=${x.type}, p2=${x.p2}`);
    });
  } else {
    lines.push("None");
  }
  return lines.join("\n");
}

function compare() {
  const t0 = performance.now();

  if (!state.a || !state.b) {
    els.statusTitle.textContent = "MISSING FILES";
    els.statusSub.textContent = "Chọn đủ 2 file trước khi so sánh";
    return;
  }

  const a = state.a.events;
  const b = state.b.events;

  const exactPairs = lcsPairs(a, b, keyExact);
  const shapePairs = lcsPairs(a, b, keyShape);

  const matchedAExact = new Set(exactPairs.map(p => p[0]));
  const matchedBExact = new Set(exactPairs.map(p => p[1]));

  const added = b
    .map((event, idx) => ({ event, idx }))
    .filter(x => !matchedBExact.has(x.idx));

  const removed = a
    .map((event, idx) => ({ event, idx }))
    .filter(x => !matchedAExact.has(x.idx));

  const diffFrames = [];
  for (const [ia, ib] of shapePairs) {
    const ea = a[ia];
    const eb = b[ib];
    if (ea.frame !== eb.frame) {
      diffFrames.push({
        frameA: ea.frame,
        frameB: eb.frame,
        type: ea.down ? "Press" : "Release",
        p2: ea.p2 || eb.p2
      });
    }
  }

  const safety = a.length ? (exactPairs.length / a.length) * 100 : 0;
  const compatibility = removed.length === 0 ? 100 : 0;

  const timeMs = (performance.now() - t0) / 1000;

  const report = {
    nameA: state.a.file.name,
    nameB: state.b.file.name,
    countA: a.length,
    countB: b.length,
    added,
    removed,
    diffFrames,
    safety,
    compatibility,
    timeMs,
    note: removed.length === 0
      ? "All original inputs are preserved. Replay compatibility: 100%"
      : "Inputs are missing or changed. Check the removed list.",
  };

  renderAll(report);
}

async function loadSelected(slot, file) {
  if (!file) return;

  const events = await parseFile(file);
  const data = { file, events };

  if (slot === "A") {
    state.a = data;
    updateFileSlot("A", file, events.length);
  } else {
    state.b = data;
    updateFileSlot("B", file, events.length);
  }

  els.footerLeft.textContent = "FILE LOADED";
  if (state.a && state.b) compare();
}

function clearAll() {
  state.a = null;
  state.b = null;
  state.report = "";

  els.fileA.value = "";
  els.fileB.value = "";

  updateFileSlot("A", null, 0);
  updateFileSlot("B", null, 0);

  els.statA.textContent = "0";
  els.statB.textContent = "0";
  els.statAdded.textContent = "0";
  els.statRemoved.textContent = "0";
  els.statDiffFrames.textContent = "0";

  els.addedCount.textContent = "0";
  els.removedCount.textContent = "0";
  els.diffFrameCount.textContent = "0";

  els.addedTable.innerHTML = `<tr><td colspan="5" class="empty">No added inputs</td></tr>`;
  els.removedTable.innerHTML = `<tr><td colspan="5" class="empty">No removed inputs</td></tr>`;
  els.diffFrameTable.innerHTML = `<tr><td colspan="5" class="empty">No different frames</td></tr>`;

  els.safetyPercent.textContent = "0.00%";
  els.safetyBar.style.width = "0%";
  els.safetyNote.textContent = "—";
  els.statusTitle.textContent = "READY";
  els.statusSub.textContent = "Chọn 2 file để so sánh";
  els.footerLeft.textContent = "READY";

  setSummary({
    nameA: "—",
    nameB: "—",
    countA: 0,
    countB: 0,
    added: [],
    removed: [],
    diffFrames: [],
    safety: 0,
    compatibility: 0
  });
}

function swapFiles() {
  if (!state.a && !state.b) return;
  const tmp = state.a;
  state.a = state.b;
  state.b = tmp;

  const tmpInput = els.fileA.files;
  // input file lists can't be assigned reliably; keep UI/state only
  updateFileSlot("A", state.a?.file || null, state.a?.events.length || 0);
  updateFileSlot("B", state.b?.file || null, state.b?.events.length || 0);

  if (state.a && state.b) compare();
}

function exportReport() {
  if (!state.report) {
    alert("Chưa có report để export.");
    return;
  }

  const blob = new Blob([state.report], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "gd_macro_compare_report.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function about() {
  alert("GD Macro Compare v2.0\n\nSo sánh input .json / .txt / .mhr\nHỗ trợ drag & drop, added/removed inputs, safety score và export report.");
}

function bindDropzone(dropzone, inputEl) {
  dropzone.addEventListener("click", () => inputEl.click());

  dropzone.addEventListener("dragover", e => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });

  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));

  dropzone.addEventListener("drop", async e => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    inputEl.files = e.dataTransfer.files;
    await loadSelected(inputEl.id === "fileA" ? "A" : "B", file);
  });
}

els.fileA.addEventListener("change", async e => {
  const file = e.target.files[0];
  if (file) await loadSelected("A", file);
});

els.fileB.addEventListener("change", async e => {
  const file = e.target.files[0];
  if (file) await loadSelected("B", file);
});

bindDropzone(els.dropzones[0], els.fileA);
bindDropzone(els.dropzones[1], els.fileB);

els.btnCompare.addEventListener("click", compare);
els.btnClear.addEventListener("click", clearAll);
els.btnSwap.addEventListener("click", swapFiles);
els.btnExport.addEventListener("click", exportReport);
els.btnAbout.addEventListener("click", about);

window.addEventListener("keydown", e => {
  if (e.key === "F5") {
    e.preventDefault();
    compare();
  }
  if (e.ctrlKey && e.key.toLowerCase() === "s") {
    e.preventDefault();
    exportReport();
  }
});

clearAll();
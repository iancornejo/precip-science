// The status page (/status/, S09): live/status.json and live/radars.json, refreshed every minute.
import { LAYERS, LAYER_ORDER, type LayerId } from "./map/layers";
import { esc, markSvg, STATUSES, STATUS_TEXT, type RadarDoc, type SiteStatus } from "./map/radarmarks";
import { ago, localClock } from "./map/timefmt";

interface Report {
  updated: string;
  pipeline: { commit: string; ecconus2d: string; alerts: "on" | "off"; uploads: "running" | "paused"; fallback_until: string | null };
  layers: Partial<Record<LayerId, { latest: string | null; age_min: number | null }>>;
  jobs: Record<string, string | null>;
  server: { power: "charger" | "battery" | null; battery_pct: number | null; cpu_c: number | null;
            disk_pct: Record<string, number | null>; uptime_h: number | null; load1: number | null };
  r2: { writes_today: number; online_frames: number; online_gb: number;
        month: { checked: string; month: string; class_a_pct: number; class_b_pct: number; storage_gb_avg: number;
                 class_a_projected_pct: number; class_b_projected_pct: number } | null };
  radars: ({ updated: string } & Partial<Record<SiteStatus, number>>) | null;
  checks: Record<string, string>;
  last_backup: string | null;
}

const cfg = JSON.parse(document.getElementById("st-config")!.textContent!) as { status: string; radars: string };
// Local testing: ?data=http://localhost:8787/ reads a local copy of the bucket.
const params = new URLSearchParams(location.search);
const override = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? params.get("data") : null;
const url = (name: "status" | "radars") => (override ? new URL(`live/${name}.json`, override).href : cfg[name]);

const $ = (id: string) => document.getElementById(id)!;
const SILENT_MIN = 10;          // no report for this long: the server is probably off, frozen or offline

const CHECK_NAMES: Record<string, string> = {
  layers: "Map layers are current", power: "On the charger", battery: "Battery above 20 %",
  disk: "Disk under 80 %", cpu: "CPU under 90 °C", cleanup: "Hourly cleanup ran",
  "r2-50": "R2 under 50 % of the free tier", "r2-80": "R2 under 80 % of the free tier", backup: "Weekly backup landed",
};
const DISK_NAMES: Record<string, string> = { ssd: "Internal SSD", archive: "4 TB drive" };
const JOB_NAMES: Record<string, string> = {
  fetch: "Download (every minute)", process: "Processing", publish: "Upload", cleanup: "Cleanup (hourly)",
};

type Tone = "ok" | "warn" | "bad" | "off";
const badge = (tone: Tone, text: string) => `<span class="st-badge st-${tone}">${esc(text)}</span>`;
const when = (iso: string | null | undefined) => {
  if (!iso) return "never";
  const t = Date.parse(iso);
  return Number.isFinite(t) ? `${ago(t)} <span class="muted st-nowrap">(${localClock(t)})</span>` : "unknown";
};
const row = (k: string, v: string) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
const pct = (v: number | null | undefined) => (v == null ? "?" : `${v.toFixed(v < 10 ? 1 : 0)} %`);

function uptime(h: number | null): string {
  if (h == null) return "unknown";
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  return `${Math.floor(h / 24)} days ${Math.round(h % 24)} h`;
}

function renderLayers(r: Report, now: number) {
  const rows = LAYER_ORDER.map((id) => {
    const L = r.layers[id];
    const t = L?.latest ? Date.parse(L.latest) : NaN;
    const age = Number.isFinite(t) ? (now - t) / 60e3 : null;
    // the same point as the server's "Map layers are current" check (rain rate is often 4-7 min old)
    const state = age == null ? badge("bad", "No frames") : age < 10 ? badge("ok", "Current") : badge("bad", "Behind");
    return `<tr><th scope="row">${esc(LAYERS[id].label)}</th><td class="st-nowrap">${Number.isFinite(t) ? localClock(t) : "none"}</td>
      <td class="st-num st-nowrap">${age == null ? "" : `${Math.round(age)} min`}</td><td>${state}</td></tr>`;
  }).join("");
  $("st-layers").innerHTML = `<table class="st-table"><thead><tr><th scope="col">Layer</th><th scope="col">Newest frame</th>
    <th scope="col">Age</th><th scope="col">State</th></tr></thead><tbody>${rows}</tbody></table>
    ${r.pipeline.uploads === "paused" ? `<p class="st-note">${badge("warn", "Uploads paused")} New frames wait on the server until uploads resume.</p>` : ""}`;
}

function renderChecks(r: Report) {
  const rows = Object.keys(CHECK_NAMES).map((k) => {
    const s = r.checks[k];
    const b = s === "up" ? badge("ok", "OK") : s === "down" ? badge("bad", "Down") : badge("off", "Not reporting yet");
    return `<tr><th scope="row">${esc(CHECK_NAMES[k])}</th><td>${b}</td></tr>`;
  }).join("");
  $("st-checks").innerHTML = `<table class="st-table"><tbody>${rows}</tbody></table>`;
}

function renderServer(r: Report) {
  const s = r.server;
  const power = s.power === "charger" ? `On the charger${s.battery_pct != null ? ` · battery ${s.battery_pct} %` : ""}`
    : s.power === "battery" ? `${badge("bad", "On battery")} ${s.battery_pct != null ? `${s.battery_pct} % left` : ""}` : "unknown";
  const disks = Object.entries(s.disk_pct ?? {}).map(([k, v]) => `${esc(DISK_NAMES[k] ?? k)}: ${pct(v)} full`).join("<br>") || "unknown";
  $("st-server").innerHTML = [
    row("Power", power),
    row("CPU temperature", s.cpu_c == null ? "unknown" : `${s.cpu_c} °C`),
    row("Disk", disks),
    row("Running for", uptime(s.uptime_h)),
    row("Load (1 min)", s.load1 == null ? "unknown" : String(s.load1)),
  ].join("");
}

function renderR2(r: Report) {
  const m = r.r2.month;
  const month = m
    ? `${pct(m.class_a_pct)} of the free writes and ${pct(m.class_b_pct)} of the free reads so far this month; storage ${m.storage_gb_avg.toFixed(1)} GB on average of the free 10 GB <span class="muted">(checked ${ago(Date.parse(m.checked))})</span>`
    : "not checked yet";
  $("st-r2").innerHTML = [
    row("Online now", `${r.r2.online_frames.toLocaleString()} frames, ${r.r2.online_gb.toFixed(2)} GB`),
    row("Writes today (UTC)", r.r2.writes_today.toLocaleString()),
    row("This month", month),
  ].join("");
}

function renderPipeline(r: Report) {
  const p = r.pipeline;
  const jobs = Object.keys(JOB_NAMES).map((j) => `${esc(JOB_NAMES[j])}: ${when(r.jobs[j])}`).join("<br>");
  $("st-pipe").innerHTML = [
    row("Last runs", jobs),
    row("Uploads", p.uploads === "paused" ? badge("warn", "Paused") : "Running"),
    ...(p.fallback_until ? [row("Cadence", `Every 4 min until ${localClock(Date.parse(p.fallback_until))} (the fallback)`)] : []),
    row("Alerts", p.alerts === "on" ? "On" : badge("off", "Not set up yet")),
    row("Last backup", when(r.last_backup)),
    row("Versions", `EcConus 2D ${esc(p.ecconus2d)} · pipeline ${esc(p.commit)}`),
  ].join("");
}

function renderRadars(doc: RadarDoc | null, failed: boolean) {
  if (!doc) {
    $("st-radars").innerHTML = `<p>${failed ? "Couldn’t load the radar list." : "Loading…"}</p>`;
    return;
  }
  const t = Date.parse(doc.updated);
  const counts = STATUSES.map((s) => ({ s, n: doc.sites.filter((x) => x.status === s).length })).filter(({ n }) => n > 0);
  const notUp = doc.sites.filter((x) => x.status !== "up")
    .sort((a, b) => STATUSES.indexOf(b.status) - STATUSES.indexOf(a.status) || a.id.localeCompare(b.id));
  const list = notUp.map((x) => {
    const last = x.last_utc ? Date.parse(x.last_utc) : NaN;
    const parts = [`<strong>${esc(x.id)}</strong> ${esc(x.name ?? "")}`, STATUS_TEXT[x.status],
      Number.isFinite(last) ? `Level II ${ago(last)}` : "", x.latency_s != null ? `latency ${Math.round(x.latency_s)} s` : ""]
      .filter(Boolean).map((v) => `<span class="st-nowrap">${v}</span>`).join(" · ");
    return `<li>${markSvg(x.status)} ${parts}</li>`;
  }).join("");
  $("st-radars").innerHTML = `<p class="st-counts">${counts.map(({ s, n }) => `<span>${markSvg(s)} ${n} ${STATUS_TEXT[s].toLowerCase()}</span>`).join("")}</p>
    <p class="st-note">${doc.sites.length} WSR-88Ds, from the National Weather Service’s status report as of ${localClock(t)}. On the <a class="link" href="/map/">map</a>, turn on <strong>Radars</strong>.</p>
    ${list ? `<ul class="st-list">${list}</ul>` : `<p>Every site is sending data.</p>`}`;
}

function summary(r: Report | null, failed: boolean, now: number) {
  const el = $("st-summary");
  if (!r) {
    el.dataset.tone = failed ? "bad" : "wait";
    el.textContent = failed ? "Couldn’t reach data.precip.science. Trying again every minute." : "Loading the latest report…";
    return;
  }
  const t = Date.parse(r.updated);
  const mins = (now - t) / 60e3;
  if (mins >= SILENT_MIN) {
    el.dataset.tone = "bad";
    el.innerHTML = `No report from the server since ${localClock(t)} (${ago(t)}). It may be off, frozen or offline; the map shows its newest frames until it’s back.`;
    return;
  }
  const down = Object.entries(r.checks).filter(([, s]) => s === "down").map(([k]) => CHECK_NAMES[k] ?? k);
  el.dataset.tone = down.length ? "bad" : "ok";
  el.innerHTML = (down.length ? `${down.length} check${down.length > 1 ? "s" : ""} down: ${down.map(esc).join(", ")}.` : "All checks normal.")
    + ` <span class="st-when">Report from ${ago(t)} (${localClock(t)}).</span>`;
}

let report: Report | null = null;
let radars: RadarDoc | null = null;
let failed = false, radarsFailed = false;

function render() {
  const now = Date.now();
  summary(report, failed, now);
  if (report) {
    $("st").dataset.state = "ready";
    renderLayers(report, now);
    renderChecks(report);
    renderServer(report);
    renderR2(report);
    renderPipeline(report);
  }
  renderRadars(radars, radarsFailed);
}

async function load() {
  const get = async (name: "status" | "radars") => {
    const res = await fetch(url(name), { cache: "no-cache" });
    if (!res.ok) throw new Error(`${res.status} for ${name}.json`);
    return res.json();
  };
  const [s, rd] = await Promise.allSettled([get("status"), get("radars")]);
  if (s.status === "fulfilled") { report = s.value as Report; failed = false; } else { failed = true; console.warn(s.reason); }
  if (rd.status === "fulfilled") { radars = rd.value as RadarDoc; radarsFailed = false; } else { radarsFailed = true; console.warn(rd.reason); }
  render();
}

load();
setInterval(() => { if (!document.hidden) load(); }, 60e3);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });

import React, { useState, useMemo } from "react";

/* ────────────────────────────────────────────────────────────────
   UNKI MINES · BMSZ Face Measurement
   Prototype of module M6 (see scoping document §6)
   Traces: STD-201 §9.8 · business rule R8

   Design note: dark surface is functional, not stylistic — the
   screen is read under cap-lamp light and must not dazzle. The
   accent is BMSZ marking yellow, the actual paint colour used on
   the face. The section view reproduces the paper sheet's own
   geometry: a vertical grid centred on BMSZ zero.
   ──────────────────────────────────────────────────────────────── */

const LIMIT_SETS = {
  bord: { label: "Bord / ledging decline", hw: 0.45, fw: -1.35 },
  decline: { label: "Decline", hw: 1.5, fw: -1.0 },
};

// Real values from Face Marking Sheet 2NB3, 12-07-10 (11.4 m face)
const SAMPLE_2NB3 = {
  hw: [0.58, 0.72, 0.77, 0.6, 0.78, 0.96, 0.78, 0.79, 0.86, 0.64, 0.88, 0.89],
  fw: [-1.26, -1.34, -1.33, -1.34, -1.36, -1.31, -1.35, -1.36, -1.37, -1.38, -1.38, -1.36],
};

const REASONS = [
  "Blast over-break",
  "Ground conditions",
  "BMSZ position uncertain",
  "Support installed",
  "Other — see notes",
];

const C = {
  bg: "#0E1013",
  panel: "#171B21",
  panel2: "#1E242C",
  line: "#2A323C",
  bmsz: "#FFD200",
  breach: "#FF4D3D",
  ok: "#3DDC97",
  muted: "#7C8794",
  text: "#E8ECF1",
};

/* ── helpers ─────────────────────────────────────────────────── */

const num = (v) => (v === "" || v === "-" || v == null ? null : parseFloat(v));

function makeStations(count) {
  return Array.from({ length: count }, () => ({ hw: "", fw: "", reason: "" }));
}

function seedStations(interval) {
  // Sheet recorded at 1 m. At 2 m interval take every second reading.
  const step = interval === 2 ? 2 : 1;
  const out = [];
  for (let i = 0; i < SAMPLE_2NB3.hw.length; i += step) {
    out.push({ hw: String(SAMPLE_2NB3.hw[i]), fw: String(SAMPLE_2NB3.fw[i]), reason: "" });
  }
  return out;
}

/* ── section view: the signature element ─────────────────────── */

function SectionView({ stations, limits, interval, active, onPick }) {
  const W = 760;
  const H = 300;
  const padL = 54;
  const padR = 18;
  const padY = 26;

  const top = Math.max(limits.hw + 0.35, 1.1);
  const bot = Math.min(limits.fw - 0.35, -1.7);

  const n = Math.max(stations.length, 2);
  const x = (i) => padL + (i * (W - padL - padR)) / (n - 1);
  const y = (v) => padY + ((top - v) / (top - bot)) * (H - padY * 2);

  const hwPts = stations.map((s, i) => [i, num(s.hw)]);
  const fwPts = stations.map((s, i) => [i, num(s.fw)]);

  const path = (pts) => {
    const seg = [];
    let open = false;
    pts.forEach(([i, v]) => {
      if (v == null) {
        open = false;
        return;
      }
      seg.push(`${open ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
      open = true;
    });
    return seg.join(" ");
  };

  const ticks = [];
  for (let v = Math.ceil(top * 2) / 2; v >= bot; v -= 0.5) ticks.push(+v.toFixed(2));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto select-none"
      role="img"
      aria-label="Face section: hangingwall and footwall offsets from BMSZ"
    >
      {ticks.map((v) => (
        <g key={v}>
          <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke={C.line} strokeWidth="1" />
          <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill={C.muted} fontFamily="ui-monospace, monospace">
            {v.toFixed(2)}
          </text>
        </g>
      ))}

      {/* limit thresholds */}
      {[
        ["H/W limit", limits.hw],
        ["F/W limit", limits.fw],
      ].map(([lbl, v]) => (
        <g key={lbl}>
          <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke={C.breach} strokeWidth="1.5" strokeDasharray="7 5" opacity="0.85" />
          <text x={W - padR} y={y(v) - 6} textAnchor="end" fontSize="10" fill={C.breach} letterSpacing="0.09em">
            {lbl.toUpperCase()} {v.toFixed(2)}
          </text>
        </g>
      ))}

      {/* BMSZ datum — the yellow marking line */}
      <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke={C.bmsz} strokeWidth="3" />
      <text x={padL + 4} y={y(0) - 8} fontSize="11" fill={C.bmsz} letterSpacing="0.14em" fontWeight="700">
        BMSZ
      </text>

      <path d={path(hwPts)} fill="none" stroke={C.text} strokeWidth="2" strokeLinejoin="round" />
      <path d={path(fwPts)} fill="none" stroke={C.text} strokeWidth="2" strokeLinejoin="round" opacity="0.7" />

      {stations.map((s, i) => {
        const hw = num(s.hw);
        const fw = num(s.fw);
        const hwBad = hw != null && hw > limits.hw;
        const fwBad = fw != null && fw < limits.fw;
        const on = i === active;
        return (
          <g key={i} onClick={() => onPick(i)} className="cursor-pointer">
            <rect x={x(i) - 16} y={padY} width="32" height={H - padY * 2} fill={on ? "#ffffff" : "transparent"} opacity={on ? 0.06 : 0} />
            {hw != null && <circle cx={x(i)} cy={y(hw)} r={on ? 7 : 5} fill={hwBad ? C.breach : C.ok} stroke={C.bg} strokeWidth="2" />}
            {fw != null && <circle cx={x(i)} cy={y(fw)} r={on ? 7 : 5} fill={fwBad ? C.breach : C.ok} stroke={C.bg} strokeWidth="2" />}
            <text
              x={x(i)}
              y={H - 6}
              textAnchor="middle"
              fontSize="11"
              fill={on ? C.bmsz : C.muted}
              fontWeight={on ? 700 : 400}
              fontFamily="ui-monospace, monospace"
            >
              {i * interval}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ── keypad ──────────────────────────────────────────────────── */

function Keypad({ onKey }) {
  const keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "−", "0", "."];
  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((k) => (
        <button
          key={k}
          onClick={() => onKey(k)}
          className="h-14 rounded-lg text-xl font-mono font-semibold transition-colors active:brightness-125"
          style={{ background: C.panel2, color: C.text, border: `1px solid ${C.line}` }}
        >
          {k}
        </button>
      ))}
      <button
        onClick={() => onKey("clear")}
        className="h-14 rounded-lg text-xs font-semibold tracking-widest transition-colors active:brightness-125"
        style={{ background: C.panel2, color: C.muted, border: `1px solid ${C.line}` }}
      >
        CLEAR
      </button>
      <button
        onClick={() => onKey("back")}
        className="h-14 rounded-lg text-lg transition-colors active:brightness-125"
        style={{ background: C.panel2, color: C.text, border: `1px solid ${C.line}` }}
      >
        ⌫
      </button>
      <button
        onClick={() => onKey("next")}
        className="h-14 rounded-lg text-xs font-bold tracking-widest transition-colors active:brightness-110"
        style={{ background: C.bmsz, color: "#0E1013" }}
      >
        NEXT
      </button>
    </div>
  );
}

/* ── field readout ───────────────────────────────────────────── */

function Field({ label, value, limit, kind, active, onSelect }) {
  const v = num(value);
  const bad = v != null && (kind === "hw" ? v > limit : v < limit);
  const delta = v == null ? null : kind === "hw" ? v - limit : limit - v;

  return (
    <button
      onClick={onSelect}
      className="w-full text-left rounded-lg p-3 transition-all"
      style={{
        background: active ? C.panel2 : "transparent",
        border: `1.5px solid ${active ? C.bmsz : bad ? C.breach : C.line}`,
      }}
    >
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] font-semibold tracking-[0.16em]" style={{ color: C.muted }}>
          {label}
        </span>
        <span className="text-[10px] font-mono" style={{ color: C.muted }}>
          limit {limit.toFixed(2)}
        </span>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-mono font-semibold tabular-nums" style={{ color: v == null ? C.line : bad ? C.breach : C.text }}>
          {value === "" ? "—.——" : value}
        </span>
        <span className="text-[11px] font-semibold tracking-wide" style={{ color: bad ? C.breach : C.ok }}>
          {v == null ? "" : bad ? `${delta > 0 ? "+" : ""}${delta.toFixed(2)} OVER` : "IN CONTROL"}
        </span>
      </div>
    </button>
  );
}

/* ── main ────────────────────────────────────────────────────── */

export default function FaceMeasurement() {
  const [view, setView] = useState("capture");
  const [headingType, setHeadingType] = useState("bord");
  const [interval, setInterval] = useState(1);
  const [stations, setStations] = useState(() => seedStations(1));
  const [active, setActive] = useState(0);
  const [field, setField] = useState("hw");

  const [meta, setMeta] = useState({
    place: "2NB3",
    peg: "1255",
    pegDist: "19.3",
    blast: "14",
    faceLength: "11.4",
    logged: "T Chidindi",
  });

  const limits = LIMIT_SETS[headingType];

  const summary = useMemo(() => {
    let hwB = 0,
      fwB = 0,
      done = 0,
      overSum = 0,
      widths = [];
    stations.forEach((s) => {
      const hw = num(s.hw);
      const fw = num(s.fw);
      if (hw != null && fw != null) {
        done++;
        widths.push(hw - fw);
      }
      if (hw != null && hw > limits.hw) {
        hwB++;
        overSum += hw - limits.hw;
      }
      if (fw != null && fw < limits.fw) fwB++;
    });
    return {
      hwB,
      fwB,
      done,
      total: stations.length,
      meanOver: hwB ? overSum / hwB : 0,
      meanWidth: widths.length ? widths.reduce((a, b) => a + b, 0) / widths.length : null,
      maxWidth: widths.length ? Math.max(...widths) : null,
    };
  }, [stations, limits]);

  const setVal = (updater) =>
    setStations((prev) => prev.map((s, i) => (i === active ? { ...s, [field]: updater(s[field]) } : s)));

  const onKey = (k) => {
    if (k === "next") {
      if (field === "hw") setField("fw");
      else {
        setField("hw");
        setActive((a) => Math.min(a + 1, stations.length - 1));
      }
      return;
    }
    if (k === "clear") return setVal(() => "");
    if (k === "back") return setVal((v) => v.slice(0, -1));
    if (k === "−") return setVal((v) => (v.startsWith("-") ? v.slice(1) : "-" + v));
    if (k === "." ) return setVal((v) => (v.includes(".") ? v : (v === "" ? "0" : v) + "."));
    return setVal((v) => (v === "0" ? k : v + k));
  };

  const cur = stations[active] ?? { hw: "", fw: "", reason: "" };
  const curBad =
    (num(cur.hw) != null && num(cur.hw) > limits.hw) || (num(cur.fw) != null && num(cur.fw) < limits.fw);

  const rebuild = (iv, count) => {
    setInterval(iv);
    setStations(makeStations(count));
    setActive(0);
    setField("hw");
  };

  const stationCount = Math.max(1, Math.floor(parseFloat(meta.faceLength || "0") / interval) + 1);

  return (
    <div className="min-h-screen w-full font-sans" style={{ background: C.bg, color: C.text }}>
      <div className="mx-auto max-w-6xl p-4 md:p-6">
        {/* header */}
        <header className="flex flex-wrap items-center gap-x-6 gap-y-2 pb-4 mb-5" style={{ borderBottom: `1px solid ${C.line}` }}>
          <div>
            <div className="text-[9px] font-semibold tracking-[0.22em]" style={{ color: C.muted }}>
              UNKI MINES · MRM
            </div>
            <h1 className="text-lg font-bold tracking-tight">Face Measurement</h1>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs font-mono" style={{ color: C.muted }}>
            <span>
              PLACE <span style={{ color: C.text }}>{meta.place || "—"}</span>
            </span>
            <span>
              PEG <span style={{ color: C.text }}>{meta.peg || "—"}</span>
            </span>
            <span>
              PEG→FACE <span style={{ color: C.text }}>{meta.pegDist || "—"} m</span>
            </span>
            <span>
              BLAST <span style={{ color: C.text }}>{meta.blast || "—"}</span>
            </span>
          </div>
          <div className="ml-auto flex gap-1">
            {["capture", "setup", "review"].map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="px-3 h-9 rounded-md text-[10px] font-bold tracking-[0.14em] uppercase transition-colors"
                style={{
                  background: view === v ? C.bmsz : C.panel,
                  color: view === v ? "#0E1013" : C.muted,
                  border: `1px solid ${view === v ? C.bmsz : C.line}`,
                }}
              >
                {v}
              </button>
            ))}
          </div>
        </header>

        {/* ── SETUP ── */}
        {view === "setup" && (
          <div className="grid gap-5 md:grid-cols-2">
            <section className="rounded-xl p-5" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
              <h2 className="text-[10px] font-bold tracking-[0.18em] mb-4" style={{ color: C.muted }}>
                HEADING TYPE · SETS THE LIMITS
              </h2>
              <div className="space-y-2">
                {Object.entries(LIMIT_SETS).map(([k, v]) => (
                  <button
                    key={k}
                    onClick={() => setHeadingType(k)}
                    className="w-full flex items-center justify-between rounded-lg px-4 h-14 text-left transition-all"
                    style={{
                      background: headingType === k ? C.panel2 : "transparent",
                      border: `1.5px solid ${headingType === k ? C.bmsz : C.line}`,
                    }}
                  >
                    <span className="text-sm font-medium">{v.label}</span>
                    <span className="font-mono text-xs" style={{ color: C.muted }}>
                      H/W {v.hw.toFixed(2)} · F/W {v.fw.toFixed(2)}
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed" style={{ color: C.muted }}>
                Limits differ by heading type in the source sheets. In production these are versioned and
                changed only under Chief Geologist authorisation (rule R9).
              </p>
            </section>

            <section className="rounded-xl p-5" style={{ background: C.panel, border: `1px solid ${C.bmsz}` }}>
              <h2 className="text-[10px] font-bold tracking-[0.18em] mb-1" style={{ color: C.bmsz }}>
                STATION INTERVAL · OPEN DECISION 12.1
              </h2>
              <p className="text-[11px] mb-4 leading-relaxed" style={{ color: C.muted }}>
                STD-201 §9.8.iv specifies 2 m. Sheet 2NB3 records at 1 m. Switch between them to see the
                difference in coverage before the Chief Geologist rules.
              </p>
              <div className="flex gap-2 mb-4">
                {[1, 2].map((iv) => (
                  <button
                    key={iv}
                    onClick={() => rebuild(iv, Math.floor(parseFloat(meta.faceLength || "0") / iv) + 1)}
                    className="flex-1 h-14 rounded-lg text-sm font-bold transition-all"
                    style={{
                      background: interval === iv ? C.bmsz : "transparent",
                      color: interval === iv ? "#0E1013" : C.text,
                      border: `1.5px solid ${interval === iv ? C.bmsz : C.line}`,
                    }}
                  >
                    {iv} m
                    <span className="block text-[9px] font-medium tracking-wider opacity-70">
                      {iv === 2 ? "PER STANDARD" : "PER SHEET"}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex items-end gap-3">
                <label className="flex-1">
                  <span className="block text-[10px] font-semibold tracking-[0.14em] mb-1" style={{ color: C.muted }}>
                    FACE LENGTH (m)
                  </span>
                  <input
                    value={meta.faceLength}
                    onChange={(e) => setMeta({ ...meta, faceLength: e.target.value })}
                    className="w-full h-12 rounded-lg px-3 font-mono text-lg outline-none focus:ring-2"
                    style={{ background: C.panel2, color: C.text, border: `1px solid ${C.line}` }}
                  />
                </label>
                <button
                  onClick={() => rebuild(interval, stationCount)}
                  className="h-12 px-4 rounded-lg text-[10px] font-bold tracking-[0.14em]"
                  style={{ background: C.panel2, color: C.text, border: `1px solid ${C.line}` }}
                >
                  {stationCount} STATIONS
                </button>
              </div>
              <button
                onClick={() => {
                  setStations(seedStations(interval));
                  setActive(0);
                  setField("hw");
                }}
                className="mt-3 w-full h-11 rounded-lg text-[10px] font-bold tracking-[0.14em]"
                style={{ background: "transparent", color: C.muted, border: `1px dashed ${C.line}` }}
              >
                LOAD 2NB3 SAMPLE DATA
              </button>
            </section>

            <section className="rounded-xl p-5 md:col-span-2" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
              <h2 className="text-[10px] font-bold tracking-[0.18em] mb-4" style={{ color: C.muted }}>
                END RECORD
              </h2>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {[
                  ["place", "WORKING PLACE"],
                  ["peg", "SURVEY PEG"],
                  ["pegDist", "PEG → FACE (m)"],
                  ["blast", "BLAST NUMBER"],
                  ["logged", "LOGGED BY"],
                ].map(([k, lbl]) => (
                  <label key={k}>
                    <span className="block text-[10px] font-semibold tracking-[0.12em] mb-1" style={{ color: C.muted }}>
                      {lbl}
                    </span>
                    <input
                      value={meta[k]}
                      onChange={(e) => setMeta({ ...meta, [k]: e.target.value })}
                      className="w-full h-12 rounded-lg px-3 font-mono text-sm outline-none"
                      style={{ background: C.panel2, color: C.text, border: `1px solid ${C.line}` }}
                    />
                  </label>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* ── CAPTURE ── */}
        {view === "capture" && (
          <div className="space-y-5">
            <section className="rounded-xl p-4 pb-1" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
              <div className="flex items-baseline justify-between mb-2">
                <h2 className="text-[10px] font-bold tracking-[0.18em]" style={{ color: C.muted }}>
                  FACE SECTION · DOWN-DIP → UP-DIP
                </h2>
                <span className="text-[10px] font-mono" style={{ color: C.muted }}>
                  {summary.done}/{summary.total} STATIONS · {interval} m INTERVAL
                </span>
              </div>
              <SectionView
                stations={stations}
                limits={limits}
                interval={interval}
                active={active}
                onPick={(i) => {
                  setActive(i);
                  setField("hw");
                }}
              />
            </section>

            <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
              <section className="rounded-xl p-5" style={{ background: C.panel, border: `1px solid ${curBad ? C.breach : C.line}` }}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <span className="text-[10px] font-bold tracking-[0.18em]" style={{ color: C.muted }}>
                      STATION
                    </span>
                    <div className="text-2xl font-mono font-bold">{active * interval} m</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setActive((a) => Math.max(0, a - 1));
                        setField("hw");
                      }}
                      disabled={active === 0}
                      className="w-14 h-14 rounded-lg text-lg disabled:opacity-30"
                      style={{ background: C.panel2, border: `1px solid ${C.line}`, color: C.text }}
                    >
                      ◀
                    </button>
                    <button
                      onClick={() => {
                        setActive((a) => Math.min(stations.length - 1, a + 1));
                        setField("hw");
                      }}
                      disabled={active === stations.length - 1}
                      className="w-14 h-14 rounded-lg text-lg disabled:opacity-30"
                      style={{ background: C.panel2, border: `1px solid ${C.line}`, color: C.text }}
                    >
                      ▶
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <Field
                    label="BMSZ → HANGINGWALL"
                    value={cur.hw}
                    limit={limits.hw}
                    kind="hw"
                    active={field === "hw"}
                    onSelect={() => setField("hw")}
                  />
                  <Field
                    label="BMSZ → FOOTWALL"
                    value={cur.fw}
                    limit={limits.fw}
                    kind="fw"
                    active={field === "fw"}
                    onSelect={() => setField("fw")}
                  />
                </div>

                {num(cur.hw) != null && num(cur.fw) != null && (
                  <div className="mt-3 flex items-baseline gap-2 px-3">
                    <span className="text-[10px] font-semibold tracking-[0.14em]" style={{ color: C.muted }}>
                      STOPE WIDTH
                    </span>
                    <span className="font-mono text-lg tabular-nums">{(num(cur.hw) - num(cur.fw)).toFixed(2)} m</span>
                  </div>
                )}

                {curBad && (
                  <div className="mt-4 rounded-lg p-3" style={{ background: "#2A1614", border: `1px solid ${C.breach}` }}>
                    <div className="text-[10px] font-bold tracking-[0.14em] mb-2" style={{ color: C.breach }}>
                      LIMIT BREACH · REASON REQUIRED
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {REASONS.map((r) => (
                        <button
                          key={r}
                          onClick={() => setStations((p) => p.map((s, i) => (i === active ? { ...s, reason: s.reason === r ? "" : r } : s)))}
                          className="px-3 h-10 rounded-md text-[11px] font-medium transition-all"
                          style={{
                            background: cur.reason === r ? C.breach : "transparent",
                            color: cur.reason === r ? "#fff" : C.text,
                            border: `1px solid ${cur.reason === r ? C.breach : C.line}`,
                          }}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              <section className="rounded-xl p-4" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                <div className="text-[10px] font-bold tracking-[0.18em] mb-3" style={{ color: C.muted }}>
                  ENTRY · {field === "hw" ? "HANGINGWALL" : "FOOTWALL"}
                </div>
                <Keypad onKey={onKey} />
              </section>
            </div>

            {/* live summary */}
            <section className="rounded-xl p-4 grid gap-4 sm:grid-cols-4" style={{ background: C.panel, border: `1px solid ${summary.hwB + summary.fwB > 0 ? C.breach : C.line}` }}>
              {[
                ["H/W BREACHES", `${summary.hwB} / ${summary.total}`, summary.hwB > 0],
                ["F/W BREACHES", `${summary.fwB} / ${summary.total}`, summary.fwB > 0],
                ["MEAN OVER-BREAK", summary.hwB ? `${summary.meanOver.toFixed(2)} m` : "—", summary.hwB > 0],
                ["MEAN STOPE WIDTH", summary.meanWidth != null ? `${summary.meanWidth.toFixed(2)} m` : "—", false],
              ].map(([lbl, val, bad]) => (
                <div key={lbl}>
                  <div className="text-[9px] font-bold tracking-[0.16em] mb-1" style={{ color: C.muted }}>
                    {lbl}
                  </div>
                  <div className="text-xl font-mono font-semibold tabular-nums" style={{ color: bad ? C.breach : C.text }}>
                    {val}
                  </div>
                </div>
              ))}
            </section>
          </div>
        )}

        {/* ── REVIEW ── */}
        {view === "review" && (
          <div className="space-y-5">
            <section className="rounded-xl overflow-hidden" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: C.panel2 }}>
                    {["DIST m", "H/W", "F/W", "STOPE WIDTH", "STATUS", "REASON"].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-[10px] font-bold tracking-[0.14em]" style={{ color: C.muted }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stations.map((s, i) => {
                    const hw = num(s.hw);
                    const fw = num(s.fw);
                    const hwBad = hw != null && hw > limits.hw;
                    const fwBad = fw != null && fw < limits.fw;
                    const bad = hwBad || fwBad;
                    return (
                      <tr key={i} style={{ borderTop: `1px solid ${C.line}` }}>
                        <td className="px-4 py-2.5 font-mono">{i * interval}</td>
                        <td className="px-4 py-2.5 font-mono tabular-nums" style={{ color: hwBad ? C.breach : C.text }}>
                          {s.hw || "—"}
                        </td>
                        <td className="px-4 py-2.5 font-mono tabular-nums" style={{ color: fwBad ? C.breach : C.text }}>
                          {s.fw || "—"}
                        </td>
                        <td className="px-4 py-2.5 font-mono tabular-nums" style={{ color: C.muted }}>
                          {hw != null && fw != null ? (hw - fw).toFixed(2) : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-[11px] font-semibold tracking-wide" style={{ color: bad ? C.breach : C.ok }}>
                          {hw == null || fw == null ? "" : bad ? `BREACH${hwBad ? " H/W" : ""}${fwBad ? " F/W" : ""}` : "IN CONTROL"}
                        </td>
                        <td className="px-4 py-2.5 text-[11px]" style={{ color: s.reason ? C.text : C.line }}>
                          {s.reason || (bad ? "— required —" : "")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            <section className="rounded-xl p-5" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
              <h2 className="text-[10px] font-bold tracking-[0.18em] mb-3" style={{ color: C.muted }}>
                SHIFT-END SUBMIT
              </h2>
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-[11px] leading-relaxed flex-1 min-w-[240px]" style={{ color: C.muted }}>
                  {summary.done < summary.total
                    ? `${summary.total - summary.done} stations still to measure. All stations must be recorded before the end can be closed out.`
                    : stations.some((s) => {
                        const hw = num(s.hw),
                          fw = num(s.fw);
                        return ((hw != null && hw > limits.hw) || (fw != null && fw < limits.fw)) && !s.reason;
                      })
                    ? "Breached stations need a reason code before submit."
                    : "Ready to queue for sync. Held on device until surface — nothing is lost if there is no signal."}
                </div>
                <button
                  disabled={summary.done < summary.total}
                  className="h-14 px-6 rounded-lg text-xs font-bold tracking-[0.14em] disabled:opacity-30"
                  style={{ background: C.bmsz, color: "#0E1013" }}
                >
                  QUEUE FOR SYNC
                </button>
              </div>
            </section>
          </div>
        )}

        <footer className="mt-8 pt-4 text-[10px] leading-relaxed" style={{ borderTop: `1px solid ${C.line}`, color: C.muted }}>
          Prototype · module M6 of the BMSZ scoping document. Traces STD-201 §9.8 and business rule R8.
          Limits, station interval and grade sources are unresolved open decisions — nothing here is a ruling
          on them. No data is persisted.
        </footer>
      </div>
    </div>
  );
}

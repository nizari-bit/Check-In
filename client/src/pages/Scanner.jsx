import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtTime, scannerSession } from "../api.js";
import Camera from "../components/Camera.jsx";
import { beep } from "../beep.js";
import { openLive } from "../live.js";

const THEMES = {
  ok: { bg: "bg-ok", fg: "text-white", icon: "✓", title: "Valid invitation" },
  partial: {
    bg: "bg-ok",
    fg: "text-white",
    icon: "✓",
    title: "Valid · partly used",
  },
  checked_in: { bg: "bg-ok", fg: "text-white", icon: "✓", title: "Checked in" },
  already: {
    bg: "bg-warn",
    fg: "text-ink",
    icon: "!",
    title: "Card fully used",
  },
  too_many: {
    bg: "bg-warn",
    fg: "text-ink",
    icon: "!",
    title: "Too many people",
  },
  not_found: {
    bg: "bg-bad",
    fg: "text-white",
    icon: "✕",
    title: "ID not found",
  },
  wrong_event: {
    bg: "bg-bad",
    fg: "text-white",
    icon: "✕",
    title: "Different event",
  },
};

const Row = ({ label, value }) =>
  value ? (
    <div className="border-b border-current/20 py-3 last:border-0">
      <p className="text-xs uppercase tracking-widest opacity-75">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  ) : null;

const people = (n) => `${n} ${n === 1 ? "person" : "people"}`;

function ResultScreen({ result, count, setCount, busy, onConfirm, onNext }) {
  const t = THEMES[result.status];
  const g = result.guest;
  const canAdmit = result.status === "ok" || result.status === "partial";

  return (
    <div
      className={`fixed inset-0 z-40 flex flex-col overflow-y-auto ${t.bg} ${t.fg} p-5`}
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className="pt-4 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border-4 border-current text-3xl font-bold">
            {t.icon}
          </div>
          <h1 className="mt-3 font-display text-3xl font-bold leading-tight">
            {t.title}
          </h1>
          {result.code && (
            <p className="mt-1 font-mono text-lg tracking-widest opacity-90">
              {result.code}
            </p>
          )}
        </div>

        {g && (
          <>
            <div className="mt-5 rounded-lg bg-black/15 px-4 py-3 text-center">
              <p className="text-xs uppercase tracking-widest opacity-80">
                {g.card_type === "double" ? "Double card" : "Single card"}
              </p>
              <p className="font-display text-2xl font-bold">
                {result.status === "already"
                  ? `All ${g.capacity} spot${g.capacity > 1 ? "s" : ""} used`
                  : `Admit up to ${g.remaining}`}
              </p>
              {g.capacity > 1 && (
                <p className="text-sm opacity-90">
                  {g.admitted_count} of {g.capacity} already inside
                </p>
              )}
            </div>
            <div className="mt-3 rounded-lg bg-black/15 px-4">
              <Row label="Name" value={g.full_name} />
              <Row label="Phone" value={g.phone} />
              <Row label="Category" value={g.category} />
              <Row label="Table" value={g.table_no} />
              {result.status === "already" && (
                <Row label="First arrived" value={fmtTime(g.checked_in_at)} />
              )}
            </div>
          </>
        )}

        {canAdmit && g.remaining > 1 && (
          <div className="mt-4">
            <p className="text-center text-xs font-semibold uppercase tracking-widest">
              How many people are entering now?
            </p>
            <div
              className="mt-2 grid gap-2"
              style={{
                gridTemplateColumns: `repeat(${g.remaining}, minmax(0, 1fr))`,
              }}
            >
              {Array.from({ length: g.remaining }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  onClick={() => setCount(n)}
                  className={`rounded-lg py-4 text-3xl font-bold ${count === n ? "bg-white text-ok" : "bg-black/15"}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {result.status === "checked_in" && (
          <p className="mt-4 text-center text-lg">
            Admitted {people(result.admitted_now)}.{" "}
            {g.remaining > 0
              ? `${people(g.remaining)} more can still enter on this card.`
              : "This card is now fully used."}
          </p>
        )}
        {result.status === "already" && (
          <p className="mt-4 text-center text-lg font-medium">
            Do not admit anyone else on this card.
          </p>
        )}
        {result.status === "too_many" && (
          <p className="mt-4 text-center text-lg font-medium">
            Only {people(g.remaining)} can still enter on this card.
          </p>
        )}
        {result.status === "not_found" && (
          <p className="mt-6 text-center text-lg">
            This ID is not on the guest list. Check the ID and try again.
          </p>
        )}
        {result.status === "wrong_event" && (
          <p className="mt-6 text-center text-lg">
            This ID belongs to a different event.
          </p>
        )}

        <div className="mt-auto space-y-3 pb-[env(safe-area-inset-bottom)] pt-6">
          {canAdmit && (
            <button
              onClick={onConfirm}
              disabled={busy}
              className="w-full rounded-lg bg-white py-4 text-lg font-bold text-ink disabled:opacity-60"
            >
              {busy ? "Saving…" : `Admit ${people(count)}`}
            </button>
          )}
          <button
            onClick={onNext}
            className={`w-full rounded-lg py-4 text-lg font-bold ${canAdmit ? "bg-black/15" : "bg-teal text-white"}`}
          >
            {canAdmit ? "Cancel" : "Scan next"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Scanner() {
  const nav = useNavigate();
  const session = scannerSession.get();
  const [info, setInfo] = useState(null);
  const [tab, setTab] = useState("scan");
  const [result, setResult] = useState(null);
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState("");
  const [error, setError] = useState("");

  const loadInfo = () =>
    api
      .get("/scan/event", "scanner")
      .then(setInfo)
      .catch(() => {});
  useEffect(() => {
    if (!session) nav("/", { replace: true });
    else loadInfo();
  }, []);

  // The "x of y people in" counter follows every scan made by ANY scanner, as it happens
  useEffect(() => {
    if (!session) return undefined;
    const slow = setInterval(loadInfo, 60000); // safety net
    let opened = false;
    const stop = openLive("/scan/stream", "scanner", {
      onOpen: () => {
        if (opened) loadInfo(); // after a reconnect, catch up
        opened = true;
      },
      onMessage: (m) => {
        if (m.type === "stats")
          setInfo((i) => (i ? { ...i, cards: m.cards, total: m.total, arrived: m.arrived } : i));
        else if (m.type === "refresh") loadInfo();
      },
    });
    return () => {
      clearInterval(slow);
      stop();
    };
  }, []);
  if (!session) return null;

  const lookup = async (code) => {
    setBusy(true);
    setError("");
    try {
      setCount(1);
      const r = await api.post("/scan/lookup", { code }, "scanner");
      setResult(r);
      if (r.status === "ok" || r.status === "partial") beep(); // green screen -> beep
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const r = await api.post(
        "/scan/checkin",
        { code: result.code, count },
        "scanner",
      );
      setResult(r);
      if (r.status === "checked_in") beep(); // green "Checked in" screen -> beep
      loadInfo();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    setResult(null);
    setManual("");
    setError("");
    setCount(1);
  };

  const onManualChange = (v) => {
    const raw = v
      .toUpperCase()
      .replace(/[^0-9A-F]/g, "")
      .slice(0, 6);
    setManual(raw.length > 3 ? `${raw.slice(0, 3)}-${raw.slice(3)}` : raw);
  };

  const pct = info?.total ? Math.round((info.arrived / info.total) * 100) : 0;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-mist-50">
      <header className="bg-teal px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] text-white">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-widest text-white/80">
              Check-in
            </p>
            <h1 className="truncate font-display text-xl font-bold">
              {info?.name || session.eventName}
            </h1>
          </div>
          <button
            className="rounded-md border border-white/40 px-3 py-1.5 text-sm font-medium text-white"
            onClick={() => {
              scannerSession.clear();
              nav(`/e/${session.accessToken}`);
            }}
          >
            Log out
          </button>
        </div>
        {info && (
          <div className="mt-3">
            <div className="flex justify-between text-sm">
              <span>
                <b className="text-xl">{info.arrived}</b> of {info.total} people
                in
              </span>
              <span className="text-white/80">{pct}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/25">
              <div
                className="h-full bg-sky transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
      </header>

      <div className="grid grid-cols-2 border-b border-mist bg-white text-sm font-semibold">
        {[
          ["scan", "Scan QR"],
          ["manual", "Enter ID"],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => {
              setTab(k);
              setError("");
            }}
            className={`py-3 ${tab === k ? "border-b-2 border-teal text-ink" : "text-steel"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <main className="flex-1 p-4">
        {error && (
          <p className="mb-3 rounded-md bg-bad-light p-3 text-sm text-bad">
            {error}
          </p>
        )}

        {tab === "scan" && !result && <Camera onCode={lookup} />}

        {tab === "manual" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              lookup(manual);
            }}
            className="space-y-4 pt-4"
          >
            <p className="text-sm text-steel">
              For guests without a smartphone: type the 6-character ID from
              their invitation.
            </p>
            <input
              className="input py-4 text-center font-mono text-4xl font-bold uppercase tracking-widest"
              placeholder="A3F-9C2"
              value={manual}
              onChange={(e) => onManualChange(e.target.value)}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={7}
              autoFocus
            />
            <button
              className="btn btn-primary w-full py-4 text-lg"
              disabled={busy || manual.replace("-", "").length !== 6}
            >
              {busy ? "Checking…" : "Verify"}
            </button>
          </form>
        )}
      </main>

      {result && (
        <ResultScreen
          result={result}
          count={count}
          setCount={setCount}
          busy={busy}
          onConfirm={confirm}
          onNext={next}
        />
      )}
    </div>
  );
}

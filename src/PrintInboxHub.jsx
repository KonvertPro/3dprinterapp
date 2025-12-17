import React, { useEffect, useMemo, useState } from "react";

const SHEETS_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbwdRHaAIBTC7q0olATYdoGb6BBZuO3OUrBaCvu6V2AJuZvpMsq1PFkvUUy9wMNscL-EMA/exec";

const priorities = ["Low", "Normal", "High", "Urgent"];
const statuses = ["New", "In Progress", "Done", "Archived"];

const priorityStyles = {
  Low: "bg-emerald-50 text-emerald-700 border border-emerald-100",
  Normal: "bg-slate-100 text-slate-700 border border-slate-200",
  High: "bg-amber-50 text-amber-700 border border-amber-100",
  Urgent: "bg-rose-50 text-rose-700 border border-rose-100",
};

const statusStyles = {
  New: "bg-sky-50 text-sky-700 border border-sky-100",
  "In Progress": "bg-indigo-50 text-indigo-700 border border-indigo-100",
  Done: "bg-emerald-50 text-emerald-700 border border-emerald-100",
  Archived: "bg-slate-100 text-slate-600 border border-slate-200",
};

const sortOptions = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "due", label: "Due date" },
  { value: "priority", label: "Priority" },
];

const STORAGE_KEY = "print-inbox-requests-v2";

const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;

const formatDate = (iso) => {
  if (!iso) return "No due date";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Invalid date";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = (message, tone = "info") => {
    const id = uuid();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  };
  const remove = (id) => setToasts((t) => t.filter((x) => x.id !== id));
  return { toasts, push, remove };
}

// Reliable send from static hosting → Apps Script
async function postToSheet(payload) {
  if (!SHEETS_ENDPOINT) return { sent: false, reason: "no-endpoint" };
  const bodyText = JSON.stringify(payload);

  // Prefer sendBeacon
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([bodyText], { type: "text/plain;charset=UTF-8" });
      const ok = navigator.sendBeacon(SHEETS_ENDPOINT, blob);
      return { sent: ok, reason: ok ? "beacon" : "beacon-failed" };
    }
  } catch {
    // fall through
  }

  // Fallback: simple POST no-cors (no custom headers)
  try {
    await fetch(SHEETS_ENDPOINT, {
      method: "POST",
      mode: "no-cors",
      body: bodyText,
      keepalive: true,
    });
    return { sent: true, reason: "fetch-no-cors" };
  } catch (e) {
    return { sent: false, reason: "fetch-failed", error: e };
  }
}

function triageBuckets(reqs) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isToday = (iso) => {
    if (!iso) return false;
    const d = new Date(iso);
    return (
      !Number.isNaN(d.getTime()) &&
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    );
  };

  const overdue = reqs.filter((r) => {
    if (!r.dueDate) return false;
    const d = new Date(r.dueDate);
    return !Number.isNaN(d.getTime()) && d < today && r.status !== "Done";
  });

  const dueToday = reqs.filter((r) => isToday(r.dueDate));
  return { overdue, dueToday };
}

const priorityRank = { Low: 0, Normal: 1, High: 2, Urgent: 3 };

function sortRequests(reqs, sort) {
  const copy = [...reqs];
  copy.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (b.pinned && !a.pinned) return 1;

    if (sort === "oldest") return new Date(a.createdAt) - new Date(b.createdAt);

    if (sort === "due") {
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return ad - bd;
    }

    if (sort === "priority") return priorityRank[b.priority] - priorityRank[a.priority];

    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  return copy;
}

function DetailDrawer({ selected, onClose, updateRequest, onCopySummary, onDelete }) {
  if (!selected) return null;

  return (
    <div className="fixed inset-0 z-30 flex md:items-start">
      <div className="flex-1 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full md:max-w-xl h-full bg-white shadow-2xl rounded-t-2xl md:rounded-none md:rounded-l-2xl p-4 md:p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-900">{selected.name}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800">
            Close
          </button>
        </div>

        <div className="space-y-4">
          <p className="text-sm text-slate-600 whitespace-pre-line">{selected.description}</p>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm text-slate-600">
              Status
              <select
                value={selected.status}
                onChange={(e) => updateRequest(selected.id, { status: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-indigo-200"
              >
                {statuses.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>

            <label className="text-sm text-slate-600">
              Priority
              <select
                value={selected.priority}
                onChange={(e) => updateRequest(selected.id, { priority: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-indigo-200"
              >
                {priorities.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="text-sm text-slate-600 block">
            Developer Notes
            <textarea
              value={selected.devNotes || ""}
              onChange={(e) => updateRequest(selected.id, { devNotes: e.target.value })}
              rows={4}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-indigo-200"
              placeholder="What to watch out for, materials, constraints..."
            />
          </label>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={!!selected.pinned}
                  onChange={(e) => updateRequest(selected.id, { pinned: e.target.checked })}
                  className="accent-indigo-600"
                />
                Pin to top
              </label>

              <button
                onClick={() => onCopySummary(selected)}
                className="px-3 py-2 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-500 active:scale-95"
              >
                Copy summary
              </button>
            </div>

            <button
              onClick={() => onDelete(selected)}
              className="px-3 py-2 rounded-md border border-rose-200 bg-rose-50 text-rose-700 text-sm hover:bg-rose-100 active:scale-95"
              title="Delete from UI and Google Sheet"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FormCard({
  compact,
  name,
  setName,
  desc,
  setDesc,
  due,
  setDue,
  priority,
  setPriority,
  onSubmit,
  loading,
}) {
  return (
    <form
      onSubmit={onSubmit}
      className={`bg-white/80 backdrop-blur border border-slate-200 rounded-2xl shadow-sm ${
        compact ? "p-4" : "p-5"
      } space-y-3`}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-900">New Request</h3>
        
      </div>

      <label className="block text-sm text-slate-700">
        Name*
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-indigo-200"
          placeholder="Requester name"
        />
      </label>

      <label className="block text-sm text-slate-700">
        Description*
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          required
          rows={3}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-indigo-200"
          placeholder="What needs to be printed? Materials? Dimensions?"
        />
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-sm text-slate-700">
          Due date
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-indigo-200"
          />
        </label>

        <label className="block text-sm text-slate-700">
          Priority
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-indigo-200"
          >
            {priorities.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 text-white py-2.5 font-semibold hover:bg-indigo-500 disabled:opacity-60 active:scale-95 transition"
      >
        {loading ? "Submitting..." : "Submit request"}
      </button>

      <p className="text-xs text-slate-500">
        Required: Name and Description.
      </p>
    </form>
  );
}

export default function PrintInboxHub() {
  const [requests, setRequests] = useState([]);
  const [hydrated, setHydrated] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [sort, setSort] = useState("newest");

  const [selected, setSelected] = useState(null);
  const [formOpenMobile, setFormOpenMobile] = useState(false);

  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [loadingRefresh, setLoadingRefresh] = useState(false);

  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formDue, setFormDue] = useState("");
  const [formPriority, setFormPriority] = useState("Normal");

  const { toasts, push, remove } = useToasts();

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setRequests(parsed);
      }
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
  }, [requests, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    refreshFromSheet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    const scoped = requests.filter((r) => {
      const matchesTerm =
        !term ||
        (r.name || "").toLowerCase().includes(term) ||
        (r.description || "").toLowerCase().includes(term);
      const matchesStatus = statusFilter === "All" || r.status === statusFilter;
      const matchesPriority = priorityFilter === "All" || r.priority === priorityFilter;
      return matchesTerm && matchesStatus && matchesPriority;
    });
    return sortRequests(scoped, sort);
  }, [requests, search, statusFilter, priorityFilter, sort]);

  const { overdue, dueToday } = useMemo(() => triageBuckets(requests), [requests]);

  async function refreshFromSheet() {
    if (!SHEETS_ENDPOINT) return;
    setLoadingRefresh(true);
    try {
      const res = await fetch(`${SHEETS_ENDPOINT}?method=GET`);
      const data = await res.json();
      if (!data?.rows || !Array.isArray(data.rows)) throw new Error("Bad response");
      setRequests(data.rows.map((r) => ({ ...r, synced: true })));
      push("Inbox refreshed", "success");
    } catch {
      push("Refresh failed (possible CORS).", "error");
    } finally {
      setLoadingRefresh(false);
    }
  }

  function updateRequest(id, changes) {
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, ...changes } : r)));
    setSelected((prev) => (prev && prev.id === id ? { ...prev, ...changes } : prev));
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!formName.trim()) return push("Name is required", "error");
    if (!formDesc.trim()) return push("Description is required", "error");

    setLoadingSubmit(true);

    const newReq = {
      id: uuid(),
      createdAt: new Date().toISOString(),
      name: formName.trim(),
      description: formDesc.trim(),
      dueDate: formDue ? new Date(formDue).toISOString() : "",
      priority: formPriority,
      status: "New",
      devNotes: "",
      pinned: false,
      synced: false,
    };

    setRequests((prev) => [newReq, ...prev]);

    setFormDesc("");
    setFormDue("");
    push("Request added", "success");

    const result = await postToSheet(newReq);
    setRequests((prev) =>
      prev.map((r) => (r.id === newReq.id ? { ...r, synced: !!result.sent } : r))
    );
    if (!result.sent) push("Could not send to sheet. Retry available.", "error");

    setLoadingSubmit(false);
    setFormOpenMobile(false);
  }

  async function retrySync(req) {
    const result = await postToSheet(req);
    setRequests((prev) =>
      prev.map((r) => (r.id === req.id ? { ...r, synced: !!result.sent } : r))
    );
    push(result.sent ? "Sent to sheet" : "Retry failed", result.sent ? "success" : "error");
  }

  async function deleteRequest(req) {
    const ok = window.confirm(`Delete "${req.name}"? This will remove it from the sheet too.`);
    if (!ok) return;

    // Optimistic UI remove
    setRequests((prev) => prev.filter((r) => r.id !== req.id));
    setSelected((s) => (s?.id === req.id ? null : s));
    push("Deleted", "success");

    // Send delete command to Apps Script
    const result = await postToSheet({ action: "delete", id: req.id });
    if (!result.sent) {
      push("Delete may not have reached the sheet (check sheet).", "error");
    }
  }

  async function onCopySummary(req) {
    const summary = [
      `Request: ${req.name}`,
      `Priority: ${req.priority}`,
      `Status: ${req.status}`,
      `Due: ${req.dueDate ? formatDate(req.dueDate) : "No due date"}`,
      `Description: ${req.description}`,
      `Dev Notes: ${req.devNotes || "-"}`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(summary);
      push("Copied summary", "success");
    } catch {
      push("Copy failed", "error");
    }
  }

  function renderRequestCard(req) {
    const quickActions = [
      { label: "Start", show: req.status === "New", next: "In Progress" },
      { label: "Done", show: req.status !== "Done", next: "Done" },
      { label: "Archive", show: req.status !== "Archived", next: "Archived" },
    ];

    return (
      <div
        key={req.id}
        tabIndex={0}
        onClick={() => setSelected(req)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setSelected(req);
          }
        }}
        className="group rounded-xl border border-slate-200 bg-white/80 backdrop-blur-sm shadow-sm hover:shadow-md focus:ring-2 focus:ring-indigo-200 transition cursor-pointer"
      >
        <div className="flex items-start gap-3 p-3 md:p-4">
          <span
            className={`text-xs px-2 py-1 rounded-full font-semibold ${
              priorityStyles[req.priority] || priorityStyles.Normal
            }`}
          >
            {req.priority}
          </span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-slate-800 truncate">{req.name}</p>
              {req.pinned && <span className="text-amber-500 text-xs font-semibold">Pinned</span>}
            </div>

            <p className="text-sm text-slate-600 line-clamp-2">{req.description}</p>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-slate-300" />
                {formatDate(req.dueDate)}
              </span>

              <span className={`px-2 py-1 rounded-full border ${statusStyles[req.status] || ""}`}>
                {req.status}
              </span>

              {!req.synced && SHEETS_ENDPOINT && (
                <span className="text-amber-600 bg-amber-50 border border-amber-100 px-2 py-1 rounded-full">
                  Not synced
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1 items-end">
            {quickActions
              .filter((a) => a.show)
              .map((a) => (
                <button
                  key={a.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    updateRequest(req.id, { status: a.next });
                  }}
                  className="text-xs px-2 py-1 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 active:scale-95"
                >
                  {a.label}
                </button>
              ))}

            {!req.synced && SHEETS_ENDPOINT && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  retrySync(req);
                }}
                className="text-[11px] text-indigo-600 underline mt-1"
              >
                Retry
              </button>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                deleteRequest(req);
              }}
              className="text-xs px-2 py-1 rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 active:scale-95 mt-1"
              title="Delete from UI and Google Sheet"
            >
              Delete (don't use yet pls)
            </button>
          </div>
        </div>
      </div>
    );
  }

  function StatsCard() {
    const counts = statuses.map((s) => ({
      status: s,
      count: requests.filter((r) => r.status === s).length,
    }));

    return (
      <div className="bg-white/80 backdrop-blur border border-slate-200 rounded-2xl shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-slate-800">Stats</h4>
          <span className="text-xs text-slate-500">{requests.length} total</span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          {counts.map((c) => (
            <div
              key={c.status}
              className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2"
            >
              <span className="text-slate-600">{c.status}</span>
              <span className="font-semibold text-slate-900">{c.count}</span>
            </div>
          ))}
        </div>

        <div className="text-xs text-slate-500">
          {dueToday.length} due today / {overdue.length} overdue
        </div>
      </div>
    );
  }

  function TriageStrip() {
    return (
      <div className="flex flex-wrap gap-2 text-sm">
        <div className="px-3 py-2 rounded-xl border border-amber-100 bg-amber-50 text-amber-800">
          Today: {dueToday.length}
        </div>
        <div className="px-3 py-2 rounded-xl border border-rose-100 bg-rose-50 text-rose-800">
          Overdue: {overdue.length}
        </div>
        <div className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700">
          Total: {filtered.length}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50 text-slate-900">
      <header className="sticky top-0 z-20 backdrop-blur border-b border-slate-200 bg-white/80">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">3D Print Inbox</h1>

          <div className="flex items-center gap-2">
            <button
              onClick={refreshFromSheet}
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm hover:bg-slate-50 active:scale-95"
            >
              {loadingRefresh ? "Refreshing..." : "Refresh"}
            </button>

            <button
              onClick={() => setFormOpenMobile(true)}
              className="md:hidden px-3 py-2 rounded-lg border border-indigo-200 bg-white text-indigo-700 text-sm active:scale-95"
            >
              New Request
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 flex flex-col md:flex-row gap-6">
        <aside className="md:w-80 space-y-4 hidden md:block">
          <FormCard
            name={formName}
            setName={setFormName}
            desc={formDesc}
            setDesc={setFormDesc}
            due={formDue}
            setDue={setFormDue}
            priority={formPriority}
            setPriority={setFormPriority}
            onSubmit={onSubmit}
            loading={loadingSubmit}
          />
          <StatsCard />
        </aside>

        <section className="flex-1 space-y-4">
          <div className="bg-white/80 backdrop-blur border border-slate-200 rounded-2xl shadow-sm p-4 space-y-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex-1 flex items-center gap-2">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name or description..."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-indigo-200"
                />
              </div>

              <div className="flex flex-wrap gap-2 text-sm">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-indigo-200"
                >
                  {["All", ...statuses].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>

                <select
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-indigo-200"
                >
                  {["All", ...priorities].map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>

                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-indigo-200"
                >
                  {sortOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <TriageStrip />
          </div>

          <div className="space-y-3">
            {filtered.length === 0 ? (
              <div className="text-center py-12 rounded-2xl border border-dashed border-slate-200 bg-white/70">
                <p className="text-sm text-slate-500">No requests yet.</p>
              </div>
            ) : (
              filtered.map(renderRequestCard)
            )}
          </div>
        </section>
      </main>

      <DetailDrawer
        selected={selected}
        onClose={() => setSelected(null)}
        updateRequest={updateRequest}
        onCopySummary={onCopySummary}
        onDelete={deleteRequest}
      />

      {formOpenMobile && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div
            className="flex-1 bg-slate-900/30 backdrop-blur-sm"
            onClick={() => setFormOpenMobile(false)}
          />
          <div className="w-full bg-white rounded-t-2xl p-4 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">New Request</h3>
              <button
                onClick={() => setFormOpenMobile(false)}
                className="text-slate-500 hover:text-slate-800"
              >
                Close
              </button>
            </div>

            <FormCard
              compact
              name={formName}
              setName={setFormName}
              desc={formDesc}
              setDesc={setFormDesc}
              due={formDue}
              setDue={setFormDue}
              priority={formPriority}
              setPriority={setFormPriority}
              onSubmit={onSubmit}
              loading={loadingSubmit}
            />
          </div>
        </div>
      )}

      <div className="fixed bottom-4 right-4 space-y-2 z-50">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-4 py-3 rounded-xl shadow-md border ${
              t.tone === "error"
                ? "bg-rose-50 border-rose-100 text-rose-700"
                : t.tone === "success"
                ? "bg-emerald-50 border-emerald-100 text-emerald-700"
                : "bg-white border-slate-200 text-slate-800"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">{t.message}</span>
              <button
                onClick={() => remove(t.id)}
                className="text-xs text-slate-500 hover:text-slate-800"
              >
                X
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

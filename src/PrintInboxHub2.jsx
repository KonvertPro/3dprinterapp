import React, { useEffect, useMemo, useRef, useState } from "react";

const SHEETS_ENDPOINT = ""; // Google Apps Script Web App URL (universal sheet)
const API_KEY = ""; // optional auth header bearer token

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

// Toast shape: { id, message, tone }
const STORAGE_KEY = "print-inbox-requests";

const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 8)}`;

const formatDate = (iso) => {
  if (!iso) return "No due date";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Invalid date";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const toCSV = (rows) => {
  const headers = [
    "createdAt",
    "name",
    "description",
    "dueDate",
    "priority",
    "status",
    "devNotes",
    "pinned",
  ];
  const esc = (val) => {
    const str = val === undefined || val === null ? "" : String(val);
    if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        r.createdAt,
        r.name,
        r.description,
        r.dueDate || "",
        r.priority,
        r.status,
        r.devNotes || "",
        r.pinned ? "true" : "false",
      ]
        .map(esc)
        .join(",")
    ),
  ];
  return lines.join("\n");
};

const useEscClose = (enabled, onClose) => {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, onClose]);
};

const useToasts = () => {
  const [toasts, setToasts] = useState([]);
  const push = (toast) => {
    const id = uuid();
    setToasts((t) => [...t, { ...toast, id }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 3000);
  };
  const remove = (id) => setToasts((t) => t.filter((x) => x.id !== id));
  return { toasts, push, remove };
};

const triageBuckets = (reqs) => {
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
};

const priorityRank = { Low: 0, Normal: 1, High: 2, Urgent: 3 };

const sortRequests = (reqs, sort) => {
  const copy = [...reqs];
  copy.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (b.pinned && !a.pinned) return 1;

    switch (sort) {
      case "oldest":
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      case "due": {
        const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return ad - bd;
      }
      case "priority":
        return priorityRank[b.priority] - priorityRank[a.priority];
      case "newest":
      default:
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
  });
  return copy;
};

// ✅ Subcomponents OUTSIDE main component to prevent keyboard focus loss on mobile
const DetailDrawer = ({
  selected,
  setSelected,
  updateRequest,
  onCopySummary,
  priorities,
  statuses,
}) => {
  if (!selected) return null;

  return (
    <div className="fixed inset-0 z-30 flex md:items-start">
      <div
        className="flex-1 bg-slate-900/30 backdrop-blur-sm"
        onClick={() => setSelected(null)}
      />
      <div className="w-full md:max-w-xl h-full bg-white shadow-2xl rounded-t-2xl md:rounded-none md:rounded-l-2xl p-4 md:p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-900">{selected.name}</h3>
          <button
            onClick={() => setSelected(null)}
            className="text-slate-500 hover:text-slate-800 focus:outline-none"
          >
            Esc
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-sm text-slate-600 whitespace-pre-line">
              {selected.description}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm text-slate-600">
              Status
              <select
                value={selected.status}
                onChange={(e) =>
                  updateRequest(selected.id, { status: e.target.value })
                }
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
                onChange={(e) =>
                  updateRequest(selected.id, { priority: e.target.value })
                }
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
              onChange={(e) =>
                updateRequest(selected.id, { devNotes: e.target.value })
              }
              rows={4}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-indigo-200"
              placeholder="What to watch out for, materials, constraints..."
            />
          </label>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={!!selected.pinned}
                onChange={(e) =>
                  updateRequest(selected.id, { pinned: e.target.checked })
                }
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
        </div>
      </div>
    </div>
  );
};

const FormCard = ({
  compact,
  formRef,
  formName,
  setFormName,
  formDesc,
  setFormDesc,
  formDue,
  setFormDue,
  formPriority,
  setFormPriority,
  submitRequest,
  loadingSubmit,
  priorities,
}) => (
  <form
    ref={formRef}
    onSubmit={submitRequest}
    className={`bg-white/80 backdrop-blur border border-slate-200 rounded-2xl shadow-sm ${
      compact ? "p-4" : "p-5"
    } space-y-3`}
  >
    <div className="flex items-center justify-between">
      <h3 className="text-lg font-semibold text-slate-900">New Request</h3>
      <span className="text-xs text-slate-500">Requester-facing</span>
    </div>

    <label className="block text-sm text-slate-700">
      Name*
      <input
        value={formName}
        onChange={(e) => setFormName(e.target.value)}
        required
        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-indigo-200"
        placeholder="Requester name"
      />
    </label>

    <label className="block text-sm text-slate-700">
      Description*
      <textarea
        value={formDesc}
        onChange={(e) => setFormDesc(e.target.value)}
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
          value={formDue}
          onChange={(e) => setFormDue(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-indigo-200"
        />
      </label>

      <label className="block text-sm text-slate-700">
        Priority
        <select
          value={formPriority}
          onChange={(e) => setFormPriority(e.target.value)}
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
      disabled={loadingSubmit}
      className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 text-white py-2.5 font-semibold hover:bg-indigo-500 disabled:opacity-60 active:scale-95 transition"
    >
      {loadingSubmit ? "Submitting..." : "Submit request"}
    </button>

    <p className="text-xs text-slate-500">
      Required: Name and Description. After submit, description clears but name
      stays for repeat requests.
    </p>
  </form>
);

export default function PrintInboxHub() {
  const [requests, setRequests] = useState([]);
  const [hydrated, setHydrated] = useState(false); // ✅ prevents localStorage wipe on mount

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
  const formRef = useRef(null);

  const { toasts, push: pushToast, remove: removeToast } = useToasts();

  // ✅ Load saved requests once on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setRequests(parsed);
      } catch (err) {
        console.warn("Failed to parse saved requests", err);
      }
    }
    setHydrated(true);
  }, []);

  // ✅ Persist requests only AFTER hydration (prevents “clears on refresh”)
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
  }, [requests, hydrated]);

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    const scoped = requests.filter((r) => {
      const matchesTerm =
        !term ||
        r.name?.toLowerCase().includes(term) ||
        r.description?.toLowerCase().includes(term);
      const matchesStatus = statusFilter === "All" || r.status === statusFilter;
      const matchesPriority =
        priorityFilter === "All" || r.priority === priorityFilter;
      return matchesTerm && matchesStatus && matchesPriority;
    });
    return sortRequests(scoped, sort);
  }, [requests, search, statusFilter, priorityFilter, sort]);

  const { overdue, dueToday } = useMemo(() => triageBuckets(requests), [requests]);

  const submitRequest = async (e) => {
    e.preventDefault();

    if (!formName.trim()) {
      pushToast({ message: "Name is required", tone: "error" });
      return;
    }
    if (!formDesc.trim()) {
      pushToast({ message: "Description is required", tone: "error" });
      return;
    }

    setLoadingSubmit(true);

    const newReq = {
      id: uuid(),
      createdAt: new Date().toISOString(),
      name: formName.trim(),
      description: formDesc.trim(),
      dueDate: formDue ? new Date(formDue).toISOString() : undefined,
      priority: formPriority,
      status: "New",
      devNotes: "",
      pinned: false,
      synced: !SHEETS_ENDPOINT,
    };

    setRequests((prev) => [newReq, ...prev]);

    // Keep name for repeat requests, clear the rest
    setFormDesc("");
    setFormDue("");

    pushToast({ message: "Request added", tone: "success" });

    if (!SHEETS_ENDPOINT) {
      setLoadingSubmit(false);
      setFormOpenMobile(false);
      return;
    }

    try {
      await fetch(SHEETS_ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        headers: {
          "Content-Type": "application/json",
          ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
        },
        body: JSON.stringify(newReq),
      });

      setRequests((prev) =>
        prev.map((r) => (r.id === newReq.id ? { ...r, synced: true } : r))
      );
    } catch (err) {
      setRequests((prev) =>
        prev.map((r) => (r.id === newReq.id ? { ...r, synced: false } : r))
      );
      pushToast({ message: "Failed to sync. You can retry.", tone: "error" });
    } finally {
      setLoadingSubmit(false);
      setFormOpenMobile(false);
    }
  };

  const retrySync = async (req) => {
    if (!SHEETS_ENDPOINT) return;

    try {
      await fetch(SHEETS_ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        headers: {
          "Content-Type": "application/json",
          ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
        },
        body: JSON.stringify(req),
      });

      setRequests((prev) =>
        prev.map((r) => (r.id === req.id ? { ...r, synced: true } : r))
      );
      pushToast({ message: "Synced", tone: "success" });
    } catch {
      pushToast({ message: "Sync failed", tone: "error" });
    }
  };

  const refreshFromSheet = async () => {
    if (!SHEETS_ENDPOINT) {
      pushToast({ message: "Add SHEETS_ENDPOINT to enable refresh", tone: "error" });
      return;
    }

    setLoadingRefresh(true);
    try {
      const res = await fetch(`${SHEETS_ENDPOINT}?method=GET`, {
        headers: API_KEY ? { Authorization: `Bearer ${API_KEY}` } : undefined,
      });
      const data = await res.json();
      if (!data?.rows || !Array.isArray(data.rows)) throw new Error("Invalid response");

      setRequests(
        data.rows.map((r) => ({
          ...r,
          synced: true,
        }))
      );

      pushToast({ message: "Inbox refreshed", tone: "success" });
    } catch {
      pushToast({ message: "Refresh failed", tone: "error" });
    } finally {
      setLoadingRefresh(false);
    }
  };

  const updateRequest = (id, changes) => {
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, ...changes } : r)));
    setSelected((prev) => (prev && prev.id === id ? { ...prev, ...changes } : prev));
  };

  const onCopySummary = async (req) => {
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
      pushToast({ message: "Copied summary", tone: "success" });
    } catch {
      pushToast({ message: "Copy failed", tone: "error" });
    }
  };

  useEscClose(!!selected || formOpenMobile, () => {
    setSelected(null);
    setFormOpenMobile(false);
  });

  const renderRequestCard = (req) => {
    const quickActions = [
      {
        label: "Start",
        action: () => updateRequest(req.id, { status: "In Progress" }),
        show: req.status === "New",
      },
      {
        label: "Done",
        action: () => updateRequest(req.id, { status: "Done" }),
        show: req.status !== "Done",
      },
      {
        label: "Archive",
        action: () => updateRequest(req.id, { status: "Archived" }),
        show: req.status !== "Archived",
      },
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
              priorityStyles[req.priority]
            }`}
          >
            {req.priority}
          </span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-slate-800 truncate">{req.name}</p>
              {req.pinned && (
                <span className="text-amber-500 text-xs font-semibold">Pinned</span>
              )}
            </div>

            <p className="text-sm text-slate-600 line-clamp-2">{req.description}</p>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-slate-300" />
                {formatDate(req.dueDate)}
              </span>

              <span className={`px-2 py-1 rounded-full border ${statusStyles[req.status]}`}>
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
              .map((qa) => (
                <button
                  key={qa.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    qa.action();
                  }}
                  className="text-xs px-2 py-1 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 active:scale-95"
                >
                  {qa.label}
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
          </div>
        </div>
      </div>
    );
  };

  const StatsCard = () => {
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
  };

  const TriageStrip = () => (
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50 text-slate-900">
      <header className="sticky top-0 z-20 backdrop-blur border-b border-slate-200 bg-white/80">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-semibold">3D Print Inbox</h1>
            </div>
          </div>

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

      {(!SHEETS_ENDPOINT || SHEETS_ENDPOINT === "") && (
        <div className="mx-auto max-w-6xl px-4 pt-3">
          <div className="rounded-xl border border-amber-100 bg-amber-50 text-amber-800 px-4 py-3 text-sm">
            Local mode - add endpoint to sync to Sheet.
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 py-6 flex flex-col md:flex-row gap-6">
        <aside className="md:w-80 space-y-4 hidden md:block">
          <FormCard
            formRef={formRef}
            formName={formName}
            setFormName={setFormName}
            formDesc={formDesc}
            setFormDesc={setFormDesc}
            formDue={formDue}
            setFormDue={setFormDue}
            formPriority={formPriority}
            setFormPriority={setFormPriority}
            submitRequest={submitRequest}
            loadingSubmit={loadingSubmit}
            priorities={priorities}
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
              filtered.map((req) => renderRequestCard(req))
            )}
          </div>
        </section>
      </main>

      <DetailDrawer
        selected={selected}
        setSelected={setSelected}
        updateRequest={updateRequest}
        onCopySummary={onCopySummary}
        priorities={priorities}
        statuses={statuses}
      />

      {/* Mobile bottom sheet for new request */}
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
              formRef={formRef}
              formName={formName}
              setFormName={setFormName}
              formDesc={formDesc}
              setFormDesc={setFormDesc}
              formDue={formDue}
              setFormDue={setFormDue}
              formPriority={formPriority}
              setFormPriority={setFormPriority}
              submitRequest={submitRequest}
              loadingSubmit={loadingSubmit}
              priorities={priorities}
            />
          </div>
        </div>
      )}

      {/* Toasts */}
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
                onClick={() => removeToast(t.id)}
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

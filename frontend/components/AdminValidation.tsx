import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type ValidationStatus = "pending" | "validated" | "needs_review" | "rejected";
type LabelSource = "prompt_assumed" | "user_confirmed" | "reviewed";

type AdminValidation = {
  status: ValidationStatus;
  validated_at: string | null;
  notes: string | null;
};

type AdminSample = {
  id: string;
  sample_id: string;
  recording_id: string;
  session_id: string;
  task_id: string;
  topic_id: string;
  submitted_at: string;
  duration_sec: number;
  session_status: string;
  prompted_word: string | null;
  phrase_id: string | null;
  normalized_label: string | null;
  semantic_label: string | null;
  category: string | null;
  language: string | null;
  literal_transcript: string | null;
  label_source: LabelSource;
  validation: AdminValidation;
  processed_audio_status: string;
  storage: {
    storage_type: string;
    storage_key: string;
    object_key: string | null;
    metadata_object_key: string | null;
    bucket_name: string | null;
  };
  metadata?: {
    recording: Record<string, unknown>;
    session: Record<string, unknown>;
    task: Record<string, unknown>;
    topic: Record<string, unknown>;
  };
};

type Summary = {
  total_recordings: number;
  pending: number;
  validated: number;
  needs_review: number;
  rejected: number;
  classifier_ready_validated: number;
  exportable: number;
  missing_metadata: number;
  missing_processed_audio: number;
  wrong_processed_audio: number;
};

type Readiness = {
  validation_filter: string;
  exportable_count: number;
  missing_phrase_id_count: number;
  missing_semantic_label_count: number;
  missing_literal_transcript_key_count: number;
  missing_processed_audio_count: number;
  wrong_processed_audio_count: number;
};

type Health = {
  ready: boolean;
  backend_time: string;
  app_environment: string;
  storage_mode: string;
  validation_filter: string;
  warnings: Array<{
    code: string;
    count: number;
    message: string;
    categories?: string[];
  }>;
};

type ListResponse = {
  success: boolean;
  samples: AdminSample[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    has_next: boolean;
    has_previous: boolean;
  };
  message?: string;
};

type AdminFormState = {
  literal_transcript: string;
  label_source: LabelSource;
  status: ValidationStatus;
  notes: string;
};

const STATUS_OPTIONS: Array<{ value: ValidationStatus; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "validated", label: "Validated" },
  { value: "needs_review", label: "Needs review" },
  { value: "rejected", label: "Rejected" },
];

const LABEL_SOURCE_OPTIONS: Array<{ value: LabelSource; label: string }> = [
  { value: "prompt_assumed", label: "Prompt assumed" },
  { value: "user_confirmed", label: "User confirmed" },
  { value: "reviewed", label: "Reviewed" },
];

function asDisplay(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "Missing";
  }

  return String(value);
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Missing";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function buildInitialForm(sample: AdminSample): AdminFormState {
  return {
    literal_transcript: sample.literal_transcript || "",
    label_source: sample.label_source || "prompt_assumed",
    status: sample.validation.status,
    notes: sample.validation.notes || "",
  };
}

function getStatusClass(status: ValidationStatus) {
  return `admin-status admin-status--${status.replace("_", "-")}`;
}

function MetadataBlock({ title, value }: { title: string; value: Record<string, unknown> }) {
  return (
    <details className="admin-metadata-block">
      <summary>{title}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

function StatGrid({ summary }: { summary: Summary | null }) {
  const items = [
    ["Total", summary?.total_recordings],
    ["Pending", summary?.pending],
    ["Validated", summary?.validated],
    ["Needs review", summary?.needs_review],
    ["Rejected", summary?.rejected],
    ["Ready validated", summary?.classifier_ready_validated],
    ["Exportable", summary?.exportable],
    ["Missing audio meta", summary?.missing_processed_audio],
  ];

  return (
    <div className="admin-stats" aria-label="Validation summary">
      {items.map(([label, value]) => (
        <div className="admin-stat" key={label}>
          <span>{label}</span>
          <strong>{value ?? "-"}</strong>
        </div>
      ))}
    </div>
  );
}

function DistributionList({
  title,
  values,
}: {
  title: string;
  values: Record<string, number> | undefined;
}) {
  const entries = Object.entries(values || {})
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8);

  return (
    <div className="admin-distribution">
      <h3>{title}</h3>
      {entries.length ? (
        <ul>
          {entries.map(([label, count]) => (
            <li key={label}>
              <span>{label}</span>
              <strong>{count}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p>No data</p>
      )}
    </div>
  );
}

function AdminValidationApp() {
  const apiUrl = import.meta.env.VITE_API_URL;
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [message, setMessage] = useState("");
  const [samples, setSamples] = useState<AdminSample[]>([]);
  const [selectedSample, setSelectedSample] = useState<AdminSample | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [distributions, setDistributions] = useState<Record<string, Record<string, number>>>({});
  const [statusFilter, setStatusFilter] = useState<ValidationStatus | "all">("pending");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [labelFilter, setLabelFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formState, setFormState] = useState<AdminFormState | null>(null);

  const pageSize = 25;

  const audioUrl = useMemo(() => {
    if (!selectedSample) {
      return "";
    }

    return `${apiUrl}/api/admin/samples/${selectedSample.id}/audio`;
  }, [apiUrl, selectedSample]);

  const requestJson = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const response = await fetch(`${apiUrl}${path}`, {
        ...init,
        credentials: "include",
        headers: {
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers || {}),
        },
      });
      const data = (await response.json()) as T & { message?: string };

      if (!response.ok) {
        throw new Error(data.message || "Admin request failed.");
      }

      return data;
    },
    [apiUrl]
  );

  const loadDashboard = useCallback(async () => {
    const [summaryResponse, readinessResponse, distributionsResponse, healthResponse] =
      await Promise.all([
        requestJson<{ summary: Summary }>("/api/admin/summary"),
        requestJson<{ readiness: Readiness }>("/api/admin/export-readiness"),
        requestJson<{ distributions: Record<string, Record<string, number>> }>(
          "/api/admin/distributions"
        ),
        requestJson<{ health: Health }>("/api/admin/health"),
      ]);

    setSummary(summaryResponse.summary);
    setReadiness(readinessResponse.readiness);
    setDistributions(distributionsResponse.distributions);
    setHealth(healthResponse.health);
  }, [requestJson]);

  const loadSampleDetail = useCallback(
    async (sampleId: string) => {
      setLoadingDetail(true);
      setMessage("");

      try {
        const data = await requestJson<{ sample: AdminSample }>(`/api/admin/samples/${sampleId}`);
        setSelectedSample(data.sample);
        setFormState(buildInitialForm(data.sample));
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not load sample.");
      } finally {
        setLoadingDetail(false);
      }
    },
    [requestJson]
  );

  const loadSamples = useCallback(async () => {
    setLoadingList(true);
    setMessage("");
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String(offset),
      status: statusFilter,
    });

    if (categoryFilter.trim()) {
      params.set("category", categoryFilter.trim());
    }

    if (labelFilter.trim()) {
      params.set("label", labelFilter.trim());
    }

    try {
      const data = await requestJson<ListResponse>(`/api/admin/samples?${params.toString()}`);
      setSamples(data.samples);
      setTotal(data.pagination.total);
      if (!selectedSample && data.samples[0]) {
        await loadSampleDetail(data.samples[0].id);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load samples.");
    } finally {
      setLoadingList(false);
    }
  }, [
    categoryFilter,
    labelFilter,
    loadSampleDetail,
    offset,
    requestJson,
    selectedSample,
    statusFilter,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function checkMe() {
      try {
        await requestJson("/api/admin/me");
        if (!cancelled) {
          setAuthenticated(true);
          await loadDashboard();
        }
      } catch (_error) {
        if (!cancelled) {
          setAuthenticated(false);
        }
      } finally {
        if (!cancelled) {
          setCheckingAuth(false);
        }
      }
    }

    void checkMe();
    return () => {
      cancelled = true;
    };
  }, [loadDashboard, requestJson]);

  useEffect(() => {
    if (authenticated) {
      void loadSamples();
    }
  }, [authenticated, loadSamples]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");

    try {
      await requestJson("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setPassword("");
      setAuthenticated(true);
      await loadDashboard();
      await loadSamples();
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Login failed.");
    }
  }

  async function handleLogout() {
    await requestJson("/api/admin/logout", { method: "POST" });
    setAuthenticated(false);
    setSelectedSample(null);
    setSamples([]);
  }

  async function handleSave() {
    if (!selectedSample || !formState) {
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const data = await requestJson<{ sample: AdminSample }>(
        `/api/admin/samples/${selectedSample.id}/validation`,
        {
          method: "POST",
          body: JSON.stringify({
            literal_transcript: formState.literal_transcript.trim() || null,
            label_source: formState.label_source,
            validation: {
              status: formState.status,
              notes: formState.notes.trim() || null,
            },
          }),
        }
      );
      setSelectedSample(data.sample);
      setFormState(buildInitialForm(data.sample));
      setMessage("Validation saved.");
      await Promise.all([loadDashboard(), loadSamples()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save validation.");
    } finally {
      setSaving(false);
    }
  }

  function resetFilters() {
    setStatusFilter("pending");
    setCategoryFilter("");
    setLabelFilter("");
    setOffset(0);
  }

  function openNextPending() {
    const next = samples.find(
      (sample) => sample.validation.status === "pending" && sample.id !== selectedSample?.id
    );

    if (next) {
      void loadSampleDetail(next.id);
      return;
    }

    setStatusFilter("pending");
    setOffset(0);
  }

  if (checkingAuth) {
    return (
      <main className="admin-shell">
        <section className="admin-panel admin-panel--login">
          <span className="app-eyebrow">Speech Collector</span>
          <h1>Admin validation</h1>
          <p>Checking admin session.</p>
        </section>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="admin-shell">
        <section className="admin-panel admin-panel--login">
          <span className="app-eyebrow">Speech Collector</span>
          <h1>Admin validation</h1>
          <p>
            This area is only for project members reviewing collected speech data. Volunteers do
            not need to use this section. If you are here to record samples, please return to the
            main collection page.
          </p>
          <form className="admin-login-form" onSubmit={handleLogin}>
            <label>
              Shared admin password
              <input
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <button className="app-primary-button" type="submit">
              Log in
            </button>
          </form>
          {loginError && <p className="app-inline-message app-inline-message--error">{loginError}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <section className="admin-panel">
        <header className="admin-header">
          <div>
            <span className="app-eyebrow">Internal review</span>
            <h1>Sample validation</h1>
          </div>
          <button className="app-secondary-button" type="button" onClick={() => void handleLogout()}>
            Logout
          </button>
        </header>

        <StatGrid summary={summary} />

        <div className="admin-dashboard">
          <section className="admin-dashboard-section">
            <h2>Export readiness</h2>
            <dl>
              <div>
                <dt>Filter</dt>
                <dd>{readiness?.validation_filter || "-"}</dd>
              </div>
              <div>
                <dt>Exportable</dt>
                <dd>{readiness?.exportable_count ?? "-"}</dd>
              </div>
              <div>
                <dt>Missing phrase ID</dt>
                <dd>{readiness?.missing_phrase_id_count ?? "-"}</dd>
              </div>
              <div>
                <dt>Missing semantic label</dt>
                <dd>{readiness?.missing_semantic_label_count ?? "-"}</dd>
              </div>
              <div>
                <dt>Wrong processed audio</dt>
                <dd>{readiness?.wrong_processed_audio_count ?? "-"}</dd>
              </div>
            </dl>
          </section>

          <section className="admin-dashboard-section">
            <h2>Backend</h2>
            <dl>
              <div>
                <dt>Storage</dt>
                <dd>{health?.storage_mode || "-"}</dd>
              </div>
              <div>
                <dt>Environment</dt>
                <dd>{health?.app_environment || "-"}</dd>
              </div>
              <div>
                <dt>Backend time</dt>
                <dd>{health ? formatDate(health.backend_time) : "-"}</dd>
              </div>
              <div>
                <dt>Warnings</dt>
                <dd>{health?.warnings.length ?? "-"}</dd>
              </div>
            </dl>
          </section>
        </div>

        {health?.warnings.length ? (
          <div className="admin-warning-list">
            {health.warnings.map((warning) => (
              <p key={warning.code}>
                <strong>{warning.code}</strong>: {warning.message} ({warning.count})
              </p>
            ))}
          </div>
        ) : null}

        <div className="admin-distributions">
          <DistributionList title="Categories" values={distributions.category} />
          <DistributionList title="Labels" values={distributions.normalized_label} />
          <DistributionList title="Semantic" values={distributions.semantic_label} />
        </div>

        <div className="admin-workspace">
          <section className="admin-list-pane" aria-label="Sample queue">
            <div className="admin-filters">
              <label>
                Status
                <select
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value as ValidationStatus | "all");
                    setOffset(0);
                    setSelectedSample(null);
                  }}
                >
                  <option value="all">All</option>
                  {STATUS_OPTIONS.map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Category
                <input
                  value={categoryFilter}
                  onChange={(event) => {
                    setCategoryFilter(event.target.value);
                    setOffset(0);
                  }}
                  placeholder="yes"
                />
              </label>
              <label>
                Label
                <input
                  value={labelFilter}
                  onChange={(event) => {
                    setLabelFilter(event.target.value);
                    setOffset(0);
                  }}
                  placeholder="joo or yes"
                />
              </label>
              <button className="app-secondary-button" type="button" onClick={resetFilters}>
                Reset
              </button>
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Submitted</th>
                    <th>Sample</th>
                    <th>Prompt</th>
                    <th>Phrase</th>
                    <th>Label</th>
                    <th>Semantic</th>
                    <th>Category</th>
                    <th>Duration</th>
                    <th>Status</th>
                    <th>Audio</th>
                    <th>Storage</th>
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {samples.map((sample) => (
                    <tr
                      key={sample.id}
                      className={selectedSample?.id === sample.id ? "admin-table-row--selected" : ""}
                    >
                      <td>{formatDate(sample.submitted_at)}</td>
                      <td>{sample.sample_id.slice(0, 8)}</td>
                      <td>{asDisplay(sample.prompted_word)}</td>
                      <td>{asDisplay(sample.phrase_id)}</td>
                      <td>{asDisplay(sample.normalized_label)}</td>
                      <td>{asDisplay(sample.semantic_label)}</td>
                      <td>{asDisplay(sample.category)}</td>
                      <td>{Number(sample.duration_sec || 0).toFixed(2)}s</td>
                      <td>
                        <span className={getStatusClass(sample.validation.status)}>
                          {sample.validation.status}
                        </span>
                      </td>
                      <td>{sample.processed_audio_status}</td>
                      <td>{sample.storage.storage_type}</td>
                      <td>
                        <button
                          className="admin-link-button"
                          type="button"
                          onClick={() => void loadSampleDetail(sample.id)}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!samples.length && (
                    <tr>
                      <td colSpan={12}>{loadingList ? "Loading samples." : "No samples found."}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="admin-pagination">
              <button
                className="app-secondary-button"
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - pageSize))}
              >
                Previous
              </button>
              <span>
                {total ? offset + 1 : 0}-{Math.min(offset + pageSize, total)} of {total}
              </span>
              <button
                className="app-secondary-button"
                type="button"
                disabled={offset + pageSize >= total}
                onClick={() => setOffset(offset + pageSize)}
              >
                Next
              </button>
            </div>
          </section>

          <section className="admin-detail-pane" aria-label="Sample detail">
            {selectedSample && formState ? (
              <>
                <div className="admin-detail-header">
                  <div>
                    <span className="app-eyebrow">Selected sample</span>
                    <h2>{selectedSample.sample_id}</h2>
                  </div>
                  <button className="app-secondary-button" type="button" onClick={openNextPending}>
                    Next pending
                  </button>
                </div>

                <audio
                  className="admin-audio"
                  controls
                  src={audioUrl}
                  crossOrigin="use-credentials"
                />

                <div className="admin-editor">
                  <label>
                    Literal transcript
                    <input
                      value={formState.literal_transcript}
                      onChange={(event) =>
                        setFormState({ ...formState, literal_transcript: event.target.value })
                      }
                      placeholder="Optional reviewed transcript"
                    />
                  </label>
                  <label>
                    Label source
                    <select
                      value={formState.label_source}
                      onChange={(event) =>
                        setFormState({
                          ...formState,
                          label_source: event.target.value as LabelSource,
                        })
                      }
                    >
                      {LABEL_SOURCE_OPTIONS.map((option) => (
                        <option value={option.value} key={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Validation status
                    <select
                      value={formState.status}
                      onChange={(event) =>
                        setFormState({ ...formState, status: event.target.value as ValidationStatus })
                      }
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <option value={option.value} key={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="admin-editor__notes">
                    Notes
                    <textarea
                      value={formState.notes}
                      rows={4}
                      onChange={(event) =>
                        setFormState({ ...formState, notes: event.target.value })
                      }
                      placeholder="Optional internal note"
                    />
                  </label>
                </div>

                <div className="admin-actions">
                  <button
                    className="app-primary-button"
                    type="button"
                    disabled={saving}
                    onClick={() => void handleSave()}
                  >
                    {saving ? "Saving..." : "Save validation"}
                  </button>
                </div>

                <dl className="admin-readonly-grid">
                  <div>
                    <dt>Prompted word</dt>
                    <dd>{asDisplay(selectedSample.prompted_word)}</dd>
                  </div>
                  <div>
                    <dt>Phrase ID</dt>
                    <dd>{asDisplay(selectedSample.phrase_id)}</dd>
                  </div>
                  <div>
                    <dt>Normalized label</dt>
                    <dd>{asDisplay(selectedSample.normalized_label)}</dd>
                  </div>
                  <div>
                    <dt>Semantic label</dt>
                    <dd>{asDisplay(selectedSample.semantic_label)}</dd>
                  </div>
                  <div>
                    <dt>Category</dt>
                    <dd>{asDisplay(selectedSample.category)}</dd>
                  </div>
                  <div>
                    <dt>Language</dt>
                    <dd>{asDisplay(selectedSample.language)}</dd>
                  </div>
                  <div>
                    <dt>Task</dt>
                    <dd>{selectedSample.task_id}</dd>
                  </div>
                  <div>
                    <dt>Session</dt>
                    <dd>{selectedSample.session_id}</dd>
                  </div>
                  <div>
                    <dt>Storage key</dt>
                    <dd>{selectedSample.storage.storage_key}</dd>
                  </div>
                  <div>
                    <dt>Metadata sidecar</dt>
                    <dd>{asDisplay(selectedSample.storage.metadata_object_key)}</dd>
                  </div>
                </dl>

                {selectedSample.metadata && (
                  <div className="admin-metadata-grid">
                    <MetadataBlock title="Recording metadata" value={selectedSample.metadata.recording} />
                    <MetadataBlock title="Session metadata" value={selectedSample.metadata.session} />
                    <MetadataBlock title="Task metadata" value={selectedSample.metadata.task} />
                  </div>
                )}
              </>
            ) : (
              <p>{loadingDetail ? "Loading sample." : "Select a sample to review."}</p>
            )}
          </section>
        </div>

        {message && <p className="app-inline-message">{message}</p>}
      </section>
    </main>
  );
}

export default AdminValidationApp;

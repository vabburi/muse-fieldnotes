"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { CloseOutRun } from "@/lib/closeout";
import { Section, type Box, type Claim, type FollowUp, type Job, type Source } from "@/lib/model";
import type { Segmentation } from "@/lib/sam";

import { AgentPanel } from "./agent-panel";
import { Unlock } from "./unlock";

interface Selected {
  sourceId: string;
  region?: { phrase?: string; box?: Box };
}

export function JobView({ job }: { job: Job }) {
  const [run, setRun] = useState<CloseOutRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  // Lines edited by hand in this session; they stay in place whatever the verifier says.
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; text: string; checking: boolean } | null>(null);

  const loadCloseOut = useCallback(() => {
    fetch(`/api/jobs/${job.id}/closeout`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setRun)
      .finally(() => setLoading(false));
  }, [job.id]);
  useEffect(loadCloseOut, [loadCloseOut]);

  const clear = useCallback(() => {
    setRun(null);
    setSelected(null);
    setEdited(new Set());
    setEditing(null);
  }, []);
  // A new note from the agent replaces the old one, hand edits included.
  const reloadAgentNote = useCallback(() => {
    clear();
    loadCloseOut();
  }, [clear, loadCloseOut]);

  async function generate() {
    setGenerating(true);
    setError(null);
    setSelected(null);
    setEdited(new Set());
    setEditing(null);
    try {
      const res = await fetch(`/api/jobs/${job.id}/closeout`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setRun(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  const sources = useMemo(
    () => new Map([...job.sources, ...(run?.derived ?? [])].map((s) => [s.id, s])),
    [job.sources, run?.derived],
  );

  const claims = run?.closeOut.claims ?? [];
  const kept = claims.filter((c) => c.status !== "unsupported" || edited.has(c.id));
  const dropped = claims.filter((c) => c.status === "unsupported" && !edited.has(c.id));

  // Footnote numbers: each source gets a number the first time a kept line cites it.
  const numbers = useMemo(() => {
    const map = new Map<string, number>();
    for (const claim of kept) for (const c of claim.citations) if (!map.has(c.source)) map.set(c.source, map.size + 1);
    return map;
  }, [kept]);

  // Re-check one hand-edited line with the same code checks and verifier, keeping its citations.
  async function checkEdit(claim: Claim) {
    if (!run || !editing) return;
    const text = editing.text.trim();
    if (!text || text === claim.text) return setEditing(null);
    setEditing({ ...editing, checking: true });
    try {
      const res = await fetch(`/api/jobs/${job.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claims: [{ section: claim.section, text, citations: claim.citations }] }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const checked: Claim = { ...body.claims[0], id: claim.id };
      const asks = (body.followUps as FollowUp[]).map((f) => ({ ...f, about: claim.id }));
      setRun({
        ...run,
        closeOut: {
          ...run.closeOut,
          claims: run.closeOut.claims.map((c) => (c.id === claim.id ? checked : c)),
          followUps: [...run.closeOut.followUps.filter((f) => f.about !== claim.id), ...asks],
        },
      });
      setEdited(new Set(edited).add(claim.id));
      setEditing(null);
    } catch (err) {
      setError((err as Error).message);
      setEditing({ ...editing, checking: false });
    }
  }

  function select(claim: Claim, sourceId: string) {
    const source = sources.get(sourceId);
    // A nameplate reading shows its photo, highlighted with the region the line gave that photo.
    const photoId = source?.kind === "nameplate" ? source.derivedFrom : sourceId;
    setSelected({ sourceId, region: claim.citations.find((c) => c.source === photoId)?.region });
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <article className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <Link href="/" className="text-sm text-zinc-500">
            ← Jobs
          </Link>
          <span className="font-mono text-xs text-zinc-500">{job.id}</span>
          <h1 className="text-2xl font-semibold leading-tight">{job.title}</h1>
        </header>

        <Unlock />
        <AgentPanel job={job} onNote={reloadAgentNote} onStart={clear} />

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={generate}
            disabled={generating}
            className="rounded border border-zinc-300 px-3 py-1 text-sm disabled:opacity-50 dark:border-zinc-700"
          >
            {generating ? "Writing close-out…" : "Quick close-out (one pass, no questions)"}
          </button>
          {run && (
            <span className="text-xs text-zinc-500">
              {run.agentRunId ? "Written by the agent with" : "Drafted by"} {run.closeOut.model} in{" "}
              {(run.timings.draft / 1000).toFixed(1)} s
              {run.verifier && (
                <>
                  {" "}
                  · checked by Muse Spark Open on {hostsOf(run.verifier)} in {(run.verifier.ms / 1000).toFixed(1)} s
                </>
              )}
            </span>
          )}
        </div>
        {error && <p className="text-red-600">{error}</p>}
        {loading && <p className="text-zinc-500">Loading…</p>}
        {!loading && !run && !generating && (
          <p className="text-zinc-500">No note yet. {job.sources.length} sources are ready.</p>
        )}

        {run && (
          <>
            {Section.options.map((section) => {
              const lines = kept.filter((c) => c.section === section);
              if (lines.length === 0) return null;
              return (
                <section key={section}>
                  <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{section}</h2>
                  <ul className="flex flex-col gap-1.5">
                    {lines.map((claim) => (
                      <li key={claim.id} className="leading-relaxed">
                        {editing?.id === claim.id ? (
                          <span className="flex flex-col gap-1">
                            <textarea
                              value={editing.text}
                              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                              disabled={editing.checking}
                              rows={2}
                              autoFocus
                              className="w-full rounded border border-zinc-300 bg-transparent p-2 dark:border-zinc-700"
                            />
                            <span className="flex gap-2 text-sm">
                              <button
                                onClick={() => checkEdit(claim)}
                                disabled={editing.checking}
                                className="rounded bg-zinc-900 px-3 py-1 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                              >
                                {editing.checking ? "Checking…" : "Save and check"}
                              </button>
                              <button onClick={() => setEditing(null)} disabled={editing.checking} className="px-2 text-zinc-500">
                                Cancel
                              </button>
                            </span>
                          </span>
                        ) : (
                          <span
                            className={
                              claim.status === "partial"
                                ? "underline decoration-amber-400 decoration-wavy underline-offset-4"
                                : claim.status === "unsupported"
                                  ? "underline decoration-red-500 decoration-wavy underline-offset-4"
                                  : undefined
                            }
                          >
                            {claim.text}
                          </span>
                        )}{" "}
                        {claim.citations.map((c) => (
                          <button
                            key={c.source}
                            onClick={() => select(claim, c.source)}
                            className={`mx-0.5 rounded px-1 font-mono text-xs align-super ${
                              selected?.sourceId === c.source
                                ? "bg-amber-400 text-zinc-900"
                                : "bg-zinc-200 text-zinc-700 hover:bg-amber-200 dark:bg-zinc-800 dark:text-zinc-300"
                            }`}
                            aria-label={`Show source ${numbers.get(c.source)}`}
                          >
                            {numbers.get(c.source)}
                          </button>
                        ))}
                        <StatusMark claim={claim} />
                        {edited.has(claim.id) && <span className="ml-1 text-xs text-zinc-500">edited</span>}
                        {editing?.id !== claim.id && (
                          <button
                            onClick={() => setEditing({ id: claim.id, text: claim.text, checking: false })}
                            className="ml-1 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                            aria-label="Edit line"
                          >
                            edit
                          </button>
                        )}
                        {claim.status !== "verified" && claim.reason && (
                          <span className="block text-xs text-zinc-500">{claim.reason}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}

            {run.closeOut.followUps.length > 0 && (
              <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950">
                <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  Questions for the technician
                </h2>
                <ul className="list-disc pl-5">
                  {run.closeOut.followUps.map((f) => (
                    <li key={f.question}>{f.question}</li>
                  ))}
                </ul>
              </section>
            )}

            {dropped.length > 0 && (
              <details className="text-sm text-zinc-500">
                <summary>Dropped by the checks ({dropped.length})</summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {dropped.map((c) => (
                    <li key={c.id}>
                      <s>{c.text}</s> — {c.reason}{" "}
                      <span className="whitespace-nowrap text-xs">
                        ({c.check?.by === "verifier" ? `Muse Spark Open on ${HOSTS[c.check.provider ?? "baseten"]}` : "code check"})
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {run.verifier && <VerifierLog run={run} claims={claims} />}

            <section className="border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Sources</h2>
              <ol className="flex flex-col gap-0.5">
                {[...numbers].map(([id, n]) => (
                  <li key={id}>
                    <button onClick={() => setSelected({ sourceId: id })} className="text-left hover:underline">
                      <span className="font-mono">[{n}]</span> {label(sources.get(id))}
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </article>

      {selected && (
        <aside className="fixed inset-x-0 bottom-0 z-10 max-h-[75vh] overflow-auto rounded-t-2xl border-t border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 md:sticky md:top-8 md:inset-auto md:max-h-[calc(100vh-4rem)] md:self-start md:rounded-2xl md:border md:shadow-none">
          <Evidence
            job={job}
            source={sources.get(selected.sourceId)}
            number={numbers.get(selected.sourceId)}
            region={selected.region}
            sources={sources}
            onClose={() => setSelected(null)}
          />
        </aside>
      )}
    </div>
  );
}

// The same open-weights model runs on three hosts; the verifier fails over between them.
const HOSTS = { baseten: "Baseten", fireworks: "Fireworks", modal: "Modal" } as const;

function hostsOf(log: NonNullable<CloseOutRun["verifier"]>): string {
  const used = Object.keys(log.providers ?? { baseten: 1 }) as (keyof typeof HOSTS)[];
  return used.map((h) => HOSTS[h]).join(" + ") || "Baseten";
}

function StatusMark({ claim }: { claim: Claim }) {
  const marks = {
    verified: { text: "✓", className: "text-emerald-600", title: "Checked against its sources" },
    partial: { text: "partly supported", className: "text-amber-700 dark:text-amber-400", title: "" },
    unverified: { text: "not checked", className: "text-zinc-500", title: "" },
    unsupported: { text: "not supported", className: "text-red-600", title: "" },
  } as const;
  if (!(claim.status in marks)) return null;
  const mark = marks[claim.status as keyof typeof marks];
  return (
    <span title={claim.reason ?? mark.title} className={`ml-1 text-xs font-medium ${mark.className}`}>
      {mark.text}
    </span>
  );
}

// The verifier's trail: which host checked each line, its request id and tokens.
function VerifierLog({ run, claims }: { run: CloseOutRun; claims: Claim[] }) {
  const log = run.verifier!;
  const checked = claims.filter((c) => c.check?.by === "verifier");
  const count = (status: Claim["status"]) => checked.filter((c) => c.status === status).length;
  return (
    <details className="text-xs text-zinc-500">
      <summary>
        Verifier log: {count("verified")} verified, {count("partial")} partial, {count("unsupported")} dropped
        {log.failed > 0 && `, ${log.failed} not checked`}
      </summary>
      <p className="mt-2">
        Muse Spark Open on {hostsOf(log)} · {log.calls} checks ({log.cached} cached
        {log.failedOver > 0 && `, ${log.failedOver} failed over`}) · {log.tokens.prompt.toLocaleString()} in /{" "}
        {log.tokens.completion.toLocaleString()} out tokens
      </p>
      <table className="mt-2 w-full table-fixed text-left">
        <tbody>
          {checked.map((c) => (
            <tr key={c.id} className="border-t border-zinc-200 align-top dark:border-zinc-800">
              <td className="w-10 py-1 font-mono">{c.id}</td>
              <td className="w-24 py-1">{c.status}</td>
              <td className="py-1">{c.reason}</td>
              <td className="w-20 py-1">{HOSTS[c.check?.provider ?? "baseten"]}</td>
              <td className="hidden w-56 truncate py-1 font-mono md:table-cell" title={c.check?.requestId}>
                {c.check?.cached ? "cached" : c.check?.requestId}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function label(source: Source | undefined): string {
  if (!source) return "Unknown source";
  const who = source.author.name;
  switch (source.kind) {
    case "photo":
      return `Photo by ${who}${source.caption ? `: ${source.caption}` : ""}`;
    case "voice":
      return `Voice note by ${who}`;
    case "text":
      return `Message from ${who}`;
    case "record":
      return `${who} record`;
    case "nameplate":
      return `Nameplate reading from photo ${source.derivedFrom}`;
  }
}

function time(at: string) {
  return new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Evidence(props: {
  job: Job;
  source: Source | undefined;
  number: number | undefined;
  region?: { phrase?: string; box?: Box };
  sources: Map<string, Source>;
  onClose: () => void;
}) {
  const { job, source, number, region, sources, onClose } = props;
  if (!source) return null;
  const photo = source.kind === "nameplate" ? sources.get(source.derivedFrom) : source;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-zinc-500">
            [{number ?? "?"}] {source.id} · {time(source.at)}
          </p>
          <p className="font-medium">{label(source)}</p>
        </div>
        <button onClick={onClose} className="rounded px-2 text-xl leading-none text-zinc-500" aria-label="Close">
          ×
        </button>
      </div>

      {source.kind === "voice" && source.audio && (
        <audio controls preload="none" src={`/api/jobs/${job.id}/audio/${source.audio.file}`} className="w-full" />
      )}

      {(source.kind === "text" || source.kind === "voice" || source.kind === "record") && (
        <blockquote className="border-l-4 border-amber-400 pl-3 leading-relaxed">{source.text}</blockquote>
      )}
      {source.kind === "voice" && source.audio && (
        <p className="text-xs text-zinc-500">Transcribed by Muse Voice Transcribe</p>
      )}

      {source.kind === "nameplate" && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
          {Object.entries(source.fields).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-zinc-500">{k}</dt>
              <dd className="font-mono">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {photo?.kind === "photo" && <HighlightedPhoto key={`${photo.id}:${JSON.stringify(region ?? null)}`} job={job} photo={photo} region={region} />}
    </div>
  );
}

function HighlightedPhoto({
  job,
  photo,
  region,
}: {
  job: Job;
  photo: Extract<Source, { kind: "photo" }>;
  region?: { phrase?: string; box?: Box };
}) {
  const phrase = region?.phrase;
  // Stable dependency for the effect: the region's content, not its object identity.
  const target = region && (region.box || region.phrase) ? JSON.stringify(region) : null;
  // The parent keys this component by region, so a new citation mounts fresh state.
  const [result, setResult] = useState<Segmentation | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(target ? "loading" : "idle");

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    fetch(`/api/jobs/${job.id}/highlight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: photo.id, file: photo.photo.file, ...JSON.parse(target) }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body: Segmentation) => {
        if (!cancelled) {
          setResult(body);
          setState("done");
        }
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [job.id, photo.id, photo.photo.file, target]);

  return (
    <figure className="flex flex-col gap-1">
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element -- served from our own API */}
        <img
          src={`/api/jobs/${job.id}/photos/${photo.photo.file}`}
          alt={photo.caption ?? "Job photo"}
          width={photo.photo.width}
          height={photo.photo.height}
          className="block h-auto w-full rounded"
        />
        {result && result.objects.length > 0 && (
          <svg
            viewBox={`0 0 ${photo.photo.width} ${photo.photo.height}`}
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            {result.objects.map((o) => (
              <path
                key={o.id}
                d={o.path}
                transform={o.transform}
                fill="rgb(251 191 36 / 0.45)"
                stroke="rgb(251 191 36)"
                strokeWidth={3}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        )}
      </div>
      {target && (
        <figcaption className="text-xs text-zinc-500">
          {state === "loading" && `Highlighting${phrase ? ` “${phrase}”` : ""}…`}
          {state === "done" &&
            (result?.objects.length
              ? `SAM 3.1 highlighted${phrase ? ` “${phrase}”` : " the cited part"} in ${result.ms} ms`
              : "No highlight found; showing the photo.")}
          {state === "error" && "Highlight unavailable; showing the photo."}
        </figcaption>
      )}
    </figure>
  );
}

"use client";

import { ChevronDown, Info } from "lucide-react";
import type { Research, ResearchFinding } from "@/lib/types";
import { quarterlyComparisons } from "@/lib/periods";
import { financialNumber } from "@/lib/presentation";
import { date, pct, SourceLink } from "./common";
import { FinnAvatar } from "./Brand";

export function ResearchAnswer({
  answer,
  documents = [],
}: {
  answer: Research;
  documents?: { id: string; url: string }[];
}) {
  const groups = [
    { title: "Key findings", items: answer.key_findings },
    {
      title: "Management commentary",
      items: answer.management_commentary ?? [],
    },
    { title: "Positive considerations", items: answer.positive_factors ?? [] },
    { title: "Risks to investigate", items: answer.risks ?? [] },
  ];
  const comparisons = quarterlyComparisons(answer.metrics).filter(
    (c) => c.values[0],
  );
  return (
    <section className="research-answer" aria-label="FINN research report">
      {answer.ai_status &&
        !["success", "offline"].includes(answer.ai_status) && (
          <div className="provider-notice" role="status">
            <Info size={17} />
            <div>
              <strong>
                Gemini response unavailable ·{" "}
                {answer.ai_status.replaceAll("_", " ")}
              </strong>
              <p>
                Cited source excerpts and deterministic calculations remain
                available below.
              </p>
            </div>
          </div>
        )}
      <div className="answer-heading">
        <div className="research-identity">
          <FinnAvatar />
          <div>
            <h3>FINN Research.</h3>
            <p>Evidence before opinion.</p>
          </div>
        </div>
        <span className="badge neutral">{answer.confidence} coverage</span>
      </div>
      <section className="report-section">
        <h3>Executive insight</h3>
        <p className="answer-summary">{answer.summary}</p>
      </section>
      <div className="answer-engine">
        <span className="status-dot" />
        {answer.engine}
        {answer.cached && " · cached result"}
      </div>
      <p className="table-note">
        AI execution: {answer.ai_status ?? "not reported"}
        {answer.generated_at ? ` · ${date(answer.generated_at)}` : ""}. Source
        checks establish linkage; interpretations require review.
      </p>
      {!!answer.metrics.length && (
        <section className="report-section">
          <h3>Reported financial findings</h3>
          <div className="table-scroll">
            <table className="report-metrics">
              <thead>
                <tr>
                  <th scope="col">Metric / basis</th>
                  <th scope="col">Reported value</th>
                  <th scope="col">Period / evidence</th>
                </tr>
              </thead>
              <tbody>
                {answer.metrics.map((m, i) => {
                  const source = answer.source_references.find(
                    (s) => s.document_id === m.document_id && s.page === m.page,
                  );
                  const original =
                    source?.url ??
                    documents.find((d) => d.id === m.document_id)?.url;
                  return (
                    <tr key={m.id ?? `${m.document_id}-${m.name}-${i}`}>
                      <th scope="row">
                        {m.name}
                        <small>{m.basis}</small>
                      </th>
                      <td>
                        {financialNumber(m.value)}
                        <small>{m.unit}</small>
                      </td>
                      <td>
                        {m.period}
                        {original ? (
                          <SourceLink url={original} page={m.page}>
                            PDF p.{m.page}
                          </SourceLink>
                        ) : (
                          <small>
                            See the company source library · PDF p.{m.page}
                          </small>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {!!comparisons.length && (
        <section className="report-section">
          <h3>Comparable quarter movements</h3>
          <div className="table-scroll">
            <table className="report-metrics">
              <thead>
                <tr>
                  <th scope="col">Metric / period</th>
                  <th scope="col">QoQ</th>
                  <th scope="col">YoY</th>
                </tr>
              </thead>
              <tbody>
                {comparisons.map((c, i) => (
                  <tr key={i}>
                    <th scope="row">
                      {c.name}
                      <small>
                        {c.periods[0]} · {c.values[0]?.basis} ·{" "}
                        {c.values[0]?.unit}
                      </small>
                    </th>
                    <td>{pct(c.qoq)}</td>
                    <td>{pct(c.yoy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="table-note">
            Existing period and accounting-basis rules apply. Unavailable
            comparisons are shown as —.
          </p>
        </section>
      )}
      {groups
        .filter((g) => g.items.length)
        .map((group) => (
          <section className="report-section" key={group.title}>
            <h3>
              {group.title}
              <span className="report-section-count">{group.items.length}</span>
            </h3>
            {group.items.map((finding, i) => (
              <Finding
                key={`${group.title}-${i}`}
                finding={finding}
                answer={answer}
                index={i}
              />
            ))}
          </section>
        ))}
      {!!answer.source_references.length && (
        <section className="report-section">
          <h3>Primary-source references</h3>
          <div className="report-sources">
            {answer.source_references.map((s) => (
              <div key={s.id}>
                <span className="badge neutral">{s.id}</span>
                <div>
                  <strong>{s.title}</strong>
                  <p>
                    {s.period} · PDF page {s.page}
                  </p>
                  <SourceLink url={s.url} page={s.page}>
                    Inspect original document
                  </SourceLink>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <details className="limitations" open={answer.confidence === "low"}>
        <summary>
          <Info size={14} />
          Evidence limitations
          <ChevronDown size={13} />
        </summary>
        <ul>
          {answer.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        {answer.confidence_basis && <p>{answer.confidence_basis}</p>}
      </details>
    </section>
  );
}
function Finding({
  finding,
  answer,
  index,
}: {
  finding: ResearchFinding;
  answer: Research;
  index: number;
}) {
  const label = finding.excerpt
    ? "Primary source excerpt"
    : finding.evidence_type === "calculated"
      ? "Calculated · comparable source inputs"
      : finding.evidence_type === "reported"
        ? "Reported fact · source linkage checked"
        : finding.evidence_type === "commentary"
          ? "Management commentary"
          : "Model interpretation · inspect evidence";
  return (
    <details className="finding" open={index === 0}>
      <summary>
        <span className="finding-index">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div>
          <strong>
            {finding.text.length > 160
              ? finding.text.slice(0, 157) + "…"
              : finding.text}
          </strong>
          <span>
            {finding.source_ids
              .map((id) => {
                const s = answer.source_references.find((s) => s.id === id);
                return s ? `${id} · ${s.period} · PDF p.${s.page}` : id;
              })
              .join(" / ")}
          </span>
        </div>
        <ChevronDown size={14} />
      </summary>
      <div className="finding-body">
        <p className="table-note">{label}</p>
        <p className={finding.excerpt ? "source-excerpt" : ""}>
          {finding.text}
        </p>
        {finding.evidence_excerpt && (
          <blockquote className="source-excerpt">
            {finding.evidence_excerpt}
          </blockquote>
        )}
        {finding.uncertainty_note &&
          finding.uncertainty_note.toLowerCase() !== "none" && (
            <p className="table-note">{finding.uncertainty_note}</p>
          )}
        <div className="finding-links">
          {finding.source_ids.map((id) => {
            const s = answer.source_references.find((s) => s.id === id);
            return s ? (
              <SourceLink key={id} url={s.url} page={s.page}>
                {id} · Inspect original PDF page {s.page}
              </SourceLink>
            ) : null;
          })}
        </div>
      </div>
    </details>
  );
}

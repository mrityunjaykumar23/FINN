import announcementSources from "../data/announcement-sources.json";
import { quarterlyComparisons, selectMetric } from "./periods";
import {
  db,
  all,
  one,
  run,
  sha,
  ApiError,
  lock,
  unlock,
} from "../db/repository";
import {
  type Filing,
  type Guidance,
  type Metric,
  defaultSettings,
  rank,
  evaluateMarket,
  compareGuidance,
} from "./domain";
import {
  getDocument,
  getPoints,
  resolveCompany,
  ingestPdf,
  yahooMarket,
  storeMarket,
} from "./server";
import { extractDocument, providerStatus, classifyWithAi } from "./ai/service";
import {
  analyzeMateriality,
  categoryForEvent,
  eventEvidence,
  normalizeEvidence,
} from "./event-analysis";
import { supportsEvent } from "./event-evidence";

export async function persistFiling(
  f: Filing,
  mode = "live",
  method = "rules",
) {
  const doc = await getDocument(f.document_id);
  if (
    !doc ||
    doc.ticker !== f.ticker ||
    !doc.pages.some((p) => p.page === f.evidence_page)
  )
    throw new ApiError(
      422,
      "invalid_evidence",
      "A matching company source and indexed evidence page are required.",
    );
  const signature = f.event_signature ?? `legacy:${f.id}`;
  const hash = await sha(`${f.ticker}:${doc.hash}:${signature}`),
    score = rank(f, defaultSettings).score;
  const result = await run(
    `INSERT INTO announcements(id,ticker,hash,document_id,date,payload,headline,category,summary,why_it_matters,published_at,detected_at,source_url,classification_method,classification_confidence,materiality_score,materiality_reason,severity,magnitude,novelty,evidence_coverage,verification_status,ingestion_mode,event_signature,exchange_filing_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash,event_signature=excluded.event_signature,exchange_filing_id=excluded.exchange_filing_id,payload=excluded.payload,headline=excluded.headline,category=excluded.category,summary=excluded.summary,why_it_matters=excluded.why_it_matters,published_at=excluded.published_at,source_url=excluded.source_url,classification_method=excluded.classification_method,classification_confidence=excluded.classification_confidence,materiality_score=excluded.materiality_score,materiality_reason=excluded.materiality_reason,severity=excluded.severity,magnitude=excluded.magnitude,novelty=excluded.novelty,evidence_coverage=excluded.evidence_coverage`,
    f.id,
    f.ticker,
    hash,
    f.document_id,
    f.date,
    JSON.stringify(f),
    f.headline,
    f.category,
    f.summary,
    f.why,
    f.published_at ?? f.date,
    new Date().toISOString(),
    doc.url,
    method,
    f.confidence,
    score,
    "Severity + magnitude + portfolio relevance + novelty + evidence",
    f.severity,
    f.magnitude,
    f.novelty,
    f.evidence,
    "source_linked",
    mode,
    signature,
    f.exchange_filing_id ?? null,
  );
  return result.meta.changes;
}
export async function seedGuidance(rows: Guidance[]) {
  for (const [i, g] of rows.entries()) {
    const id = `seed-guidance-${i}`,
      actualId = `seed-actual-${i}`;
    if (await one("SELECT id FROM guidance_statements WHERE id=?", id))
      continue;
    const doc = await getDocument(g.guidance_document),
      actualDoc = await getDocument(g.actual_document);
    const quote =
      doc?.pages.find((p) => p.page === g.guidance_page)?.text ?? "";
    const actualQuote =
      actualDoc?.pages.find((p) => p.page === g.actual_page)?.text ?? "";
    if (!doc || !actualDoc || !quote || !actualQuote)
      throw new ApiError(
        503,
        "seed_evidence_missing",
        "Guidance seed requires both primary sources.",
      );
    await db().batch([
      db()
        .prepare(
          `INSERT OR IGNORE INTO financial_metrics(id,ticker,name,value,period,unit,basis,document_id,page,evidence_text,verification_status,extraction_method,updated_at,fiscal_year) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          actualId,
          g.ticker,
          g.metric,
          g.actual,
          g.actual_period,
          "%",
          g.actual_basis,
          g.actual_document,
          g.actual_page,
          actualQuote,
          "reviewed",
          "reviewed_seed",
          new Date().toISOString(),
          Number(g.actual_period.match(/FY(\d{4})/)?.[1]) || null,
        ),
      db()
        .prepare(
          `INSERT OR IGNORE INTO guidance_statements(id,ticker,metric,statement_text,guidance_type,target_min,target_max,unit,basis,stated_at,target_period,document_id,page,relevant_quote,qualifiers,extraction_confidence,verification_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          id,
          g.ticker,
          g.metric,
          quote,
          "range",
          g.low,
          g.high,
          "%",
          g.basis,
          "2025-01-16",
          g.period,
          g.guidance_document,
          g.guidance_page,
          quote,
          g.qualifier,
          1,
          "reviewed",
        ),
    ]);
  }
}
type Statement = {
  id: string;
  ticker: string;
  metric: string;
  target_period: string;
  basis: string;
  unit: string;
  target_min: number | null;
  target_max: number | null;
  document_id: string;
  page: number;
  qualifiers: string;
  guidance_type: string;
  revision_of: string | null;
  stated_at: string | null;
};
export async function guidanceRows(ticker?: string) {
  const statements = await all<Statement>(
    `SELECT * FROM guidance_statements WHERE verification_status IN ('reviewed','source_checked','verified') ${ticker ? "AND ticker=?" : ""} ORDER BY stated_at DESC,id`,
    ...(ticker ? [ticker] : []),
  );
  return Promise.all(
    statements.map(async (s) => {
      const actualRows = await all<Metric>(
        "SELECT m.*,d.published_at FROM financial_metrics m JOIN documents d ON d.id=m.document_id WHERE m.ticker=? AND name=? AND m.period=? AND basis=? AND unit=? AND value IS NOT NULL AND verification_status IN (?,?,?)",
        s.ticker,
        s.metric,
        s.target_period,
        s.basis,
        s.unit,
        "reviewed",
        "source_checked",
        "verified",
      );
      const actual = selectMetric(actualRows, s.metric, s.target_period);
      const superseded = statements.some((g) => g.revision_of === s.id);
      const g: Guidance = {
        id: s.id,
        ticker: s.ticker,
        metric: s.metric,
        period: s.target_period,
        basis: s.basis,
        unit: s.unit,
        guidance_type: s.guidance_type,
        low: s.target_min ?? s.target_max!,
        high: s.target_max ?? s.target_min!,
        actual: actual?.value ?? NaN,
        actual_period: actual?.period ?? "",
        actual_basis: actual?.basis ?? "",
        guidance_document: s.document_id,
        guidance_page: s.page,
        actual_document: actual?.document_id ?? "",
        actual_page: actual?.page ?? 0,
        qualifier:
          s.qualifiers +
          (superseded ? " Superseded by a later cited revision." : ""),
        revised: !!s.revision_of,
      };
      const result = compareGuidance(g);
      if (actual)
        await run(
          "INSERT INTO guidance_comparisons(id,statement_id,metric_id,status,variance,explanation,compared_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(statement_id,metric_id) DO UPDATE SET status=excluded.status,variance=excluded.variance,explanation=excluded.explanation,compared_at=excluded.compared_at",
          `${s.id}:${actual.id}`,
          s.id,
          actual.id,
          result.status,
          result.variance,
          result.explanation,
          new Date().toISOString(),
        );
      const sources = [];
      for (const loc of [
        { id: s.document_id, page: s.page },
        ...(actual ? [{ id: actual.document_id, page: actual.page }] : []),
      ]) {
        const d = await getDocument(loc.id);
        sources.push({
          document_id: loc.id,
          title: d?.title ?? "Unavailable",
          url: d?.url ?? "",
          page: loc.page,
          period: d?.period ?? "",
          text: d?.pages.find((p) => p.page === loc.page)?.text ?? "",
        });
      }
      return {
        ...g,
        ...result,
        status: superseded ? "Superseded guidance" : result.status,
        explanation: superseded
          ? "A later source supersedes this target. Historical comparison: " +
            result.explanation
          : result.explanation,
        sources,
        stated_at: s.stated_at,
        superseded,
      };
    }),
  );
}
export async function evaluateAlerts(
  owner: string,
  mode = "live",
  start?: string,
  end?: string,
) {
  const preferences = await one<{ settings: string }>(
    "SELECT settings FROM alert_preferences WHERE owner=?",
    owner,
  );
  const settings = preferences
    ? JSON.parse(preferences.settings)
    : structuredClone(defaultSettings);
  const companies = await all<{ ticker: string }>(
    "SELECT ticker FROM portfolio_companies WHERE owner=?",
    owner,
  );
  const now = new Date().toISOString(),
    statements: D1PreparedStatement[] = [];
  for (const c of companies) {
    const points = await getPoints(c.ticker, mode);
    const from = start ?? points.at(-1)?.date ?? now.slice(0, 10),
      to = end ?? points.at(-1)?.date ?? now.slice(0, 10);
    for (const [i, p] of points.entries()) {
      if (p.date < from || p.date > to) continue;
      for (const a of evaluateMarket(
        c.ticker,
        points.slice(0, i + 1),
        settings,
      )) {
        const id = `${owner}:${mode}:${a.id}`;
        statements.push(
          db()
            .prepare(
              "INSERT INTO alerts(id,owner,payload,triggered_at,ticker,event_type,rule_id,event_reference,observed_at,priority,evidence_reference,mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
            )
            .bind(
              id,
              owner,
              JSON.stringify(a),
              now,
              c.ticker,
              a.type,
              a.type,
              a.id,
              p.date,
              50,
              `market/${c.ticker}?mode=${mode}`,
              mode,
            ),
        );
      }
    }
    const events = await all<{ id: string; payload: string }>(
      "SELECT id,payload FROM announcements WHERE ticker=? AND ingestion_mode=? AND date>=? AND date<=? AND json_extract(payload,'$.canonical_event_id') IS NULL",
      c.ticker,
      mode,
      start ?? "0000",
      end ?? now.slice(0, 10),
    );
    for (const event of events) {
      const f = JSON.parse(event.payload) as Filing,
        r = rank(f, settings);
      if (
        r.score < settings.min_priority ||
        !settings.enabled_categories.includes(f.category)
      )
        continue;
      const a = {
        id: event.id,
        ticker: f.ticker,
        type: "filing",
        date: f.date,
        text: f.summary,
        threshold: settings.min_priority,
        value: r.score,
      };
      statements.push(
        db()
          .prepare(
            "INSERT OR IGNORE INTO alerts(id,owner,payload,triggered_at,ticker,event_type,rule_id,event_reference,announcement_id,observed_at,priority,evidence_reference,mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            `${owner}:${mode}:filing:${event.id}`,
            owner,
            JSON.stringify(a),
            now,
            f.ticker,
            "filing",
            "materiality",
            event.id,
            event.id,
            f.date,
            r.score,
            f.document_id,
            mode,
          ),
      );
    }
  }
  for (let i = 0; i < statements.length; i += 50)
    await db().batch(statements.slice(i, i + 50));
  return {
    evaluated: companies.length,
    qualifying_events: statements.length,
    mode,
  };
}
export async function evaluateAll(
  mode = "live",
  refreshMarket = false,
  requestedTickers?: string[],
  ownerAfter = "",
) {
  const marketResults: { ticker: string; status: string; error?: string }[] =
    [];
  if (refreshMarket && mode === "live") {
    const tickers =
      requestedTickers ??
      (
        await all<{ ticker: string }>(
          "SELECT DISTINCT ticker FROM portfolio_companies ORDER BY ticker LIMIT 30",
        )
      ).map((c) => c.ticker);
    for (const ticker of tickers) {
      try {
        await resolveCompany(ticker);
        await trackSync("market", ticker, async () => {
          const data = await yahooMarket(ticker);
          const counts = await storeMarket(ticker, data);
          return {
            discovered: data.points.length,
            ...counts,
            freshness: data.freshness,
          };
        });
        marketResults.push({ ticker, status: "success" });
      } catch (e) {
        marketResults.push({
          ticker,
          status: "failed",
          error: e instanceof ApiError ? e.code : "source_unavailable",
        });
      }
    }
  }
  const owners = await all<{ id: string }>(
    "SELECT id FROM owners WHERE initialized_at IS NOT NULL AND id>? ORDER BY id LIMIT 31",
    ownerAfter,
  );
  const results = [];
  for (const o of owners.slice(0, 30))
    results.push(await evaluateAlerts(o.id, mode));
  return {
    owners: Math.min(30, owners.length),
    results,
    market_sync: marketResults,
    next_owner_cursor: owners.length > 30 ? owners[29].id : null,
  };
}
export async function trackSync<
  T extends { discovered?: number; inserted?: number; duplicates?: number },
>(provider: string, ticker: string, work: () => Promise<T>, cooldown = true) {
  const key = `sync:${provider}:${ticker}`;
  if (!(await lock(key, 180000)))
    throw new ApiError(
      409,
      "sync_in_progress",
      "This company source is already being synchronized.",
    );
  const previous = await one<{ next_retry: string }>(
    "SELECT next_retry FROM source_sync WHERE provider=? AND ticker=?",
    provider,
    ticker,
  );
  if (
    cooldown &&
    previous?.next_retry &&
    previous.next_retry > new Date().toISOString()
  ) {
    await unlock(key);
    throw new ApiError(
      429,
      "sync_cooldown",
      "Source synchronization is cooling down. Inspect status for the next retry.",
    );
  }
  const id = crypto.randomUUID(),
    started = new Date().toISOString();
  await run(
    "INSERT INTO ingestion_runs(id,provider,ticker,started_at,status) VALUES (?,?,?,?,?)",
    id,
    provider,
    ticker,
    started,
    "running",
  );
  try {
    const result = await work(),
      finished = new Date().toISOString();
    await db().batch([
      db()
        .prepare(
          "UPDATE ingestion_runs SET status=?,finished_at=?,discovered=?,inserted=?,duplicates=? WHERE id=?",
        )
        .bind(
          (result as T & { status?: string }).status ?? "success",
          finished,
          result.discovered ?? 0,
          result.inserted ?? 0,
          result.duplicates ?? 0,
          id,
        ),
      db()
        .prepare(
          "INSERT INTO source_sync(provider,ticker,last_success,last_attempt,next_retry,status) VALUES (?,?,?,?,?,?) ON CONFLICT(provider,ticker) DO UPDATE SET last_success=coalesce(excluded.last_success,source_sync.last_success),last_attempt=excluded.last_attempt,next_retry=excluded.next_retry,status=excluded.status,error=NULL",
        )
        .bind(
          provider,
          ticker,
          ((result as T & { status?: string }).status ?? "success") ===
            "success"
            ? finished
            : null,
          started,
          new Date(Date.now() + 60000).toISOString(),
          (result as T & { status?: string }).status ?? "success",
        ),
    ]);
    await run(
      "UPDATE source_sync SET discovered=?,inserted=?,duplicates=?,cursor=coalesce(?,cursor) WHERE provider=? AND ticker=?",
      result.discovered ?? 0,
      result.inserted ?? 0,
      result.duplicates ?? 0,
      (result as T & { cursor?: string }).cursor ?? null,
      provider,
      ticker,
    );
    const info = result as T & {
      manual_required?: number;
      undated?: number;
      failures?: number;
      pending?: number;
      discovery_cursor?: string | null;
      coverage?: unknown;
      freshness?: unknown;
    };
    const details = JSON.stringify({
      coverage: info.coverage,
      freshness: info.freshness,
    });
    await db().batch([
      db()
        .prepare(
          "UPDATE source_sync SET manual_required=?,failures=?,pending=?,discovery_cursor=?,details=? WHERE provider=? AND ticker=?",
        )
        .bind(
          info.manual_required ?? info.undated ?? 0,
          info.failures ?? 0,
          info.pending ?? 0,
          info.discovery_cursor ?? null,
          details,
          provider,
          ticker,
        ),
      db()
        .prepare("UPDATE ingestion_runs SET details=? WHERE id=?")
        .bind(
          JSON.stringify({
            manual_required: info.manual_required ?? info.undated ?? 0,
            failures: info.failures ?? 0,
            pending: info.pending ?? 0,
            ...JSON.parse(details),
          }),
          id,
        ),
    ]);
    return { ...result, run_id: id };
  } catch (e) {
    const message =
      e instanceof ApiError
        ? e.message
        : `Source operation failed (${e instanceof Error && ["TimeoutError", "TypeError", "AbortError"].includes(e.name) ? e.name : "source_or_storage_error"}); no successful empty result was recorded.`;
    await db().batch([
      db()
        .prepare(
          "UPDATE ingestion_runs SET status=?,finished_at=?,error=? WHERE id=?",
        )
        .bind("failed", new Date().toISOString(), message, id),
      db()
        .prepare(
          "INSERT INTO source_sync(provider,ticker,last_attempt,next_retry,status,error,failures) VALUES (?,?,?,?,?,?,1) ON CONFLICT(provider,ticker) DO UPDATE SET last_attempt=excluded.last_attempt,next_retry=excluded.next_retry,status=excluded.status,error=excluded.error,failures=source_sync.failures+1",
        )
        .bind(
          provider,
          ticker,
          started,
          new Date(Date.now() + 120000).toISOString(),
          "failed",
          message,
        ),
    ]);
    throw e;
  } finally {
    await unlock(key);
  }
}
export async function importFiling(input: {
  ticker: string;
  document_id?: string;
  url?: string;
  headline: string;
  date: string;
  evidence_page: number;
  mode: "historical" | "live";
  reprocess?: boolean;
  event_quote?: string;
  exchange_filing_id?: string;
  category?: import("./domain").Category;
  source_provider?: string;
  publication_precision?: string;
  publication_timezone?: string;
  source_timestamp?: string;
}) {
  await resolveCompany(input.ticker);
  const known = input.document_id
    ? { id: input.document_id }
    : await one<{ id: string }>(
        "SELECT id FROM documents WHERE ticker=? AND url=?",
        input.ticker,
        input.url ?? "",
      );
  const id =
    known?.id ?? (await ingestPdf(input.ticker, input.url!, input.headline));
  const doc = await getDocument(id),
    page = doc?.pages.find((p) => p.page === input.evidence_page);
  if (!doc || doc.ticker !== input.ticker || !page)
    throw new ApiError(
      422,
      "invalid_evidence",
      "A valid matching company source page is required.",
    );
  const rule = categoryForEvent(input.headline, input.event_quote ?? page.text);
  if (input.category) rule.category = input.category;
  let quote: string;
  try {
    quote = eventEvidence(page.text, rule.category, input.event_quote);
  } catch {
    throw new ApiError(
      422,
      "invalid_event_quote",
      "The event quote must occur verbatim on the cited source page.",
    );
  }
  if (!supportsEvent(rule.category, quote))
    throw new ApiError(
      422,
      "event_requires_review",
      "The selected category has no verified supporting passage on this page.",
    );
  const signature = await sha(`${rule.category}:${normalizeEvidence(quote)}`);
  // Reconcile legacy records lazily, preserving their public IDs and alert foreign keys.
  const matches = await all<{
    id: string;
    payload: string;
    event_signature: string;
  }>(
    "SELECT id,payload,event_signature FROM announcements WHERE ticker=? AND document_id=? AND json_extract(payload,'$.canonical_event_id') IS NULL AND (event_signature=? OR (((?=1 AND event_signature LIKE 'legacy:%') OR (?=1 AND coalesce(json_extract(payload,'$.event_scope'),'page_category')='page_category')) AND category=? AND json_extract(payload,'$.evidence_page')=?)) ORDER BY detected_at,id",
    input.ticker,
    id,
    signature,
    input.event_quote && !input.source_provider ? 0 : 1,
    input.event_quote && !input.source_provider ? 0 : 1,
    rule.category,
    page.page,
  );
  const prior = matches[0];
  if (matches.length > 1)
    await db().batch(
      matches
        .slice(1)
        .map((alias) =>
          db()
            .prepare(
              "UPDATE announcements SET event_signature=?,hash=?,payload=json_set(payload,'$.canonical_event_id',?) WHERE id=?",
            )
            .bind(`alias:${alias.id}`, `alias:${alias.id}`, prior.id, alias.id),
        ),
    );
  if (matches.length > 1) {
    // Preserve the strongest existing lifecycle state when historical aliases converge.
    for (const state of ["dismissed", "read"] as const)
      await run(
        "UPDATE alerts SET status=?,read_at=coalesce(read_at,(SELECT max(x.read_at) FROM alerts x JOIN announcements a ON a.id=x.announcement_id WHERE x.owner=alerts.owner AND json_extract(a.payload,'$.canonical_event_id')=?)),dismissed_at=coalesce(dismissed_at,(SELECT max(x.dismissed_at) FROM alerts x JOIN announcements a ON a.id=x.announcement_id WHERE x.owner=alerts.owner AND json_extract(a.payload,'$.canonical_event_id')=?)) WHERE announcement_id=? AND status IN (" +
          (state === "dismissed" ? "'unread','read'" : "'unread'") +
          ") AND EXISTS (SELECT 1 FROM alerts x JOIN announcements a ON a.id=x.announcement_id WHERE x.owner=alerts.owner AND x.mode=alerts.mode AND x.status=? AND json_extract(a.payload,'$.canonical_event_id')=?)",
        state,
        prior.id,
        prior.id,
        prior.id,
        state,
        prior.id,
      );
  }
  if (prior && !input.reprocess) {
    await run(
      "UPDATE announcements SET event_signature=? WHERE id=?",
      signature,
      prior.id,
    );
    return {
      filing: JSON.parse(prior.payload) as Filing,
      discovered: 1,
      inserted: 0,
      duplicates: 1,
    };
  }
  return trackSync(
    "filing_import",
    input.ticker,
    async () => {
      let summary = quote.slice(0, 450),
        why = rule.rationale,
        method = "rules",
        confidence = rule.confidence;
      if (providerStatus().enabled) {
        try {
          const ai = await classifyWithAi(input.ticker, [
            {
              id: "F1",
              document_id: id,
              ticker: input.ticker,
              page: page.page,
              text: quote.slice(0, 5000),
              period: doc.period,
            },
          ]);
          // The selected event category is source-scoped; a multi-event PDF cannot silently change it.
          if (
            ai.category === rule.category ||
            rule.category === "unclassified"
          ) {
            summary = ai.summary.claim;
            why = ai.why_it_matters.claim;
            confidence = String(ai.confidence);
            method = "gemini";
          }
        } catch {
          why +=
            " Gemini classification unavailable or rejected; source excerpt and rules shown.";
        }
      }
      const scaleMetrics = await all<Metric>(
        "SELECT m.*,d.published_at FROM financial_metrics m JOIN documents d ON d.id=m.document_id AND d.ticker=m.ticker WHERE m.ticker=? AND m.verification_status<>'unverified'",
        input.ticker,
      );
      const materiality = analyzeMateriality(rule.category, quote, {
        ticker: input.ticker,
        date: input.date,
        metrics: scaleMetrics,
      });
      const filing: Filing = {
        id:
          prior?.id ??
          (await sha(`${input.ticker}:${doc.hash}:${signature}`)).slice(0, 24),
        ticker: input.ticker,
        headline: input.headline,
        date: input.date,
        date_precision: "Source-supplied publication date; time not verified",
        category: rule.category,
        summary,
        why: why + " " + materiality.reasons.join(" "),
        document_id: id,
        evidence_page: page.page,
        confidence,
        severity: materiality.severity,
        magnitude: materiality.magnitude,
        novelty: materiality.novelty,
        evidence: materiality.evidence,
        event_signature: signature,
        source_provider: input.source_provider ?? "verified_admin",
        publication_precision: input.publication_precision ?? "date",
        publication_timezone: input.publication_timezone,
        published_at: input.source_timestamp,
        exchange_filing_id: input.exchange_filing_id,
        event_quote: quote,
        event_scope: input.event_quote ? "explicit" : "page_category",
        materiality_attributes: materiality.attributes,
        materiality_reasons: materiality.reasons,
        questions: [
          "What changed in this disclosure?",
          "What financial guidance is supported?",
        ],
      };
      await persistFiling(filing, input.mode, method);
      await run(
        "UPDATE documents SET published_at=coalesce(published_at,?) WHERE id=?",
        input.date,
        id,
      );
      const extraction = await extractDocument(input.ticker, id).catch(() => ({
        status: "provider_failed",
        metrics: 0,
        guidance: 0,
      }));
      return {
        filing,
        extraction,
        discovered: 1,
        inserted: prior ? 0 : 1,
        duplicates: prior ? 1 : 0,
      };
    },
    false,
  );
}
export async function systemStatus(owner?: string) {
  return {
    database: "SQLite / D1",
    ai: providerStatus(),
    snapshot: "2025-04-22",
    counts: await one(
      "SELECT (SELECT count(*) FROM companies) companies,(SELECT count(*) FROM documents) documents,(SELECT count(*) FROM document_chunks) chunks,(SELECT count(*) FROM announcements) announcements,(SELECT count(*) FROM financial_metrics) metrics,(SELECT count(*) FROM guidance_statements) guidance",
    ),
    sync: await all(
      "SELECT * FROM source_sync ORDER BY last_attempt DESC LIMIT 50",
    ),
    indexing: await all(
      "SELECT ticker,status,count(*) documents FROM discovery_candidates GROUP BY ticker,status",
    ),
    monitored_companies: (
      await all<{ ticker: string }>(
        `SELECT DISTINCT ticker FROM portfolio_companies ${owner ? "WHERE owner=?" : ""}`,
        ...(owner ? [owner] : []),
      )
    ).filter((c) =>
      announcementSources.some(
        (s) =>
          s.ticker === c.ticker &&
          (!("scope_end" in s) ||
            String(s.scope_end) >= new Date().toISOString().slice(0, 10)),
      ),
    ).length,
    document_jobs: await all(
      "SELECT status,count(*) n FROM document_jobs GROUP BY status",
    ),
    recent_runs: await all(
      "SELECT * FROM ingestion_runs ORDER BY started_at DESC LIMIT 20",
    ),
    ai_operations: await one(
      "SELECT count(*) requests,sum(cache_hit) cache_hits,sum(input_tokens) input_tokens,sum(output_tokens) output_tokens,sum(status='failed') failures,round(avg(duration_ms)) mean_duration_ms FROM ai_operations",
    ),
    coverage_note:
      "Successful source imports and checks are listed individually. Absence of a successful check is unknown coverage, never proof of no filings.",
  };
}

export async function persistComparisons(ticker: string, rows: Metric[]) {
  const statements: D1PreparedStatement[] = [];
  for (const c of quarterlyComparisons(rows)) {
    for (const [index, name, value] of [
      [1, "QoQ growth", c.qoq],
      [2, "YoY growth", c.yoy],
    ] as const) {
      const current = c.values[0],
        base = c.values[index];
      if (!current || !base || value === null) continue;
      const label = `${c.name} ${name}`,
        id = await sha(`${label}:${current.id}:${base.id}`);
      statements.push(
        db()
          .prepare(
            "INSERT INTO metric_derivations(id,ticker,name,current_metric_id,base_metric_id,value,unit,formula,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE metric_derivations.value<>excluded.value",
          )
          .bind(
            id,
            ticker,
            label,
            current.id,
            base.id,
            value,
            "%",
            "(current - base) / base * 100",
            new Date().toISOString(),
          ),
      );
    }
  }
  if (statements.length) await db().batch(statements);
}

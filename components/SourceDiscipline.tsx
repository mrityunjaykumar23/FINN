"use client";

import { ShieldCheck } from "lucide-react";

import { Modal } from "./common";
export function SourceDiscipline({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Evidence, before opinion." onClose={onClose}>
      <div className="source-discipline">
        <ShieldCheck size={35} />
        <p className="source-intro">
          FINN separates what the source says, what the calculation shows, and
          what still needs investigation.
        </p>
        <section>
          <h3>What is in the demo</h3>
          <p>
            18 Yahoo-validated Indian portfolio tickers, 576 real daily price
            and volume observations from March–April 2025, and an archived
            primary-source library covering Infosys, HCLTech, Asian Paints,
            Persistent Systems, and Avenue Supermarts.
          </p>
        </section>
        <section>
          <h3>The important coverage gap</h3>
          <p>
            The briefing replays selected official Infosys and HCLTech
            disclosures. It is a curated, limited snapshot, not every exchange
            filing for all 18 companies. Missing coverage does not mean no
            announcement occurred.
          </p>
        </section>
        <section>
          <h3>Research uses primary documents</h3>
          <p>
            Company results, annual reports, and earnings-call transcripts
            support research. Screener is used only to discover links to
            original documents. No news, broker notes, or model memory is used
            as company evidence.
          </p>
        </section>
        <section>
          <h3>How intelligence is generated</h3>
          <p>
            Without a model key, FINN retrieves and displays original source
            passages and deterministic financial comparisons. A configurable
            server-side provider can add citation-constrained synthesis. Source
            text is untrusted data and cannot execute actions.
          </p>
        </section>
        <section>
          <h3>Daily data, precisely labelled</h3>
          <p>
            Price change uses adjusted closes. Relative volume divides a
            session’s volume by the average of the prior N sessions. The
            observed day is excluded from its baseline. Current-day live
            observations are excluded to avoid incomplete sessions.
          </p>
        </section>
        <section>
          <h3>The promise tracker</h3>
          <p>
            January 2025 revised guidance is compared with FY2025 results on
            matching definitions and periods. Differences are percentage points
            against the nearest boundary, not percentage price forecasts.
          </p>
        </section>
        <section>
          <h3>Limits are part of the evidence</h3>
          <p>
            The historical library is not current investment advice. Large
            annual reports index selected relevant pages. Missing data,
            incompatible periods, and failed external requests remain explicit.
            Live exchange ingestion requires an administrator token.
          </p>
        </section>
      </div>
    </Modal>
  );
}

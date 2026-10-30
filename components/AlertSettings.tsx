"use client";

import { categories } from "@/lib/domain";
import type { Company, Settings } from "@/lib/types";
import {
  Activity,
  BriefcaseBusiness,
  Check,
  Clock3,
  FileText,
  Info,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { api, ErrorBox, labels, short, Skeleton } from "./common";
export function AlertSettings({
  companies,
  onSave,
}: {
  companies: Company[];
  onSave: () => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [dirty, setDirty] = useState(false),
    [company, setCompany] = useState("");
  useEffect(() => {
    api<Settings>("alerts/settings")
      .then(setSettings)
      .catch((e) => setError(e.message));
  }, []);
  const update = (key: keyof Settings, value: Settings[keyof Settings]) => {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
    setDirty(true);
  };
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError("");
    try {
      await api("alerts/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setDirty(false);
      onSave();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const setCompanyRule = (
    key: "price_threshold" | "volume_multiplier",
    value: string,
  ) => {
    if (!settings || !company) return;
    const rules = { ...settings.company_rules };
    const rule = { ...rules[company] };
    if (!value) delete rule[key];
    else rule[key] = Number(value);
    if (!Object.keys(rule).length) delete rules[company];
    else rules[company] = rule;
    update("company_rules", rules);
  };
  return (
    <>
      <div className="page-heading compact">
        <div>
          <div className="eyebrow">YOUR ATTENTION, YOUR RULES</div>
          <h1>
            Define
            <br />
            <em>the unusual.</em>
          </h1>
          <p>
            Decide what earns an interruption. FINN checks the stored data for
            you.
          </p>
        </div>
        <span className="badge neutral">
          <Clock3 size={12} />
          END-OF-DAY ALERTS
        </span>
      </div>
      {error && <ErrorBox message={error} />}{" "}
      {!settings ? (
        <Skeleton rows={3} />
      ) : (
        <form className="settings-form" onSubmit={save}>
          <section className="settings-section">
            <div className="settings-section-title">
              <Activity size={21} />
              <div>
                <h2>Market movement</h2>
                <p>
                  Evaluate completed daily sessions. No intraday or phone push
                  monitoring.
                </p>
              </div>
            </div>
            <div className="settings-field">
              <div>
                <label htmlFor="price-threshold">
                  Absolute daily price move
                </label>
                <p>
                  Trigger when the adjusted close moves at least this much in
                  either direction.
                </p>
              </div>
              <div className="number-input">
                <span>±</span>
                <input
                  id="price-threshold"
                  type="number"
                  min="0.1"
                  max="100"
                  step="0.1"
                  required
                  value={settings.price_threshold}
                  onChange={(e) =>
                    update("price_threshold", Number(e.target.value))
                  }
                />
                <span>%</span>
              </div>
            </div>
            <div className="settings-field">
              <div>
                <label htmlFor="volume-threshold">Relative volume</label>
                <p>
                  Compare the session’s trading volume with the previous
                  sessions’ average.
                </p>
              </div>
              <div className="number-input">
                <input
                  id="volume-threshold"
                  type="number"
                  min="1"
                  max="50"
                  step="0.1"
                  required
                  value={settings.volume_multiplier}
                  onChange={(e) =>
                    update("volume_multiplier", Number(e.target.value))
                  }
                />
                <span>×</span>
              </div>
            </div>
            <div className="settings-field">
              <div>
                <label htmlFor="lookback">Volume lookback</label>
                <p>
                  Only prior sessions count. An incomplete baseline returns
                  “Unavailable”.
                </p>
              </div>
              <div className="number-input">
                <input
                  id="lookback"
                  type="number"
                  min="5"
                  max="60"
                  step="1"
                  required
                  value={settings.volume_lookback}
                  onChange={(e) =>
                    update("volume_lookback", Number(e.target.value))
                  }
                />
                <span>days</span>
              </div>
            </div>
            <div className="rule-preview">
              <Activity size={15} />
              <p>
                Alert when daily movement is ≥{" "}
                <strong>±{settings.price_threshold}%</strong> or volume is ≥{" "}
                <strong>{settings.volume_multiplier}×</strong> the average of
                the previous <strong>{settings.volume_lookback}</strong>{" "}
                sessions.
              </p>
            </div>
          </section>
          <section className="settings-section">
            <div className="settings-section-title">
              <FileText size={21} />
              <div>
                <h2>The filings you care about</h2>
                <p>
                  Selected categories influence relevance and the briefing
                  filter.
                </p>
              </div>
            </div>
            <div className="category-grid">
              {categories.map((c) => (
                <label
                  key={c}
                  className={
                    settings.enabled_categories.includes(c) ? "checked" : ""
                  }
                >
                  <input
                    type="checkbox"
                    checked={settings.enabled_categories.includes(c)}
                    onChange={() =>
                      update(
                        "enabled_categories",
                        settings.enabled_categories.includes(c)
                          ? settings.enabled_categories.filter((x) => x !== c)
                          : [...settings.enabled_categories, c],
                      )
                    }
                  />
                  <span className="checkbox-visual">
                    <Check size={11} />
                  </span>
                  {labels[c]}
                </label>
              ))}
            </div>
            <div className="settings-field priority-setting">
              <div>
                <label htmlFor="min-priority">Minimum attention score</label>
                <p>
                  Lower-scoring updates remain available in the collapsed
                  section.
                </p>
              </div>
              <div>
                <div className="range-value">
                  <span>
                    {settings.min_priority >= 75
                      ? "Critical"
                      : settings.min_priority >= 50
                        ? "Important"
                        : settings.min_priority >= 25
                          ? "Watch"
                          : "All filings"}
                  </span>
                  <strong>{settings.min_priority}/100</strong>
                </div>
                <input
                  id="min-priority"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={settings.min_priority}
                  onChange={(e) =>
                    update("min_priority", Number(e.target.value))
                  }
                />
              </div>
            </div>
          </section>
          <section className="settings-section">
            <div className="settings-section-title">
              <BriefcaseBusiness size={21} />
              <div>
                <h2>Company-specific rules</h2>
                <p>
                  Optional overrides for companies that need a different lens.
                </p>
              </div>
            </div>
            <label className="company-rule-select">
              <span>Choose a portfolio company</span>
              <select
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              >
                <option value="">Select a company…</option>
                {companies.map((c) => (
                  <option value={c.ticker} key={c.ticker}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {company && (
              <div className="company-rule-fields">
                <label>
                  Daily move (%)
                  <input
                    type="number"
                    min="0.1"
                    max="100"
                    step="0.1"
                    placeholder={`Inherit ${settings.price_threshold}`}
                    value={
                      settings.company_rules[company]?.price_threshold ?? ""
                    }
                    onChange={(e) =>
                      setCompanyRule("price_threshold", e.target.value)
                    }
                  />
                </label>
                <label>
                  Relative volume (×)
                  <input
                    type="number"
                    min="1"
                    max="50"
                    step="0.1"
                    placeholder={`Inherit ${settings.volume_multiplier}`}
                    value={
                      settings.company_rules[company]?.volume_multiplier ?? ""
                    }
                    onChange={(e) =>
                      setCompanyRule("volume_multiplier", e.target.value)
                    }
                  />
                </label>
              </div>
            )}
            {Object.keys(settings.company_rules).length > 0 && (
              <div className="rule-tags">
                {Object.entries(settings.company_rules).map(([t, rule]) => (
                  <span key={t}>
                    {short(t)} ·{" "}
                    {rule.price_threshold ? `±${rule.price_threshold}% ` : ""}
                    {rule.volume_multiplier ? `${rule.volume_multiplier}×` : ""}
                    <button
                      type="button"
                      aria-label={`Remove override for ${t}`}
                      onClick={() => {
                        const rules = { ...settings.company_rules };
                        delete rules[t];
                        update("company_rules", rules);
                      }}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>
          <div className="settings-save">
            <span>
              {dirty
                ? "You have unsaved changes."
                : "Rules are saved to your workspace."}
            </span>
            <button
              className="primary-button"
              type="submit"
              disabled={saving || !dirty}
            >
              {saving ? (
                <RefreshCw className="spin" size={16} />
              ) : (
                <Check size={16} />
              )}
              Save alert rules
            </button>
          </div>
          <p className="coverage-note">
            <Info size={14} />
            Alerts are evaluated when the briefing is opened or data is
            ingested. This prototype has no continuous scheduler or phone
            notification service.
          </p>
        </form>
      )}
    </>
  );
}

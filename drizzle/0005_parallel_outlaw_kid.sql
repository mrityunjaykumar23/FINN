CREATE INDEX `metrics_guidance_actual` ON `financial_metrics` (`ticker`,`name`,`period`,`basis`,`unit`);
--> statement-breakpoint
CREATE TRIGGER comparable_guidance_insert BEFORE INSERT ON guidance_comparisons
WHEN NOT EXISTS (
 SELECT 1 FROM guidance_statements g JOIN financial_metrics m ON m.id=NEW.metric_id
 WHERE g.id=NEW.statement_id AND g.ticker=m.ticker AND g.metric=m.name
 AND g.target_period=m.period AND g.basis=m.basis AND g.unit=m.unit
 AND g.verification_status IN ('reviewed','source_checked','verified')
 AND m.verification_status IN ('reviewed','source_checked','verified') AND m.value IS NOT NULL
)
BEGIN SELECT RAISE(ABORT,'Incomparable guidance evidence'); END;

--> statement-breakpoint
CREATE TRIGGER comparable_derivation_insert BEFORE INSERT ON metric_derivations
WHEN NOT EXISTS (
 SELECT 1 FROM financial_metrics a JOIN financial_metrics b ON b.id=NEW.base_metric_id
 WHERE a.id=NEW.current_metric_id AND a.ticker=NEW.ticker AND b.ticker=NEW.ticker
 AND a.name=b.name AND a.unit=b.unit AND a.basis=b.basis
 AND (a.currency IS NULL OR b.currency IS NULL OR a.currency=b.currency)
 AND a.verification_status <> 'unverified' AND b.verification_status <> 'unverified'
)
BEGIN SELECT RAISE(ABORT,'Incomparable derived metric evidence'); END;

--> statement-breakpoint
CREATE TRIGGER comparable_guidance_update BEFORE UPDATE ON guidance_comparisons
WHEN NOT EXISTS (
 SELECT 1 FROM guidance_statements g JOIN financial_metrics m ON m.id=NEW.metric_id
 WHERE g.id=NEW.statement_id AND g.ticker=m.ticker AND g.metric=m.name
 AND g.target_period=m.period AND g.basis=m.basis AND g.unit=m.unit
 AND g.verification_status IN ('reviewed','source_checked','verified')
 AND m.verification_status IN ('reviewed','source_checked','verified') AND m.value IS NOT NULL
)
BEGIN SELECT RAISE(ABORT,'Incomparable guidance evidence'); END;

--> statement-breakpoint
CREATE TRIGGER comparable_derivation_update BEFORE UPDATE ON metric_derivations
WHEN NOT EXISTS (
 SELECT 1 FROM financial_metrics a JOIN financial_metrics b ON b.id=NEW.base_metric_id
 WHERE a.id=NEW.current_metric_id AND a.ticker=NEW.ticker AND b.ticker=NEW.ticker
 AND a.name=b.name AND a.unit=b.unit AND a.basis=b.basis
 AND (a.currency IS NULL OR b.currency IS NULL OR a.currency=b.currency)
 AND a.verification_status <> 'unverified' AND b.verification_status <> 'unverified'
)
BEGIN SELECT RAISE(ABORT,'Incomparable derived metric evidence'); END;

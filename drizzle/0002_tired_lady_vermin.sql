CREATE INDEX `prices_ticker_mode_date` ON `daily_prices` (`ticker`,`mode`,`date`);
--> statement-breakpoint
UPDATE alerts SET ticker=CASE WHEN EXISTS(SELECT 1 FROM companies WHERE ticker=json_extract(alerts.payload,'$.ticker')) THEN json_extract(payload,'$.ticker') ELSE NULL END,event_type=coalesce(json_extract(payload,'$.type'),'legacy'),rule_id=json_extract(payload,'$.type'),event_reference=json_extract(payload,'$.id'),observed_at=json_extract(payload,'$.date'),priority=50,mode=CASE WHEN instr(id,':live:')>0 THEN 'live' ELSE 'historical' END WHERE event_type='legacy';
--> statement-breakpoint
CREATE TRIGGER metric_page_insert BEFORE INSERT ON financial_metrics WHEN NOT EXISTS(SELECT 1 FROM document_chunks WHERE document_id=new.document_id AND ticker=new.ticker AND page=new.page) BEGIN SELECT RAISE(ABORT,'metric source page is not indexed'); END;
--> statement-breakpoint
CREATE TRIGGER metric_page_update BEFORE UPDATE OF document_id,ticker,page ON financial_metrics WHEN NOT EXISTS(SELECT 1 FROM document_chunks WHERE document_id=new.document_id AND ticker=new.ticker AND page=new.page) BEGIN SELECT RAISE(ABORT,'metric source page is not indexed'); END;
--> statement-breakpoint
CREATE TRIGGER guidance_page_insert BEFORE INSERT ON guidance_statements WHEN NOT EXISTS(SELECT 1 FROM document_chunks WHERE document_id=new.document_id AND ticker=new.ticker AND page=new.page) BEGIN SELECT RAISE(ABORT,'guidance source page is not indexed'); END;
--> statement-breakpoint
CREATE TRIGGER guidance_page_update BEFORE UPDATE OF document_id,ticker,page ON guidance_statements WHEN NOT EXISTS(SELECT 1 FROM document_chunks WHERE document_id=new.document_id AND ticker=new.ticker AND page=new.page) BEGIN SELECT RAISE(ABORT,'guidance source page is not indexed'); END;
--> statement-breakpoint
CREATE TRIGGER preserve_referenced_page BEFORE DELETE ON document_chunks WHEN (SELECT count(*) FROM document_chunks WHERE document_id=old.document_id AND page=old.page)<=1 AND (EXISTS(SELECT 1 FROM financial_metrics WHERE document_id=old.document_id AND page=old.page) OR EXISTS(SELECT 1 FROM guidance_statements WHERE document_id=old.document_id AND page=old.page)) BEGIN SELECT RAISE(ABORT,'source page is referenced by financial evidence'); END;

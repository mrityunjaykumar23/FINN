-- Backup first: npm run db:backup. Run with no local server writing.
CREATE TABLE owners(id TEXT PRIMARY KEY NOT NULL,created_at TEXT NOT NULL,initialized_at TEXT);
--> statement-breakpoint
INSERT OR IGNORE INTO owners SELECT owner,datetime('now'),datetime('now') FROM portfolio_companies;
--> statement-breakpoint
INSERT OR IGNORE INTO owners SELECT owner,datetime('now'),datetime('now') FROM alert_preferences;
--> statement-breakpoint
INSERT OR IGNORE INTO owners SELECT owner,datetime('now'),datetime('now') FROM alerts;
--> statement-breakpoint
INSERT OR IGNORE INTO owners SELECT substr(key,7),datetime('now'),datetime('now') FROM meta WHERE key LIKE 'owner:%';
--> statement-breakpoint
CREATE TABLE companies_v2(ticker TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL,sector TEXT NOT NULL,validation TEXT NOT NULL,updated_at TEXT NOT NULL);
--> statement-breakpoint
INSERT INTO companies_v2(ticker,name,sector,validation,updated_at) SELECT ticker,name,sector,validation,updated_at FROM companies;
--> statement-breakpoint
CREATE TABLE documents_v2(id TEXT PRIMARY KEY NOT NULL,ticker TEXT NOT NULL REFERENCES companies_v2(ticker) ON DELETE RESTRICT,title TEXT NOT NULL,type TEXT NOT NULL,period TEXT NOT NULL,url TEXT NOT NULL,published_at TEXT,retrieved_at TEXT NOT NULL,hash TEXT NOT NULL UNIQUE,mode TEXT NOT NULL,publisher TEXT,extraction_status TEXT NOT NULL DEFAULT 'complete',total_pages INTEGER,indexed_pages INTEGER,UNIQUE(id,ticker));
--> statement-breakpoint
INSERT INTO documents_v2(id,ticker,title,type,period,url,published_at,retrieved_at,hash,mode) SELECT id,ticker,title,type,period,url,published_at,retrieved_at,hash,mode FROM documents;
--> statement-breakpoint
CREATE TABLE document_chunks_v2(id TEXT PRIMARY KEY NOT NULL,document_id TEXT NOT NULL,ticker TEXT NOT NULL,page INTEGER NOT NULL CHECK(page>0),text TEXT NOT NULL,FOREIGN KEY(document_id,ticker) REFERENCES documents_v2(id,ticker) ON DELETE CASCADE);
--> statement-breakpoint
INSERT INTO document_chunks_v2(id,document_id,ticker,page,text) SELECT id,document_id,ticker,page,text FROM document_chunks;
--> statement-breakpoint
CREATE TABLE portfolio_companies_v2(owner TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,ticker TEXT NOT NULL REFERENCES companies_v2(ticker) ON DELETE RESTRICT,created_at TEXT NOT NULL,PRIMARY KEY(owner,ticker));
--> statement-breakpoint
INSERT INTO portfolio_companies_v2(owner,ticker,created_at) SELECT owner,ticker,created_at FROM portfolio_companies;
--> statement-breakpoint
CREATE TABLE alert_preferences_v2(owner TEXT PRIMARY KEY NOT NULL REFERENCES owners(id) ON DELETE CASCADE,settings TEXT NOT NULL CHECK(json_valid(settings)));
--> statement-breakpoint
INSERT INTO alert_preferences_v2(owner,settings) SELECT owner,settings FROM alert_preferences;
--> statement-breakpoint
CREATE TABLE daily_prices_v2(ticker TEXT NOT NULL REFERENCES companies_v2(ticker) ON DELETE RESTRICT,date TEXT NOT NULL,close REAL NOT NULL CHECK(close>0),adjusted_close REAL NOT NULL CHECK(adjusted_close>0),volume REAL NOT NULL CHECK(volume>=0),source TEXT NOT NULL,retrieved_at TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('historical','live')),PRIMARY KEY(ticker,date,mode));
--> statement-breakpoint
INSERT INTO daily_prices_v2(ticker,date,close,adjusted_close,volume,source,retrieved_at,mode) SELECT ticker,date,close,adjusted_close,volume,source,retrieved_at,mode FROM daily_prices;
--> statement-breakpoint
CREATE TABLE announcements_v2(id TEXT PRIMARY KEY NOT NULL,ticker TEXT NOT NULL,hash TEXT NOT NULL UNIQUE,document_id TEXT NOT NULL,date TEXT NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),headline TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT 'unclassified',summary TEXT NOT NULL DEFAULT '',why_it_matters TEXT NOT NULL DEFAULT '',published_at TEXT,detected_at TEXT,source_url TEXT,classification_method TEXT NOT NULL DEFAULT 'human_reviewed',classification_confidence TEXT,materiality_score REAL NOT NULL DEFAULT 0,materiality_reason TEXT,severity REAL NOT NULL DEFAULT 0,magnitude REAL NOT NULL DEFAULT 0,novelty REAL NOT NULL DEFAULT 0,evidence_coverage REAL NOT NULL DEFAULT 0,verification_status TEXT NOT NULL DEFAULT 'source_linked',ingestion_mode TEXT NOT NULL DEFAULT 'historical',FOREIGN KEY(document_id,ticker) REFERENCES documents_v2(id,ticker) ON DELETE RESTRICT);
--> statement-breakpoint
INSERT INTO announcements_v2(id,ticker,hash,document_id,date,payload) SELECT id,ticker,hash,document_id,date,payload FROM announcements;
--> statement-breakpoint
CREATE TABLE financial_metrics_v2(id TEXT PRIMARY KEY NOT NULL,ticker TEXT NOT NULL,name TEXT NOT NULL,value REAL,period TEXT NOT NULL,unit TEXT NOT NULL,basis TEXT NOT NULL,document_id TEXT NOT NULL,page INTEGER NOT NULL CHECK(page>0),currency TEXT,scale TEXT,fiscal_year INTEGER,fiscal_quarter INTEGER CHECK(fiscal_quarter BETWEEN 1 AND 4),period_start TEXT,period_end TEXT,value_type TEXT NOT NULL DEFAULT 'reported',calculation_method TEXT,evidence_text TEXT NOT NULL DEFAULT '',extraction_method TEXT NOT NULL DEFAULT 'reviewed_seed',verification_status TEXT NOT NULL DEFAULT 'reviewed',updated_at TEXT NOT NULL DEFAULT '',FOREIGN KEY(document_id,ticker) REFERENCES documents_v2(id,ticker) ON DELETE RESTRICT);
--> statement-breakpoint
INSERT INTO financial_metrics_v2(id,ticker,name,value,period,unit,basis,document_id,page) SELECT id,ticker,name,value,period,unit,basis,document_id,page FROM financial_metrics;
--> statement-breakpoint
CREATE TABLE alerts_v2(id TEXT PRIMARY KEY NOT NULL,owner TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,payload TEXT NOT NULL CHECK(json_valid(payload)),triggered_at TEXT NOT NULL,ticker TEXT REFERENCES companies_v2(ticker) ON DELETE RESTRICT,event_type TEXT NOT NULL DEFAULT 'legacy',rule_id TEXT,event_reference TEXT,announcement_id TEXT REFERENCES announcements_v2(id) ON DELETE RESTRICT,observed_at TEXT,status TEXT NOT NULL DEFAULT 'unread' CHECK(status IN ('unread','read','dismissed')),read_at TEXT,dismissed_at TEXT,priority REAL NOT NULL DEFAULT 0,evidence_reference TEXT,mode TEXT NOT NULL DEFAULT 'historical' );
--> statement-breakpoint
INSERT INTO alerts_v2(id,owner,payload,triggered_at) SELECT id,owner,payload,triggered_at FROM alerts;
--> statement-breakpoint
CREATE TABLE analysis_cache_v2(key TEXT PRIMARY KEY NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),created_at TEXT NOT NULL,expires_at TEXT,ticker TEXT,document_version TEXT,metric_version TEXT,model TEXT,prompt_version TEXT,kind TEXT NOT NULL DEFAULT 'research' );
--> statement-breakpoint
INSERT INTO analysis_cache_v2(key,payload,created_at) SELECT key,payload,created_at FROM analysis_cache;
--> statement-breakpoint
DROP TABLE analysis_cache;
--> statement-breakpoint
DROP TABLE alerts;
--> statement-breakpoint
DROP TABLE financial_metrics;
--> statement-breakpoint
DROP TABLE announcements;
--> statement-breakpoint
DROP TABLE daily_prices;
--> statement-breakpoint
DROP TABLE alert_preferences;
--> statement-breakpoint
DROP TABLE portfolio_companies;
--> statement-breakpoint
DROP TABLE document_chunks;
--> statement-breakpoint
DROP TABLE documents;
--> statement-breakpoint
DROP TABLE companies;
--> statement-breakpoint
ALTER TABLE companies_v2 RENAME TO companies;
--> statement-breakpoint
ALTER TABLE documents_v2 RENAME TO documents;
--> statement-breakpoint
ALTER TABLE document_chunks_v2 RENAME TO document_chunks;
--> statement-breakpoint
ALTER TABLE portfolio_companies_v2 RENAME TO portfolio_companies;
--> statement-breakpoint
ALTER TABLE alert_preferences_v2 RENAME TO alert_preferences;
--> statement-breakpoint
ALTER TABLE daily_prices_v2 RENAME TO daily_prices;
--> statement-breakpoint
ALTER TABLE announcements_v2 RENAME TO announcements;
--> statement-breakpoint
ALTER TABLE financial_metrics_v2 RENAME TO financial_metrics;
--> statement-breakpoint
ALTER TABLE alerts_v2 RENAME TO alerts;
--> statement-breakpoint
ALTER TABLE analysis_cache_v2 RENAME TO analysis_cache;
--> statement-breakpoint
UPDATE announcements SET headline=json_extract(payload,'$.headline'),category=json_extract(payload,'$.category'),summary=json_extract(payload,'$.summary'),why_it_matters=json_extract(payload,'$.why'),published_at=date,detected_at=datetime('now'),classification_confidence=json_extract(payload,'$.confidence'),severity=json_extract(payload,'$.severity'),magnitude=json_extract(payload,'$.magnitude'),novelty=json_extract(payload,'$.novelty'),evidence_coverage=json_extract(payload,'$.evidence'),source_url=(SELECT url FROM documents WHERE id=document_id),materiality_score=min(100,coalesce(json_extract(payload,'$.severity'),0)+coalesce(json_extract(payload,'$.magnitude'),0)+15+coalesce(json_extract(payload,'$.novelty'),0)+coalesce(json_extract(payload,'$.evidence'),0));
--> statement-breakpoint
UPDATE financial_metrics SET currency=CASE WHEN unit LIKE 'INR%' THEN 'INR' END,scale=CASE WHEN unit LIKE '%crore%' THEN 'crore' END,fiscal_year=CAST(substr(period,instr(period,'FY')+2) AS INTEGER),fiscal_quarter=CASE WHEN period LIKE 'Q_ FY%' THEN CAST(substr(period,2,1) AS INTEGER) END,evidence_text=coalesce((SELECT text FROM document_chunks c WHERE c.document_id=financial_metrics.document_id AND c.page=financial_metrics.page LIMIT 1),''),updated_at=datetime('now');
--> statement-breakpoint
CREATE TABLE guidance_statements(id TEXT PRIMARY KEY,ticker TEXT NOT NULL,metric TEXT NOT NULL,statement_text TEXT NOT NULL,guidance_type TEXT NOT NULL CHECK(guidance_type IN ('range','minimum','maximum','target','approximate')),target_min REAL,target_max REAL,unit TEXT NOT NULL,basis TEXT NOT NULL,stated_at TEXT,target_period TEXT NOT NULL,document_id TEXT NOT NULL,page INTEGER NOT NULL CHECK(page>0),relevant_quote TEXT NOT NULL,qualifiers TEXT NOT NULL DEFAULT '',extraction_confidence REAL NOT NULL DEFAULT 0,verification_status TEXT NOT NULL DEFAULT 'source_checked',revision_of TEXT REFERENCES guidance_statements(id),FOREIGN KEY(document_id,ticker) REFERENCES documents(id,ticker) ON DELETE RESTRICT,UNIQUE(ticker,metric,target_period,document_id,page,basis));
--> statement-breakpoint
CREATE TABLE guidance_comparisons(id TEXT PRIMARY KEY,statement_id TEXT NOT NULL REFERENCES guidance_statements(id) ON DELETE CASCADE,metric_id TEXT NOT NULL REFERENCES financial_metrics(id) ON DELETE RESTRICT,status TEXT NOT NULL,variance REAL,explanation TEXT NOT NULL,compared_at TEXT NOT NULL,UNIQUE(statement_id,metric_id));
--> statement-breakpoint
CREATE TABLE ingestion_runs(id TEXT PRIMARY KEY,provider TEXT NOT NULL,ticker TEXT REFERENCES companies(ticker),started_at TEXT NOT NULL,finished_at TEXT,status TEXT NOT NULL,discovered INTEGER NOT NULL DEFAULT 0,inserted INTEGER NOT NULL DEFAULT 0,duplicates INTEGER NOT NULL DEFAULT 0,error TEXT);
--> statement-breakpoint
CREATE TABLE source_sync(provider TEXT NOT NULL,ticker TEXT NOT NULL REFERENCES companies(ticker),last_success TEXT,last_attempt TEXT,next_retry TEXT,status TEXT NOT NULL,error TEXT,PRIMARY KEY(provider,ticker));
--> statement-breakpoint
CREATE TABLE request_budgets(scope TEXT NOT NULL,bucket TEXT NOT NULL,used INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(scope,bucket));
--> statement-breakpoint
CREATE TABLE ai_operations(id TEXT PRIMARY KEY,ticker TEXT,task TEXT NOT NULL,model TEXT,status TEXT NOT NULL,created_at TEXT NOT NULL,duration_ms INTEGER NOT NULL DEFAULT 0,input_tokens INTEGER NOT NULL DEFAULT 0,output_tokens INTEGER NOT NULL DEFAULT 0,cache_hit INTEGER NOT NULL DEFAULT 0,error_code TEXT);
--> statement-breakpoint
CREATE TABLE job_locks(key TEXT PRIMARY KEY,expires_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX announcements_ticker_date ON announcements(ticker,published_at);
--> statement-breakpoint
CREATE INDEX announcements_category_priority ON announcements(category,materiality_score);
--> statement-breakpoint
CREATE INDEX announcements_mode_date ON announcements(ingestion_mode,published_at);
--> statement-breakpoint
CREATE INDEX documents_ticker_type_period ON documents(ticker,type,period);
--> statement-breakpoint
CREATE INDEX chunks_document_page ON document_chunks(document_id,page);
--> statement-breakpoint
CREATE INDEX metrics_comparable ON financial_metrics(ticker,name,period,basis);
--> statement-breakpoint
CREATE INDEX guidance_target ON guidance_statements(ticker,metric,target_period);
--> statement-breakpoint
CREATE INDEX alerts_owner_state_time ON alerts(owner,status,triggered_at);
--> statement-breakpoint
CREATE INDEX cache_expiry ON analysis_cache(expires_at);
--> statement-breakpoint
CREATE INDEX cache_document_version ON analysis_cache(ticker,document_version);
--> statement-breakpoint
CREATE INDEX runs_provider_ticker_time ON ingestion_runs(provider,ticker,started_at);
--> statement-breakpoint
CREATE VIRTUAL TABLE chunks_fts USING fts5(chunk_id UNINDEXED,text,tokenize='unicode61');
--> statement-breakpoint
INSERT INTO chunks_fts SELECT id,text FROM document_chunks;
--> statement-breakpoint
CREATE TRIGGER chunks_fts_insert AFTER INSERT ON document_chunks BEGIN INSERT INTO chunks_fts(chunk_id,text) VALUES(new.id,new.text); END;
--> statement-breakpoint
CREATE TRIGGER chunks_fts_delete AFTER DELETE ON document_chunks BEGIN DELETE FROM chunks_fts WHERE chunk_id=old.id; END;
--> statement-breakpoint
CREATE TRIGGER chunks_fts_update AFTER UPDATE OF text ON document_chunks BEGIN DELETE FROM chunks_fts WHERE chunk_id=old.id; INSERT INTO chunks_fts(chunk_id,text) VALUES(new.id,new.text); END;

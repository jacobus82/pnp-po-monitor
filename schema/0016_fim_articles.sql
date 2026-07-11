-- ---------------------------------------------------------------------------
-- FIM article-level waste (drill-down under a department on the Waste screen).
-- FIM exports carry per-article rows beneath each department; the ingest keeps
-- only department-level rows for performance. This table stores the small subset
-- of article rows that actually carry waste/shrink (~70 per daily file), so the
-- waste dept detail can drill down to the individual items driving the waste.
-- All amounts in Rand (mirrors fim_daily). dept_code is the rolled-up SAP dept
-- (CP-format files map their Category Portfolio to a dept at ingest).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fim_articles (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id      INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  report_date    TEXT    NOT NULL,          -- ISO YYYY-MM-DD (= date_from)
  date_from      TEXT    NOT NULL,
  date_to        TEXT    NOT NULL,
  dept_code      TEXT    NOT NULL,          -- rolled-up dept (F04, G12, …)
  article_code   TEXT    NOT NULL,
  article_desc   TEXT,
  net_sales_zar  REAL,
  shrink_zar     REAL,
  waste_zar      REAL,
  rtc_zar        REAL,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_fim_articles_dept    ON fim_articles(dept_code, date_from, date_to);
CREATE INDEX IF NOT EXISTS idx_fim_articles_article ON fim_articles(article_code);
CREATE INDEX IF NOT EXISTS idx_fim_articles_upload  ON fim_articles(upload_id);

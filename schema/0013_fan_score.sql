-- ---------------------------------------------------------------------------
-- Fan Score / NPS (Net Promoter Score) from the SAP/BusinessObjects
-- "Fan Score Store Report" export. Two tables:
--   fan_score_responses  one row per survey response (score 0-10 + reason)
--   fan_score_weeks      one summary row per week (the report's stated NPS TW/LW
--                        plus the counts/NPS we compute from the responses)
-- NPS bands: promoter 9-10, passive 7-8, detractor 0-6. NPS = (%promoters -
-- %detractors) over the SCORED responses (non-numeric answers are excluded).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fan_score_responses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id      INTEGER,
  week_ending    TEXT    NOT NULL,        -- ISO YYYY-MM-DD (Sunday, W/E)
  site_code      TEXT,
  score          INTEGER,                 -- 0-10; NULL for non-numeric answers
  classification TEXT,                    -- 'promoter' | 'passive' | 'detractor' | NULL
  reason         TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_fan_score_responses_week   ON fan_score_responses(week_ending);
CREATE INDEX IF NOT EXISTS idx_fan_score_responses_upload ON fan_score_responses(upload_id);

CREATE TABLE IF NOT EXISTS fan_score_weeks (
  week_ending      TEXT    PRIMARY KEY,    -- ISO YYYY-MM-DD; one summary per week
  upload_id        INTEGER,
  site_code        TEXT,
  nps_tw           REAL,                   -- reported NPS this week (%)
  nps_lw           REAL,                   -- reported NPS last week (%)
  total_responses  INTEGER,               -- all response rows (incl. non-numeric)
  scored_responses INTEGER,               -- rows with a numeric score
  promoters        INTEGER,
  passives         INTEGER,
  detractors       INTEGER,
  nps_computed     REAL,                   -- (promoters - detractors) / scored * 100
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_fan_score_weeks_upload ON fan_score_weeks(upload_id);

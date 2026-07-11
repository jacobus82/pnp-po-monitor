/**
 * Parser for the SAP/BusinessObjects "Fan Score Store Report" text export.
 *
 * The file carries, for one store/week:
 *   - a header with NPS TW / NPS LW percentages (e.g. "81.48%  61.54%"),
 *   - the week-ending date ("... W/E 08.03.2026"),
 *   - a block of individual responses under a "Score / Reason for the Score?"
 *     header: each line is `<score>\t<reason>` where score is 0-10 or blank.
 *
 * NPS bands: promoter 9-10, passive 7-8, detractor 0-6. Non-numeric answers
 * (e.g. "Highly likely") are kept as responses but have no score/classification.
 */
import { parseSapDate } from "./core";
import type { FanScoreParseResult, ParsedFanScoreResponse } from "../types";

export function classifyScore(score: number): "promoter" | "passive" | "detractor" {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

export function parseFanScoreFile(text: string, _filename: string): FanScoreParseResult {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/);

  // Week ending: "... W/E 08.03.2026" (day-first dotted date).
  let weekEnding: string | undefined;
  const we = text.match(/W\/E\s+(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})/i);
  if (we) weekEnding = parseSapDate(we[1]);
  if (!weekEnding) warnings.push("Could not find the week-ending (W/E) date.");

  // Site code: first NF##-style token (fallback: undefined).
  let siteCode: string | undefined;
  const site = text.match(/\b([A-Z]{2}\d{2,3})\b/);
  if (site) siteCode = site[1];

  // NPS TW / LW: the first line carrying two percentages (the region/store header).
  let npsTw: number | undefined;
  let npsLw: number | undefined;
  for (const line of lines.slice(0, 40)) {
    const pcts = line.match(/-?\d+(?:\.\d+)?(?=%)/g);
    if (pcts && pcts.length >= 2) {
      npsTw = Number(pcts[0]);
      npsLw = Number(pcts[1]);
      break;
    }
  }
  if (npsTw == null) warnings.push("Could not find the NPS TW / LW header percentages.");

  // Response block: everything after the "Reason for the Score?" header until the
  // trailing metadata sections ("FILTERS:", "QUERY INFORMATION:", "*** Query").
  const responses: ParsedFanScoreResponse[] = [];
  let inBlock = false;
  for (const raw of lines) {
    const line = raw.replace(/ /g, " ");
    if (/reason for the score/i.test(line)) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    if (/^\s*(FILTERS:|QUERY INFORMATION:|\*\*\*)/i.test(line)) break;
    if (line.trim() === "") continue;

    const cols = line.split("\t");
    const scoreRaw = (cols[0] ?? "").trim();
    const reason = (cols.slice(1).join(" ").trim()) || undefined;
    let score: number | undefined;
    if (/^\d{1,2}$/.test(scoreRaw)) {
      const n = Number(scoreRaw);
      if (n >= 0 && n <= 10) score = n;
    }
    // Skip lines that are neither a score nor a reason (stray separators).
    if (score == null && !reason) continue;
    const resp: ParsedFanScoreResponse = { reason };
    if (score != null) {
      resp.score = score;
      resp.classification = classifyScore(score);
    }
    responses.push(resp);
  }

  if (responses.length === 0) warnings.push("No survey responses were found in the report.");
  return { weekEnding, siteCode, npsTw, npsLw, responses, warnings };
}

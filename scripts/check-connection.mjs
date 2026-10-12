// Read-only timetable check: München Hbf → Hannover Hbf on 2026-12-18.
// This script NEVER books or buys anything — it only queries journey data.
//
// Why the ÖBB profile? Deutsche Bahn shut off its old HAFAS API, DB's own
// "vendo" backend blocks datacenter IPs (incl. GitHub runners, error
// OPS_BLOCKED), and the community wrapper v6.db.transport.rest is offline
// (HTTP 503). The Austrian railways (ÖBB) HAFAS contains the same German
// long-distance trains (ICE/IC/NightJet), needs no API key, and is
// reachable from CI runners. Verified Oct 2026.

import { writeFileSync, appendFileSync } from 'node:fs';
import { createClient } from 'hafas-client';
import { profile } from 'hafas-client/p/oebb/index.js';

const FROM = '8000261'; // München Hbf (EVA number)
const TO = '8000152'; // Hannover Hbf (EVA number)
const TRAVEL_DATE = '2026-12-18';
const DEPARTURE = new Date(`${TRAVEL_DATE}T08:00:00+01:00`);
const RESULTS = 8;

const client = createClient(profile, 'db-connection-check-github-action');

function legLine(leg) {
  return leg?.line?.name ?? (leg?.walking ? 'Fußweg' : '?');
}

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
  } catch {
    return iso ?? '?';
  }
}

function setOutput(name, value) {
  // Expose values to later workflow steps (subject/body of the mail).
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

let journeys = [];
let error = null;
try {
  const res = await client.journeys(FROM, TO, { departure: DEPARTURE, results: RESULTS });
  journeys = res.journeys ?? [];
} catch (err) {
  error = err?.message ?? String(err);
}

// Daytime departures (05:00–22:00 Berlin time) from the first leg.
// Rationale: before the mid-December timetable change is published,
// only night trains (departing ~23:00) are returned for 18.12.2026.
// Daytime ICE/IC connections appearing = timetable is out / bookable.
const daytime = journeys.filter((j) => {
  const h = Number(new Date(j.legs?.[0]?.departure).toLocaleString('en-GB', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    hour12: false,
  }));
  return h >= 5 && h < 22;
});

const status = error ? 'UNKNOWN' : daytime.length > 0 ? 'FOUND' : 'NOT_YET';
const checkedAt = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });

const lines = [];
lines.push(`# 🚂 München Hbf → Hannover Hbf am 18.12.2026 — Status: ${status}`);
lines.push('');
lines.push(`- Geprüft am: ${checkedAt} (Europe/Berlin)`);
lines.push(`- Reise: München Hbf (8000261) → Hannover Hbf (8000152), Abfahrt ab 08:00 am 18.12.2026`);
lines.push(`- Gefundene Verbindungen gesamt: ${journeys.length}, davon tagsüber (05–22 Uhr): ${daytime.length}`);
lines.push('');
if (error) {
  lines.push(`## ⚠️ Abfrage fehlgeschlagen`);
  lines.push('');
  lines.push(`Fehler: \`${error}\``);
  lines.push('Bitte Workflow-Log prüfen und ggf. manuell erneut starten (Actions → Run workflow).');
} else if (status === 'FOUND') {
  lines.push(`## ✅ Verbindungen verfügbar!`);
  lines.push('');
  lines.push('Der Fahrplan für den 18.12.2026 scheint veröffentlicht — bitte selbst auf bahn.de prüfen & buchen.');
  lines.push('');
  lines.push('| # | Abfahrt | Ankunft | Verbindung |');
  lines.push('|---|---------|---------|------------|');
  daytime.forEach((j, i) => {
    const legs = (j.legs ?? []).map((l) => `${legLine(l)} ${l.origin?.name ?? ''} → ${l.destination?.name ?? ''}`).join(' + ');
    lines.push(`| ${i + 1} | ${fmtTime(j.legs?.[0]?.departure)} | ${fmtTime(j.legs?.at(-1)?.arrival)} | ${legs} |`);
  });
} else {
  lines.push(`## ⏳ Noch nicht verfügbar`);
  lines.push('');
  lines.push('Für den 18.12.2026 sind tagsüber noch keine Verbindungen im Fahrplan.');
  lines.push('Das ist normal vor dem Fahrplanwechsel Mitte Dezember (neuer Fahrplan ca. Mitte Oktober).');
  lines.push('Der Check läuft täglich weiter — du bekommst eine Mail, sobald etwas gefunden wird.');
  if (journeys.length > 0) {
    lines.push('');
    lines.push('Hinweis: Es wurden nur Nachtverbindungen außerhalb der Tagzeiten gefunden:');
    journeys.forEach((j) => {
      lines.push(`- ${fmtTime(j.legs?.[0]?.departure)} → ${fmtTime(j.legs?.at(-1)?.arrival)} (${legLine(j.legs?.[0])})`);
    });
  }
}
lines.push('');
lines.push('Selbst prüfen & buchen (keine automatische Buchung durch diesen Check!): https://www.bahn.de');
lines.push('');
writeFileSync('status_report.md', lines.join('\n'), 'utf8');

setOutput('status', status);
setOutput('daytime_count', String(daytime.length));
setOutput('total_count', String(journeys.length));

console.log(`STATUS=${status} daytime=${daytime.length} total=${journeys.length}${error ? ` error=${error}` : ''}`);

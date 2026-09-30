"use strict";

// Petites dates "YYYY-MM-DD" (le format deja utilise pour invoice.date dans
// l'app) manipulees en arithmetique entiere UTC, jamais via un objet Date
// local : melanger les deux a deja cause un vrai bug de fuseau horaire dans
// Dashboard.jsx (Africa/Tunis, UTC+1). On applique ici la meme prudence.

function ymd(y, m, d) {
  return { y, m, d };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function isoOf({ y, m, d }) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** Index de jour (entier), comparable et soustrayable sans souci de fuseau. */
function dayIndex({ y, m, d }) {
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function daysBetween(a, b) {
  return dayIndex(b) - dayIndex(a);
}

function isValidYmd({ y, m, d }) {
  if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function fromIso(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(str || ""));
  if (!m) return null;
  const ymdObj = ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  return isValidYmd(ymdObj) ? ymdObj : null;
}

// Formats acceptes, dans cet ordre : dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy,
// yyyy-mm-dd, yyyy/mm/dd, dd/mm/yy, dd-mm-yy — reprend _FORMATS_DATE de
// statements.py.
function parseFlexible(brut) {
  brut = String(brut || "").trim();
  const m1 = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(brut);
  if (m1) {
    const cand = ymd(Number(m1[3]), Number(m1[2]), Number(m1[1]));
    if (isValidYmd(cand)) return cand;
  }
  const m2 = /^(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})$/.exec(brut);
  if (m2) {
    const cand = ymd(Number(m2[1]), Number(m2[2]), Number(m2[3]));
    if (isValidYmd(cand)) return cand;
  }
  const m3 = /^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2})$/.exec(brut);
  if (m3) {
    const cand = ymd(2000 + Number(m3[3]), Number(m3[2]), Number(m3[1]));
    if (isValidYmd(cand)) return cand;
  }
  return null;
}

/** Repere une sous-chaine "JJ/MM/AAAA" (ou variantes) n'importe ou dans le texte. */
function extractDate(valeur) {
  if (valeur instanceof Date) {
    return ymd(valeur.getFullYear(), valeur.getMonth() + 1, valeur.getDate());
  }
  const brut = String(valeur || "").trim();
  if (!brut) return null;
  const m = /(\d{1,4}[/\-.]\d{1,2}[/\-.]\d{2,4})/.exec(brut);
  if (!m) return null;
  return parseFlexible(m[1]);
}

module.exports = { ymd, isoOf, dayIndex, daysBetween, isValidYmd, fromIso, parseFlexible, extractDate };

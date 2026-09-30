"use strict";

/**
 * Lecture des releves de compte telecharges depuis BIATNET.
 *
 * Le format des exports n'est pas normalise d'une version du portail a
 * l'autre (BIAT en edite deux), donc ce module ne code en dur aucune
 * colonne : il repere la ligne d'entete en cherchant des mots-cles ("date",
 * "libelle", "credit", ...) puis en deduit le role de chaque colonne.
 *
 * Formats acceptes : .csv / .tsv / .xlsx / .xls / .pdf
 *
 * Port fidele de invoice-tracker/invoice_tracker/statements.py (l'ancien
 * outil Python), adapte a Node (SheetJS pour le xlsx, pdfjs-dist pour le
 * pdf, plus de position de mots faisant office d'equivalent a pdfplumber).
 */

const fs = require("node:fs");
const path = require("node:path");
const XLSX = require("xlsx");
const { ymd, isoOf, dayIndex, daysBetween, isValidYmd, extractDate } = require("./dateUtils");

// Mouvements internes : ils apparaissent au credit sans etre le reglement
// d'une facture.
const MOTIFS_INTERNES = [
  "deblocage",
  "blocage",
  "provision eng",
  "versement",
  "annulation",
  "extourne",
  "regularisation",
  "solde au",
  "report a nouveau",
];

// Mentions legales imprimees en pied de page, a ne pas coller au libelle.
const PIED_DE_PAGE = /depot|garanti|fonds de garantie|capital social|registre de commerce|matricule fiscal|siege social|www\.|\.tn\b/i;

function sansAccents(texte) {
  return String(texte ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function makeOperation(fields) {
  const libelle = fields.libelle || "";
  const estInterne = (() => {
    const t = sansAccents(libelle);
    return MOTIFS_INTERNES.some((motif) => t.includes(motif));
  })();
  return {
    banque: fields.banque,
    dateOperation: fields.dateOperation || null, // {y,m,d} | null
    dateValeur: fields.dateValeur || null,
    libelle,
    credit: fields.credit || 0,
    debit: fields.debit || 0,
    reference: fields.reference || "",
    source: fields.source || "",
    ligne: fields.ligne || 0,
    estInterne,
    get estEncaissement() {
      return this.credit > 0 && !this.estInterne;
    },
    get texteRecherche() {
      return `${this.libelle} ${this.reference}`;
    },
  };
}

// --------------------------------------------------------------------------
// Montants
// --------------------------------------------------------------------------

function montant(valeur) {
  if (valeur === null || valeur === undefined) return null;
  if (typeof valeur === "number") return valeur;

  let brut = String(valeur).trim();
  if (!brut) return null;

  const negatif = brut.startsWith("(") && brut.endsWith(")");
  if (negatif) brut = brut.slice(1, -1);
  brut = brut.replace(/[\s  ]/g, "");
  brut = brut.replace(/(TND|DT|DINARS?)/gi, "");

  if (brut.includes(",") && brut.includes(".")) {
    if (brut.lastIndexOf(",") > brut.lastIndexOf(".")) {
      brut = brut.replace(/\./g, "").replace(",", ".");
    } else {
      brut = brut.replace(/,/g, "");
    }
  } else if (brut.includes(",")) {
    brut = brut.replace(",", ".");
  }

  brut = brut.replace(/[^0-9.\-+]/g, "");
  if (!brut || ["-", "+", "."].includes(brut)) return null;
  const v = parseFloat(brut);
  if (Number.isNaN(v)) return null;
  return negatif ? -v : v;
}

// --------------------------------------------------------------------------
// Reconnaissance des colonnes (formats tabulaires : csv / xlsx)
// --------------------------------------------------------------------------

const MOTS = {
  date_operation: ["date operation", "date d'operation", "date compta", "date"],
  date_valeur: ["date valeur", "valeur"],
  libelle: ["libelle", "libelle operation", "description", "designation", "nature", "motif", "intitule", "operation"],
  reference: ["reference", "ref", "no piece", "num piece", "piece", "numero"],
  credit: ["credit", "recette", "encaissement", "entree", "au credit"],
  debit: ["debit", "depense", "decaissement", "sortie", "au debit"],
  montant: ["montant", "montant operation", "amount"],
  sens: ["sens", "type operation", "d/c", "c/d"],
};

function roleDeColonne(entete) {
  let titre = sansAccents(entete);
  titre = titre.replace(/[^a-z0-9 ]+/g, " ");
  titre = titre.replace(/\s+/g, " ").trim();
  if (!titre) return null;

  let meilleur = null;
  let meilleureTaille = 0;
  for (const [role, mots] of Object.entries(MOTS)) {
    for (const mot of mots) {
      if (titre === mot || titre.startsWith(mot + " ") || titre.endsWith(" " + mot)) {
        if (mot.length > meilleureTaille) {
          meilleur = role;
          meilleureTaille = mot.length;
        }
      } else if (titre.includes(mot) && mot.length > meilleureTaille) {
        meilleur = role;
        meilleureTaille = mot.length;
      }
    }
  }
  return meilleur;
}

function detecterEntete(lignes) {
  let meilleur = null; // [index, roles, score]
  for (let i = 0; i < Math.min(lignes.length, 40); i++) {
    const ligne = lignes[i];
    const roles = {};
    for (let j = 0; j < ligne.length; j++) {
      const r = roleDeColonne(String(ligne[j] ?? ""));
      if (r && !(r in roles)) roles[r] = j;
    }
    const aDate = "date_operation" in roles || "date_valeur" in roles;
    const aMontant = "credit" in roles || "debit" in roles || "montant" in roles;
    if (aDate && aMontant && "libelle" in roles) {
      const score = Object.keys(roles).length;
      if (meilleur === null || score > meilleur[2]) meilleur = [i, roles, score];
    }
  }
  return meilleur ? [meilleur[0], meilleur[1]] : null;
}

function ligneVersOperation(ligne, roles, banque, sourceName, numero) {
  const champ = (role) => {
    const idx = roles[role];
    if (idx === undefined || idx >= ligne.length) return null;
    return ligne[idx];
  };

  const dOp = extractDate(champ("date_operation"));
  const dVal = extractDate(champ("date_valeur"));
  if (dOp === null && dVal === null) return null;

  const libelle = String(champ("libelle") ?? "").trim();
  const reference = String(champ("reference") ?? "").trim();

  let credit = montant(champ("credit")) || 0;
  let debit = montant(champ("debit")) || 0;

  if (!credit && !debit) {
    const valeur = montant(champ("montant"));
    if (valeur === null) return null;
    const sens = sansAccents(String(champ("sens") ?? ""));
    if (sens.startsWith("d") || sens === "debit") debit = Math.abs(valeur);
    else if (sens.startsWith("c") || sens === "credit") credit = Math.abs(valeur);
    else if (valeur < 0) debit = Math.abs(valeur);
    else credit = valeur;
  }

  if (!credit && !debit) return null;

  return makeOperation({
    banque,
    dateOperation: dOp || dVal,
    dateValeur: dVal || dOp,
    libelle: libelle.replace(/\s+/g, " "),
    credit: Math.round(Math.abs(credit) * 1000) / 1000,
    debit: Math.round(Math.abs(debit) * 1000) / 1000,
    reference,
    source: sourceName,
    ligne: numero,
  });
}

// --------------------------------------------------------------------------
// Lecteurs par format
// --------------------------------------------------------------------------

function parseCsvLine(line, sep) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === sep) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function lignesCsv(chemin) {
  const buf = fs.readFileSync(chemin);
  let texte = buf.toString("utf-8");
  // Heuristique d'encodage : beaucoup de caracteres de remplacement U+FFFD
  // trahissent un fichier qui n'est pas de l'UTF-8 (exports BIATNET en
  // Windows-1252/Latin-1). "latin1" est l'approximation la plus proche
  // disponible nativement en Node.
  const remplacements = (texte.match(/�/g) || []).length;
  if (remplacements > 3) texte = buf.toString("latin1");

  const lignesTexte = texte.split(/\r\n|\r|\n/);
  const echantillon = lignesTexte.slice(0, 30).join("\n");
  const candidats = [";", ",", "\t", "|"];
  let separateur = ";";
  let meilleurCompte = -1;
  for (const c of candidats) {
    const compte = (echantillon.match(new RegExp(c === "\t" ? "\t" : `\\${c}`, "g")) || []).length;
    if (compte > meilleurCompte) {
      meilleurCompte = compte;
      separateur = c;
    }
  }
  return lignesTexte.filter((l) => l.length > 0).map((l) => parseCsvLine(l, separateur));
}

function lignesXlsx(chemin) {
  const classeur = XLSX.readFile(chemin, { cellDates: true });
  const lignes = [];
  for (const nomFeuille of classeur.SheetNames) {
    const feuille = classeur.Sheets[nomFeuille];
    const rows = XLSX.utils.sheet_to_json(feuille, { header: 1, raw: true, defval: null, blankrows: false });
    for (const r of rows) lignes.push(r);
  }
  return lignes;
}

// --------------------------------------------------------------------------
// Lecture PDF (position des mots)
// --------------------------------------------------------------------------

const RE_DATE = /^\d{2}[/-]\d{2}[/-]\d{4}$/;
const RE_DATE_COMPACTE = /^\d{8}$/;
const RE_JOUR_OU_MOIS = /^\d{2}$/;
const RE_MONTANT = /^\d[\d\s.  ]*,\d{2,3}$/;

const ENTETE_PDF = ["Date", "Libellé", "Référence", "Date de valeur", "Débit", "Crédit"];
const ZONE_DATE = 70;

let pdfjsModule = null;
async function getPdfjs() {
  if (!pdfjsModule) pdfjsModule = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsModule;
}

async function extraireMotsParPage(chemin) {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(fs.readFileSync(chemin));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, disableWorker: true, isEvalSupported: false }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const mots = [];
    for (const it of content.items) {
      const text = it.str || "";
      if (!text.trim()) continue;
      const x0 = it.transform[4];
      const x1 = x0 + (it.width || 0);
      const y = it.transform[5];
      mots.push({ text, x0, x1, y });
    }
    pages.push(mots);
    try {
      page.cleanup();
    } catch {
      // rien a faire
    }
  }
  return pages;
}

function grouperEnLignes(mots, tolerance = 3.0) {
  const tries = [...mots].sort((a, b) => b.y - a.y); // haut -> bas (y decroit)
  const lignes = [];
  for (const mot of tries) {
    if (lignes.length && lignes[lignes.length - 1][0].y - mot.y <= tolerance) {
      lignes[lignes.length - 1].push(mot);
    } else {
      lignes.push([mot]);
    }
  }
  return lignes.map((l) => [...l].sort((a, b) => a.x0 - b.x0));
}

function profilPdf(pages) {
  for (const mots of pages) {
    for (const ligne of grouperEnLignes(mots)) {
      const textes = {};
      for (const m of ligne) {
        const cle = sansAccents(m.text);
        if (!(cle in textes)) textes[cle] = m;
      }
      if ("debit" in textes && "credit" in textes) {
        return {
          frontiere: (textes.debit.x1 + textes.credit.x0) / 2,
          montantGauche: textes.debit.x0 - 25,
          referenceGauche: "reference" in textes ? textes.reference.x0 - 40 : null,
          format: "à en-têtes",
        };
      }
    }
  }

  const tousMontants = [];
  for (const mots of pages) for (const m of mots) if (RE_MONTANT.test(m.text)) tousMontants.push(m);
  const bords = [...new Set(tousMontants.map((m) => Math.round(m.x1 * 10) / 10))].sort((a, b) => a - b);
  if (bords.length < 2) return null;

  let meilleurEcart = -Infinity;
  let coupure = 0;
  for (let i = 0; i < bords.length - 1; i++) {
    const ecart = bords[i + 1] - bords[i];
    if (ecart > meilleurEcart) {
      meilleurEcart = ecart;
      coupure = i;
    }
  }
  if (meilleurEcart < 20) return null;

  const gauches = tousMontants.map((m) => m.x0);
  return {
    frontiere: (bords[coupure] + bords[coupure + 1]) / 2,
    montantGauche: Math.min(...gauches) - 10,
    referenceGauche: null,
    format: "ancien",
  };
}

function estDateCompacte(texte) {
  const annee = parseInt(texte.slice(4), 10);
  if (!(annee >= 2000 && annee <= 2100)) return false;
  const cand = ymd(annee, parseInt(texte.slice(2, 4), 10), parseInt(texte.slice(0, 2), 10));
  return isValidYmd(cand);
}

function dateAncienFormat(jour, mois, valeur) {
  if (!valeur) return null;
  for (const annee of [valeur.y, valeur.y - 1, valeur.y + 1]) {
    const cand = ymd(annee, parseInt(mois, 10), parseInt(jour, 10));
    if (!isValidYmd(cand)) continue;
    if (Math.abs(daysBetween(cand, valeur)) <= 45) return cand;
  }
  return null;
}

function estLigneDeSolde(texte) {
  const t = sansAccents(texte);
  return ["solde", "totaux", "total", "report"].some((m) => t.startsWith(m));
}

// pdfjs fusionne parfois "02" et "03" (jour + mois de l'ancien format) en un
// seul item textuel "02 03" avec un espace interne, alors que pdfplumber (sur
// lequel l'algorithme d'origine a ete concu) les rendait comme deux mots
// distincts. On les re-separe ici pour que RE_JOUR_OU_MOIS (deux chiffres
// exactement) puisse continuer a les reconnaitre individuellement.
const RE_JOUR_MOIS_COLLES = /^(\d{2})\s+(\d{2})$/;

function separerJourMoisColles(reste) {
  const out = [];
  for (const j of reste) {
    const m = RE_JOUR_MOIS_COLLES.exec(j.text);
    if (m && j.x1 < ZONE_DATE + 15) {
      const proportion = m[1].length / j.text.length;
      const milieu = j.x0 + (j.x1 - j.x0) * proportion;
      out.push({ text: m[1], x0: j.x0, x1: milieu, y: j.y });
      out.push({ text: m[2], x0: milieu, x1: j.x1, y: j.y });
    } else {
      out.push(j);
    }
  }
  return out;
}

function repartirMontants(jetons, frontiere) {
  if (!jetons.length) return ["", ""];
  let debit = "";
  let credit = "";
  const groupes = [[jetons[0]]];
  for (let i = 1; i < jetons.length; i++) {
    const j = jetons[i];
    const dernier = groupes[groupes.length - 1];
    if (j.x0 - dernier[dernier.length - 1].x1 < 6) dernier.push(j);
    else groupes.push([j]);
  }
  for (const groupe of groupes) {
    const valeur = groupe.map((g) => g.text).join(" ");
    if (!RE_MONTANT.test(valeur)) continue;
    if (groupe[groupe.length - 1].x1 <= frontiere) debit = valeur;
    else credit = valeur;
  }
  return [debit, credit];
}

async function lignesPdf(chemin) {
  const lignes = [[...ENTETE_PDF]];
  const soldes = [];

  const pages = await extraireMotsParPage(chemin);
  const profil = profilPdf(pages);
  if (profil === null) return [lignes, soldes];

  const { frontiere, montantGauche, referenceGauche: refGauche } = profil;
  const dateGaucheMax = montantGauche - 200;

  for (const mots of pages) {
    for (const jetons of grouperEnLignes(mots)) {
      const brutsMontants = jetons.filter((j) => j.x0 >= montantGauche);
      const reste = separerJourMoisColles(jetons.filter((j) => j.x0 < montantGauche));

      const pleines = reste.filter((j) => RE_DATE.test(j.text));
      const dateOpTok = pleines.length && pleines[0].x0 <= dateGaucheMax ? pleines[0] : null;
      let dValeurTexte = null;
      if (pleines.length >= 2) dValeurTexte = pleines[1].text;
      else if (pleines.length && dateOpTok === null) dValeurTexte = pleines[0].text;

      if (dValeurTexte === null) {
        for (let i = reste.length - 1; i >= 0; i--) {
          const j = reste[i];
          if (RE_DATE_COMPACTE.test(j.text) && estDateCompacte(j.text)) {
            dValeurTexte = `${j.text.slice(0, 2)}/${j.text.slice(2, 4)}/${j.text.slice(4)}`;
            break;
          }
        }
      }

      const jourMois = reste.filter((j) => j.x1 < ZONE_DATE && RE_JOUR_OU_MOIS.test(j.text));
      let dateOp = dateOpTok;
      if (dateOp === null && jourMois.length >= 2) {
        const reconstituee = dateAncienFormat(jourMois[0].text, jourMois[1].text, extractDate(dValeurTexte));
        if (reconstituee) dateOp = { text: `${String(reconstituee.d).padStart(2, "0")}/${String(reconstituee.m).padStart(2, "0")}/${reconstituee.y}`, x0: 0.0 };
      }

      const bordDate = dateOp ? dateOp.x0 : 0.0;
      const etiquette = [];
      const reference = [];
      for (const j of reste) {
        if (pleines.includes(j)) continue;
        if (RE_DATE_COMPACTE.test(j.text) && estDateCompacte(j.text)) continue;
        if (jourMois.includes(j) && dateOp !== null) continue;
        if (j.x1 <= bordDate && j.text.length <= 3 && /^\d+$/.test(j.text)) continue;
        if (refGauche !== null && j.x0 >= refGauche) reference.push(j.text);
        else etiquette.push(j.text);
      }

      const texteEtiquette = etiquette.join(" ").trim();
      const [debit, credit] = repartirMontants(brutsMontants, frontiere);

      if (estLigneDeSolde(texteEtiquette)) {
        if (debit || credit) soldes.push([texteEtiquette, debit, credit]);
        continue;
      }

      if (dateOp === null) {
        if (texteEtiquette && lignes.length > 1 && !PIED_DE_PAGE.test(texteEtiquette)) {
          lignes[lignes.length - 1][1] = `${lignes[lignes.length - 1][1]} ${texteEtiquette}`.trim();
        }
        if (debit || credit) soldes.push([texteEtiquette, debit, credit]);
        continue;
      }

      lignes.push([dateOp.text, texteEtiquette, reference.join(" ").trim(), dValeurTexte || dateOp.text, debit, credit]);
    }
  }

  return [lignes, soldes];
}

// --------------------------------------------------------------------------
// Assemblage
// --------------------------------------------------------------------------

function controlerSoldes(releve, soldes) {
  if (!soldes.length || !releve.operations.length) return;

  const valeurs = [];
  for (const [, d, c] of soldes) {
    const vc = montant(c);
    if (vc) valeurs.push(vc);
    const vd = montant(d);
    if (vd) valeurs.push(-vd);
  }
  if (!valeurs.length) return;

  const debits = releve.operations.reduce((s, o) => s + o.debit, 0);
  const credits = releve.operations.reduce((s, o) => s + o.credit, 0);
  const initial = valeurs[0];
  const attendu = Math.round((initial + credits - debits) * 1000) / 1000;

  if (valeurs.some((v) => Math.abs(attendu - v) < 0.05)) {
    releve.controle = `soldes cohérents : ${initial.toFixed(3)} + ${credits.toFixed(3)} − ${debits.toFixed(3)} = ${attendu.toFixed(3)}`;
  } else {
    releve.avertissements.push(
      `contrôle des soldes : ${initial.toFixed(3)} + ${credits.toFixed(3)} − ${debits.toFixed(3)} = ${attendu.toFixed(3)}, qui ne correspond à aucun solde imprimé (${valeurs.map((v) => v.toFixed(3)).join(", ")}) — des opérations ont pu échapper à la lecture`
    );
  }
}

async function lireReleve(chemin, banque = "BIAT") {
  const releve = { banque, fichier: chemin, operations: [], avertissements: [], controle: "" };
  const suffixe = path.extname(chemin).toLowerCase();
  let soldesPdf = [];

  let lignes;
  try {
    if ([".csv", ".tsv", ".txt"].includes(suffixe)) {
      lignes = lignesCsv(chemin);
    } else if ([".xlsx", ".xlsm", ".xls"].includes(suffixe)) {
      lignes = lignesXlsx(chemin);
    } else if (suffixe === ".pdf") {
      [lignes, soldesPdf] = await lignesPdf(chemin);
    } else {
      releve.avertissements.push(`format non pris en charge : ${suffixe}`);
      return releve;
    }
  } catch (err) {
    releve.avertissements.push(`lecture impossible : ${err.message || err}`);
    return releve;
  }

  const detection = detecterEntete(lignes);
  if (detection === null) {
    releve.avertissements.push(
      "entete introuvable — colonnes date / libelle / credit non reconnues. Verifier le fichier."
    );
    return releve;
  }

  const [indexEntete, roles] = detection;
  const nomFichier = path.basename(chemin);
  for (let i = indexEntete + 1; i < lignes.length; i++) {
    const ligne = lignes[i];
    if (!ligne || !ligne.some((c) => c !== null && c !== undefined && String(c).trim() !== "")) continue;
    const operation = ligneVersOperation(ligne, roles, banque, nomFichier, i + 1);
    if (operation !== null) releve.operations.push(operation);
  }

  if (!releve.operations.length) releve.avertissements.push("entete reconnue mais aucune operation lue");

  controlerSoldes(releve, soldesPdf);
  return releve;
}

async function lireTousLesReleves(racine) {
  const releves = [];
  if (!fs.existsSync(racine)) return releves;

  const extensions = new Set([".csv", ".tsv", ".txt", ".xlsx", ".xlsm", ".xls", ".pdf"]);
  const fichiers = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) fichiers.push(p);
    }
  })(racine);

  for (const chemin of fichiers) {
    const ext = path.extname(chemin).toLowerCase();
    if (!extensions.has(ext)) continue;
    const base = path.basename(chemin);
    if (base.startsWith("~$") || base.startsWith(".")) continue;
    const stem = path.basename(chemin, ext).toUpperCase();
    if (["DEPOSER_ICI", "README", "LISEZMOI"].includes(stem)) continue;
    releves.push(await lireReleve(chemin));
  }
  return releves;
}

function encaissements(releves) {
  const ops = [];
  for (const r of releves) for (const o of r.operations) if (o.estEncaissement) ops.push(o);
  ops.sort((a, b) => {
    const da = a.dateOperation ? dayIndex(a.dateOperation) : -Infinity;
    const db = b.dateOperation ? dayIndex(b.dateOperation) : -Infinity;
    if (da !== db) return da - db;
    return a.credit - b.credit;
  });
  return ops;
}

module.exports = {
  makeOperation,
  montant,
  sansAccents,
  lireReleve,
  lireTousLesReleves,
  encaissements,
  isoOf,
};

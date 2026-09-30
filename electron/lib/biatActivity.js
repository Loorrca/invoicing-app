"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { makeOperation, montant, sansAccents } = require("./statements");
const { parseFlexible, isoOf } = require("./dateUtils");

/**
 * Lecture du fichier "Détails Transactions" telechargeable depuis BIATNET
 * (export CSV de l'activite du compte, sur la periode de son choix — jusqu'a
 * un an en arriere).
 *
 * Contrairement aux releves mensuels (PDF/XLSX/CSV) lus par statements.js
 * avec une detection generique des colonnes par mots-cles, ce format a une
 * entete fixe et connue — et il le FAUT : sa colonne "Type opération" prend
 * des valeurs comme "Commissions", qui accrocheraient a tort le mot-cle du
 * role "sens" dans la detection generique (voir roleDeColonne/MOTS dans
 * statements.js) et inverseraient le credit/debit de toutes les lignes de
 * commissions. On lit donc ce format avec un parseur dedie, qui utilise
 * explicitement la colonne "Débit/Crédit" (valeurs "Debit"/"Credit" propres,
 * verifiees sur un export reel d'un an de transactions).
 */

const ENTETES_ATTENDUES = {
  dateOperation: "date operation",
  dateValeur: "date valeur",
  typeOperation: "type operation",
  reference: "reference",
  description: "description",
  sens: "debit/credit",
  montant: "montant",
};

function normaliserEntete(texte) {
  return sansAccents(texte).replace(/\s+/g, " ").trim();
}

function decoderTexte(chemin) {
  const buf = fs.readFileSync(chemin);
  let texte = buf.toString("utf-8");
  // Meme heuristique d'encodage que statements.js : un exces de caracteres
  // de remplacement U+FFFD trahit un fichier qui n'est pas de l'UTF-8.
  const remplacements = (texte.match(/�/g) || []).length;
  if (remplacements > 3) texte = buf.toString("latin1");
  if (texte.charCodeAt(0) === 0xfeff) texte = texte.slice(1); // BOM UTF-8 eventuel
  return texte;
}

function decouperLigne(ligne) {
  // Format fixe, champs jamais guillemetes ni porteurs de virgule (verifie
  // sur un export reel de 523 lignes) : une simple decoupe suffit.
  return ligne.split(",");
}

function repererColonnes(entete) {
  const normalisees = entete.map(normaliserEntete);
  const index = {};
  for (const [cle, attendu] of Object.entries(ENTETES_ATTENDUES)) {
    const i = normalisees.indexOf(attendu);
    if (i === -1) return null;
    index[cle] = i;
  }
  return index;
}

/**
 * Cle de deduplication stable d'une operation, independante de sa position
 * dans le fichier : un export BIATNET redemarre "depuis le debut" a chaque
 * telechargement, donc une meme operation peut se retrouver a une ligne
 * differente d'un export a l'autre. La Référence seule ne suffit pas non
 * plus (une meme reference peut regrouper plusieurs lignes lieees, ex. un
 * virement et sa commission) : on la combine a la date, au type, au sens et
 * au montant.
 */
function cleOperation({ reference, dateOperation, typeOperation, sens, montantAbs }) {
  return [
    reference || "",
    dateOperation ? isoOf(dateOperation) : "",
    typeOperation || "",
    sens || "",
    montantAbs != null ? montantAbs.toFixed(3) : "",
  ].join("|");
}

/**
 * Parse un export CSV "Détails Transactions" BIATNET.
 * @returns {{ operations: object[], avertissements: string[], nomFichier: string }}
 */
function parseActiviteCsv(chemin) {
  const texte = decoderTexte(chemin);
  const lignesTexte = texte.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
  if (!lignesTexte.length) {
    throw new Error("fichier vide");
  }

  const entete = decouperLigne(lignesTexte[0]);
  const colonnes = repererColonnes(entete);
  if (!colonnes) {
    throw new Error(
      'colonnes attendues introuvables — ce fichier ne ressemble pas à un export "Détails Transactions" BIATNET au format CSV'
    );
  }

  const operations = [];
  const avertissements = [];

  for (let i = 1; i < lignesTexte.length; i++) {
    const champs = decouperLigne(lignesTexte[i]);
    const get = (cle) => (champs[colonnes[cle]] ?? "").trim();

    const dateOperation = parseFlexible(get("dateOperation"));
    const dateValeur = parseFlexible(get("dateValeur"));
    const sensBrut = get("sens");
    const sens = /credit/i.test(sensBrut) ? "Credit" : /debit/i.test(sensBrut) ? "Debit" : "";
    const montantAbs = Math.abs(montant(get("montant")) ?? 0);
    const reference = get("reference");
    const typeOperation = get("typeOperation");
    const description = get("description").replace(/\\n/g, " ").replace(/\s+/g, " ").trim();

    if (!dateOperation || !sens || !montantAbs) {
      avertissements.push(`ligne ${i + 1} ignorée (date, sens ou montant illisible)`);
      continue;
    }

    const cle = cleOperation({ reference, dateOperation, typeOperation, sens, montantAbs });

    operations.push({
      cle,
      dateOperation,
      dateValeur: dateValeur || dateOperation,
      sens,
      montant: Math.round(montantAbs * 1000) / 1000,
      reference,
      typeOperation,
      libelle: description || typeOperation,
    });
  }

  return { operations, avertissements, nomFichier: path.basename(chemin) };
}

/**
 * Transforme une operation stockee (forme JSON brute persistee par
 * activityImports.js) en l'objet Operation attendu par matching.js — memes
 * champs/getters que les operations produites par statements.js, pour que
 * rapprocher() n'ait aucune distinction a faire selon la source.
 */
function versOperationMatching(champsStockes) {
  return makeOperation({
    banque: "BIAT",
    dateOperation: champsStockes.dateOperation,
    dateValeur: champsStockes.dateValeur,
    libelle: champsStockes.libelle,
    credit: champsStockes.sens === "Credit" ? champsStockes.montant : 0,
    debit: champsStockes.sens === "Debit" ? champsStockes.montant : 0,
    reference: champsStockes.reference,
    source: "import-activite",
    ligne: champsStockes.cle,
  });
}

module.exports = { parseActiviteCsv, versOperationMatching };

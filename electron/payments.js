"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { lireTousLesReleves, encaissements } = require("./lib/statements");
const { rapprocher, certain } = require("./lib/matching");
const { fromIso, isoOf } = require("./lib/dateUtils");
const { variantes } = require("./lib/retenue");
const { parseActiviteCsv, versOperationMatching } = require("./lib/biatActivity");
const {
  initActivityImports,
  aDesOperationsImportees,
  operationsImportees,
  dernierImport,
  fusionnerImport,
} = require("./lib/activityImports");

// Suivi des reglements par rapprochement bancaire (port de l'ancien outil
// Python invoice-tracker). Chaque entreprise a son propre compte BIAT : les
// releves mensuels se deposent dans Documents/Facturation/Releves/<Entreprise>/,
// au meme endroit que les factures PDF dans Documents/Facturation/Factures/.

let documentsDir = null;
let overridesFilePath = null;
let overrides = null; // { [companyId]: { "<invoiceId>::<source>::<ligne>": "confirmed" } }

function sanitizeForPath(name) {
  return (
    String(name || "")
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "_")
      .slice(0, 80) || "Sans-nom"
  );
}

function releveDirFor(company) {
  const dir = path.join(documentsDir, "Facturation", "Releves", sanitizeForPath(company.company_name));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function loadOverrides() {
  try {
    const raw = JSON.parse(fs.readFileSync(overridesFilePath, "utf-8"));
    if (raw && typeof raw === "object") return raw;
  } catch {
    // pas de fichier, ou fichier invalide : on repart d'un objet vide
  }
  return {};
}

function persistOverrides() {
  const tmp = `${overridesFilePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(overrides, null, 2), "utf-8");
  fs.renameSync(tmp, overridesFilePath);
}

function initPayments(userDataDir, documentsDirArg) {
  documentsDir = documentsDirArg;
  overridesFilePath = path.join(userDataDir, "payments-overrides.json");
  overrides = loadOverrides();
  initActivityImports(userDataDir);
}

function operationKey(op) {
  return `${op.source}::${op.ligne}`;
}

function overrideKey(invoiceId, op) {
  return `${invoiceId}::${operationKey(op)}`;
}

function getOverride(companyId, invoiceId, op) {
  return overrides[companyId]?.[overrideKey(invoiceId, op)] || null;
}

// --------------------------------------------------------------------------
// Adaptation d'une facture de l'app vers le format attendu par matching.js
// --------------------------------------------------------------------------

function toFacture(invoice) {
  return {
    cle: invoice.id,
    numero: invoice.numero || "",
    numeroInterne: null,
    dateFacture: fromIso(invoice.date),
    client: invoice.client || "",
    bonCommande: invoice.bonCommande || "",
    bonLivraison: invoice.bonLivraison || "",
    montantHt: invoice.totaux?.ht ?? null,
    fodec: invoice.totaux?.fodec ?? null,
    tva: invoice.totaux?.tva ?? null,
    montantTtc: invoice.totaux?.ttc ?? null,
  };
}

function statutBrut(rapprochement) {
  if (!rapprochement) return "Non payée";
  if (rapprochement.methode === "reference" && rapprochement.variante === null) return "Partiel ?";
  if (certain(rapprochement) && rapprochement.variante !== null) return "Payée";
  return "Probable";
}

function confianceBrute(r) {
  if (!r) return "";
  if ((r.commentaire || "").includes("À VÉRIFIER") || !certain(r)) return "À vérifier";
  if (r.score >= 0.85) return "Élevée";
  if (r.score >= 0.65) return "Moyenne";
  return "À vérifier";
}

function partRecue(facture, rapprochement) {
  if (!rapprochement) return null;
  const groupe = rapprochement.factures.length > 1;
  if (!groupe) return rapprochement.montantRecu;
  if (rapprochement.variante) {
    const v = variantes(facture.montantTtc, facture.tva, facture.fodec).find((x) => x.code === rapprochement.variante.code);
    return v ? v.montant : null;
  }
  return null;
}

/**
 * Calcule le suivi des reglements pour une entreprise : rapproche ses
 * factures avec les operations bancaires, applique les confirmations
 * manuelles deja enregistrees, et renvoie une ligne par facture plus un
 * recapitulatif.
 *
 * Deux sources possibles pour les operations, jamais combinees pour une
 * meme entreprise (pour eviter tout risque de compter une operation deux
 * fois) : le fichier d'activite importe (payments:importActivity), s'il y
 * en a au moins un ; sinon, a l'ancienne, les releves deposes dans le
 * dossier de l'entreprise.
 */
async function scanPayments(company, invoices) {
  const dir = releveDirFor(company);
  const sourceActivite = aDesOperationsImportees(company.id);

  let releves;
  const avertissements = [];
  let controles = [];
  let activityMeta = null;

  if (sourceActivite) {
    const ops = operationsImportees(company.id).map(versOperationMatching);
    releves = [{ banque: "BIAT", fichier: "import-activite", operations: ops, avertissements: [], controle: "" }];
    const di = dernierImport(company.id);
    activityMeta = {
      nbOperations: ops.length,
      dernierImport: di?.date || null,
      nomFichier: di?.nomFichier || null,
    };
  } else {
    releves = await lireTousLesReleves(dir);
    for (const r of releves) {
      for (const a of r.avertissements) avertissements.push(`${path.basename(r.fichier)} : ${a}`);
    }
    controles = releves.filter((r) => r.controle).map((r) => `${path.basename(r.fichier)} : ${r.controle}`);
  }

  const operations = encaissements(releves);
  const factures = invoices.map(toFacture);
  const resultat = rapprocher(factures, operations);
  const parFacture = resultat.parFacture();

  const rows = [];
  for (const invoice of invoices) {
    const facture = factures.find((f) => f.cle === invoice.id);
    const r = parFacture.get(invoice.id) || null;

    let statut = statutBrut(r);
    let confiance = confianceBrute(r);
    let confirmeManuellement = false;

    if (r && statut !== "Payée") {
      const ov = getOverride(company.id, invoice.id, r.operation);
      if (ov === "confirmed") {
        statut = "Payée";
        confiance = "Confirmé manuellement";
        confirmeManuellement = true;
      }
    }

    const part = r ? partRecue(facture, r) : null;
    const groupe = r ? r.factures.length > 1 : false;

    rows.push({
      invoiceId: invoice.id,
      numero: invoice.numero,
      date: invoice.date,
      client: invoice.client,
      montantTtc: invoice.totaux?.ttc ?? null,
      statut,
      confiance,
      montantRecu: part,
      dateEncaissement: r ? isoOf(r.operation.dateOperation) : null,
      retenueAppliquee: r?.variante ? r.variante.libelle : "",
      ecart: r ? r.ecart : null,
      methode: r ? r.methode : "",
      libelleBancaire: r ? r.operation.libelle : "",
      referenceBancaire: r ? r.operation.reference : "",
      commentaire: r ? r.commentaire : "",
      groupe,
      // Detail complet des autres factures reglees par le meme virement
      // (numero + client + montant), pour affichage sans avoir a recouper
      // avec la liste des transactions.
      facturesGroupe: groupe
        ? r.factures.map((f) => ({ id: f.cle, numero: f.numero, client: f.client, montantTtc: f.montantTtc }))
        : [],
      confirmeManuellement,
      // Cle stable pour renvoyer une confirmation cote IPC.
      operationKey: r ? operationKey(r.operation) : null,
      peutVerifier: !!r && !confirmeManuellement && (statut === "Probable" || statut === "Partiel ?"),
    });
  }

  const totalTtc = rows.reduce((s, l) => s + (l.montantTtc || 0), 0);
  const totalEncaisse = rows.reduce((s, l) => s + (typeof l.montantRecu === "number" ? l.montantRecu : 0), 0);
  const resteAEncaisser = rows.filter((l) => l.statut === "Non payée").reduce((s, l) => s + (l.montantTtc || 0), 0);
  const nbPayees = rows.filter((l) => l.statut === "Payée").length;
  const nbProbables = rows.filter((l) => l.statut === "Probable" || l.statut === "Partiel ?").length;
  const nbNonPayees = rows.filter((l) => l.statut === "Non payée").length;
  const nbAVerifier = rows.filter((l) => l.peutVerifier).length;

  // --------------------------------------------------------------------------
  // Vue "Transactions" : chaque encaissement bancaire, qu'il soit affecte a
  // une (ou plusieurs, si reglement groupe) facture ou non — pour repondre a
  // "est-ce que cette entree a ete rapprochee d'une facture ou pas".
  // --------------------------------------------------------------------------
  const rapprochementParOperation = new Map();
  for (const r of resultat.rapprochements) rapprochementParOperation.set(r.operation, r);

  const transactions = operations.map((o) => {
    const r = rapprochementParOperation.get(o) || null;
    return {
      operationKey: operationKey(o),
      date: isoOf(o.dateOperation),
      dateValeur: o.dateValeur ? isoOf(o.dateValeur) : null,
      libelle: o.libelle,
      reference: o.reference,
      montant: o.credit,
      source: o.source,
      affectee: !!r,
      factures: r ? r.factures.map((f) => ({ id: f.cle, numero: f.numero, client: f.client, montantTtc: f.montantTtc })) : [],
      methode: r ? r.methode : null,
      confiance: r ? confianceBrute(r) : null,
      ecart: r ? r.ecart : null,
      commentaire: r ? r.commentaire : null,
    };
  });
  transactions.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const nbTransactions = transactions.length;
  const nbTransactionsAffectees = transactions.filter((t) => t.affectee).length;
  const nbTransactionsNonAffectees = nbTransactions - nbTransactionsAffectees;
  const totalNonAffecte = transactions
    .filter((t) => !t.affectee)
    .reduce((s, t) => s + (t.montant || 0), 0);

  return {
    dossier: dir,
    sourceActivite,
    activityMeta,
    rows,
    recap: {
      nbFactures: invoices.length,
      totalTtc: Math.round(totalTtc * 1000) / 1000,
      totalEncaisse: Math.round(totalEncaisse * 1000) / 1000,
      resteAEncaisser: Math.round(resteAEncaisser * 1000) / 1000,
      nbPayees,
      nbProbables,
      nbNonPayees,
      nbAVerifier,
    },
    avertissements,
    controles,
    transactions,
    recapTransactions: {
      nbTransactions,
      nbTransactionsAffectees,
      nbTransactionsNonAffectees,
      totalNonAffecte: Math.round(totalNonAffecte * 1000) / 1000,
    },
    nbReleves: releves.length,
  };
}

/**
 * Importe un fichier "Détails Transactions" BIATNET (CSV) pour une
 * entreprise : le parse, fusionne ses operations dans le stock deja connu
 * (sans jamais dupliquer une operation deja importee), et renvoie un resume.
 * A partir du premier import reussi, scanPayments() pour cette entreprise
 * bascule definitivement sur cette source (voir plus haut) — l'ancien
 * dossier de depot de releves n'est plus lu pour elle.
 */
function importActivityFile(companyId, filePath) {
  const { operations, avertissements, nomFichier } = parseActiviteCsv(filePath);
  const resume = fusionnerImport(companyId, nomFichier, operations);
  return { ...resume, avertissements, nomFichier };
}

function verifyPayment(companyId, invoiceId, opKeyValue, confirmer) {
  // On reconstruit une cle d'override a partir de la operationKey deja
  // calculee lors du scan (source::ligne), sans avoir besoin de l'objet
  // Operation original.
  const key = `${invoiceId}::${opKeyValue}`;
  if (!overrides[companyId]) overrides[companyId] = {};
  if (confirmer) overrides[companyId][key] = "confirmed";
  else delete overrides[companyId][key];
  persistOverrides();
  return true;
}

module.exports = { initPayments, releveDirFor, scanPayments, verifyPayment, importActivityFile };

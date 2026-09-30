"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { lireTousLesReleves, encaissements } = require("./lib/statements");
const { rapprocher, certain } = require("./lib/matching");
const { fromIso, isoOf } = require("./lib/dateUtils");
const { variantes } = require("./lib/retenue");

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
 * Calcule le suivi des reglements pour une entreprise : lit tous les releves
 * de son dossier, rapproche avec ses factures, applique les confirmations
 * manuelles deja enregistrees, et renvoie une ligne par facture plus un
 * recapitulatif.
 */
async function scanPayments(company, invoices) {
  const dir = releveDirFor(company);
  const releves = await lireTousLesReleves(dir);
  const avertissements = [];
  for (const r of releves) {
    for (const a of r.avertissements) avertissements.push(`${path.basename(r.fichier)} : ${a}`);
  }
  const controles = releves.filter((r) => r.controle).map((r) => `${path.basename(r.fichier)} : ${r.controle}`);

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
      commentaire: r ? r.commentaire : "",
      groupe,
      facturesGroupe: groupe ? r.factures.map((f) => f.numero) : [],
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

  const operationsNonAffectees = resultat.operationsNonAffectees.map((o) => ({
    date: isoOf(o.dateOperation),
    libelle: o.libelle,
    reference: o.reference,
    montant: o.credit,
    source: o.source,
  }));

  return {
    dossier: dir,
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
    operationsNonAffectees,
    nbReleves: releves.length,
  };
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

module.exports = { initPayments, releveDirFor, scanPayments, verifyPayment };

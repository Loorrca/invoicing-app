"use strict";

/**
 * Rapprochement entre les factures et les encaissements du releve bancaire.
 *
 * Port fidele de invoice-tracker/invoice_tracker/matching.py :
 *
 *  1. Le montant recu est presque toujours inferieur au TTC (retenue a la
 *     source) -> module retenue.js : comparaison a plusieurs variantes, puis
 *     a une fourchette.
 *  2. Un seul virement solde parfois plusieurs factures du meme client
 *     -> recherche de sous-ensembles de factures dont la somme des nets
 *     tombe sur le montant vire.
 *  3. Les libelles bancaires citent parfois le numero de facture ou le bon
 *     de commande -> bonus de score.
 *
 * Le rapprochement se fait par score decroissant : les correspondances les
 * plus sures sont figees d'abord.
 */

const { fourchette, identifier, variantes } = require("./retenue");
const { correspondance } = require("./translitteration");
const { dayIndex } = require("./dateUtils");

const JOURS_APRES = 180;
const TOLERANCE = 0.5;
const TAILLE_MAX_LOT = 4;

// Un numero de facture cite explicitement ("FACT 0011", "F/ 43", "N° 0053").
const CITATION_EXPLICITE = /(?:factures?|fact\.?|fre|f\/|n[°ºo]\.?)\s*:?\s*(?<!\d)(\d{1,5})(?!\d)/gi;

// Un nombre isole de 4 chiffres, qui *pourrait* etre un numero de facture.
// Le negative lookaround est essentiel : les references bancaires sont de
// longues suites de chiffres ("00010000000165") ou l'on trouverait sinon
// "0165", "0001", etc.
const NOMBRE_ISOLE = /(?<!\d)\d{4}(?!\d)/g;

function pad4(n) {
  return n.replace(/^0+/, "").padStart(4, "0");
}

function numerosCites(texte) {
  texte = texte || "";
  const explicites = new Set([...texte.matchAll(CITATION_EXPLICITE)].map((m) => pad4(m[1])));
  const isolesTous = new Set([...texte.matchAll(NOMBRE_ISOLE)].map((m) => pad4(m[0])));
  const isoles = new Set([...isolesTous].filter((x) => !explicites.has(x)));
  return [explicites, isoles];
}

function indiceLibelle(facture, texte) {
  if (!texte) return [0, ""];

  let score = 0;
  const raisons = [];
  const [explicites, isoles] = numerosCites(texte);
  const numero = pad4(String(facture.numero || "0"));

  if (explicites.has(numero)) {
    score += 0.6;
    raisons.push(`n° facture ${facture.numero} cité`);
  } else if (isoles.has(numero)) {
    score += 0.2;
    raisons.push(`nombre ${facture.numero} présent dans le libellé`);
  }
  if (facture.numeroInterne && explicites.has(pad4(String(facture.numeroInterne)))) {
    score += 0.5;
    raisons.push(`n° imprimé ${facture.numeroInterne} cité`);
  }
  for (const [bon, etiquette] of [
    [facture.bonCommande, "bon de commande"],
    [facture.bonLivraison, "bon de livraison"],
  ]) {
    if (bon && explicites.has(pad4(String(bon)))) {
      score += 0.25;
      raisons.push(`${etiquette} ${bon} cité`);
    }
  }

  // Le client est parfois nomme en arabe sur la facture, en latin sur le
  // releve : la comparaison passe par le squelette consonantique.
  const communs = correspondance(facture.client, texte);
  if (communs.size) {
    score += Math.min(0.4, 0.2 * communs.size);
    raisons.push("client reconnu (" + [...communs].sort().slice(0, 3).join(", ") + ")");
  }

  return [Math.min(score, 1.0), raisons.join(" ; ")];
}

function proximite(factures, operation, delaiMax = JOURS_APRES) {
  const delais = [];
  for (const f of factures) {
    if (f.dateFacture && operation.dateOperation) {
      delais.push(dayIndex(operation.dateOperation) - dayIndex(f.dateFacture));
    }
  }
  if (!delais.length) return 0;
  const moyen = Math.max(delais.reduce((s, d) => s + d, 0) / delais.length, 0);
  return Math.max(0, 1 - moyen / Math.max(delaiMax, 1));
}

// Une operation bancaire ne peut jamais regler une facture pas encore
// emise : un virement date avant la facture est forcement autre chose
// (un autre reglement, une avance sans rapport...), jamais ce paiement-la.
// On n'autorise donc aucune marge vers le passe, seulement vers l'avenir
// (le reglement arrive apres la facture, jusqu'a delaiMax jours plus tard).
function datePlausible(facture, operation, delaiMax = JOURS_APRES) {
  if (!facture.dateFacture || !operation.dateOperation) return true;
  const delta = dayIndex(operation.dateOperation) - dayIndex(facture.dateFacture);
  return delta >= 0 && delta <= delaiMax;
}

function* combinations(arr, k) {
  const n = arr.length;
  if (k > n) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.map((i) => arr[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === i + n - k) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}
function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function certain(r) {
  return r.decisif || corrobore(r);
}
function corrobore(r) {
  return r.indice > 0;
}

function candidatsSimples(factures, operations, tolerance, delaiMax) {
  const out = [];
  for (const operation of operations) {
    const recu = operation.credit;
    for (const facture of factures) {
      if (facture.montantTtc === null || facture.montantTtc === undefined) continue;
      if (!datePlausible(facture, operation, delaiMax)) continue;

      const [bas, haut] = fourchette(facture.montantTtc, facture.tva, facture.fodec, tolerance);
      const [indice, raison] = indiceLibelle(facture, operation.texteRecherche);

      let variante = null;
      let ecart;
      let methode;
      let score;
      let commentaire;

      if (!(recu >= bas && recu <= haut)) {
        if (indice < 0.6) continue;
        ecart = round3(Math.abs(facture.montantTtc - recu));
        methode = "reference";
        score = indice;
        commentaire = `${raison} — montant hors fourchette (TTC ${facture.montantTtc.toFixed(3)}, reçu ${recu.toFixed(3)})`;
      } else {
        const idr = identifier(facture.montantTtc, facture.tva, facture.fodec, recu, tolerance);
        variante = idr.variante;
        ecart = idr.ecart;
        const proche = proximite([facture], operation, delaiMax);
        if (variante !== null) {
          methode = "exact";
          score = 0.8 + 0.2 * indice - Math.min(ecart, tolerance) * 0.1 + 0.05 * proche;
        } else {
          methode = "fourchette";
          const etendue = Math.max(haut - bas, 1e-6);
          score = 0.5 + 0.3 * indice - 0.2 * (ecart / etendue) + 0.05 * proche;
        }
        commentaire = raison;
      }

      out.push({
        factures: [facture],
        operation,
        montantRecu: recu,
        variante,
        ecart,
        score: round4(score),
        methode,
        commentaire,
        indice,
        decisif: false,
      });
    }
  }
  return out;
}

function candidatsLots(factures, operations, tolerance, tailleMax, delaiMax) {
  const out = [];

  const groupes = new Map(); // "banque||client" -> factures[]
  for (const f of factures) {
    if (f.montantTtc === null || f.montantTtc === undefined) continue;
    const cle = normaliserClient(f.client);
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(f);
  }

  for (const operation of operations) {
    const recu = operation.credit;
    for (const lot of groupes.values()) {
      if (lot.length < 2) continue;
      let eligibles = lot.filter((f) => datePlausible(f, operation, delaiMax));
      if (eligibles.length < 2) continue;

      eligibles = [...eligibles].sort((a, b) => a.montantTtc - b.montantTtc);
      const plafond = Math.min(tailleMax, eligibles.length);

      for (let taille = 2; taille <= plafond; taille++) {
        for (const sousEnsemble of combinations(eligibles, taille)) {
          const marge = tolerance + 0.01 * taille;
          const bornes = sousEnsemble.map((f) => fourchette(f.montantTtc, f.tva, f.fodec, 0));
          const bas = bornes.reduce((s, b) => s + b[0], 0) - marge;
          const haut = bornes.reduce((s, b) => s + b[1], 0) + marge;
          if (!(recu >= bas && recu <= haut)) continue;

          let varianteCommune = null;
          let meilleurEcart = Infinity;
          const codes = new Set(variantes(sousEnsemble[0].montantTtc, sousEnsemble[0].tva, sousEnsemble[0].fodec).map((v) => v.code));
          for (const code of codes) {
            let total = 0;
            let ok = true;
            for (const f of sousEnsemble) {
              const trouve = variantes(f.montantTtc, f.tva, f.fodec).find((v) => v.code === code);
              if (!trouve) {
                ok = false;
                break;
              }
              total += trouve.montant;
            }
            if (!ok) continue;
            const ecart = Math.abs(total - recu);
            if (ecart < meilleurEcart) {
              meilleurEcart = ecart;
              varianteCommune = variantes(sousEnsemble[0].montantTtc, sousEnsemble[0].tva, sousEnsemble[0].fodec).find((v) => v.code === code);
            }
          }

          const indice = Math.max(...sousEnsemble.map((f) => indiceLibelle(f, operation.texteRecherche)[0]));
          const colle = meilleurEcart <= marge;
          const base = (colle ? 0.62 : 0.35) + (indice ? 0.1 : 0);
          const score = base + 0.15 * indice - 0.05 * (taille - 2) + 0.05 * proximite(sousEnsemble, operation, delaiMax);

          out.push({
            factures: sousEnsemble,
            operation,
            montantRecu: recu,
            variante: colle ? varianteCommune : null,
            ecart: round3(colle ? meilleurEcart : 0),
            score: round4(score),
            methode: "lot",
            indice,
            decisif: false,
            commentaire: `règlement groupé de ${taille} factures ${sousEnsemble.map((f) => f.numero).join(", ")}`,
          });
        }
      }
    }
  }
  return out;
}

function normaliserClient(client) {
  return String(client || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function rapprocher(factures, operations, options = {}) {
  const tolerance = options.tolerance ?? TOLERANCE;
  const tailleMaxLot = options.tailleMaxLot ?? TAILLE_MAX_LOT;
  const delaiMax = options.delaiMax ?? JOURS_APRES;

  let candidats = candidatsSimples(factures, operations, tolerance, delaiMax);
  candidats = candidats.concat(candidatsLots(factures, operations, tolerance, tailleMaxLot, delaiMax));

  // Les meilleurs scores figent leur appariement en premier. Un virement
  // dont une seule facture explique le montant *exactement* n'a pas besoin
  // d'etre confirme par le libelle, sauf si une autre facture du meme
  // montant s'en approche presque autant (deux factures de meme montant qui
  // se disputent le virement).
  const parOperation = new Map();
  for (const c of candidats) {
    if (c.factures.length === 1 && (c.methode === "exact" || c.methode === "fourchette")) {
      const key = c.operation;
      if (!parOperation.has(key)) parOperation.set(key, []);
      parOperation.get(key).push(c);
    }
  }
  for (const rivaux of parOperation.values()) {
    rivaux.sort((a, b) => a.ecart - b.ecart);
    const meilleur = rivaux[0];
    if (meilleur.ecart >= 0.01) continue;
    if (rivaux.length === 1 || rivaux[1].ecart >= meilleur.ecart + 0.005) {
      meilleur.decisif = true;
      meilleur.score = round4(meilleur.score + 0.25);
    }
  }

  candidats.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.factures.length !== b.factures.length) return a.factures.length - b.factures.length;
    return a.ecart - b.ecart;
  });

  const facturesPrises = new Set();
  const operationsPrises = new Set();
  const retenus = [];

  for (const candidat of candidats) {
    if (operationsPrises.has(candidat.operation)) continue;
    if (candidat.factures.some((f) => facturesPrises.has(f.cle))) continue;

    const retenuCles = new Set(candidat.factures.map((f) => f.cle));
    const rivales = candidats.filter((c) => {
      if (c.operation !== candidat.operation) return false;
      const cles = new Set(c.factures.map((f) => f.cle));
      if (cles.size === retenuCles.size && [...cles].every((x) => retenuCles.has(x))) return false;
      if (c.score < candidat.score - 0.05) return false;
      if (c.factures.some((f) => facturesPrises.has(f.cle))) return false;
      return true;
    });

    if (rivales.length) {
      const autres = [...new Set(rivales.map((c) => c.factures.map((f) => f.numero).join("+")))].sort().slice(0, 3).join(", ");
      candidat.commentaire = `${candidat.commentaire ? candidat.commentaire + " — " : ""}À VÉRIFIER : d'autres combinaisons collent aussi (${autres})`;
    }

    retenus.push(candidat);
    operationsPrises.add(candidat.operation);
    for (const f of candidat.factures) facturesPrises.add(f.cle);
  }

  return {
    rapprochements: retenus,
    facturesNonReglees: factures.filter((f) => !facturesPrises.has(f.cle)),
    operationsNonAffectees: operations.filter((o) => !operationsPrises.has(o)),
    parFacture() {
      const out = new Map();
      for (const r of retenus) for (const f of r.factures) out.set(f.cle, r);
      return out;
    },
  };
}

module.exports = { rapprocher, indiceLibelle, proximite, datePlausible, certain, corrobore, JOURS_APRES, TOLERANCE, TAILLE_MAX_LOT };

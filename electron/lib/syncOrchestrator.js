"use strict";

// Orchestrateur de synchronisation entre postes : un cycle complet consiste,
// pour chacune des 4 collections (entreprises, clients, articles, factures),
// a telecharger la version sur Drive (voir driveSync.js), la fusionner avec
// la copie locale par id (voir syncMerge.js), puis a ecrire le resultat
// fusionne localement ET a le renvoyer sur Drive — pour que Drive reflete
// toujours la derniere version fusionnee connue, et que le prochain poste a
// se synchroniser reparte de la bonne base.
//
// Une collection qui echoue (reseau coupe, cle absente, etc.) n'empeche pas
// les autres de se synchroniser : chaque collection est traitee
// independamment, les erreurs sont rassemblees et renvoyees a l'appelant
// plutot que de faire planter tout le cycle.

const { estConfigure, telechargerJson, envoyerJson } = require("./driveSync");
const { fusionnerParId } = require("./syncMerge");

const db = require("../db");
const clientsModule = require("./clients");
const articlesModule = require("../articles");
const invoicesModule = require("../invoices");

// Chaque collection : le nom du fichier sur Drive, comment lire la version
// locale complete (tombstones inclus), et comment remplacer la version
// locale par un resultat deja fusionne.
const COLLECTIONS = [
  {
    nom: "companies.json",
    listerLocal: () => db.listAllForSync(),
    remplacerLocal: (nouvelles) => db.remplacerCompanies(nouvelles),
  },
  {
    nom: "clients.json",
    listerLocal: () => clientsModule.listAllForSync(),
    remplacerLocal: (nouveaux) => clientsModule.remplacerTousLesClients(nouveaux),
  },
  {
    nom: "articles.json",
    listerLocal: () => articlesModule.listAllForSync(),
    remplacerLocal: (nouveaux) => articlesModule.remplacerTousLesArticles(nouveaux),
  },
  {
    nom: "invoices.json",
    listerLocal: () => invoicesModule.listAllForSync(),
    remplacerLocal: (nouvelles) => invoicesModule.remplacerToutesLesFactures(nouvelles),
  },
];

// Un poste tout juste installe/reinitialise cree localement, avant meme
// que la synchronisation ait eu la chance de tourner, une entreprise par
// defaut vide (voir db.js, newCompany/load) pour que l'app ait toujours au
// moins une entreprise a afficher. Son id est propre a ce poste : une fois
// la vraie entreprise recuperee depuis Drive, fusionnerParId les traite
// comme deux enregistrements distincts et garde les deux, ce qui fait
// apparaitre un second profil fantome "(Sans nom)" a cote du bon.
//
// On la reconnait par ses donnees plutot que par le seul marqueur
// estPlaceholderAuto (db.js) : nom vide ET jamais modifiee depuis sa
// creation (updatedAt === createdAt — toute sauvegarde reelle, meme
// partielle, change updatedAt). Ca couvre aussi bien les placeholders
// crees par les versions a jour de db.js que ceux deja crees par une
// version plus ancienne (sans le marqueur) avant ce correctif — sans quoi
// un poste deja touche par le bug resterait pollue pour toujours, meme
// apres la mise a jour. Des qu'au moins une autre entreprise (reelle)
// existe dans le resultat fusionne, ce placeholder est jetable sans perte.
function estPlaceholderJetable(c) {
  if (!c) return false;
  const nomVide = !c.company_name || !c.company_name.trim();
  const jamaisModifiee = c.updatedAt === c.createdAt;
  return nomVide && jamaisModifiee;
}

function retirerPlaceholdersVides(companies) {
  if (!Array.isArray(companies) || companies.length <= 1) return companies;
  const reelles = companies.filter((c) => !estPlaceholderJetable(c));
  // Si tout n'est que des placeholders (deux postes neufs synchronises
  // avant que l'un ou l'autre n'ait de vraies donnees), on ne vide pas la
  // liste : rien de mieux a garder pour l'instant.
  return reelles.length > 0 ? reelles : companies;
}

// Synchronise une seule collection : telecharge, fusionne, ecrit localement,
// renvoie sur Drive. Renvoie le nombre d'enregistrements apres fusion.
async function synchroniserCollection(def) {
  const distant = await telechargerJson(def.nom); // null si jamais synchronise depuis aucun poste
  const local = def.listerLocal();
  let fusionne = fusionnerParId(local, distant || []);
  if (def.nom === "companies.json") fusionne = retirerPlaceholdersVides(fusionne);
  def.remplacerLocal(fusionne);
  await envoyerJson(def.nom, fusionne);
  return fusionne.length;
}

// Un seul cycle a la fois (le minuteur periodique et le declenchement avant
// numerotation pourraient sinon se chevaucher).
let cycleEnCours = false;

// Un cycle complet, les 4 collections. Ne fait rien (et renvoie
// { ok: false, raison: "non-configure" }) tant qu'aucune cle n'est en place
// sur ce poste — c'est l'etat normal avant que l'utilisateur n'ait copie le
// fichier de cles (voir main.js, configurerSynchronisationDrive).
async function executerCycleDeSync() {
  if (!estConfigure()) return { ok: false, raison: "non-configure" };
  if (cycleEnCours) return { ok: false, raison: "deja-en-cours" };

  cycleEnCours = true;
  const resultats = {};
  const erreurs = {};
  try {
    for (const def of COLLECTIONS) {
      try {
        resultats[def.nom] = await synchroniserCollection(def);
      } catch (err) {
        erreurs[def.nom] = err.message || String(err);
      }
    }
  } finally {
    cycleEnCours = false;
  }

  return { ok: Object.keys(erreurs).length === 0, resultats, erreurs };
}

// Ne synchronise que les factures, utilise juste avant d'attribuer un
// numero (voir invoices:nextNumero dans main.js) : si deux postes emettent
// une facture a peu pres en meme temps (bascule de l'un a l'autre), chacun
// part du compte le plus a jour possible plutot que du dernier etat connu
// localement, qui peut dater du dernier cycle periodique. N'echoue jamais
// bruyamment : si Drive est injoignable a cet instant precis, on retombe
// silencieusement sur les donnees locales plutot que de bloquer la creation
// d'une facture pour une histoire de reseau.
async function synchroniserFacturesAvantNumerotation() {
  if (!estConfigure()) return;
  const def = COLLECTIONS.find((c) => c.nom === "invoices.json");
  try {
    await synchroniserCollection(def);
  } catch (err) {
    console.error(
      "Sync Drive (avant numerotation) : echec, on continue avec les donnees locales :",
      err.message || err
    );
  }
}

module.exports = { executerCycleDeSync, synchroniserFacturesAvantNumerotation };

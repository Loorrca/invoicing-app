import React, { useEffect, useMemo, useState } from "react";
import Calculatrice from "../components/Calculatrice.jsx";
import ArticlesManager from "../components/ArticlesManager.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import FilterSuggestInput from "../components/FilterSuggestInput.jsx";
import { TAUX_TVA, TAUX_FODEC } from "../utils/taxRates.js";

const NOUVEL_ARTICLE = "__new_article__";
const NOUVEAU_CLIENT = "__new_client__";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function emptyLigne() {
  return { code: "", designation: "", quantite: 1, prixUnitaire: 0 };
}

function emptyClientDraft() {
  return { nom: "", code: "", adresse: "" };
}

// Le dinar tunisien n'a pas de sous-unite en dessous du millime (3 decimales) :
// un prix unitaire ne doit donc jamais afficher ou utiliser un 4e chiffre
// apres la virgule (ex. 16 HT + FODEC 1% + TVA 19% = 19,2304 — ce 4e chiffre
// n'existe dans aucune monnaie reelle). On arrondit au millime le plus proche
// (1-4 vers le bas, 5-9 vers le haut) AVANT tout calcul ou affichage, et on
// reutilise ce prix arrondi pour le Total de la ligne, pour que le P.U.HT
// affiche x la Qte affichee redonne exactement le Total affiche. Meme regle
// que electron/lib/invoiceTemplate.js (voir arrondirMillime la-bas).
function round(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

// Reprend exactement la formule du gabarit PDF (electron/lib/invoiceTemplate.js) :
// le timbre fiscal, saisi a la main et optionnel, s'ajoute au TTC sans etre
// soumis a la T.V.A ni au FODEC.
//
// IMPORTANT (revu le 4/10/2026, suite a une erreur) : le FODEC et la T.V.A
// sont appliques UNE SEULE FOIS sur le sous-total HT de la facture entiere,
// jamais ligne par ligne ni en arrondissant un prix unitaire TTC avant de le
// multiplier par la quantite — un essai precedent dans ce sens avait fausse
// le TOTAL T.T.C de plusieurs millimes a chaque facture (ex. 1 730,800 au
// lieu du 1 730,736 mathematiquement exact pour 100x6,4 + 200x4 HT) :
// arrondir avant de multiplier par une grande quantite amplifie l'erreur et
// peut donner un TTC incorrect sur un document fiscal. On arrondit donc
// seulement le resultat FINAL de chaque total (ht/fodec/tva/ttc) au millime
// le plus proche, jamais les valeurs intermediaires — c'est la seule
// methode exacte au millime pres. Seul le prix unitaire HT lui-meme est
// arrondi avant d'etre multiplie par la quantite (meme arrondi que celui
// imprime en P.U.HT) : simple coherence d'affichage, ca ne change rien au
// calcul de la T.V.A/FODEC.
//
// `prixImposesTtc` (case "Prix TTC imposes (appel d'offres)") : certains
// appels d'offres imposent un P.U.TTC deja arrondi au millime par leur
// propre formulaire — facturer au P.U.HT catalogue "propre" et taxer
// normalement donnerait alors un TOTAL T.T.C legerement different du prix
// engage dans l'appel d'offres. Quand la case est cochee, le champ prix de
// chaque ligne est interprete comme ce P.U.TTC impose au lieu du P.U.HT
// habituel : on retrouve le P.U.HT implique (sans l'arrondir) pour
// l'inclure dans le sous-total HT, qui est ensuite taxe une seule fois
// comme ci-dessus — par construction algebrique, Qte x P.U.TTC impose
// retombe alors exactement sur la part de TOTAL T.T.C de cette ligne. Meme
// formule que electron/lib/invoiceTemplate.js.
function calculerTotaux(lignes, avecFodec, avecTimbre, timbre, prixImposesTtc) {
  const tauxFodec = avecFodec ? TAUX_FODEC : 0;
  let ht;
  if (prixImposesTtc) {
    const diviseurTtc = (1 + tauxFodec) * (1 + TAUX_TVA);
    ht = lignes.reduce((s, l) => s + (Number(l.quantite) || 0) * (round(l.prixUnitaire) / diviseurTtc), 0);
  } else {
    ht = lignes.reduce((s, l) => s + (Number(l.quantite) || 0) * round(l.prixUnitaire), 0);
  }
  const fodec = avecFodec ? ht * TAUX_FODEC : 0;
  const tva = (ht + fodec) * TAUX_TVA;
  const ttc = ht + fodec + tva;
  const timbreApplique = avecTimbre ? Number(timbre) || 0 : 0;
  return {
    ht: round(ht),
    fodec: round(fodec),
    tva: round(tva),
    ttc: round(ttc),
    timbre: round(timbreApplique),
    totalGeneral: round(ttc + timbreApplique),
  };
}

function fmt(n) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export default function NewInvoice({ editingId, activeCompanyId, onSaved, onCancelEdit }) {
  const [numero, setNumero] = useState("");
  const [date, setDate] = useState(todayIso());
  const [bonCommande, setBonCommande] = useState("");
  const [bonsLivraison, setBonsLivraison] = useState([""]);
  const [avecFodec, setAvecFodec] = useState(true);
  const [avecTimbre, setAvecTimbre] = useState(false);
  const [timbre, setTimbre] = useState("");
  // Appel d'offres qui impose un P.U.TTC deja arrondi au millime : voir le
  // commentaire JSDoc de calculerTotaux ci-dessus.
  const [prixImposesTtc, setPrixImposesTtc] = useState(false);
  const [lignes, setLignes] = useState([emptyLigne()]);
  const [status, setStatus] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [loadingRecord, setLoadingRecord] = useState(!!editingId);

  const [articles, setArticles] = useState([]);
  // rowIndex en attente quand la fenetre de gestion des articles a ete
  // ouverte depuis le selecteur d'une ligne ("+ Nouvel article..."), sinon
  // null (ouverte via le lien general "Gerer les articles").
  const [articlesManagerFor, setArticlesManagerFor] = useState(null); // { rowIndex } | "general" | null
  const [showCalc, setShowCalc] = useState(false);

  // Client choisi dans le catalogue : clientId pointe vers `clients`. En
  // modification d'une ancienne facture, le client peut etre une simple
  // chaine (avant le catalogue) ou un instantane qui ne correspond plus a
  // aucune fiche du catalogue actuel (supprimee depuis) : on la garde telle
  // quelle dans clientFallback tant que l'utilisateur ne choisit pas
  // explicitement un autre client.
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("");
  const [clientFallback, setClientFallback] = useState(null); // string | {id,nom,code,adresse} | null
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientDraft, setNewClientDraft] = useState(emptyClientDraft());

  useEffect(() => {
    window.api.listArticles().then(setArticles).catch(() => {});
    window.api.listClients().then(setClients).catch(() => {});
  }, []);

  // En mode modification, on recharge la facture existante depuis l'historique.
  // Sinon (nouvelle facture), on propose le prochain numero disponible.
  useEffect(() => {
    if (editingId) {
      setLoadingRecord(true);
      Promise.all([window.api.getInvoiceRecord(editingId), window.api.listClients()])
        .then(([record, clientList]) => {
          if (!record || (activeCompanyId && record.companyId !== activeCompanyId)) {
            onCancelEdit?.();
            return;
          }
          setNumero(record.numero || "");
          setDate(record.date || todayIso());
          setBonCommande(record.bonCommande || "");
          const bl = Array.isArray(record.bonLivraison)
            ? record.bonLivraison
            : record.bonLivraison
            ? [record.bonLivraison]
            : [];
          setBonsLivraison(bl.length ? bl : [""]);
          setAvecFodec(record.avecFodec !== false);
          setAvecTimbre(!!record.avecTimbre);
          setTimbre(record.timbre ?? "");
          setPrixImposesTtc(!!record.prixImposesTtc);
          setLignes(
            record.lignes && record.lignes.length
              ? record.lignes.map((l) => ({ code: l.code || "", ...l }))
              : [emptyLigne()]
          );

          // Rattache le client enregistre a une fiche du catalogue si possible
          // (par id pour un instantane, par nom pour une ancienne chaine),
          // sinon le garde tel quel en secours.
          const recorded = record.client;
          let match = null;
          if (recorded && typeof recorded === "object") {
            match = clientList.find((c) => c.id === recorded.id) || null;
          } else if (typeof recorded === "string" && recorded.trim()) {
            match = clientList.find((c) => c.nom.toLowerCase() === recorded.trim().toLowerCase()) || null;
          }
          if (match) {
            setClientId(match.id);
            setClientFallback(null);
          } else {
            setClientId("");
            setClientFallback(recorded || null);
          }
          setLoadingRecord(false);
        })
        .catch(() => setLoadingRecord(false));
    } else {
      window.api
        .getNextNumero()
        .then((suggested) => {
          if (suggested) setNumero(suggested);
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  const totaux = useMemo(
    () => calculerTotaux(lignes, avecFodec, avecTimbre, timbre, prixImposesTtc),
    [lignes, avecFodec, avecTimbre, timbre, prixImposesTtc]
  );

  function updateLigne(i, field, value) {
    setLignes((ls) => ls.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  }

  function addLigne() {
    setLignes((ls) => [...ls, emptyLigne()]);
  }

  function removeLigne(i) {
    setLignes((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));
  }

  // Remplit code + designation par defaut + prix a partir d'un article du
  // catalogue, sur une ligne donnee. Utilise aussi bien par le selecteur de
  // code que par les suggestions du champ designation (voir plus bas) : les
  // deux doivent aboutir exactement au meme resultat.
  function applyArticleToLigne(i, article) {
    setLignes((ls) =>
      ls.map((l, idx) =>
        idx === i
          ? { ...l, code: article.code || "", designation: article.designation, prixUnitaire: article.prixUnitaire }
          : l
      )
    );
  }

  // Selection d'un article par son CODE (comme sur un bon de commande) :
  // pre-remplit le code, la designation par defaut et le prix. La
  // designation reste ensuite modifiable ligne par ligne (voir updateLigne
  // plus bas) SANS que ça cree ou modifie quoi que ce soit dans le
  // catalogue : c'est juste le libelle imprime sur cette facture precise.
  // Le code, lui, reste le lien stable vers l'article du catalogue (utilise
  // notamment par l'onglet Productions pour regrouper les quantites par
  // article malgre des libelles retouches facture par facture).
  // Choisir "+ Nouvel article" ouvre plutot la fenetre de gestion.
  function handleArticleSelect(i, value) {
    if (value === NOUVEL_ARTICLE) {
      setArticlesManagerFor({ rowIndex: i });
      return;
    }
    const article = articles.find((a) => a.id === value);
    if (!article) return;
    applyArticleToLigne(i, article);
  }

  // Suggestions sous le champ Designation, filtrees au fur et a mesure de la
  // frappe (voir FilterSuggestInput) : choisir une suggestion remplit tout
  // (meme resultat que par le code), mais rien n'oblige a en choisir une —
  // taper un libelle different ou retouche reste un simple texte libre,
  // sans toucher au catalogue (meme principe que la frappe directe dans le
  // champ, voir le commentaire au-dessus de handleArticleSelect).
  function handleDesignationPick(i, article) {
    applyArticleToLigne(i, article);
  }

  // Applique un article (nouvellement cree ou existant, cliqué dans la
  // fenetre de gestion) a la ligne en attente, s'il y en a une.
  function handleApplyArticle(article) {
    const target = articlesManagerFor;
    setArticlesManagerFor(null);
    if (!target || target === "general" || target.rowIndex === undefined) return;
    setLignes((ls) =>
      ls.map((l, idx) =>
        idx === target.rowIndex
          ? { ...l, code: article.code || "", designation: article.designation, prixUnitaire: article.prixUnitaire }
          : l
      )
    );
  }

  function updateBonLivraison(i, value) {
    setBonsLivraison((bs) => bs.map((b, idx) => (idx === i ? value : b)));
  }

  function addBonLivraison() {
    setBonsLivraison((bs) => [...bs, ""]);
  }

  function removeBonLivraison(i) {
    setBonsLivraison((bs) => (bs.length > 1 ? bs.filter((_, idx) => idx !== i) : bs));
  }

  // Remet tous les champs de la facture a leur valeur de depart, SAUF le
  // numero de facture (laisse tel quel). Utilise par le bouton
  // "Reinitialiser" et, apres generation reussie d'une nouvelle facture,
  // pour repartir aussitot sur une facture vierge.
  function resetFields() {
    setDate(todayIso());
    setBonCommande("");
    setBonsLivraison([""]);
    setAvecFodec(true);
    setAvecTimbre(false);
    setTimbre("");
    setLignes([emptyLigne()]);
    setClientId("");
    setClientFallback(null);
    setShowNewClient(false);
    setNewClientDraft(emptyClientDraft());
  }

  function handleResetAll() {
    resetFields();
    setStatus(null);
  }

  function handleClientSelect(value) {
    if (value === NOUVEAU_CLIENT) {
      setShowNewClient(true);
      return;
    }
    setClientId(value);
    setClientFallback(null);
  }

  async function handleAddClient(e) {
    e.preventDefault();
    const nom = newClientDraft.nom.trim();
    if (!nom) return;
    const created = await window.api.addClient({
      nom,
      adresse: newClientDraft.adresse.trim(),
    });
    setClients((cs) => [...cs, created].sort((a, b) => a.nom.localeCompare(b.nom, "fr")));
    setClientId(created.id);
    setClientFallback(null);
    setNewClientDraft(emptyClientDraft());
    setShowNewClient(false);
  }

  const selectedClient = clientId ? clients.find((c) => c.id === clientId) : null;
  const clientPreview = selectedClient || (typeof clientFallback === "object" ? clientFallback : null);
  const clientFallbackLabel = typeof clientFallback === "string" ? clientFallback : clientPreview?.nom || "";

  async function handleGenerate(e) {
    e.preventDefault();
    setStatus(null);

    const client = selectedClient
      ? { id: selectedClient.id, nom: selectedClient.nom, code: selectedClient.code, adresse: selectedClient.adresse }
      : clientFallback;
    if (!client || (typeof client === "object" && !client.nom) || (typeof client === "string" && !client.trim())) {
      setStatus({ kind: "error", text: "Choisissez un client." });
      return;
    }

    setGenerating(true);
    try {
      const invoice = {
        numero: numero.trim(),
        date,
        client,
        bonCommande: bonCommande.trim(),
        bonLivraison: bonsLivraison.map((b) => b.trim()).filter(Boolean),
        avecFodec,
        avecTimbre,
        timbre: avecTimbre ? Number(timbre) || 0 : 0,
        prixImposesTtc,
        lignes: lignes
          .filter((l) => l.designation.trim() || Number(l.quantite) || Number(l.prixUnitaire))
          .map((l) => ({
            code: (l.code || "").trim(),
            designation: l.designation.trim(),
            quantite: Number(l.quantite) || 0,
            prixUnitaire: Number(l.prixUnitaire) || 0,
          })),
      };
      const result = editingId
        ? await window.api.updateAndSaveInvoice(editingId, invoice)
        : await window.api.generateInvoicePdf(invoice);
      if (result.canceled) {
        setStatus({ kind: "error", text: result.error || "Impossible d'enregistrer la facture." });
      } else {
        setStatus({
          kind: "ok",
          text: editingId ? `Facture mise a jour : ${result.filePath}` : `PDF enregistre : ${result.filePath}`,
        });
        if (!editingId) {
          // Nouvelle facture generee : on repart directement sur une facture
          // vierge, avec le numero suivant propose automatiquement.
          resetFields();
          try {
            const suggested = await window.api.getNextNumero();
            if (suggested) setNumero(suggested);
          } catch {
            // Au pire, l'utilisateur garde l'ancien numero et le corrige a la main.
          }
        }
        onSaved?.();
      }
    } catch (err) {
      setStatus({ kind: "error", text: String(err?.message || err) });
    } finally {
      setGenerating(false);
    }
  }

  if (loadingRecord) return <div className="page page-wide">Chargement...</div>;

  return (
    <div className="page page-wide">
      <div className="page-header-row">
        <div>
          <h1>{editingId ? "Modifier la facture" : "Nouvelle facture"}</h1>
          <p className="subtitle">
            {editingId
              ? "Modifiez les informations puis enregistrez : le PDF existant sera remplace."
              : "Remplir les informations puis generer le PDF. Il est enregistre automatiquement dans le dossier Factures."}
          </p>
        </div>
        <button type="button" className="btn secondary" onClick={() => setShowCalc(true)}>
          Calculatrice P.H.T / P.T.T.C
        </button>
      </div>

      <form className="form" onSubmit={handleGenerate}>
        <div className="grid-2">
          <label>
            Numero de facture
            <input type="text" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="2026001" required />
          </label>
          <label>
            Date
            <input type="date" lang="fr" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <div className="client-field">
            <label>
              Client
              <SearchableSelect
                items={clients}
                getId={(c) => c.id}
                getLabel={(c) => c.nom}
                getCode={(c) => c.code || ""}
                value={clientId}
                onSelect={handleClientSelect}
                extraOption={{ value: NOUVEAU_CLIENT, label: "+ Nouveau client..." }}
                placeholder={clientFallbackLabel || "Choisir un client..."}
              />
            </label>
            {clientPreview && (clientPreview.code || clientPreview.adresse) && (
              <p className="field-hint">
                {clientPreview.code ? `Code : ${clientPreview.code}` : ""}
                {clientPreview.code && clientPreview.adresse ? " · " : ""}
                {clientPreview.adresse ? clientPreview.adresse : ""}
              </p>
            )}
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={avecFodec} onChange={(e) => setAvecFodec(e.target.checked)} />
            Appliquer le FODEC ({TAUX_FODEC * 100}%)
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={prixImposesTtc}
              onChange={(e) => setPrixImposesTtc(e.target.checked)}
            />
            Prix TTC imposes
          </label>
          <label>
            Bon de commande N&deg; (optionnel)
            <input type="text" value={bonCommande} onChange={(e) => setBonCommande(e.target.value)} />
          </label>
          <div className="timbre-field">
            <label className="checkbox-row">
              <input type="checkbox" checked={avecTimbre} onChange={(e) => setAvecTimbre(e.target.checked)} />
              Ajouter le timbre fiscal
            </label>
            {avecTimbre && (
              <input
                type="number"
                min="0"
                step="any"
                className="timbre-amount"
                placeholder="Montant du timbre (DT)"
                value={timbre}
                onChange={(e) => setTimbre(e.target.value)}
              />
            )}
          </div>
        </div>

        <div className="bl-block">
          <label className="bl-label">
            Bons de livraison N&deg; (optionnel &mdash; une facture peut &ecirc;tre livr&eacute;e en plusieurs fois)
          </label>
          {bonsLivraison.map((b, i) => (
            <div className="bl-row" key={i}>
              <input
                type="text"
                value={b}
                placeholder="310"
                onChange={(e) => updateBonLivraison(i, e.target.value)}
              />
              <button
                type="button"
                className="btn icon"
                onClick={() => removeBonLivraison(i)}
                aria-label="Supprimer ce bon de livraison"
                disabled={bonsLivraison.length === 1}
              >
                &times;
              </button>
            </div>
          ))}
          <button type="button" className="btn secondary bl-add" onClick={addBonLivraison}>
            + Ajouter un bon de livraison
          </button>
        </div>

        <div className="page-header-row">
          <h2 className="section-title">Lignes</h2>
          <button type="button" className="btn secondary" onClick={() => setArticlesManagerFor("general")}>
            G&eacute;rer les articles
          </button>
        </div>
        <table className="lignes-editor">
          <thead>
            <tr>
              <th style={{ width: "14%" }}>Code</th>
              <th>Designation</th>
              <th style={{ width: "10%" }}>Qte</th>
              <th style={{ width: "14%" }}>{prixImposesTtc ? "P.U.TTC (DT)" : "P.U.HT (DT)"}</th>
              <th style={{ width: "14%" }}>Total</th>
              <th style={{ width: "4%" }}></th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, i) => (
              <tr key={i}>
                <td>
                  <SearchableSelect
                    items={articles}
                    getId={(a) => a.id}
                    getLabel={(a) => a.code || a.designation}
                    getCode={(a) => (a.code ? a.designation : "")}
                    value={
                      (l.code
                        ? articles.find((a) => a.code && a.code.toLowerCase() === l.code.toLowerCase())?.id
                        : articles.find((a) => !a.code && a.designation === l.designation)?.id) || ""
                    }
                    onSelect={(val) => handleArticleSelect(i, val)}
                    extraOption={{ value: NOUVEL_ARTICLE, label: "+ Nouvel article..." }}
                    placeholder={l.code || "Choisir un article..."}
                  />
                </td>
                <td>
                  <FilterSuggestInput
                    items={articles}
                    getLabel={(a) => a.designation}
                    getCode={(a) => a.code || ""}
                    value={l.designation}
                    onChange={(text) => updateLigne(i, "designation", text)}
                    onPick={(article) => handleDesignationPick(i, article)}
                    placeholder="Designation"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className="qte-input"
                    value={l.quantite}
                    onChange={(e) => updateLigne(i, "quantite", e.target.value)}
                    onFocus={(e) => e.target.select()}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={l.prixUnitaire}
                    onChange={(e) => updateLigne(i, "prixUnitaire", e.target.value)}
                    onFocus={(e) => e.target.select()}
                  />
                </td>
                <td className="num">{fmt((Number(l.quantite) || 0) * round(l.prixUnitaire))}</td>
                <td>
                  <button type="button" className="btn icon" onClick={() => removeLigne(i)} aria-label="Supprimer la ligne">
                    &times;
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn secondary" onClick={addLigne}>+ Ajouter une ligne</button>

        <div className="totaux-preview">
          <div><span>P.T.H.T</span><span>{fmt(totaux.ht)} DT</span></div>
          {avecFodec && <div><span>FODEC {TAUX_FODEC * 100}%</span><span>{fmt(totaux.fodec)} DT</span></div>}
          <div><span>T.V.A {TAUX_TVA * 100}%</span><span>{fmt(totaux.tva)} DT</span></div>
          <div className={avecTimbre && totaux.timbre > 0 ? "" : "ttc"}>
            <span>TOTAL T.T.C</span><span>{fmt(totaux.ttc)} DT</span>
          </div>
          {avecTimbre && totaux.timbre > 0 && (
            <>
              <div><span>Timbre fiscal</span><span>{fmt(totaux.timbre)} DT</span></div>
              <div className="ttc"><span>NET A PAYER</span><span>{fmt(totaux.totalGeneral)} DT</span></div>
            </>
          )}
        </div>

        <div className="actions">
          <button type="submit" className="btn primary" disabled={generating}>
            {generating ? "Enregistrement..." : editingId ? "Enregistrer les modifications" : "Generer le PDF"}
          </button>
          <button type="button" className="btn secondary" onClick={handleResetAll} disabled={generating}>
            Reinitialiser
          </button>
          {editingId && (
            <button type="button" className="btn secondary" onClick={() => onCancelEdit?.()}>
              Annuler
            </button>
          )}
          {status && (
            <span className={`status ${status.kind === "ok" ? "ok" : status.kind === "error" ? "error" : ""}`}>
              {status.text}
            </span>
          )}
        </div>
      </form>

      {showCalc && <Calculatrice avecFodecParDefaut={avecFodec} onClose={() => setShowCalc(false)} />}

      {articlesManagerFor && (
        <ArticlesManager
          articles={articles}
          setArticles={setArticles}
          onApply={handleApplyArticle}
          onClose={() => setArticlesManagerFor(null)}
        />
      )}

      {showNewClient && (
        <div className="modal-overlay" onClick={() => setShowNewClient(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleAddClient}>
            <h2 className="section-title">Nouveau client</h2>
            <label>
              Nom (catalogue)
              <input
                type="text"
                autoFocus
                value={newClientDraft.nom}
                onChange={(e) => setNewClientDraft((d) => ({ ...d, nom: e.target.value }))}
                required
              />
            </label>
            <label>
              Adresse (optionnel)
              <input
                type="text"
                value={newClientDraft.adresse}
                onChange={(e) => setNewClientDraft((d) => ({ ...d, adresse: e.target.value }))}
              />
            </label>
            <p className="field-hint">Le code client est attribue automatiquement (3 chiffres).</p>
            <div className="actions">
              <button type="submit" className="btn primary">Ajouter</button>
              <button type="button" className="btn secondary" onClick={() => setShowNewClient(false)}>
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

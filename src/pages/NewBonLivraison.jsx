import React, { useEffect, useState } from "react";
import ArticlesManager from "../components/ArticlesManager.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import FilterSuggestInput from "../components/FilterSuggestInput.jsx";

const NOUVEL_ARTICLE = "__new_article__";
const NOUVEAU_CLIENT = "__new_client__";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function emptyLigne() {
  return { code: "", designation: "", quantite: 1 };
}

function emptyClientDraft() {
  return { nom: "", code: "", adresse: "" };
}

// Formulaire de bon de livraison : exactement le meme principe que
// NewInvoice.jsx (meme catalogue articles/clients, memes suggestions), mais
// sans aucun prix ni total - un bon de livraison n'est qu'une preuve de
// livraison, jamais un document fiscal. Voir electron/bonsLivraison.js et
// electron/lib/bonLivraisonTemplate.js cote backend.
export default function NewBonLivraison({ editingId, activeCompanyId, onSaved, onCancelEdit }) {
  const [numero, setNumero] = useState("");
  const [date, setDate] = useState(todayIso());
  const [bonCommande, setBonCommande] = useState("");
  const [lignes, setLignes] = useState([emptyLigne()]);
  const [status, setStatus] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [loadingRecord, setLoadingRecord] = useState(!!editingId);

  const [articles, setArticles] = useState([]);
  const [articlesManagerFor, setArticlesManagerFor] = useState(null); // { rowIndex } | "general" | null

  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("");
  const [clientFallback, setClientFallback] = useState(null); // string | {id,nom,code,adresse} | null
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientDraft, setNewClientDraft] = useState(emptyClientDraft());

  useEffect(() => {
    window.api.listArticles().then(setArticles).catch(() => {});
    window.api.listClients().then(setClients).catch(() => {});
  }, []);

  useEffect(() => {
    if (editingId) {
      setLoadingRecord(true);
      Promise.all([window.api.getBonLivraisonRecord(editingId), window.api.listClients()])
        .then(([record, clientList]) => {
          if (!record || (activeCompanyId && record.companyId !== activeCompanyId)) {
            onCancelEdit?.();
            return;
          }
          setNumero(record.numero || "");
          setDate(record.date || todayIso());
          setBonCommande(record.bonCommande || "");
          setLignes(
            record.lignes && record.lignes.length
              ? record.lignes.map((l) => ({ code: l.code || "", designation: l.designation || "", quantite: l.quantite }))
              : [emptyLigne()]
          );

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
      // Meme logique en deux temps que NewInvoice.jsx : proposition locale
      // instantanee, puis correction silencieuse une fois la synchro Drive
      // revenue (voir bonsLivraison:nextNumero/nextNumeroLocal dans main.js).
      let numeroLocalPropose = null;
      window.api
        .getNextNumeroBonLivraisonLocal()
        .then((suggested) => {
          if (suggested) {
            numeroLocalPropose = suggested;
            setNumero(suggested);
          }
        })
        .catch(() => {})
        .finally(() => {
          window.api
            .getNextNumeroBonLivraison()
            .then((suggested) => {
              if (suggested) setNumero((actuel) => (actuel === numeroLocalPropose ? suggested : actuel));
            })
            .catch(() => {});
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  function updateLigne(i, field, value) {
    setLignes((ls) => ls.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  }

  function addLigne() {
    setLignes((ls) => [...ls, emptyLigne()]);
  }

  function removeLigne(i) {
    setLignes((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));
  }

  function applyArticleToLigne(i, article) {
    setLignes((ls) =>
      ls.map((l, idx) => (idx === i ? { ...l, code: article.code || "", designation: article.designation } : l))
    );
  }

  function handleArticleSelect(i, value) {
    if (value === NOUVEL_ARTICLE) {
      setArticlesManagerFor({ rowIndex: i });
      return;
    }
    const article = articles.find((a) => a.id === value);
    if (!article) return;
    applyArticleToLigne(i, article);
  }

  function handleDesignationPick(i, article) {
    applyArticleToLigne(i, article);
  }

  function handleApplyArticle(article) {
    const target = articlesManagerFor;
    setArticlesManagerFor(null);
    if (!target || target === "general" || target.rowIndex === undefined) return;
    setLignes((ls) =>
      ls.map((l, idx) => (idx === target.rowIndex ? { ...l, code: article.code || "", designation: article.designation } : l))
    );
  }

  function resetFields() {
    setDate(todayIso());
    setBonCommande("");
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
      const bonLivraison = {
        numero: numero.trim(),
        date,
        client,
        bonCommande: bonCommande.trim(),
        lignes: lignes
          .filter((l) => l.designation.trim() || Number(l.quantite))
          .map((l) => ({
            code: (l.code || "").trim(),
            designation: l.designation.trim(),
            quantite: Number(l.quantite) || 0,
          })),
      };
      const result = editingId
        ? await window.api.updateAndSaveBonLivraison(editingId, bonLivraison)
        : await window.api.generateBonLivraisonPdf(bonLivraison);
      if (result.canceled) {
        setStatus({ kind: "error", text: result.error || "Impossible d'enregistrer le bon de livraison." });
      } else {
        setStatus({
          kind: "ok",
          text: editingId ? `Bon de livraison mis a jour : ${result.filePath}` : `PDF enregistre : ${result.filePath}`,
        });
        if (!editingId) {
          resetFields();
          let numeroLocalPropose = null;
          try {
            const suggestedLocal = await window.api.getNextNumeroBonLivraisonLocal();
            if (suggestedLocal) {
              numeroLocalPropose = suggestedLocal;
              setNumero(suggestedLocal);
            }
          } catch {
            // Au pire, l'utilisateur garde l'ancien numero et le corrige a la main.
          }
          window.api
            .getNextNumeroBonLivraison()
            .then((suggested) => {
              if (suggested) setNumero((actuel) => (actuel === numeroLocalPropose ? suggested : actuel));
            })
            .catch(() => {});
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
          <h1>{editingId ? "Modifier le bon de livraison" : "Nouveau bon de livraison"}</h1>
          <p className="subtitle">
            {editingId
              ? "Modifiez les informations puis enregistrez : le PDF existant sera remplace."
              : "Remplir les informations puis generer le PDF. Il est enregistre automatiquement dans le dossier Bons de livraison. Sans prix : la facturation se fait ensuite depuis l'onglet Bons de livraison."}
          </p>
        </div>
      </div>

      <form className="form" onSubmit={handleGenerate}>
        <div className="grid-2">
          <label>
            Numero de bon de livraison
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
          <label>
            Bon de commande N&deg; (optionnel)
            <input type="text" value={bonCommande} onChange={(e) => setBonCommande(e.target.value)} />
          </label>
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
              <th style={{ width: "18%" }}>Code</th>
              <th>Designation</th>
              <th style={{ width: "14%" }}>Qte</th>
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
                  <button type="button" className="btn icon" onClick={() => removeLigne(i)} aria-label="Supprimer la ligne">
                    &times;
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn secondary" onClick={addLigne}>+ Ajouter une ligne</button>

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

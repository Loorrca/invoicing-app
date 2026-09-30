import React, { useEffect, useMemo, useState } from "react";
import Calculatrice from "../components/Calculatrice.jsx";

const NOUVEL_ARTICLE = "__new__";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function emptyLigne() {
  return { designation: "", quantite: 1, prixUnitaire: 0 };
}

function calculerTotaux(lignes, avecFodec) {
  const ht = lignes.reduce((s, l) => s + (Number(l.quantite) || 0) * (Number(l.prixUnitaire) || 0), 0);
  const fodec = avecFodec ? ht * 0.01 : 0;
  const tva = (ht + fodec) * 0.19;
  const ttc = ht + fodec + tva;
  const round = (n) => Math.round(n * 1000) / 1000;
  return { ht: round(ht), fodec: round(fodec), tva: round(tva), ttc: round(ttc) };
}

function fmt(n) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export default function NewInvoice({ editingId, activeCompanyId, onSaved, onCancelEdit }) {
  const [numero, setNumero] = useState("");
  const [date, setDate] = useState(todayIso());
  const [client, setClient] = useState("");
  const [bonCommande, setBonCommande] = useState("");
  const [bonsLivraison, setBonsLivraison] = useState([""]);
  const [avecFodec, setAvecFodec] = useState(true);
  const [lignes, setLignes] = useState([emptyLigne()]);
  const [status, setStatus] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [loadingRecord, setLoadingRecord] = useState(!!editingId);

  const [articles, setArticles] = useState([]);
  // { rowIndex, designation, prixUnitaire } quand la petite fenetre d'ajout
  // d'article est ouverte, sinon null.
  const [newArticle, setNewArticle] = useState(null);
  const [showCalc, setShowCalc] = useState(false);

  useEffect(() => {
    window.api.listArticles().then(setArticles).catch(() => {});
  }, []);

  // En mode modification, on recharge la facture existante depuis l'historique.
  // Sinon (nouvelle facture), on propose le prochain numero disponible.
  useEffect(() => {
    if (editingId) {
      setLoadingRecord(true);
      window.api
        .getInvoiceRecord(editingId)
        .then((record) => {
          if (!record || (activeCompanyId && record.companyId !== activeCompanyId)) {
            onCancelEdit?.();
            return;
          }
          setNumero(record.numero || "");
          setDate(record.date || todayIso());
          setClient(record.client || "");
          setBonCommande(record.bonCommande || "");
          const bl = Array.isArray(record.bonLivraison)
            ? record.bonLivraison
            : record.bonLivraison
            ? [record.bonLivraison]
            : [];
          setBonsLivraison(bl.length ? bl : [""]);
          setAvecFodec(record.avecFodec !== false);
          setLignes(record.lignes && record.lignes.length ? record.lignes : [emptyLigne()]);
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

  const totaux = useMemo(() => calculerTotaux(lignes, avecFodec), [lignes, avecFodec]);

  function updateLigne(i, field, value) {
    setLignes((ls) => ls.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  }

  function addLigne() {
    setLignes((ls) => [...ls, emptyLigne()]);
  }

  function removeLigne(i) {
    setLignes((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));
  }

  // Selection d'un article dans la liste : pre-remplit la designation et le
  // prix (le prix reste modifiable ensuite ligne par ligne). Choisir
  // "+ Nouvel article" ouvre plutot la petite fenetre d'ajout.
  function handleArticleSelect(i, value) {
    if (value === NOUVEL_ARTICLE) {
      setNewArticle({ rowIndex: i, designation: "", prixUnitaire: "" });
      return;
    }
    const article = articles.find((a) => a.id === value);
    if (!article) return;
    setLignes((ls) =>
      ls.map((l, idx) =>
        idx === i ? { ...l, designation: article.designation, prixUnitaire: article.prixUnitaire } : l
      )
    );
  }

  async function handleAddArticle(e) {
    e.preventDefault();
    if (!newArticle) return;
    const designation = newArticle.designation.trim();
    if (!designation) return;
    const created = await window.api.addArticle({
      designation,
      prixUnitaire: Number(newArticle.prixUnitaire) || 0,
    });
    setArticles((as) => {
      const others = as.filter((a) => a.id !== created.id);
      return [...others, created].sort((a, b) => a.designation.localeCompare(b.designation, "fr"));
    });
    setLignes((ls) =>
      ls.map((l, idx) =>
        idx === newArticle.rowIndex
          ? { ...l, designation: created.designation, prixUnitaire: created.prixUnitaire }
          : l
      )
    );
    setNewArticle(null);
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

  async function handleGenerate(e) {
    e.preventDefault();
    setStatus(null);
    setGenerating(true);
    try {
      const invoice = {
        numero: numero.trim(),
        date,
        client: client.trim(),
        bonCommande: bonCommande.trim(),
        bonLivraison: bonsLivraison.map((b) => b.trim()).filter(Boolean),
        avecFodec,
        lignes: lignes
          .filter((l) => l.designation.trim() || Number(l.quantite) || Number(l.prixUnitaire))
          .map((l) => ({
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
        onSaved?.();
      }
    } catch (err) {
      setStatus({ kind: "error", text: String(err?.message || err) });
    } finally {
      setGenerating(false);
    }
  }

  if (loadingRecord) return <div className="page">Chargement...</div>;

  return (
    <div className="page">
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
            <input type="text" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="0080" required />
          </label>
          <label>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label>
            Client
            <input type="text" value={client} onChange={(e) => setClient(e.target.value)} required />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={avecFodec} onChange={(e) => setAvecFodec(e.target.checked)} />
            Appliquer le FODEC (1%)
          </label>
          <label>
            Bon de commande N&deg; (optionnel)
            <input type="text" value={bonCommande} onChange={(e) => setBonCommande(e.target.value)} />
          </label>
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

        <h2 className="section-title">Lignes</h2>
        <table className="lignes-editor">
          <thead>
            <tr>
              <th style={{ width: "12%" }}>Qte</th>
              <th>Designation</th>
              <th style={{ width: "18%" }}>P.U (DT)</th>
              <th style={{ width: "18%" }}>Total</th>
              <th style={{ width: "5%" }}></th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, i) => (
              <tr key={i}>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={l.quantite}
                    onChange={(e) => updateLigne(i, "quantite", e.target.value)}
                  />
                </td>
                <td>
                  <select
                    value={articles.find((a) => a.designation === l.designation)?.id || ""}
                    onChange={(e) => handleArticleSelect(i, e.target.value)}
                  >
                    <option value="" disabled>
                      {l.designation ? l.designation : "Choisir un article..."}
                    </option>
                    {articles.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.designation}
                      </option>
                    ))}
                    <option value={NOUVEL_ARTICLE}>+ Nouvel article...</option>
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={l.prixUnitaire}
                    onChange={(e) => updateLigne(i, "prixUnitaire", e.target.value)}
                  />
                </td>
                <td className="num">{fmt((Number(l.quantite) || 0) * (Number(l.prixUnitaire) || 0))}</td>
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
          {avecFodec && <div><span>FODEC 1%</span><span>{fmt(totaux.fodec)} DT</span></div>}
          <div><span>T.V.A 19%</span><span>{fmt(totaux.tva)} DT</span></div>
          <div className="ttc"><span>TOTAL T.T.C</span><span>{fmt(totaux.ttc)} DT</span></div>
        </div>

        <div className="actions">
          <button type="submit" className="btn primary" disabled={generating}>
            {generating ? "Enregistrement..." : editingId ? "Enregistrer les modifications" : "Generer le PDF"}
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

      {newArticle && (
        <div className="modal-overlay" onClick={() => setNewArticle(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleAddArticle}>
            <h2 className="section-title">Nouvel article</h2>
            <label>
              Designation
              <input
                type="text"
                autoFocus
                value={newArticle.designation}
                onChange={(e) => setNewArticle((n) => ({ ...n, designation: e.target.value }))}
                required
              />
            </label>
            <label>
              Prix unitaire par defaut (DT, optionnel)
              <input
                type="number"
                min="0"
                step="any"
                value={newArticle.prixUnitaire}
                onChange={(e) => setNewArticle((n) => ({ ...n, prixUnitaire: e.target.value }))}
              />
            </label>
            <div className="actions">
              <button type="submit" className="btn primary">Ajouter</button>
              <button type="button" className="btn secondary" onClick={() => setNewArticle(null)}>
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

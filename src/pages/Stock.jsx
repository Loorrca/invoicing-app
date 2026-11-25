import React, { useEffect, useMemo, useState } from "react";

function nouvelleLigneCode() {
  return { key: Math.random().toString(36).slice(2), code: "" };
}

export default function Stock() {
  const [items, setItems] = useState([]);
  const [catalogue, setCatalogue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [lignesCode, setLignesCode] = useState([nouvelleLigneCode()]);
  const [designation, setDesignation] = useState("");
  const [designationModifieeManuellement, setDesignationModifieeManuellement] = useState(false);
  const [quantiteInitiale, setQuantiteInitiale] = useState("0");
  const [confirmRetraitId, setConfirmRetraitId] = useState(null);
  const [edition, setEdition] = useState(null); // { id, valeur }
  const [lierSurId, setLierSurId] = useState(null);
  const [codeALier, setCodeALier] = useState("");

  async function refresh() {
    setLoading(true);
    const [stock, cat] = await Promise.all([window.api.listStock(), window.api.getCatalogueArticlesStock()]);
    setItems(stock);
    setCatalogue(cat);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  // Tous les codes deja rattaches a un suivi existant (tous articles
  // confondus) - jamais reproposes dans un selecteur, qu'on soit en train
  // d'en creer un nouveau ou de lier un code supplementaire a un article
  // existant : un meme code ne peut jamais appartenir a deux articles suivis
  // a la fois.
  const codesDejaSuivis = useMemo(() => new Set(items.flatMap((i) => i.codes || [])), [items]);
  const catalogueDisponible = useMemo(
    () => catalogue.filter((a) => !codesDejaSuivis.has(a.code)),
    [catalogue, codesDejaSuivis]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        (i.codes || []).some((c) => c.toLowerCase().includes(q)) ||
        (i.designation || "").toLowerCase().includes(q)
    );
  }, [items, query]);

  // Dans le formulaire d'ajout, un meme code ne doit pas pouvoir etre
  // choisi deux fois sur deux lignes differentes.
  function codesDisponiblesPourLigne(ligneKey) {
    const choisisAilleurs = new Set(
      lignesCode.filter((l) => l.key !== ligneKey && l.code).map((l) => l.code)
    );
    return catalogueDisponible.filter((a) => !choisisAilleurs.has(a.code));
  }

  function handleChoixCode(ligneKey, code) {
    setLignesCode((ls) => ls.map((l) => (l.key === ligneKey ? { ...l, code } : l)));
    // Pre-remplit la designation (modifiable ensuite) a partir du premier
    // code choisi, sans ecraser une saisie manuelle deja faite.
    if (!designationModifieeManuellement) {
      const article = catalogue.find((a) => a.code === code);
      if (article?.designation) setDesignation(article.designation);
    }
  }

  function resetFormulaireAjout() {
    setLignesCode([nouvelleLigneCode()]);
    setDesignation("");
    setDesignationModifieeManuellement(false);
    setQuantiteInitiale("0");
  }

  async function handleAdd(e) {
    e.preventDefault();
    setStatus(null);
    const codes = lignesCode.map((l) => l.code.trim()).filter(Boolean);
    if (codes.length === 0) return;
    try {
      const article = await window.api.suivreArticleStock({ codes, designation: designation.trim() });
      if (article) {
        const q = Number(quantiteInitiale);
        if (!Number.isNaN(q) && q !== 0) {
          await window.api.ajusterQuantiteStock(article.id, q);
        }
      }
      setShowAdd(false);
      resetFormulaireAjout();
      await refresh();
    } catch (err) {
      setStatus({ kind: "error", text: String(err?.message || err) });
    }
  }

  async function handleLierCode(e) {
    e.preventDefault();
    if (!lierSurId || !codeALier) return;
    setStatus(null);
    try {
      await window.api.lierCodeStock(lierSurId, codeALier);
      setLierSurId(null);
      setCodeALier("");
      await refresh();
    } catch (err) {
      setStatus({ kind: "error", text: String(err?.message || err) });
    }
  }

  async function handleRetirer(id) {
    await window.api.retirerSuiviStock(id);
    setConfirmRetraitId(null);
    await refresh();
  }

  function startEdit(item) {
    setEdition({ id: item.id, valeur: String(item.quantite) });
  }

  async function handleSaveEdit() {
    if (!edition) return;
    setStatus(null);
    try {
      await window.api.ajusterQuantiteStock(edition.id, Number(edition.valeur));
      setEdition(null);
      await refresh();
    } catch (err) {
      setStatus({ kind: "error", text: String(err?.message || err) });
    }
  }

  if (loading) return <div className="page">Chargement...</div>;

  return (
    <div className="page">
      <div className="page-header-row">
        <div>
          <h1>Stock</h1>
          <p className="subtitle">
            Articles suivis en stock, communs aux deux entreprises. Un meme article peut porter un code different
            chez chacune : regroupez-les en un seul suivi pour qu&apos;une ligne cote TEXBANNER ou cote MASTERFLAG
            deduise le meme stock. Il baisse a la generation d&apos;un bon de livraison, ou directement a la facture
            quand elle n&apos;a pas de bon de livraison d&apos;origine, et peut devenir negatif (aucun blocage en cas
            de stock insuffisant).
          </p>
        </div>
        <button type="button" className="btn primary" onClick={() => setShowAdd(true)}>
          + Suivre un article
        </button>
      </div>

      <div className="invoices-search-row">
        <input
          type="text"
          className="invoices-search"
          placeholder="Rechercher par code ou designation..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {status && (
        <p className={`status ${status.kind === "ok" ? "ok" : status.kind === "error" ? "error" : ""}`}>
          {status.text}
        </p>
      )}

      {filtered.length === 0 ? (
        <p className="subtitle">
          {query ? "Aucun article suivi ne correspond a cette recherche." : "Aucun article suivi pour le moment."}
        </p>
      ) : (
        <table className="invoices-table">
          <thead>
            <tr>
              <th>Codes equivalents</th>
              <th>Designation</th>
              <th>Quantite en stock</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id} className={item.quantite < 0 ? "row-muted" : ""}>
                <td>{(item.codes || []).join(" · ")}</td>
                <td>{item.designation || "—"}</td>
                <td>
                  {edition?.id === item.id ? (
                    <input
                      type="number"
                      autoFocus
                      value={edition.valeur}
                      onChange={(e) => setEdition((d) => ({ ...d, valeur: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveEdit();
                        if (e.key === "Escape") setEdition(null);
                      }}
                      style={{ width: "6em" }}
                    />
                  ) : (
                    <span style={{ fontWeight: 600, color: item.quantite < 0 ? "#b3261e" : undefined }}>
                      {item.quantite}
                    </span>
                  )}
                </td>
                <td className="invoices-actions">
                  {edition?.id === item.id ? (
                    <>
                      <button type="button" className="btn secondary" onClick={handleSaveEdit}>
                        Enregistrer
                      </button>
                      <button type="button" className="btn secondary" onClick={() => setEdition(null)}>
                        Annuler
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn secondary" onClick={() => startEdit(item)}>
                      Modifier
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => {
                      setLierSurId(item.id);
                      setCodeALier("");
                    }}
                  >
                    Lier un code
                  </button>
                  {confirmRetraitId === item.id ? (
                    <>
                      <button type="button" className="btn link" onClick={() => handleRetirer(item.id)}>
                        Confirmer
                      </button>
                      <button type="button" className="btn secondary" onClick={() => setConfirmRetraitId(null)}>
                        Annuler
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn icon"
                      onClick={() => setConfirmRetraitId(item.id)}
                      aria-label="Arreter de suivre cet article"
                    >
                      &times;
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showAdd && (
        <div
          className="modal-overlay"
          onClick={() => {
            setShowAdd(false);
            resetFormulaireAjout();
          }}
        >
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleAdd}>
            <h2 className="section-title">Suivre un article en stock</h2>
            <p className="field-hint">
              Choisissez un code par entreprise si le meme article porte des codes differents chez TEXBANNER et chez
              MASTERFLAG : les deux seront suivis comme un seul et meme stock.
            </p>
            {lignesCode.map((ligne, idx) => (
              <label key={ligne.key}>
                {idx === 0 ? "Code (1re entreprise)" : `Code equivalent (${idx + 1}e entreprise)`}
                <div style={{ display: "flex", gap: "0.5em" }}>
                  <select
                    value={ligne.code}
                    autoFocus={idx === 0}
                    onChange={(e) => handleChoixCode(ligne.key, e.target.value)}
                    required={idx === 0}
                    style={{ flex: 1 }}
                  >
                    <option value="" disabled>
                      Choisir un article...
                    </option>
                    {codesDisponiblesPourLigne(ligne.key).map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.code} {a.designation ? `— ${a.designation}` : ""}
                      </option>
                    ))}
                  </select>
                  {lignesCode.length > 1 && (
                    <button
                      type="button"
                      className="btn icon"
                      aria-label="Retirer ce code"
                      onClick={() => setLignesCode((ls) => ls.filter((l) => l.key !== ligne.key))}
                    >
                      &times;
                    </button>
                  )}
                </div>
              </label>
            ))}
            <button
              type="button"
              className="btn link"
              onClick={() => setLignesCode((ls) => [...ls, nouvelleLigneCode()])}
            >
              + Ajouter un code equivalent (autre entreprise)
            </button>
            <label>
              Designation
              <input
                type="text"
                value={designation}
                onChange={(e) => {
                  setDesignation(e.target.value);
                  setDesignationModifieeManuellement(true);
                }}
              />
            </label>
            <label>
              Quantite initiale en stock
              <input type="number" value={quantiteInitiale} onChange={(e) => setQuantiteInitiale(e.target.value)} />
            </label>
            <div className="actions">
              <button type="submit" className="btn primary" disabled={catalogueDisponible.length === 0}>
                Ajouter
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setShowAdd(false);
                  resetFormulaireAjout();
                }}
              >
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}

      {lierSurId && (
        <div className="modal-overlay" onClick={() => setLierSurId(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleLierCode}>
            <h2 className="section-title">Lier un code equivalent</h2>
            <p className="field-hint">
              Rattache un code supplementaire (ex. le code de l&apos;autre entreprise pour cette meme reference) a cet
              article : il partagera des lors le meme stock, historique compris.
            </p>
            <label>
              Code a lier
              <select value={codeALier} autoFocus onChange={(e) => setCodeALier(e.target.value)} required>
                <option value="" disabled>
                  Choisir un article...
                </option>
                {catalogueDisponible.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} {a.designation ? `— ${a.designation}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="actions">
              <button type="submit" className="btn primary" disabled={catalogueDisponible.length === 0}>
                Lier
              </button>
              <button type="button" className="btn secondary" onClick={() => setLierSurId(null)}>
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

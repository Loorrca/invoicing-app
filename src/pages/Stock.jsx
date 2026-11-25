import React, { useEffect, useMemo, useState } from "react";

export default function Stock() {
  const [items, setItems] = useState([]);
  const [catalogue, setCatalogue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [codeAAjouter, setCodeAAjouter] = useState("");
  const [quantiteInitiale, setQuantiteInitiale] = useState("0");
  const [confirmRetraitCode, setConfirmRetraitCode] = useState(null);
  const [edition, setEdition] = useState(null); // { code, valeur }

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

  const codesSuivis = useMemo(() => new Set(items.map((i) => i.code)), [items]);
  const catalogueDisponible = useMemo(
    () => catalogue.filter((a) => !codesSuivis.has(a.code)),
    [catalogue, codesSuivis]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) => (i.code || "").toLowerCase().includes(q) || (i.designation || "").toLowerCase().includes(q)
    );
  }, [items, query]);

  async function handleAdd(e) {
    e.preventDefault();
    setStatus(null);
    const code = codeAAjouter.trim();
    if (!code) return;
    const article = catalogue.find((a) => a.code === code);
    try {
      await window.api.suivreArticleStock({ code, designation: article?.designation || "" });
      const q = Number(quantiteInitiale);
      if (!Number.isNaN(q) && q !== 0) {
        await window.api.ajusterQuantiteStock(code, q);
      }
      setShowAdd(false);
      setCodeAAjouter("");
      setQuantiteInitiale("0");
      await refresh();
    } catch (err) {
      setStatus({ kind: "error", text: String(err?.message || err) });
    }
  }

  async function handleRetirer(code) {
    await window.api.retirerSuiviStock(code);
    setConfirmRetraitCode(null);
    await refresh();
  }

  function startEdit(item) {
    setEdition({ code: item.code, valeur: String(item.quantite) });
  }

  async function handleSaveEdit() {
    if (!edition) return;
    setStatus(null);
    try {
      await window.api.ajusterQuantiteStock(edition.code, Number(edition.valeur));
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
            Articles suivis en stock, communs aux deux entreprises (identifies par leur code, pas par leur
            designation). Le stock baisse a la generation d&apos;un bon de livraison, ou directement a la facture
            quand elle n&apos;a pas de bon de livraison d&apos;origine. Il peut devenir negatif : aucun blocage n&apos;est
            applique en cas de stock insuffisant.
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
              <th>Code</th>
              <th>Designation</th>
              <th>Quantite en stock</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.code} className={item.quantite < 0 ? "row-muted" : ""}>
                <td>{item.code}</td>
                <td>{item.designation || "—"}</td>
                <td>
                  {edition?.code === item.code ? (
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
                  {edition?.code === item.code ? (
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
                  {confirmRetraitCode === item.code ? (
                    <>
                      <button type="button" className="btn link" onClick={() => handleRetirer(item.code)}>
                        Confirmer
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => setConfirmRetraitCode(null)}
                      >
                        Annuler
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn icon"
                      onClick={() => setConfirmRetraitCode(item.code)}
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
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleAdd}>
            <h2 className="section-title">Suivre un article en stock</h2>
            <label>
              Article (catalogue des deux entreprises)
              <select
                value={codeAAjouter}
                autoFocus
                onChange={(e) => setCodeAAjouter(e.target.value)}
                required
              >
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
            <label>
              Quantite initiale en stock
              <input
                type="number"
                value={quantiteInitiale}
                onChange={(e) => setQuantiteInitiale(e.target.value)}
              />
            </label>
            <p className="field-hint">
              Seuls les articles de ce catalogue peuvent etre suivis : les lignes de facture ou de bon de livraison
              sont reconnues par leur code, qui doit correspondre exactement a l&apos;un d&apos;eux.
            </p>
            <div className="actions">
              <button type="submit" className="btn primary" disabled={catalogueDisponible.length === 0}>
                Ajouter
              </button>
              <button type="button" className="btn secondary" onClick={() => setShowAdd(false)}>
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

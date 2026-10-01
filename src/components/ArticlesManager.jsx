import React, { useState } from "react";

function emptyDraft() {
  return { code: "", designation: "", prixUnitaire: "" };
}

// Fenetre de gestion du catalogue d'articles : ajouter un article (avec son
// code), et corriger/supprimer ceux deja saisis (notamment les anciens,
// entres avant l'ajout du champ code). Ouverte soit depuis le selecteur de
// ligne ("+ Nouvel article...", avec applique automatiquement a cette
// ligne), soit depuis le lien general "Gerer les articles".
export default function ArticlesManager({ articles, setArticles, onApply, onClose }) {
  const [addDraft, setAddDraft] = useState(emptyDraft());
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(emptyDraft());
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [status, setStatus] = useState(null);

  function syncArticle(article) {
    setArticles((as) => {
      const others = as.filter((a) => a.id !== article.id);
      return [...others, article].sort((a, b) => a.designation.localeCompare(b.designation, "fr"));
    });
    return article;
  }

  async function handleAdd(e) {
    e.preventDefault();
    setStatus(null);
    const designation = addDraft.designation.trim();
    if (!designation) return;
    try {
      const created = await window.api.addArticle({
        designation,
        prixUnitaire: Number(addDraft.prixUnitaire) || 0,
        code: addDraft.code.trim(),
      });
      syncArticle(created);
      setAddDraft(emptyDraft());
      onApply?.(created);
    } catch (err) {
      setStatus({ kind: "error", text: String(err?.message || err) });
    }
  }

  function startEdit(a) {
    setEditingId(a.id);
    setEditDraft({ code: a.code || "", designation: a.designation || "", prixUnitaire: a.prixUnitaire ?? "" });
  }

  async function handleSaveEdit(id) {
    setStatus(null);
    const designation = editDraft.designation.trim();
    if (!designation) return;
    try {
      const updated = await window.api.updateArticle(id, {
        designation,
        prixUnitaire: Number(editDraft.prixUnitaire) || 0,
        code: editDraft.code.trim(),
      });
      syncArticle(updated);
      setEditingId(null);
    } catch (err) {
      setStatus({ kind: "error", text: String(err?.message || err) });
    }
  }

  async function handleDelete(id) {
    await window.api.deleteArticle(id);
    setArticles((as) => as.filter((a) => a.id !== id));
    setConfirmDeleteId(null);
  }

  const sorted = [...articles].sort((a, b) => a.designation.localeCompare(b.designation, "fr"));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal articles-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="section-title">Articles</h2>
        <p className="subtitle calc-subtitle">
          Ajoutez un article (avec son code), ou corrigez/supprimez un article deja saisi.
        </p>

        <form className="articles-add-form" onSubmit={handleAdd}>
          <label>
            Code
            <input
              type="text"
              value={addDraft.code}
              onChange={(e) => setAddDraft((d) => ({ ...d, code: e.target.value }))}
            />
          </label>
          <label>
            Designation
            <input
              type="text"
              autoFocus
              value={addDraft.designation}
              onChange={(e) => setAddDraft((d) => ({ ...d, designation: e.target.value }))}
              required
            />
          </label>
          <label>
            Prix unitaire par defaut (DT)
            <input
              type="number"
              min="0"
              step="any"
              value={addDraft.prixUnitaire}
              onChange={(e) => setAddDraft((d) => ({ ...d, prixUnitaire: e.target.value }))}
            />
          </label>
          <button type="submit" className="btn primary">+ Ajouter</button>
        </form>

        {status && (
          <p className={`status ${status.kind === "error" ? "error" : ""}`}>{status.text}</p>
        )}

        <div className="articles-list">
          {sorted.length === 0 ? (
            <p className="subtitle">Aucun article enregistre pour le moment.</p>
          ) : (
            <table className="invoices-table">
              <thead>
                <tr>
                  <th style={{ width: "18%" }}>Code</th>
                  <th>Designation</th>
                  <th className="num" style={{ width: "22%" }}>P.U (DT)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((a) =>
                  editingId === a.id ? (
                    <tr key={a.id}>
                      <td>
                        <input
                          type="text"
                          value={editDraft.code}
                          onChange={(e) => setEditDraft((d) => ({ ...d, code: e.target.value }))}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={editDraft.designation}
                          onChange={(e) => setEditDraft((d) => ({ ...d, designation: e.target.value }))}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={editDraft.prixUnitaire}
                          onChange={(e) => setEditDraft((d) => ({ ...d, prixUnitaire: e.target.value }))}
                        />
                      </td>
                      <td className="invoices-actions">
                        <button type="button" className="btn secondary" onClick={() => handleSaveEdit(a.id)}>
                          Enregistrer
                        </button>
                        <button type="button" className="btn secondary" onClick={() => setEditingId(null)}>
                          Annuler
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={a.id}>
                      <td>{a.code || "—"}</td>
                      <td>
                        <button type="button" className="btn link articles-pick" onClick={() => onApply?.(a)}>
                          {a.designation}
                        </button>
                      </td>
                      <td className="num">{Number(a.prixUnitaire || 0).toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</td>
                      <td className="invoices-actions">
                        <button type="button" className="btn secondary" onClick={() => startEdit(a)}>
                          Modifier
                        </button>
                        {confirmDeleteId === a.id ? (
                          <>
                            <button type="button" className="btn link" onClick={() => handleDelete(a.id)}>
                              Confirmer
                            </button>
                            <button type="button" className="btn secondary" onClick={() => setConfirmDeleteId(null)}>
                              Annuler
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn icon"
                            onClick={() => setConfirmDeleteId(a.id)}
                            aria-label="Supprimer cet article"
                          >
                            &times;
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="actions">
          <button type="button" className="btn secondary" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

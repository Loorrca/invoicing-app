import React, { useEffect, useState } from "react";
import { correspondTranslitteration } from "../utils/translitteration.js";

function emptyDraft() {
  return { nom: "", code: "", adresse: "" };
}

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addDraft, setAddDraft] = useState(emptyDraft());
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(emptyDraft());
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [status, setStatus] = useState(null);

  async function refresh() {
    setLoading(true);
    const list = await window.api.listClients();
    setClients(list);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  const filtered = clients.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      (c.nom || "").toLowerCase().includes(q) ||
      (c.code || "").toLowerCase().includes(q) ||
      (c.adresse || "").toLowerCase().includes(q) ||
      // Recherche translitteree : retrouve "بلدية التضامن" en tapant
      // "tadhamen"/"tadamen", "المستشفى ... سنان" en tapant "sinan", etc.
      correspondTranslitteration(c.nom, query)
    );
  });

  async function handleAdd(e) {
    e.preventDefault();
    setStatus(null);
    const nom = addDraft.nom.trim();
    if (!nom) return;
    try {
      const created = await window.api.addClient({ nom, adresse: addDraft.adresse.trim() });
      setAddDraft(emptyDraft());
      setShowAdd(false);
      await refresh();
      setStatus({ kind: "ok", text: `Client ajoute (code ${created.code}).` });
    } catch (err) {
      setStatus({ kind: "error", text: String(err?.message || err) });
    }
  }

  function startEdit(c) {
    setEditingId(c.id);
    setEditDraft({ nom: c.nom || "", code: c.code || "", adresse: c.adresse || "" });
  }

  async function handleSaveEdit(id) {
    setStatus(null);
    const nom = editDraft.nom.trim();
    if (!nom) return;
    try {
      await window.api.updateClient(id, { nom, code: editDraft.code.trim(), adresse: editDraft.adresse.trim() });
      setEditingId(null);
      await refresh();
    } catch (err) {
      setStatus({ kind: "error", text: String(err?.message || err) });
    }
  }

  async function handleDelete(id) {
    await window.api.deleteClient(id);
    setConfirmDeleteId(null);
    await refresh();
  }

  if (loading) return <div className="page">Chargement...</div>;

  return (
    <div className="page">
      <div className="page-header-row">
        <div>
          <h1>Clients</h1>
          <p className="subtitle">
            Catalogue des clients : nom, code et adresse. Ces fiches sont proposees lors de la creation d&apos;une
            facture et reprises telles quelles dessus.
          </p>
        </div>
        <button type="button" className="btn primary" onClick={() => setShowAdd(true)}>
          + Ajouter un client
        </button>
      </div>

      <div className="invoices-search-row">
        <input
          type="text"
          className="invoices-search"
          placeholder="Rechercher par nom, code ou adresse..."
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
          {query ? "Aucun client ne correspond a cette recherche." : "Aucun client enregistre pour le moment."}
        </p>
      ) : (
        <table className="invoices-table">
          <thead>
            <tr>
              <th>Nom (catalogue)</th>
              <th>Code client</th>
              <th>Adresse</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) =>
              editingId === c.id ? (
                <tr key={c.id}>
                  <td>
                    <input
                      type="text"
                      value={editDraft.nom}
                      autoFocus
                      onChange={(e) => setEditDraft((d) => ({ ...d, nom: e.target.value }))}
                    />
                  </td>
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
                      value={editDraft.adresse}
                      onChange={(e) => setEditDraft((d) => ({ ...d, adresse: e.target.value }))}
                    />
                  </td>
                  <td className="invoices-actions">
                    <button type="button" className="btn secondary" onClick={() => handleSaveEdit(c.id)}>
                      Enregistrer
                    </button>
                    <button type="button" className="btn secondary" onClick={() => setEditingId(null)}>
                      Annuler
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={c.id}>
                  <td dir={/[؀-ۿ]/.test(c.nom || "") ? "rtl" : "ltr"}>{c.nom}</td>
                  <td>{c.code || "—"}</td>
                  <td dir={/[؀-ۿ]/.test(c.adresse || "") ? "rtl" : "ltr"}>{c.adresse || "—"}</td>
                  <td className="invoices-actions">
                    <button type="button" className="btn secondary" onClick={() => startEdit(c)}>
                      Modifier
                    </button>
                    {confirmDeleteId === c.id ? (
                      <>
                        <button type="button" className="btn link" onClick={() => handleDelete(c.id)}>
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
                        onClick={() => setConfirmDeleteId(c.id)}
                        aria-label="Supprimer ce client"
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

      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleAdd}>
            <h2 className="section-title">Nouveau client</h2>
            <label>
              Nom (catalogue)
              <input
                type="text"
                autoFocus
                value={addDraft.nom}
                onChange={(e) => setAddDraft((d) => ({ ...d, nom: e.target.value }))}
                required
              />
            </label>
            <label>
              Adresse (optionnel)
              <input
                type="text"
                value={addDraft.adresse}
                onChange={(e) => setAddDraft((d) => ({ ...d, adresse: e.target.value }))}
              />
            </label>
            <p className="field-hint">Le code client est attribue automatiquement (3 chiffres).</p>
            <div className="actions">
              <button type="submit" className="btn primary">Ajouter</button>
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

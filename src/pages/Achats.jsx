import React, { useEffect, useMemo, useState } from "react";

function aujourdHui() {
  return new Date().toISOString().slice(0, 10);
}

function formatMontant(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return v.toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export default function Achats() {
  const [achats, setAchats] = useState([]);
  const [photosEnAttente, setPhotosEnAttente] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [confirmSuppressionId, setConfirmSuppressionId] = useState(null);

  // Photo en cours de traitement (voir handleTraiter) : { fileId, nom,
  // dataUrl, montant, date } pendant que l'utilisateur confirme/corrige le
  // montant devine par l'OCR avant d'enregistrer l'achat.
  const [traitement, setTraitement] = useState(null);
  const [traitementEnCours, setTraitementEnCours] = useState(false);

  // Photo deja enregistree, affichee en grand (voir handleVoirPhoto) :
  // { nom, dataUrl }.
  const [photoAffichee, setPhotoAffichee] = useState(null);

  async function refresh() {
    setLoading(true);
    const [listeAchats, listePhotos] = await Promise.all([
      window.api.listAchats(),
      window.api.listPhotosAchatsEnAttente(),
    ]);
    setAchats(listeAchats);
    setPhotosEnAttente(listePhotos);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  const total = useMemo(() => achats.reduce((s, a) => s + (Number(a.montant) || 0), 0), [achats]);

  async function handleTraiter(photo) {
    setStatus(null);
    setTraitementEnCours(true);
    setTraitement({ fileId: photo.id, nom: photo.name, dataUrl: "", montant: "", date: aujourdHui() });
    try {
      const { dataUrl, montantDevine } = await window.api.analyserPhotoAchat(photo.id, photo.name);
      setTraitement((t) =>
        t && t.fileId === photo.id
          ? { ...t, dataUrl, montant: montantDevine !== null && montantDevine !== undefined ? String(montantDevine) : "" }
          : t
      );
    } catch (err) {
      setStatus({ kind: "error", text: String(err?.message || err) });
      setTraitement(null);
    } finally {
      setTraitementEnCours(false);
    }
  }

  async function handleEnregistrer(e) {
    e.preventDefault();
    if (!traitement) return;
    setStatus(null);
    try {
      await window.api.enregistrerAchat({
        date: traitement.date,
        montant: Number(traitement.montant),
        photoFileId: traitement.fileId,
        photoNom: traitement.nom,
      });
      setTraitement(null);
      await refresh();
    } catch (err) {
      setStatus({ kind: "error", text: String(err?.message || err) });
    }
  }

  async function handleVoirPhoto(achat) {
    setStatus(null);
    setPhotoAffichee({ nom: achat.photoNom, dataUrl: "" });
    try {
      const dataUrl = await window.api.ouvrirPhotoAchat(achat.photoFileId, achat.photoNom);
      setPhotoAffichee({ nom: achat.photoNom, dataUrl });
    } catch (err) {
      setStatus({ kind: "error", text: String(err?.message || err) });
      setPhotoAffichee(null);
    }
  }

  async function handleSupprimer(id) {
    await window.api.supprimerAchat(id);
    setConfirmSuppressionId(null);
    await refresh();
  }

  if (loading) return <div className="page">Chargement...</div>;

  return (
    <div className="page">
      <div className="page-header-row">
        <div>
          <h1>Achats de matieres premieres</h1>
          <p className="subtitle">
            Journal des factures d&apos;achat (matieres premieres), communes aux deux entreprises : montant et photo
            uniquement, independant du stock. Prenez la facture en photo depuis votre telephone (page mobile dediee)
            pour qu&apos;elle apparaisse ici, pretes a traiter.
          </p>
        </div>
      </div>

      {status && (
        <p className={`status ${status.kind === "ok" ? "ok" : status.kind === "error" ? "error" : ""}`}>
          {status.text}
        </p>
      )}

      <h2 className="section-title">Photos en attente de traitement</h2>
      {photosEnAttente.length === 0 ? (
        <p className="subtitle">Aucune nouvelle photo. Celles prises depuis votre telephone apparaissent ici.</p>
      ) : (
        <table className="invoices-table">
          <thead>
            <tr>
              <th>Photo</th>
              <th>Deposee le</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {photosEnAttente.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.createdTime ? new Date(p.createdTime).toLocaleString("fr-FR") : "—"}</td>
                <td className="invoices-actions">
                  <button type="button" className="btn primary" onClick={() => handleTraiter(p)}>
                    Traiter cette photo
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="section-title" style={{ marginTop: "2em" }}>
        Historique des achats
        <span className="subtitle" style={{ display: "inline", marginLeft: "0.75em", fontWeight: 400 }}>
          {achats.length > 0 ? `Total : ${formatMontant(total)}` : ""}
        </span>
      </h2>
      {achats.length === 0 ? (
        <p className="subtitle">Aucun achat enregistre pour le moment.</p>
      ) : (
        <table className="invoices-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Montant</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {achats.map((a) => (
              <tr key={a.id}>
                <td>{a.date ? new Date(a.date).toLocaleDateString("fr-FR") : "—"}</td>
                <td style={{ fontWeight: 600 }}>{formatMontant(a.montant)}</td>
                <td className="invoices-actions">
                  <button type="button" className="btn secondary" onClick={() => handleVoirPhoto(a)}>
                    Voir la photo
                  </button>
                  {confirmSuppressionId === a.id ? (
                    <>
                      <button type="button" className="btn link" onClick={() => handleSupprimer(a.id)}>
                        Confirmer
                      </button>
                      <button type="button" className="btn secondary" onClick={() => setConfirmSuppressionId(null)}>
                        Annuler
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn icon"
                      onClick={() => setConfirmSuppressionId(a.id)}
                      aria-label="Supprimer cet achat"
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

      {traitement && (
        <div
          className="modal-overlay"
          onClick={() => {
            if (!traitementEnCours) setTraitement(null);
          }}
        >
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleEnregistrer}>
            <h2 className="section-title">Confirmer cet achat</h2>
            {traitement.dataUrl ? (
              <img
                src={traitement.dataUrl}
                alt={traitement.nom}
                style={{ maxWidth: "100%", maxHeight: "40vh", objectFit: "contain", marginBottom: "1em" }}
              />
            ) : (
              <p className="field-hint">Analyse de la photo en cours (lecture du montant)...</p>
            )}
            <p className="field-hint">
              Montant devine automatiquement par lecture de la photo — verifiez-le et corrigez-le si besoin avant
              d&apos;enregistrer.
            </p>
            <label>
              Montant
              <input
                type="number"
                step="0.001"
                autoFocus
                required
                value={traitement.montant}
                onChange={(e) => setTraitement((t) => ({ ...t, montant: e.target.value }))}
              />
            </label>
            <label>
              Date
              <input
                type="date"
                required
                value={traitement.date}
                onChange={(e) => setTraitement((t) => ({ ...t, date: e.target.value }))}
              />
            </label>
            <div className="actions">
              <button type="submit" className="btn primary" disabled={!traitement.dataUrl}>
                Enregistrer
              </button>
              <button type="button" className="btn secondary" onClick={() => setTraitement(null)}>
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}

      {photoAffichee && (
        <div className="modal-overlay" onClick={() => setPhotoAffichee(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="section-title">{photoAffichee.nom}</h2>
            {photoAffichee.dataUrl ? (
              <img
                src={photoAffichee.dataUrl}
                alt={photoAffichee.nom}
                style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain" }}
              />
            ) : (
              <p className="field-hint">Chargement de la photo...</p>
            )}
            <div className="actions">
              <button type="button" className="btn secondary" onClick={() => setPhotoAffichee(null)}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

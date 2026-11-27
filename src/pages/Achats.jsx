import React, { useEffect, useMemo, useState } from "react";

function aujourdHui() {
  return new Date().toISOString().slice(0, 10);
}

function formatMontant(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return v.toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

// "2026-11" -> "Novembre 2026", pour le regroupement mensuel ci-dessous.
function formatMois(cleAnneeMois) {
  const [annee, mois] = cleAnneeMois.split("-").map(Number);
  const libelle = new Date(annee, mois - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return libelle.charAt(0).toUpperCase() + libelle.slice(1);
}

export default function Achats() {
  const [achats, setAchats] = useState([]);
  const [photosEnAttente, setPhotosEnAttente] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [confirmSuppressionId, setConfirmSuppressionId] = useState(null);

  // Renommage d'une photo encore en attente (voir startRenommage) : agit
  // directement sur le fichier Drive, pour retrouver une facture plus
  // facilement que par son nom auto-genere a l'envoi depuis le telephone.
  const [renommageId, setRenommageId] = useState(null); // id Drive de la photo en cours de renommage
  const [nouveauNomPhoto, setNouveauNomPhoto] = useState("");
  const [confirmSuppressionPhotoId, setConfirmSuppressionPhotoId] = useState(null); // id Drive

  // Photo en cours de traitement (voir handleTraiter) : { fileId,
  // nomOriginal, nom, dataUrl, montant, date } pendant que l'utilisateur
  // confirme/corrige le montant devine par l'OCR avant d'enregistrer
  // l'achat. `nom` est modifiable (voir le champ dans la modale) : si
  // different de `nomOriginal` au moment d'enregistrer, le fichier Drive est
  // renomme en meme temps.
  const [traitement, setTraitement] = useState(null);
  const [traitementEnCours, setTraitementEnCours] = useState(false);
  const [confirmSuppressionTraitementPhoto, setConfirmSuppressionTraitementPhoto] = useState(false);

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

  // Regroupement par mois (ex. "Novembre 2026 : 1 240,500 DT") pour suivre
  // l'evolution des depenses de matieres premieres dans le temps, plutot
  // qu'un seul total cumule. Les achats sans date exploitable tombent dans
  // un groupe "Sans date" place en dernier.
  const parMois = useMemo(() => {
    const totauxParCle = new Map();
    for (const a of achats) {
      const cle = /^\d{4}-\d{2}/.test(a.date || "") ? a.date.slice(0, 7) : "Sans date";
      totauxParCle.set(cle, (totauxParCle.get(cle) || 0) + (Number(a.montant) || 0));
    }
    return [...totauxParCle.entries()]
      .sort(([cleA], [cleB]) => {
        if (cleA === "Sans date") return 1;
        if (cleB === "Sans date") return -1;
        return cleB.localeCompare(cleA);
      })
      .map(([cle, montant]) => ({ cle, label: cle === "Sans date" ? cle : formatMois(cle), montant }));
  }, [achats]);

  async function handleTraiter(photo) {
    setStatus(null);
    setTraitementEnCours(true);
    setConfirmSuppressionTraitementPhoto(false);
    setTraitement({ fileId: photo.id, nomOriginal: photo.name, nom: photo.name, dataUrl: "", montant: "", date: aujourdHui() });
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
      const nomFinal = traitement.nom.trim() || traitement.nomOriginal;
      if (nomFinal !== traitement.nomOriginal) {
        await window.api.renommerPhotoAchat(traitement.fileId, nomFinal);
      }
      await window.api.enregistrerAchat({
        date: traitement.date,
        montant: Number(traitement.montant),
        photoFileId: traitement.fileId,
        photoNom: nomFinal,
      });
      setTraitement(null);
      await refresh();
    } catch (err) {
      setStatus({ kind: "error", text: String(err?.message || err) });
    }
  }

  async function handleSupprimerPhotoTraitement() {
    if (!traitement) return;
    setStatus(null);
    try {
      await window.api.supprimerPhotoAchat(traitement.fileId);
      setTraitement(null);
      setConfirmSuppressionTraitementPhoto(false);
      await refresh();
    } catch (err) {
      setStatus({ kind: "error", text: String(err?.message || err) });
    }
  }

  function startRenommage(photo) {
    setRenommageId(photo.id);
    setNouveauNomPhoto(photo.name);
  }

  async function handleEnregistrerRenommage(photo) {
    setStatus(null);
    try {
      await window.api.renommerPhotoAchat(photo.id, nouveauNomPhoto.trim() || photo.name);
      setRenommageId(null);
      await refresh();
    } catch (err) {
      setStatus({ kind: "error", text: String(err?.message || err) });
    }
  }

  async function handleSupprimerPhotoEnAttente(fileId) {
    setStatus(null);
    try {
      await window.api.supprimerPhotoAchat(fileId);
      setConfirmSuppressionPhotoId(null);
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
                <td>
                  {renommageId === p.id ? (
                    <input
                      type="text"
                      autoFocus
                      value={nouveauNomPhoto}
                      onChange={(e) => setNouveauNomPhoto(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleEnregistrerRenommage(p);
                        if (e.key === "Escape") setRenommageId(null);
                      }}
                    />
                  ) : (
                    p.name
                  )}
                </td>
                <td>{p.createdTime ? new Date(p.createdTime).toLocaleString("fr-FR") : "—"}</td>
                <td className="invoices-actions">
                  {renommageId === p.id ? (
                    <>
                      <button type="button" className="btn secondary" onClick={() => handleEnregistrerRenommage(p)}>
                        Enregistrer
                      </button>
                      <button type="button" className="btn secondary" onClick={() => setRenommageId(null)}>
                        Annuler
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn primary" onClick={() => handleTraiter(p)}>
                        Traiter cette photo
                      </button>
                      <button type="button" className="btn secondary" onClick={() => startRenommage(p)}>
                        Renommer
                      </button>
                      {confirmSuppressionPhotoId === p.id ? (
                        <>
                          <button
                            type="button"
                            className="btn link"
                            onClick={() => handleSupprimerPhotoEnAttente(p.id)}
                          >
                            Confirmer
                          </button>
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => setConfirmSuppressionPhotoId(null)}
                          >
                            Annuler
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn icon"
                          onClick={() => setConfirmSuppressionPhotoId(p.id)}
                          aria-label="Supprimer cette photo"
                        >
                          &times;
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="section-title" style={{ marginTop: "2em" }}>
        Historique des achats
        <span className="subtitle" style={{ display: "inline", marginLeft: "0.75em", fontWeight: 400 }}>
          {achats.length > 0 ? `Total : ${formatMontant(total)} DT` : ""}
        </span>
      </h2>
      {parMois.length > 0 && (
        <ul className="achats-mois-liste">
          {parMois.map((m) => (
            <li key={m.cle}>
              <span className="achats-mois-label">{m.label}</span>
              <span className="achats-mois-montant">{formatMontant(m.montant)} DT</span>
            </li>
          ))}
        </ul>
      )}
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
            if (!traitementEnCours) {
              setTraitement(null);
              setConfirmSuppressionTraitementPhoto(false);
            }
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
              Nom de la photo
              <input
                type="text"
                value={traitement.nom}
                onChange={(e) => setTraitement((t) => ({ ...t, nom: e.target.value }))}
              />
            </label>
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
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setTraitement(null);
                  setConfirmSuppressionTraitementPhoto(false);
                }}
              >
                Annuler
              </button>
              {confirmSuppressionTraitementPhoto ? (
                <>
                  <button type="button" className="btn link" onClick={handleSupprimerPhotoTraitement}>
                    Confirmer la suppression
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => setConfirmSuppressionTraitementPhoto(false)}
                  >
                    Annuler
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn link"
                  onClick={() => setConfirmSuppressionTraitementPhoto(true)}
                >
                  Supprimer cette photo
                </button>
              )}
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

import React, { useState } from "react";

export default function Sauvegarde() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exportMsg, setExportMsg] = useState(null);
  const [importMsg, setImportMsg] = useState(null);

  async function handleExport() {
    setExporting(true);
    setExportMsg(null);
    try {
      const res = await window.api.exportBackup();
      if (res.canceled) return;
      if (!res.ok) {
        setExportMsg({ kind: "error", text: `Échec de l'export : ${res.error}` });
        return;
      }
      setExportMsg({
        kind: "ok",
        text: `Sauvegarde créée : ${res.path} (${res.nbFichiersApp} fichier(s) de données, ${res.nbFichiersDocuments} PDF/relevé(s)).`,
      });
    } finally {
      setExporting(false);
    }
  }

  async function handleImport() {
    setImporting(true);
    setImportMsg(null);
    try {
      const res = await window.api.importBackup();
      if (res.canceled) return;
      if (!res.ok) {
        setImportMsg({ kind: "error", text: `Échec de la restauration : ${res.error}` });
        return;
      }
      // En cas de succes, l'application redemarre d'elle-meme (voir main.js) :
      // ce message ne restera visible qu'un instant.
      setImportMsg({ kind: "ok", text: "Restauration en cours, redémarrage de l'application..." });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="page">
      <h1>Sauvegarde</h1>
      <p className="subtitle">
        Exporte et restaure l'intégralité des données de l'application — toutes les entreprises, toutes les
        factures, le catalogue d'articles, et le suivi des paiements — en une seule archive ZIP.
      </p>

      <div className="card backup-card">
        <h2 className="section-title">Exporter une sauvegarde</h2>
        <p className="payments-folder-hint">
          Crée un fichier .zip contenant toutes les données de l'app et les PDF de factures / relevés déposés
          dans le dossier Facturation (Bureau sur Windows, Documents sur macOS/Linux). Choisissez où l'enregistrer — idéalement pas seulement sur ce
          poste (clé USB, dossier synchronisé type Google Drive/OneDrive, ou envoyé par email) : si l'ordinateur
          est perdu ou tombe en panne, c'est ce fichier qui permet de tout récupérer.
        </p>
        <button type="button" className="btn primary" onClick={handleExport} disabled={exporting}>
          {exporting ? "Export..." : "Exporter une sauvegarde"}
        </button>
        {exportMsg && (
          <p className={`status ${exportMsg.kind === "error" ? "error" : "ok"}`}>{exportMsg.text}</p>
        )}
      </div>

      <div className="card backup-card">
        <h2 className="section-title">Restaurer une sauvegarde</h2>
        <p className="payments-folder-hint">
          Remplace toutes les données actuelles de l'application par celles d'un fichier de sauvegarde .zip
          exporté précédemment. Utile après une réinstallation de l'application sur ce poste ou sur un autre
          (nouvel ordinateur, disque remplacé) : installez l'application normalement, ouvrez cet onglet, puis
          restaurez votre dernière sauvegarde — tout revient exactement comme avant, sans rien ressaisir.
          Une copie de sûreté des données actuelles est prise avant l'écrasement, et l'application redémarre
          automatiquement une fois la restauration terminée.
        </p>
        <button type="button" className="btn danger" onClick={handleImport} disabled={importing}>
          {importing ? "Restauration..." : "Restaurer une sauvegarde"}
        </button>
        {importMsg && (
          <p className={`status ${importMsg.kind === "error" ? "error" : "ok"}`}>{importMsg.text}</p>
        )}
      </div>
    </div>
  );
}

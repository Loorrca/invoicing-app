import React, { useEffect, useRef, useState } from "react";

const EMPTY = {
  company_name: "",
  address: "",
  rne: "",
  tax_id: "",
  phone: "",
  email: "",
  rib: "",
  logo_data_url: "",
};

// Redimensionne l'image choisie (hauteur max 300px) avant de la stocker, pour
// ne pas alourdir la base avec des photos de plusieurs Mo.
function resizeImage(file, maxHeight = 300) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxHeight / img.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export default function Settings({ activeCompany, onSaved }) {
  const [values, setValues] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null); // { kind: "ok"|"error", text }
  const fileInputRef = useRef(null);

  // Recharge le formulaire a chaque changement d'entreprise active (via le
  // selecteur dans la barre laterale), pas seulement au premier montage.
  useEffect(() => {
    if (activeCompany) {
      setValues({ ...EMPTY, ...activeCompany });
      setLoading(false);
    }
  }, [activeCompany?.id]);

  function update(field, value) {
    setValues((v) => ({ ...v, [field]: value }));
  }

  async function handleLogoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await resizeImage(file);
    update("logo_data_url", dataUrl);
  }

  async function handleSave(e) {
    e.preventDefault();
    setStatus(null);
    try {
      const saved = await window.api.saveActiveCompany(values);
      setValues({ ...EMPTY, ...saved });
      await onSaved?.();
      setStatus({ kind: "ok", text: "Enregistre." });
    } catch (err) {
      setStatus({ kind: "error", text: String(err?.message || err) });
    }
  }

  if (loading) return <div className="page">Chargement...</div>;

  return (
    <div className="page">
      <h1>Profil de l'entreprise</h1>
      <p className="subtitle">
        Ces informations apparaissent sur l'en-tete de chaque facture generee.
      </p>

      <form className="form" onSubmit={handleSave}>
        <div className="form-row logo-row">
          <div className="logo-preview" onClick={() => fileInputRef.current?.click()}>
            {values.logo_data_url ? (
              <img src={values.logo_data_url} alt="Logo" />
            ) : (
              <span>Ajouter un logo</span>
            )}
          </div>
          <div>
            <button type="button" className="btn secondary" onClick={() => fileInputRef.current?.click()}>
              Choisir une image
            </button>
            {values.logo_data_url && (
              <button
                type="button"
                className="btn link"
                onClick={() => update("logo_data_url", "")}
              >
                Retirer le logo
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleLogoChange}
            />
          </div>
        </div>

        <div className="grid-2">
          <label>
            Nom de l'entreprise
            <input
              type="text"
              value={values.company_name}
              onChange={(e) => update("company_name", e.target.value)}
              required
            />
          </label>
          <label>
            RNE
            <input
              type="text"
              value={values.rne}
              onChange={(e) => update("rne", e.target.value)}
              placeholder="Registre National des Entreprises"
            />
          </label>
          <label>
            Matricule fiscal
            <input
              type="text"
              value={values.tax_id}
              onChange={(e) => update("tax_id", e.target.value)}
              placeholder="0000000/A/M/000"
            />
          </label>
          <label>
            Telephone
            <input
              type="text"
              value={values.phone}
              onChange={(e) => update("phone", e.target.value)}
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={values.email}
              onChange={(e) => update("email", e.target.value)}
            />
          </label>
          <label>
            RIB (pour les virements)
            <input
              type="text"
              value={values.rib}
              onChange={(e) => update("rib", e.target.value)}
            />
          </label>
        </div>

        <label className="full">
          Adresse
          <textarea
            rows={2}
            value={values.address}
            onChange={(e) => update("address", e.target.value)}
          />
        </label>

        <div className="actions">
          <button type="submit" className="btn primary">Enregistrer</button>
          {status && (
            <span className={status.kind === "ok" ? "status ok" : "status error"}>
              {status.text}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

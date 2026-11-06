import React, { useEffect, useRef, useState } from "react";

const EMPTY = {
  company_name: "",
  address: "",
  rne: "",
  tax_id: "",
  tel_fax: "",
  phone: "",
  email: "",
  rib: "",
  siege: "",
  logo_data_url: "",
  qr_data_url: "",
  invoice_template: "classic",
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
  const qrInputRef = useRef(null);

  // Verrouillage de l'application (voir electron/lib/appLock.js et
  // src/components/AppLock.jsx) : local a CE poste, independant de
  // l'entreprise active - donc son propre etat, separe du formulaire
  // ci-dessus.
  const [lockHasPassword, setLockHasPassword] = useState(null); // null = pas encore charge
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [lockBusy, setLockBusy] = useState(false);
  const [lockStatusMsg, setLockStatusMsg] = useState(null);

  useEffect(() => {
    window.api.getLockStatus().then(({ hasPassword }) => setLockHasPassword(hasPassword));
  }, []);

  async function handleSetPassword(e) {
    e.preventDefault();
    setLockStatusMsg(null);
    if (!newPassword.trim()) return;
    if (newPassword !== confirmPassword) {
      setLockStatusMsg({ kind: "error", text: "Les deux saisies ne correspondent pas." });
      return;
    }
    setLockBusy(true);
    try {
      const { hasPassword } = await window.api.setLockPassword(newPassword);
      setLockHasPassword(hasPassword);
      setNewPassword("");
      setConfirmPassword("");
      setLockStatusMsg({ kind: "ok", text: "Mot de passe enregistre." });
    } catch (err) {
      setLockStatusMsg({ kind: "error", text: String(err?.message || err) });
    } finally {
      setLockBusy(false);
    }
  }

  async function handleRemovePassword() {
    setLockStatusMsg(null);
    setLockBusy(true);
    try {
      const { hasPassword } = await window.api.setLockPassword("");
      setLockHasPassword(hasPassword);
      setLockStatusMsg({ kind: "ok", text: "Protection retiree." });
    } catch (err) {
      setLockStatusMsg({ kind: "error", text: String(err?.message || err) });
    } finally {
      setLockBusy(false);
    }
  }

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

  // Resolution un peu plus elevee que le logo (500px au lieu de 300) : un QR
  // code trop compresse peut devenir illisible par un scanner, contrairement
  // a un logo ou la perte de nettete ne se voit presque pas.
  async function handleQrChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await resizeImage(file, 500);
    update("qr_data_url", dataUrl);
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

        {values.invoice_template !== "lignes" && (
          <div className="form-row logo-row">
            <div className="qr-preview" onClick={() => qrInputRef.current?.click()}>
              {values.qr_data_url ? (
                <img src={values.qr_data_url} alt="QR code" />
              ) : (
                <span>Ajouter un QR code</span>
              )}
            </div>
            <div>
              <p className="field-hint" style={{ marginTop: 0 }}>
                QR code du site web / de la boutique en ligne, imprime sous le tableau de la facture.
              </p>
              <button type="button" className="btn secondary" onClick={() => qrInputRef.current?.click()}>
                Choisir une image
              </button>
              {values.qr_data_url && (
                <button
                  type="button"
                  className="btn link"
                  onClick={() => update("qr_data_url", "")}
                >
                  Retirer le QR code
                </button>
              )}
              <input
                ref={qrInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleQrChange}
              />
            </div>
          </div>
        )}

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
            Tel/fax
            <input
              type="text"
              value={values.tel_fax}
              onChange={(e) => update("tel_fax", e.target.value)}
            />
          </label>
          <label>
            Mobile
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
          <label>
            Siege (agence RIB)
            <input
              type="text"
              value={values.siege}
              onChange={(e) => update("siege", e.target.value)}
              placeholder="Nom du siege de la banque"
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

      <div className="card">
        <h2 className="section-title">Verrouillage de l'application</h2>
        <p className="field-hint">
          Si un mot de passe est defini, il sera demande a chaque ouverture de l'application sur ce
          poste. Propre a ce poste : il n'est pas synchronise avec l'autre ordinateur.
        </p>

        {lockHasPassword === null ? null : (
          <>
            {lockHasPassword && (
              <p className="status ok" style={{ marginBottom: 10 }}>
                Protection active sur ce poste.
              </p>
            )}

            <form className="form" onSubmit={handleSetPassword}>
              <div className="grid-2">
                <label>
                  {lockHasPassword ? "Nouveau mot de passe" : "Mot de passe"}
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </label>
                <label>
                  Confirmer
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </label>
              </div>
              <div className="actions">
                <button type="submit" className="btn primary" disabled={lockBusy || !newPassword.trim()}>
                  {lockHasPassword ? "Changer le mot de passe" : "Activer la protection"}
                </button>
                {lockHasPassword && (
                  <button
                    type="button"
                    className="btn link"
                    disabled={lockBusy}
                    onClick={handleRemovePassword}
                  >
                    Retirer la protection
                  </button>
                )}
                {lockStatusMsg && (
                  <span className={lockStatusMsg.kind === "ok" ? "status ok" : "status error"}>
                    {lockStatusMsg.text}
                  </span>
                )}
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

import React, { useState } from "react";

// Ecran de verrouillage affiche au demarrage tant que l'appli n'a pas ete
// deverrouillee (voir App.jsx), si un mot de passe a ete configure sur ce
// poste (section "Verrouillage de l'application" dans Settings.jsx). Remplace
// entierement le contenu de l'appli pendant qu'il est affiche - aucune donnee
// (factures, clients...) n'est accessible avant la bonne saisie.
export default function AppLock({ onUnlocked }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setChecking(true);
    try {
      const { ok } = await window.api.unlockApp(password);
      if (ok) {
        onUnlocked();
      } else {
        setError("Mot de passe incorrect.");
        setPassword("");
      }
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="modal-overlay">
      <form className="modal" onSubmit={handleSubmit}>
        <h2 className="section-title">Application verrouillee</h2>
        <label>
          Mot de passe
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="status error">{error}</p>}
        <div className="actions">
          <button type="submit" className="btn primary" disabled={checking || !password}>
            {checking ? "Verification..." : "Deverrouiller"}
          </button>
        </div>
      </form>
    </div>
  );
}

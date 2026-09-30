# Facturation — application de facturation (bureau)

Application de bureau (Electron + React) pour generer des factures PDF, avec
un tableau de bord a venir. Les donnees (profil de l'entreprise, puis clients
et factures) sont stockees localement dans une base SQLite, sur la machine
qui fait tourner l'application.

## Etat actuel (fonctionnalite 1)

- **Profil de l'entreprise** : nom, adresse, RNE, matricule fiscal,
  telephone, email, RIB, logo. Enregistre en local.
- **Nouvelle facture -> PDF** : formulaire (client, date, lignes, TVA/FODEC)
  qui genere un PDF avec l'en-tete de l'entreprise, dans le meme format que
  les factures existantes (P.T.H.T / FODEC / T.V.A / TOTAL T.T.C + montant en
  toutes lettres). Cette facture n'est pas encore enregistree dans une liste
  — ca arrive avec la prochaine fonctionnalite (creation/suivi des factures,
  puis le tableau de bord, puis l'integration avec le suivi des reglements).

## Installation

Necessite [Node.js](https://nodejs.org/) (version 20 ou plus recente).

```bash
npm install
```

Toutes les dependances sont en JavaScript pur (pas de module natif a
compiler) : les donnees sont stockees dans de simples fichiers JSON, et la
lecture des releves bancaires PDF/XLSX utilise `pdfjs-dist`/`xlsx`.

## Lancer en developpement

```bash
npm run dev
```

Ouvre la fenetre de l'application avec rechargement a chaud sur les
modifications de l'interface.

## Lancer sur Windows

1. Installer [Node.js LTS](https://nodejs.org/) (le programme d'installation
   inclut npm) et [Git for Windows](https://git-scm.com/download/win) (ou
   utiliser GitHub Desktop).
2. Cloner le depot :
   ```bash
   git clone <url-du-depot-github>
   cd invoicing-app
   ```
3. Installer les dependances :
   ```bash
   npm install
   ```
   (premiere execution : necessite internet, Electron est telecharge
   automatiquement — rien de natif a compiler)
4. Lancer l'application :
   ```bash
   npm run dev
   ```

Les donnees (entreprises, factures, catalogue d'articles) sont propres a
chaque machine : elles vivent dans `%APPDATA%\invoicing-app` (fichiers JSON)
et dans `Documents\Facturation\` (PDF de factures et releves BIAT).

## Construire l'application (executable)

Pour installer l'application une bonne fois sur un poste (sans avoir a
relancer `npm run dev` a chaque fois) :

```bash
npm run dist
```

Produit un installeur dans `release/` :
- `win` -> `Facturation Setup x.x.x.exe` (NSIS)
- `linux` -> `.AppImage`
- `mac` -> `.dmg`

A executer directement sur la plateforme ciblee (le plus simple pour un
`.exe` Windows reste de lancer `npm run dist` sur une machine Windows).
L'installeur n'etant pas signe numeriquement, Windows SmartScreen affiche un
avertissement au premier lancement ("Windows a protege votre ordinateur") —
c'est normal pour une application non signee, cliquer sur **Informations
complementaires -> Executer quand meme**.

## Organisation

```
electron/
  main.js              processus principal (fenetre, IPC, base de donnees, PDF)
  preload.js           pont securise entre l'interface et le processus principal
  db.js                SQLite (better-sqlite3) : profil de l'entreprise
  lib/
    invoiceTemplate.js  gabarit HTML de la facture (identique au format existant)
    numberToWords.js    montant en toutes lettres (francais, dinars/millimes)
src/
  App.jsx              navigation (barre laterale)
  pages/
    Settings.jsx        profil de l'entreprise (logo, adresse, RNE, ...)
    NewInvoice.jsx       formulaire de facture -> generation PDF
vite.config.js          build de l'interface (React)
```

## A venir (prochaines fonctionnalites, une a la fois)

1. Creation/suivi des factures (liste, statut, modification) au lieu du
   formulaire "a usage unique" actuel.
2. Tableau de bord (chiffre d'affaires, factures en attente, ...).
3. Integration avec le projet `invoice-tracker` existant (rapprochement
   bancaire BIAT, retenue a la source) directement dans cette application.

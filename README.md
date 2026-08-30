# AGRISAT — Frontend

Interface web d'AGRISAT : cartographie satellite, délimitation automatique de parcelles agricoles et analyse de cultures (NDVI, détection d'orge, etc.). Application React + TypeScript construite avec Vite.

> Ce dépôt est le frontend du projet [AGRISAT](../README.md). Il consomme l'API exposée par [AGRISAT-BACKEND](../AGRISAT-BACKEND).

## Sommaire

- [Stack technique](#stack-technique)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration](#configuration)
- [Lancer le projet](#lancer-le-projet)
- [Scripts disponibles](#scripts-disponibles)
- [Structure du projet](#structure-du-projet)
- [Tests](#tests)
- [Dépannage](#dépannage)

## Stack technique

| Domaine        | Technologie                                           |
| --------------- | ------------------------------------------------------ |
| Framework       | React 18 + TypeScript                                  |
| Build tool      | Vite 5                                                  |
| UI              | Tailwind CSS, Radix UI, shadcn/ui, Framer Motion        |
| Cartographie    | `@react-google-maps/api` (Google Maps JavaScript API)   |
| Données serveur | TanStack Query (React Query)                            |
| Formulaires     | React Hook Form + Zod                                   |
| Tests           | Vitest, Testing Library, Playwright (E2E)                |

## Prérequis

- [Node.js](https://nodejs.org/) 18 ou supérieur
- npm (ou [Bun](https://bun.sh/), un fichier `bun.lock` est fourni)
- Le backend AGRISAT lancé et accessible (voir [AGRISAT-BACKEND](../AGRISAT-BACKEND))
- Une clé API Google Maps valide (Maps JavaScript API activée)

## Installation

```bash
cd AGRISAT-FRONTEND
npm install
# ou : bun install
```

## Configuration

La configuration de l'application se fait exclusivement via des variables d'environnement Vite, définies dans un fichier `.env` à la racine du projet frontend.

### 1. Créer le fichier `.env`

Copiez le modèle fourni puis renseignez vos propres valeurs :

```bash
cp .env.example .env
```

### 2. Variables d'environnement

| Variable                   | Obligatoire | Description                                                                                                  | Exemple                 |
| --------------------------- | :---------: | ---------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `VITE_API_URL`              |     Non*    | URL de base de l'API backend AGRISAT (Fastify). Si absente, `http://localhost:3001` est utilisé par défaut.        | `http://localhost:3001`     |
| `VITE_GOOGLE_MAPS_API_KEY`  |   **Oui**   | Clé API Google Maps, requise pour l'affichage de la carte satellite et le dessin de parcelles.                     | `AIzaSy...`                  |

\* Recommandé de la définir explicitement en production pour pointer vers l'URL réelle de l'API.

> **Important**
> - Toute variable exposée au client **doit** être préfixée par `VITE_` (contrainte imposée par Vite) : les autres variables ne seront pas injectées dans le bundle.
> - Le fichier `.env` est ignoré par Git (voir `.gitignore`) : ne jamais committer de clé API réelle.
> - Après toute modification du fichier `.env`, redémarrez le serveur de développement (`npm run dev`) pour que les changements soient pris en compte.

### 3. Obtenir une clé Google Maps

1. Ouvrez la [Google Cloud Console](https://console.cloud.google.com/google/maps-apis/credentials).
2. Créez (ou sélectionnez) un projet, puis activez **Maps JavaScript API**.
3. Générez une clé API et restreignez-la (référents HTTP correspondant à vos domaines de dev/prod) pour éviter tout usage non autorisé.
4. Renseignez la clé dans `VITE_GOOGLE_MAPS_API_KEY`.

### 4. Configuration du backend associé

Le frontend consomme l'API exposée par `AGRISAT-BACKEND`. Assurez-vous que :

- `VITE_API_URL` correspond bien à l'origine (protocole + domaine + port) sur laquelle le backend écoute.
- La variable `FRONTEND_ORIGIN` du backend autorise l'origine du frontend (CORS) — voir `AGRISAT-BACKEND/.env.example`.

Par défaut en développement local, le frontend tourne sur `http://localhost:8080` (port défini dans `vite.config.ts`) et le backend sur `http://localhost:3001`.

## Lancer le projet

```bash
npm run dev
```

L'application est alors accessible sur [http://localhost:8080](http://localhost:8080).

### Build de production

```bash
npm run build
npm run preview   # prévisualise le build de production en local
```

### Avec Docker

Un `Dockerfile` (build multi-étapes + Nginx) est fourni. Voir le [`docker-compose.yml`](../docker-compose.yml) à la racine du projet pour le lancer avec les bonnes variables d'environnement.

## Scripts disponibles

| Commande              | Description                                              |
| ----------------------- | ------------------------------------------------------------ |
| `npm run dev`           | Démarre le serveur de développement Vite (hot reload)         |
| `npm run build`         | Génère le build de production dans `dist/`                    |
| `npm run build:dev`     | Génère un build en mode développement (non minifié)           |
| `npm run preview`       | Sert le build de production en local                          |
| `npm run lint`          | Analyse le code avec ESLint                                   |
| `npm run test`          | Exécute la suite de tests unitaires (Vitest)                   |
| `npm run test:watch`    | Exécute les tests en mode watch                                 |

## Structure du projet

```
AGRISAT-FRONTEND/
├── src/
│   ├── components/     # Composants React (carte, overlays, formulaires...)
│   │   └── ui/         # Composants shadcn/ui (Radix + Tailwind)
│   ├── hooks/           # Hooks personnalisés (accès API, état partagé)
│   ├── lib/              # Clients API et logique métier côté client
│   ├── pages/            # Pages de l'application (routing)
│   └── test/             # Configuration et utilitaires de tests
├── public/               # Assets statiques
├── .env.example          # Modèle des variables d'environnement
├── Dockerfile             # Build de production (Nginx)
├── vite.config.ts        # Configuration Vite (port 8080, alias `@/`)
├── tailwind.config.ts    # Configuration Tailwind CSS
└── playwright.config.ts  # Configuration des tests end-to-end
```

## Tests

- **Unitaires / composants** : Vitest + Testing Library (`npm run test`)
- **End-to-end** : Playwright (`npx playwright test`)

## Dépannage

| Problème                                              | Cause probable / solution                                                                          |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| La carte ne s'affiche pas / erreur Google Maps             | `VITE_GOOGLE_MAPS_API_KEY` manquante, invalide ou restreinte sur un mauvais domaine                        |
| Erreurs `CORS` dans la console                              | `FRONTEND_ORIGIN` mal configuré côté backend, ou `VITE_API_URL` pointant vers la mauvaise origine            |
| Les appels API échouent (`ECONNREFUSED`)                    | Le backend n'est pas démarré ou `VITE_API_URL` est incorrect                                                |
| Les variables `.env` ne semblent pas prises en compte        | Le serveur `npm run dev` doit être redémarré après modification du `.env`                                    |

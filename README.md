# Le carnet du foyer — guide de déploiement (100% gratuit)

Cette version n'utilise **que des services gratuits, sans carte bancaire à
enregistrer nulle part** :
- **Firebase** (plan gratuit "Spark") pour la base de données et les notifications
- **Vercel** (plan gratuit "Hobby") pour héberger l'appli et envoyer les notifications

Comptez environ 45–60 minutes la première fois. Vous aurez besoin de :
- Node.js installé sur votre ordinateur (18 ou plus) — https://nodejs.org
- Un compte Google gratuit (pour Firebase)
- Un compte GitHub gratuit et un compte Vercel gratuit (Vercel propose de se
  créer un compte directement avec GitHub, sans carte bancaire)

---

## Étape 1 — Créer le projet Firebase (gratuit, plan Spark)

1. Allez sur https://console.firebase.google.com
2. **Ajouter un projet** → nommez-le (ex. `carnet-du-foyer`) → continuez.
   **Ne cliquez sur aucune proposition de passer au plan Blaze** — le plan
   gratuit "Spark" (sélectionné par défaut) suffit pour tout ce guide.
3. Menu de gauche :
   - **Build → Firestore Database** → **Créer une base de données** → mode
     **production** → région proche (ex. `europe-west1`).
   - **Build → Cloud Messaging** → onglet **Web configuration** → sous
     "Certificats Web Push", cliquez sur **Générer une paire de clés**.
     Copiez cette clé (c'est votre `VAPID_KEY`).
4. **Paramètres du projet** (roue dentée) → section **Vos applications** →
   icône **Web** (`</>`) → nommez l'app → **Enregistrer**. Gardez la page
   ouverte, elle affiche votre `firebaseConfig`.
5. Toujours dans **Paramètres du projet** → onglet **Comptes de service** →
   **Générer une nouvelle clé privée**. Un fichier `.json` se télécharge :
   **gardez-le précieusement**, c'est la clé qui permettra à la fonction
   d'envoi de notifications de fonctionner. Ne le partagez jamais publiquement.

---

## Étape 2 — Configurer le projet avec vos identifiants

Dans le dossier du projet fourni :

1. `.firebaserc` → remplacez `REMPLACER_PAR_VOTRE_PROJECT_ID` par l'ID du
   projet (Paramètres du projet → "ID du projet").
2. `src/firebase.js` → remplacez chaque `REMPLACER...` par les valeurs de
   votre `firebaseConfig` (étape 1.4), et `VAPID_KEY` par la clé de l'étape 1.3.
3. `public/firebase-messaging-sw.js` → collez **exactement la même config**
   `firebaseConfig` (dupliquée volontairement, un service worker ne peut pas
   importer `src/firebase.js`).

---

## Étape 3 — Déployer les règles Firestore (gratuit, sans Blaze)

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules
```

---

## Étape 4 — Mettre le projet sur GitHub

1. Créez un dépôt vide sur https://github.com/new (peut être privé).
2. Dans le dossier du projet :

```bash
git init
git add .
git commit -m "Premier envoi"
git branch -M main
git remote add origin https://github.com/VOTRE-COMPTE/VOTRE-DEPOT.git
git push -u origin main
```

---

## Étape 5 — Déployer sur Vercel (gratuit, sans carte)

1. Allez sur https://vercel.com/signup et créez un compte avec votre GitHub.
2. **Add New → Project** → sélectionnez votre dépôt → Vercel détecte
   automatiquement Vite grâce à `vercel.json`.
3. Avant de cliquer sur **Deploy**, ouvrez **Environment Variables** et
   ajoutez-en une :
   - **Nom** : `FIREBASE_SERVICE_ACCOUNT`
   - **Valeur** : ouvrez le fichier `.json` téléchargé à l'étape 1.5 avec un
     éditeur de texte, **copiez tout son contenu** (accolades incluses) et
     collez-le tel quel dans la valeur.
4. Cliquez sur **Deploy**. Après 1–2 minutes, Vercel vous donne une URL du
   type `https://carnet-du-foyer.vercel.app` — c'est votre application, en
   ligne, gratuitement.

---

## Étape 6 — Installer l'appli sur votre téléphone et celui de votre femme

1. Ouvrez l'URL de l'étape 5 dans Chrome (Android) ou Safari (iPhone).
2. **Android (Chrome)** : bandeau "Installer l'application", ou menu ⋮ →
   **Installer l'application**.
3. **iPhone (Safari)** : bouton de partage → **Sur l'écran d'accueil**.
4. Répétez sur le téléphone de votre femme, avec le **même lien**.
5. Sur la page "Aujourd'hui", appuyez sur **Activer** dans le bloc
   Notifications, acceptez la permission, indiquez votre prénom.

À partir de là : chaque ajout (tâche, repas, activité, courses, valise)
déclenche une notification sur l'autre téléphone — même appli fermée — sans
qu'aucun service payant n'entre en jeu.

---

## Étape 7 (optionnelle) — Obtenir un vrai fichier .apk

1. https://www.pwabuilder.com → collez l'URL de l'étape 5 → **Start**.
2. Onglet **Android** → **Generate Package** → téléchargez le `.apk`.
3. Transférez-le sur le téléphone et ouvrez-le pour l'installer (Android
   demandera d'autoriser "Sources inconnues" la première fois).

---

## Pourquoi c'est vraiment gratuit

- **Firestore (Spark)** : jusqu'à 50 000 lectures et 20 000 écritures par jour
  offertes — un usage familial en utilise une fraction infime.
- **Cloud Messaging** : gratuit et illimité, quel que soit le plan Firebase.
- **Vercel (Hobby)** : hébergement + fonctions serverless gratuits pour un
  usage personnel, aucune carte bancaire demandée à l'inscription.
- La seule chose qui nécessitait une carte (les Cloud Functions Firebase,
  plan "Blaze") a été remplacée par une fonction Vercel équivalente.

---

## Pour aller plus loin (facultatif)

- **Sécurité** : `firestore.rules` autorise la lecture/écriture à qui connaît
  l'URL de votre projet Firebase. Suffisant pour un usage familial privé, mais
  pas un vrai contrôle d'accès — dites-le-moi si vous voulez ajouter une
  authentification.
- **Mettre à jour l'appli** après une modification : il suffit de refaire
  `git push`, Vercel redéploie automatiquement.
- **Logs de notifications** : Vercel → votre projet → onglet **Logs**.

---

## En cas de blocage

Si une étape coince (message d'erreur, notification qui n'arrive pas...),
revenez me voir avec le message d'erreur exact.

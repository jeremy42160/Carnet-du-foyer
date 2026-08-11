import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./firebase";

// Firebase Authentication exige un e-mail. Comme on veut un simple "identifiant"
// (pas une vraie adresse mail), on fabrique un faux e-mail interne à partir du nom
// d'utilisateur — l'utilisateur ne le voit jamais, il ne tape qu'un identifiant.
function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@carnet-du-foyer.local`;
}

// Les deux comptes historiques du foyer. Ils sont créés automatiquement (une seule
// fois chacun) au premier login réussi avec ces identifiants + ce mot de passe,
// et partagent le même "foyer" que les données déjà existantes dans l'appli
// (aucune migration de données nécessaire : householdId "default" correspond
// directement aux collections déjà en place).
const SEED_ACCOUNTS = {
  JEREMY: "Volley12!",
  JENNIFER: "Volley12!",
};

export function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function getMyHousehold(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

// Enregistre la date/heure de la dernière connexion — appelée à chaque authentification
// réussie (login explicite ou reprise de session), pour que l'administrateur puisse
// voir qui s'est connecté récemment.
export async function touchLastLogin(uid) {
  try {
    await setDoc(doc(db, "users", uid), { lastLoginAt: serverTimestamp() }, { merge: true });
  } catch (e) {
    console.error("Impossible d'enregistrer la dernière connexion", e);
  }
}

// Enregistre la disposition personnalisée des onglets du bas (ordre + onglets
// affichés) sur le compte de la personne connectée, pour qu'elle la retrouve
// telle quelle à chaque reconnexion, sur n'importe quel appareil.
export async function saveNavTabs(uid, navTabs) {
  await setDoc(doc(db, "users", uid), { navTabs }, { merge: true });
}

export async function login(usernameRaw, password) {
  const username = usernameRaw.trim();
  const usernameUpper = username.toUpperCase();
  const email = usernameToEmail(username);

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return { ok: true, uid: cred.user.uid };
  } catch (e) {
    // Si c'est un des deux comptes historiques et qu'il n'existe pas encore
    // côté Firebase Authentication, on le crée automatiquement à la première
    // connexion (avec le bon mot de passe attendu), pour éviter toute étape
    // manuelle de configuration.
    const isSeed = SEED_ACCOUNTS[usernameUpper] && SEED_ACCOUNTS[usernameUpper] === password;
    if (isSeed && (e.code === "auth/user-not-found" || e.code === "auth/invalid-credential")) {
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await setDoc(doc(db, "users", cred.user.uid), {
          username: usernameUpper,
          householdId: "default",
          isAdmin: usernameUpper === "JEREMY",
          createdAt: serverTimestamp(),
        });
        return { ok: true, uid: cred.user.uid };
      } catch (createErr) {
        return { ok: false, error: friendlyAuthError(createErr) };
      }
    }
    return { ok: false, error: friendlyAuthError(e) };
  }
}

export async function register(usernameRaw, password) {
  const username = usernameRaw.trim();
  const usernameUpper = username.toUpperCase();
  if (!username) return { ok: false, error: "Choisissez un identifiant." };
  if (SEED_ACCOUNTS[usernameUpper]) {
    return { ok: false, error: "Cet identifiant est réservé, choisissez-en un autre." };
  }
  if (password.length < 6) {
    return { ok: false, error: "Le mot de passe doit faire au moins 6 caractères." };
  }
  const email = usernameToEmail(username);

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const householdId = crypto.randomUUID();
    await setDoc(doc(db, "users", cred.user.uid), {
      username: usernameUpper,
      householdId,
      isAdmin: false,
      createdAt: serverTimestamp(),
    });
    return { ok: true, uid: cred.user.uid };
  } catch (e) {
    return { ok: false, error: friendlyAuthError(e) };
  }
}

export async function logout() {
  await firebaseSignOut(auth);
}

function friendlyAuthError(e) {
  const code = e?.code || "";
  if (code.includes("wrong-password") || code.includes("invalid-credential")) return "Identifiant ou mot de passe incorrect.";
  if (code.includes("user-not-found")) return "Identifiant ou mot de passe incorrect.";
  if (code.includes("email-already-in-use")) return "Cet identifiant est déjà utilisé.";
  if (code.includes("weak-password")) return "Mot de passe trop faible (6 caractères minimum).";
  if (code.includes("network-request-failed")) return "Problème de connexion réseau.";
  return "Une erreur est survenue, réessayez.";
}

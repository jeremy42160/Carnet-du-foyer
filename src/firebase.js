import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getMessaging, isSupported } from "firebase/messaging";
import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth";

// ⚠️ Remplacez par la config de VOTRE projet Firebase
// (Console Firebase → Paramètres du projet → Vos applications → config).
// Elle doit être IDENTIQUE à celle de public/firebase-messaging-sw.js.
const firebaseConfig = {
  apiKey: "AIzaSyBK0XE4AInFTxrDTU9YiccuW5DzbFRSyPQ",
  authDomain: "carnet-du-foyer.firebaseapp.com",
  projectId: "carnet-du-foyer",
  storageBucket: "carnet-du-foyer.appspot.com",
  messagingSenderId: "1049902629118",
  appId: "1:1049902629118:web:06cd2097a9237873cb65af",
};

// Clé publique VAPID, à récupérer dans Console Firebase → Cloud Messaging →
// "Certificats Web Push" → générer une paire de clés.
export const VAPID_KEY = "BG0Zy6AdpDtUyAYx60N1OPO83vBvKrBMp4gN5UJiPFK_mM7_kq8FeheA-9J02JlhiEUCqOAc9GzDvevChJzly4k";

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Session conservée indéfiniment sur cet appareil/navigateur (PC comme mobile) :
// pas de reconnexion à chaque ouverture, tant que la personne ne se déconnecte
// pas elle-même ou n'efface pas les données du navigateur. C'est le mode le plus
// durable proposé par Firebase — on le fixe explicitement pour ne pas dépendre
// du comportement par défaut du navigateur (certains, comme la navigation privée,
// se comportent différemment).
setPersistence(auth, browserLocalPersistence).catch((e) => {
  console.error("Impossible de configurer la persistance de session", e);
});

export async function getMessagingIfSupported() {
  try {
    const supported = await isSupported();
    return supported ? getMessaging(app) : null;
  } catch {
    return null;
  }
}

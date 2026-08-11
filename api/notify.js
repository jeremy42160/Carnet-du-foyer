// Fonction serverless Vercel — remplace les Cloud Functions Firebase (qui exigent
// désormais un compte payant "Blaze"). Hébergée gratuitement sur Vercel, sans carte
// bancaire requise. Elle est appelée directement par l'appli juste après l'ajout
// d'un élément (tâche, repas, activité, courses, valise).
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée" });
    return;
  }

  try {
    const { title, body, excludeDeviceId, category, householdId } = req.body;
    if (!title || !body) {
      res.status(400).json({ error: "title et body sont requis" });
      return;
    }

    const db = admin.firestore();
    const devicesSnap = await db.collection("devices").get();
    const tokens = devicesSnap.docs
      .filter((d) => d.id !== excludeDeviceId)
      .filter((d) => {
        // Ne jamais notifier un appareil d'un autre foyer.
        const deviceHousehold = d.data().householdId;
        if (!householdId || !deviceHousehold) return true; // anciens appareils sans foyer enregistré : compatibilité
        return deviceHousehold === householdId;
      })
      .filter((d) => {
        // Si aucune catégorie n'est précisée, ou que l'appareil n'a pas encore de
        // préférences enregistrées, on envoie par défaut. On ne bloque que si la
        // préférence pour cette catégorie a été explicitement désactivée.
        if (!category) return true;
        const prefs = d.data().categories;
        if (!prefs) return true;
        return prefs[category] !== false;
      })
      .map((d) => d.data().token)
      .filter(Boolean);

    if (tokens.length === 0) {
      res.status(200).json({ sent: 0 });
      return;
    }

    const result = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      webpush: { fcmOptions: { link: "/" } },
    });

    res.status(200).json({ sent: result.successCount });
  } catch (e) {
    console.error("Erreur d'envoi de notification", e);
    res.status(500).json({ error: e.message });
  }
}

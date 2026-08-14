// Fonction serverless Vercel — fournit un résumé du jour en JSON, destiné au widget
// Android natif (écran d'accueil du téléphone), pas à l'appli web elle-même.
// Le widget fait un simple appel HTTP GET vers cette adresse toutes les 30-60 minutes.
//
// Appel : GET /api/widget-data?username=JEREMY
//
// Volontairement minimaliste : pas d'authentification complexe, puisque c'est une
// appli familiale privée à usage personnel. Seul le prénom du compte est demandé,
// pas le mot de passe — ce point est documenté et assumé pour cet usage précis.
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}

function parisToday() {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function dayNameFR() {
  const s = new Date().toLocaleDateString("fr-FR", { weekday: "long", timeZone: "Europe/Paris" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function dayLabelFR() {
  return new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });
}

function collectionRef(db, householdId, name) {
  return householdId === "default" ? db.collection(name) : db.collection("households").doc(householdId).collection(name);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const username = (req.query.username || "").toString().trim();
  if (!username) {
    res.status(400).json({ error: "Paramètre username manquant" });
    return;
  }

  try {
    const db = admin.firestore();
    const usersSnap = await db.collection("users").where("username", "==", username).limit(1).get();
    if (usersSnap.empty) {
      res.status(404).json({ error: "Compte introuvable" });
      return;
    }
    const householdId = usersSnap.docs[0].data().householdId;
    const todayIso = parisToday();
    const todayDayName = dayNameFR();

    const [tasksSnap, repasSnap, activitesSnap] = await Promise.all([
      collectionRef(db, householdId, "tasks").where("date", "==", todayIso).get(),
      collectionRef(db, householdId, "repas").where("date", "==", todayIso).get(),
      collectionRef(db, householdId, "activites").get(),
    ]);

    const items = [];

    activitesSnap.docs
      .map((d) => d.data())
      .filter((a) => (a.recurring && a.day === todayDayName) || (!a.recurring && a.date === todayIso))
      .sort((a, b) => (a.time || "").localeCompare(b.time || ""))
      .forEach((a) => items.push(`${a.time || ""} ${a.activity} (${a.child})`.trim()));

    repasSnap.docs.map((d) => d.data()).forEach((r) => items.push(`Repas : ${r.meal}`));

    tasksSnap.docs
      .map((d) => d.data())
      .filter((t) => !t.done)
      .forEach((t) => {
        if (t.isWork) items.push(`${t.assignee} : ${t.isRest ? "repos" : `travail ${t.time || ""}-${t.endTime || ""}`}`);
        else if (t.isFriend) items.push(`${t.friendName} (${t.moment})`);
        else items.push(`${t.text} (${t.assignee})`);
      });

    res.status(200).json({
      dayLabel: dayLabelFR(),
      items: items.slice(0, 6),
      count: items.length,
    });
  } catch (e) {
    console.error("Erreur widget-data :", e);
    res.status(500).json({ error: e.message });
  }
}

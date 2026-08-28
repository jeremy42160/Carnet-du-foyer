// Fonction serverless Vercel — fournit un résumé des prochains jours en JSON, destiné
// aux widgets Android natifs (écran d'accueil du téléphone), pas à l'appli web elle-même.
// Chaque widget fait un simple appel HTTP GET vers cette adresse régulièrement.
//
// Appel : GET /api/widget-data?username=JEREMY&days=1   (widget "Aujourd'hui")
//         GET /api/widget-data?username=JEREMY&days=5   (widget "Calendrier")
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

function isoOffset(offsetDays) {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(Date.now() + offsetDays * 86400000));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function dayNameFR(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const s = d.toLocaleDateString("fr-FR", { weekday: "long", timeZone: "Europe/Paris" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function dayLabelFR(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const s = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function collectionRef(db, householdId, name) {
  return householdId === "default" ? db.collection(name) : db.collection("households").doc(householdId).collection(name);
}

async function buildDayItems(db, householdId, offsetDays, allActivites) {
  const dateIso = isoOffset(offsetDays);
  const dayName = dayNameFR(offsetDays);

  const [tasksSnap, repasSnap] = await Promise.all([
    collectionRef(db, householdId, "tasks").where("date", "==", dateIso).get(),
    collectionRef(db, householdId, "repas").where("date", "==", dateIso).get(),
  ]);

  const items = [];

  allActivites
    .filter((a) => (a.recurring && a.day === dayName) || (!a.recurring && a.date === dateIso))
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

  return { dateIso, dayLabel: dayLabelFR(offsetDays), items: items.slice(0, 6), count: items.length };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const username = (req.query.username || "").toString().trim();
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 1, 1), 7);
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
    const activitesSnap = await collectionRef(db, householdId, "activites").get();
    const allActivites = activitesSnap.docs.map((d) => d.data());

    const daysData = [];
    for (let i = 0; i < days; i++) {
      daysData.push(await buildDayItems(db, householdId, i, allActivites));
    }

    if (days === 1) {
      // Forme simple, inchangée pour le widget "Aujourd'hui" déjà en place.
      res.status(200).json({ dayLabel: daysData[0].dayLabel, items: daysData[0].items, count: daysData[0].count });
    } else {
      // Forme multi-jours pour le widget "Calendrier".
      res.status(200).json({ days: daysData });
    }
  } catch (e) {
    console.error("Erreur widget-data :", e);
    res.status(500).json({ error: e.message });
  }
}

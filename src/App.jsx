import { useState, useEffect, useRef } from "react";
import {
  Home, CheckSquare, ShoppingCart, UtensilsCrossed, CalendarClock, CalendarDays, Briefcase,
  Plus, Trash2, Check, X, Loader2, Shuffle, ChevronLeft, ChevronRight, Bell, BellOff, User, Palette, Users, Pencil,
} from "lucide-react";
import { useCollection } from "./hooks/useCollection";
import { useHouseholdConfig, DEFAULT_MEAL_FIELDS } from "./hooks/useHouseholdConfig";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";
import { enableNotifications, disableNotifications, getMyDevice, setCategoryPref, NOTIF_CATEGORIES } from "./notifications";
import { sendPush } from "./push";
import { watchAuthState, getMyHousehold, login, register, logout, touchLastLogin, saveNavTabs } from "./auth";

const TABS = [
  { id: "jour", label: "Aujourd'hui", icon: Home },
  { id: "taches", label: "Tâches", icon: CheckSquare },
  { id: "calendrier", label: "Calendrier", icon: CalendarDays },
  { id: "repas", label: "Enfants", icon: UtensilsCrossed },
  { id: "valise", label: "Valises", icon: Briefcase },
  { id: "courses", label: "Courses", icon: ShoppingCart },
  { id: "profil", label: "Profil", icon: User },
];

const QUICK_ADD_CHOICES = [
  { id: "travail", label: "Travail", icon: Briefcase },
  { id: "amis", label: "Amis", icon: Users },
  { id: "activite", label: "Activités", icon: CalendarClock },
  { id: "tache", label: "Tâche", icon: CheckSquare },
  { id: "repas", label: "Repas", icon: UtensilsCrossed },
];

const ASSIGNEES = ["Jerem", "Jennifer", "Les deux"];
// Icônes de métiers proposées lors de la configuration du foyer (onboarding et Profil).
const PROFESSION_ICONS = [
  { emoji: "🩺", label: "Santé" },
  { emoji: "💳", label: "Commerce" },
  { emoji: "👨‍🏫", label: "Enseignement" },
  { emoji: "👷", label: "BTP" },
  { emoji: "💼", label: "Bureau" },
  { emoji: "🚓", label: "Sécurité" },
  { emoji: "🚒", label: "Pompier" },
  { emoji: "👨‍🍳", label: "Restauration" },
  { emoji: "🚚", label: "Transport" },
  { emoji: "💻", label: "Informatique" },
  { emoji: "⚖️", label: "Droit" },
  { emoji: "🔧", label: "Technique" },
];
const KID_COLOR_PALETTE = ["#5B4B8A", "#C1683C", "#3E6E63", "#8C3B4E", "#34507A", "#4A7856", "#B08968", "#5C6BC0"];
const FRIEND_MOMENTS = ["Journée", "Midi", "Goûter", "Soir"];

// Couleurs fixes par catégorie pour la vue Calendrier (indépendantes de la couleur
// d'accent personnalisable, pour que la légende reste lisible quel que soit le thème).
const CAT_COLORS = {
  tache: "#6B7280",
  travail: "#2F6B4F",
  repos: "#B0455A",
  amis: "#C1683C",
  activite: "#5B4B8A",
  repas: "#3B6B8C",
};

function monthGridDates(monthDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7; // 0 = lundi
  const start = new Date(firstOfMonth);
  start.setDate(1 - firstWeekday);
  const days = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

// Rassemble tous les éléments (tâches, travail, amis, repas, activités) d'un jour
// donné, avec une couleur par catégorie, pour l'affichage compact en grille.
function buildDayItems(iso, dayName, tasks, repas, activites) {
  const items = [];
  tasks
    .filter((t) => t.date === iso)
    .forEach((t) => {
      if (t.isWork) {
        items.push({ label: `${t.icon} ${t.isRest ? "Repos" : `${t.time}–${t.endTime}`}`, color: t.isRest ? CAT_COLORS.repos : CAT_COLORS.travail });
      } else if (t.isFriend) {
        items.push({ label: `${t.friendName} (${t.moment})`, color: CAT_COLORS.amis });
      } else {
        items.push({ label: t.text, color: CAT_COLORS.tache });
      }
    });
  repas.filter((r) => r.date === iso).forEach((r) => items.push({ label: r.meal, color: CAT_COLORS.repas }));
  activites
    .filter((a) => (a.recurring && a.day === dayName) || (!a.recurring && a.date === iso))
    .forEach((a) => items.push({ label: `${a.icon} ${a.activity}`, color: CAT_COLORS.activite }));
  return items;
}
const KIDS = [
  { name: "Noé", color: "#5B4B8A" },
  { name: "Thaïs", color: "#C1683C" },
  { name: "Alba", color: "#3E6E63" },
];
const PEOPLE_COLORS = { Jerem: "#3E6E63", Jennifer: "#C1683C", "Les deux": "#5B4B8A", Tous: "#8A8071", Parents: "var(--accent)" };
const VALISE_OWNERS = ["Tous", "Jerem", "Jennifer", "Noé", "Thaïs", "Alba"];
const MEAL_TASKS = [
  { id: "table", label: "Mettre la table" },
  { id: "debarrasser", label: "Débarrasser la table" },
  { id: "yaourts", label: "Chercher les yaourts" },
];
const MEALS = ["Petit-déjeuner", "Déjeuner", "Dîner"];

// Les repas créés avant cette mise à jour stockent un seul prénom par champ fixe
// (r.table, r.debarrasser, r.yaourts). On les convertit à la volée vers le nouveau
// format (tableau de champs avec plusieurs personnes possibles par champ), pour ne
// perdre aucune donnée existante.
function getRepasTasks(r) {
  if (Array.isArray(r.tasks)) return r.tasks;
  return MEAL_TASKS.map((t) => ({ id: t.id, label: t.label, assignees: r[t.id] ? [r[t.id]] : [], counted: true }));
}
// Résumé compact affiché partout où le repas apparaît (Aujourd'hui, Calendrier, etc.)
function repasSummary(r) {
  return getRepasTasks(r)
    .filter((t) => (t.assignees || []).length > 0)
    .map((t) => `${t.label}: ${t.assignees.join(" + ")}`)
    .join(", ");
}
const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const ACTIVITY_ICONS = [
  { emoji: "⚽", label: "Foot" },
  { emoji: "🩰", label: "Danse" },
  { emoji: "🏐", label: "Volleyball" },
  { emoji: "🏋️", label: "Salle de sport" },
  { emoji: "⭐", label: "Autres" },
];

function colorFor(name) {
  const kid = KIDS.find((k) => k.name === name);
  if (kid) return kid.color;
  if (PEOPLE_COLORS[name]) return PEOPLE_COLORS[name];
  if (!name) return "#8A8071";
  // Couleur stable (toujours la même pour un même prénom) pour les enfants/métiers
  // personnalisés d'un autre foyer, sans avoir à connaître leur configuration ici.
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return KID_COLOR_PALETTE[hash % KID_COLOR_PALETTE.length];
}
function todayFR() {
  const s = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function todayDayName() {
  const s = new Date().toLocaleDateString("fr-FR", { weekday: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function dayNameFromDate(dateStr) {
  if (!dateStr) return "";
  const s = new Date(dateStr + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function todayISO() { return toISO(new Date()); }
function datesBetween(startStr, endStr) {
  const dates = [];
  const d = new Date(startStr + "T00:00:00");
  const end = new Date(endStr + "T00:00:00");
  while (d <= end) {
    dates.push(toISO(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}
function startOfWeek(offset) {
  const d = new Date();
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow + offset * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}
function weekDates(offset) {
  const start = startOfWeek(offset);
  return DAYS.map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
}
function suggestAssignment(records, kids, mealFields) {
  const used = new Set();
  const result = {};
  (mealFields || []).forEach((field) => {
    let pool = kids.filter((k) => !used.has(k.name));
    if (pool.length === 0) pool = kids; // pas assez d'enfants distincts : on autorise la répétition
    const counts = pool.map((k) => ({
      name: k.name,
      count: records.filter((r) => getRepasTasks(r).some((t) => t.id === field.id && (t.assignees || []).includes(k.name))).length,
    }));
    const min = Math.min(...counts.map((c) => c.count));
    const candidates = counts.filter((c) => c.count === min);
    const pick = candidates[Math.floor(Math.random() * candidates.length)].name;
    used.add(pick);
    result[field.id] = pick;
  });
  return result;
}

function AppContent({ householdId, username, isAdmin, onLogout, navTabs, updateNavTabs }) {
  const effectiveNavTabs = navTabs && navTabs.length ? navTabs : TABS.map((t) => t.id);
  const { config: householdConfig, loading: configLoading, save: saveHouseholdConfig, setConfig: setHouseholdConfigLocal } = useHouseholdConfig(householdId);

  // Permet d'ouvrir l'appli directement sur un onglet précis via l'URL
  // (ex. https://.../?tab=calendrier) — utilisé pour créer un raccourci
  // "Calendrier" sur l'écran d'accueil, en plus de l'icône principale.
  const [active, setActive] = useState(() => {
    if (typeof window !== "undefined") {
      const tab = new URLSearchParams(window.location.search).get("tab");
      if (tab && TABS.some((t) => t.id === tab)) return tab;
    }
    return "jour";
  });
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const notify = (msg = "Enregistré") => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  };

  const [fabOpen, setFabOpen] = useState(false);
  const [taskRequest, setTaskRequest] = useState({ category: "travail", token: 0, date: null });
  const [repasDateRequest, setRepasDateRequest] = useState({ date: null, token: 0 });
  const openAddWith = (categoryId, presetDate) => {
    if (categoryId === "repas") {
      setRepasDateRequest({ date: presetDate || null, token: Date.now() });
      setActive("repas");
    } else {
      setTaskRequest({ category: categoryId, token: Date.now(), date: presetDate || null });
      setActive("taches");
    }
    setFabOpen(false);
  };

  const [accentColor, setAccentColor] = useState(() => localStorage.getItem("carnet-accent-color") || "#5B4B8A");
  const updateAccent = (color) => {
    setAccentColor(color);
    localStorage.setItem("carnet-accent-color", color);
  };

  // Notifications limitées au foyer courant (voir api/notify.js).
  const push = (title, body, category) => sendPush(title, body, category, householdId);

  const tasksC = useCollection("tasks", householdId);
  const repasC = useCollection("repas", householdId);
  const activitesC = useCollection("activites", householdId);
  const shoppingC = useCollection("shopping", householdId);
  const valiseC = useCollection("valise", householdId);
  const friendsC = useCollection("friends", householdId);

  const ready = tasksC.ready && repasC.ready && activitesC.ready && shoppingC.ready && valiseC.ready;

  const needsOnboarding = !configLoading && householdConfig && householdConfig.hasKids === null;
  if (needsOnboarding) {
    return (
      <OnboardingWizard
        save={saveHouseholdConfig}
        onFinish={(finalConfig) => setHouseholdConfigLocal(finalConfig)}
      />
    );
  }

  const kids = householdConfig?.hasKids ? householdConfig.kids : [];
  const workers = householdConfig?.hasWork ? householdConfig.workers : [];

  return (
    <div style={{ "--accent": accentColor, fontFamily: "'Public Sans', sans-serif", background: "#F1ECE2", minHeight: "100vh", color: "#262138", display: "flex", flexDirection: "column" }}>
      <main style={{ flex: 1, overflowY: "auto", padding: "20px 16px 110px", maxWidth: 560, margin: "0 auto", width: "100%" }}>
        {!ready || configLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 60, color: "#8A8071" }}>
            <Loader2 size={22} style={{ animation: "spin 1s linear infinite" }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : active === "jour" ? (
          <Overview tasks={tasksC.items} shopping={shoppingC.items} repas={repasC.items} activites={activitesC.items} goTo={setActive} notify={notify} username={username} householdId={householdId} />
        ) : active === "taches" ? (
          <Tasks tasks={tasksC.items} col={tasksC} notify={notify} friends={friendsC.items} friendsCol={friendsC} activites={activitesC.items} activitesCol={activitesC} initialCategory={taskRequest.category} requestToken={taskRequest.token} initialDate={taskRequest.date} sendPush={push} kids={kids} workers={workers} />
        ) : active === "calendrier" ? (
          <Calendrier tasks={tasksC.items} repas={repasC.items} activites={activitesC.items} tasksCol={tasksC} repasCol={repasC} activitesCol={activitesC} notify={notify} workers={workers} friends={friendsC.items} kids={kids} onQuickAdd={openAddWith} />
        ) : active === "repas" ? (
          <Repas repas={repasC.items} col={repasC} notify={notify} sendPush={push} kids={kids} mealFields={householdConfig?.mealFields || []} saveHouseholdConfig={saveHouseholdConfig} presetDate={repasDateRequest.date} presetToken={repasDateRequest.token} />
        ) : active === "activites" ? (
          <Activites activites={activitesC.items} col={activitesC} notify={notify} sendPush={push} kids={kids} />
        ) : active === "valise" ? (
          <Valise valise={valiseC.items} col={valiseC} notify={notify} sendPush={push} />
        ) : active === "profil" ? (
          <Profil accentColor={accentColor} updateAccent={updateAccent} householdId={householdId} username={username} isAdmin={isAdmin} onLogout={onLogout} householdConfig={householdConfig} saveHouseholdConfig={saveHouseholdConfig} navTabs={effectiveNavTabs} updateNavTabs={updateNavTabs} />
        ) : (
          <Shopping shopping={shoppingC.items} col={shoppingC} notify={notify} sendPush={push} />
        )}
      </main>

      {toast && (
        <div style={{ position: "fixed", bottom: 78, left: "50%", transform: "translateX(-50%)", background: "#262138", color: "#FBF8F3", padding: "8px 16px", borderRadius: 20, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, boxShadow: "0 4px 14px rgba(0,0,0,0.18)", zIndex: 20 }}>
          <Check size={14} /> {toast}
        </div>
      )}

      {fabOpen && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 29, background: "rgba(38,33,56,0.25)" }}
          onClick={() => setFabOpen(false)}
        />
      )}

      {fabOpen && (
        <div
          style={{
            position: "fixed",
            bottom: 88,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            gap: 10,
            zIndex: 30,
            maxWidth: 560,
          }}
        >
          {QUICK_ADD_CHOICES.map((c) => {
            const Icon = c.icon;
            return (
              <button
                key={c.id}
                onClick={() => openAddWith(c.id)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <span style={{ width: 46, height: 46, borderRadius: "50%", background: "#FBF8F3", border: "1px solid #E3DBCB", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 10px rgba(0,0,0,0.18)" }}>
                  <Icon size={20} color="var(--accent)" />
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#5C5346", background: "#FBF8F3", padding: "2px 8px", borderRadius: 8, whiteSpace: "nowrap" }}>{c.label}</span>
              </button>
            );
          })}
        </div>
      )}

      <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#FBF8F3", borderTop: "1px solid #E3DBCB", maxWidth: 560, margin: "0 auto" }}>
        <div className="navscroll" style={{ display: "flex", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          {effectiveNavTabs.map((tabId) => {
            const tab = TABS.find((t) => t.id === tabId);
            if (!tab) return null;
            if (tab.id === "taches") {
              const isActive = active === "taches";
              return (
                <button
                  key={tab.id}
                  onClick={() => setFabOpen((o) => !o)}
                  aria-label="Ajouter"
                  style={{ flex: "0 0 auto", minWidth: 66, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "10px 8px 12px", background: "none", border: "none", cursor: "pointer" }}
                >
                  <span
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: "50%",
                      background: "var(--accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: fabOpen ? "0 1px 4px rgba(0,0,0,0.2)" : "0 2px 6px rgba(0,0,0,0.2)",
                      transform: fabOpen ? "rotate(45deg)" : "rotate(0deg)",
                      transition: "transform 0.2s ease",
                    }}
                  >
                    <Plus size={18} color="#FBF8F3" strokeWidth={2.6} />
                  </span>
                  <span style={{ fontSize: 10, fontWeight: isActive ? 600 : 500, color: isActive ? "var(--accent)" : "#9C9384" }}>Tâches</span>
                </button>
              );
            }
            const Icon = tab.icon;
            const isActive = tab.id === active;
            return (
              <button key={tab.id} onClick={() => setActive(tab.id)} style={{ flex: "0 0 auto", minWidth: 66, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "10px 8px 12px", background: "none", border: "none", cursor: "pointer" }}>
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 26, borderRadius: 10, background: isActive ? "color-mix(in srgb, var(--accent) 15%, white)" : "transparent" }}>
                  <Icon size={18} strokeWidth={isActive ? 2.4 : 2} color={isActive ? "var(--accent)" : "#9C9384"} />
                </span>
                <span style={{ fontSize: 10, fontWeight: isActive ? 600 : 500, color: isActive ? "var(--accent)" : "#9C9384", whiteSpace: "nowrap" }}>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function LoginScreen() {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (!username.trim() || !password) {
      setError("Renseignez un identifiant et un mot de passe.");
      return;
    }
    if (mode === "register" && password !== confirm) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    setBusy(true);
    const result = mode === "login" ? await login(username, password) : await register(username, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
    }
    // Si succès, onAuthStateChanged (géré au niveau racine) prend le relais tout seul.
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F1ECE2", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,500&family=Public+Sans:wght@400;500;600;700&display=swap');`}</style>
      <div style={{ width: "100%", maxWidth: 380, background: "#FBF8F3", border: "1px solid #E3DBCB", borderRadius: 18, padding: 28 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div className="display" style={{ fontFamily: "'Fraunces', serif", fontStyle: "italic", fontSize: 26, fontWeight: 600, color: "#262138" }}>Le carnet du foyer</div>
          <div style={{ fontSize: 13, color: "#8A8071", marginTop: 4 }}>{mode === "login" ? "Connectez-vous à votre foyer" : "Créez le compte de votre foyer"}</div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, color: "#8A8071", display: "block", marginBottom: 6 }}>Identifiant</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 15 }}
          />
        </div>
        <div style={{ marginBottom: mode === "register" ? 14 : 20 }}>
          <label style={{ fontSize: 12, color: "#8A8071", display: "block", marginBottom: 6 }}>Mot de passe</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && mode === "login" && submit()}
            style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 15 }}
          />
        </div>
        {mode === "register" && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 12, color: "#8A8071", display: "block", marginBottom: 6 }}>Confirmer le mot de passe</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 15 }}
            />
          </div>
        )}

        {error && <div style={{ fontSize: 13, color: "#B0455A", marginBottom: 14 }}>{error}</div>}

        <button
          onClick={submit}
          disabled={busy}
          style={{ width: "100%", background: "#5B4B8A", color: "#FBF8F3", border: "none", borderRadius: 10, padding: "12px 0", fontWeight: 600, fontSize: 15, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1, marginBottom: 14 }}
        >
          {busy ? "…" : mode === "login" ? "Se connecter" : "Créer mon compte"}
        </button>

        <button
          onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
          style={{ width: "100%", background: "none", border: "none", color: "#5B4B8A", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
        >
          {mode === "login" ? "Pas encore de compte ? Créer mon compte" : "Déjà un compte ? Se connecter"}
        </button>
      </div>
    </div>
  );
}

function OnboardingShell({ children }) {
  return (
    <div style={{ minHeight: "100vh", background: "#F1ECE2", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 400, background: "#FBF8F3", border: "1px solid #E3DBCB", borderRadius: 18, padding: 28 }}>
        {children}
      </div>
    </div>
  );
}

function OnboardingWizard({ onFinish, save }) {
  const [step, setStep] = useState("kids-question"); // kids-question | kids-names | work-question | work-names
  const [hasKids, setHasKids] = useState(null);
  const [kidsList, setKidsList] = useState([]);
  const [kidInput, setKidInput] = useState("");
  const [hasWork, setHasWork] = useState(null);
  const [workersList, setWorkersList] = useState([]);
  const [workerName, setWorkerName] = useState("");
  const [workerIcon, setWorkerIcon] = useState(PROFESSION_ICONS[0].emoji);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const addKid = () => {
    if (!kidInput.trim()) return;
    setKidsList([...kidsList, { name: kidInput.trim() }]);
    setKidInput("");
  };
  const removeKid = (i) => setKidsList(kidsList.filter((_, idx) => idx !== i));

  const addWorker = () => {
    if (!workerName.trim()) return;
    setWorkersList([...workersList, { name: workerName.trim(), icon: workerIcon }]);
    setWorkerName("");
  };
  const removeWorker = (i) => setWorkersList(workersList.filter((_, idx) => idx !== i));

  const finishAll = async (finalHasWork, finalWorkers) => {
    setSaving(true);
    setSaveError("");
    const kidsWithColors = kidsList.map((k, i) => ({ name: k.name, color: KID_COLOR_PALETTE[i % KID_COLOR_PALETTE.length] }));
    const finalConfig = {
      hasKids,
      kids: hasKids ? kidsWithColors : [],
      hasWork: finalHasWork,
      workers: finalHasWork ? finalWorkers : [],
      mealFields: hasKids ? DEFAULT_MEAL_FIELDS : [],
    };
    try {
      await save(finalConfig);
    } catch (e) {
      // On bascule quand même sur l'appli : la sauvegarde sera retentée en
      // arrière-plan via la synchronisation Firestore normale, plutôt que de
      // bloquer l'utilisateur sur cet écran à cause d'un souci réseau ponctuel.
      console.error("Erreur d'enregistrement de la configuration", e);
    } finally {
      setSaving(false);
    }
    onFinish(finalConfig);
  };

  if (step === "kids-question") {
    return (
      <OnboardingShell>
        <div className="display" style={{ fontStyle: "italic", fontSize: 22, marginBottom: 8, color: "#262138" }}>Configurons votre foyer</div>
        <div style={{ fontSize: 14, color: "#5C5346", marginBottom: 24 }}>Avez-vous des enfants à ajouter dans le carnet ?</div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => { setHasKids(true); setStep("kids-names"); }}
            style={{ flex: 1, padding: "14px 0", borderRadius: 10, border: "1px solid #E3DBCB", background: "#5B4B8A", color: "#FBF8F3", fontWeight: 600, fontSize: 15, cursor: "pointer" }}
          >
            Oui
          </button>
          <button
            onClick={() => { setHasKids(false); setKidsList([]); setStep("work-question"); }}
            style={{ flex: 1, padding: "14px 0", borderRadius: 10, border: "1px solid #E3DBCB", background: "#FBF8F3", color: "#5B4B8A", fontWeight: 600, fontSize: 15, cursor: "pointer" }}
          >
            Non
          </button>
        </div>
      </OnboardingShell>
    );
  }

  if (step === "kids-names") {
    return (
      <OnboardingShell>
        <div className="display" style={{ fontStyle: "italic", fontSize: 22, marginBottom: 8, color: "#262138" }}>Vos enfants</div>
        <div style={{ fontSize: 14, color: "#5C5346", marginBottom: 16 }}>Ajoutez leurs prénoms un par un.</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input
            value={kidInput}
            onChange={(e) => setKidInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addKid()}
            placeholder="Prénom…"
            style={{ flex: 1, padding: "12px 14px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 15 }}
          />
          <button onClick={addKid} style={{ background: "#5B4B8A", color: "#FBF8F3", border: "none", borderRadius: 10, width: 44, cursor: "pointer" }}><Plus size={18} style={{ margin: "auto" }} /></button>
        </div>
        {kidsList.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
            {kidsList.map((k, i) => (
              <span key={i} style={{ display: "flex", alignItems: "center", gap: 6, background: "#F1ECE2", borderRadius: 20, padding: "6px 10px 6px 14px", fontSize: 13, fontWeight: 600, color: "#5C5346" }}>
                {k.name}
                <button onClick={() => removeKid(i)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex" }}><X size={14} color="#8A8071" /></button>
              </span>
            ))}
          </div>
        )}
        <button
          onClick={() => setStep("work-question")}
          disabled={kidsList.length === 0}
          style={{ width: "100%", background: kidsList.length ? "#5B4B8A" : "#C9BFA9", color: "#FBF8F3", border: "none", borderRadius: 10, padding: "12px 0", fontWeight: 600, fontSize: 15, cursor: kidsList.length ? "pointer" : "not-allowed" }}
        >
          Continuer
        </button>
      </OnboardingShell>
    );
  }

  if (step === "work-question") {
    return (
      <OnboardingShell>
        <div className="display" style={{ fontStyle: "italic", fontSize: 22, marginBottom: 8, color: "#262138" }}>Le travail</div>
        <div style={{ fontSize: 14, color: "#5C5346", marginBottom: 24 }}>Souhaitez-vous suivre des plannings de travail dans l'appli ?</div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => { setHasWork(true); setStep("work-names"); }}
            style={{ flex: 1, padding: "14px 0", borderRadius: 10, border: "1px solid #E3DBCB", background: "#5B4B8A", color: "#FBF8F3", fontWeight: 600, fontSize: 15, cursor: "pointer" }}
          >
            Oui
          </button>
          <button
            onClick={() => finishAll(false, [])}
            disabled={saving}
            style={{ flex: 1, padding: "14px 0", borderRadius: 10, border: "1px solid #E3DBCB", background: "#FBF8F3", color: "#5B4B8A", fontWeight: 600, fontSize: 15, cursor: "pointer" }}
          >
            Non
          </button>
        </div>
        {saveError && <div style={{ fontSize: 13, color: "#B0455A", marginTop: 14 }}>{saveError}</div>}
      </OnboardingShell>
    );
  }

  // step === "work-names"
  return (
    <OnboardingShell>
      <div className="display" style={{ fontStyle: "italic", fontSize: 22, marginBottom: 8, color: "#262138" }}>Qui travaille ?</div>
      <div style={{ fontSize: 14, color: "#5C5346", marginBottom: 16 }}>Ajoutez chaque personne avec l'icône de son métier.</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input
          value={workerName}
          onChange={(e) => setWorkerName(e.target.value)}
          placeholder="Prénom…"
          style={{ flex: 1, padding: "12px 14px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 15 }}
        />
        <select value={workerIcon} onChange={(e) => setWorkerIcon(e.target.value)} style={{ width: 60, padding: "10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 15 }}>
          {PROFESSION_ICONS.map((i) => <option key={i.emoji} value={i.emoji}>{i.emoji} {i.label}</option>)}
        </select>
      </div>
      <button onClick={addWorker} style={{ width: "100%", background: "none", border: "1px solid #E3DBCB", color: "#5B4B8A", borderRadius: 10, padding: "9px 0", fontWeight: 600, fontSize: 13, cursor: "pointer", marginBottom: 14 }}>
        + Ajouter
      </button>
      {workersList.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
          {workersList.map((w, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 6, background: "#F1ECE2", borderRadius: 20, padding: "6px 10px 6px 14px", fontSize: 13, fontWeight: 600, color: "#5C5346" }}>
              {w.icon} {w.name}
              <button onClick={() => removeWorker(i)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex" }}><X size={14} color="#8A8071" /></button>
            </span>
          ))}
        </div>
      )}
      {saveError && <div style={{ fontSize: 13, color: "#B0455A", marginBottom: 12 }}>{saveError}</div>}
      <button
        onClick={() => finishAll(true, workersList)}
        disabled={workersList.length === 0 || saving}
        style={{ width: "100%", background: workersList.length ? "#5B4B8A" : "#C9BFA9", color: "#FBF8F3", border: "none", borderRadius: 10, padding: "12px 0", fontWeight: 600, fontSize: 15, cursor: workersList.length ? "pointer" : "not-allowed" }}
      >
        {saving ? "…" : "Terminer"}
      </button>
    </OnboardingShell>
  );
}

export default function App() {
  const [authState, setAuthState] = useState("loading"); // loading | signedOut | signedIn
  const [uid, setUid] = useState(null);
  const [householdId, setHouseholdId] = useState(null);
  const [username, setUsername] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [navTabs, setNavTabs] = useState(null); // null = pas encore personnalisé, ordre par défaut

  useEffect(() => {
    const unsub = watchAuthState(async (user) => {
      if (!user) {
        setAuthState("signedOut");
        setUid(null);
        setHouseholdId(null);
        setUsername("");
        setIsAdmin(false);
        setNavTabs(null);
        return;
      }
      setUid(user.uid);
      try {
        const profile = await getMyHousehold(user.uid);
        if (profile) {
          setHouseholdId(profile.householdId);
          setUsername(profile.username);
          setIsAdmin(!!profile.isAdmin);
          setNavTabs(Array.isArray(profile.navTabs) && profile.navTabs.length ? profile.navTabs : null);
          setAuthState("signedIn");
          touchLastLogin(user.uid); // ne bloque pas l'affichage, se met à jour en arrière-plan
        } else {
          // Compte authentifié mais sans profil (cas anormal) : on déconnecte proprement.
          await logout();
          setAuthState("signedOut");
        }
      } catch (e) {
        console.error("Erreur de chargement du profil", e);
        setAuthState("signedOut");
      }
    });
    return unsub;
  }, []);

  const handleLogout = async () => {
    await logout();
  };

  const updateNavTabs = async (nextIds) => {
    // "profil" reste toujours disponible, pour ne jamais s'enfermer hors des réglages.
    const withProfil = nextIds.includes("profil") ? nextIds : [...nextIds, "profil"];
    setNavTabs(withProfil);
    try {
      await saveNavTabs(uid, withProfil);
    } catch (e) {
      console.error("Impossible d'enregistrer la disposition des onglets", e);
    }
  };

  if (authState === "loading") {
    return (
      <div style={{ minHeight: "100vh", background: "#F1ECE2", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Loader2 size={24} color="#8A8071" style={{ animation: "spin 1s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (authState === "signedOut") {
    return <LoginScreen />;
  }

  return <AppContent householdId={householdId} username={username} isAdmin={isAdmin} onLogout={handleLogout} navTabs={navTabs} updateNavTabs={updateNavTabs} />;
}

function Card({ children, style, onClick }) {
  return <div onClick={onClick} style={{ background: "#FBF8F3", border: "1px solid #E3DBCB", borderRadius: 14, padding: 18, marginBottom: 14, ...style }}>{children}</div>;
}
function SectionLabel({ children }) {
  return <div style={{ fontSize: 13, fontWeight: 600, color: "#8A8071", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>{children}</div>;
}
function EmptyState({ text }) {
  return <div style={{ textAlign: "center", padding: "40px 20px", color: "#9C9384" }}><div className="display" style={{ fontStyle: "italic", fontSize: 16 }}>{text}</div></div>;
}

function DeleteButton({ onDelete, label = "l'élément" }) {
  const [confirming, setConfirming] = useState(false);
  const timer = useRef(null);
  useEffect(() => {
    if (confirming) timer.current = setTimeout(() => setConfirming(false), 3500);
    return () => clearTimeout(timer.current);
  }, [confirming]);

  if (!confirming) {
    return <button onClick={() => setConfirming(true)} aria-label={`Supprimer ${label}`} style={trashStyle}><Trash2 size={16} /></button>;
  }
  return (
    <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <span style={{ fontSize: 11, color: "#B0455A", marginRight: 2 }}>Confirmer ?</span>
      <button onClick={() => { setConfirming(false); onDelete(); }} aria-label="Confirmer la suppression" style={{ ...smallConfirmBtn, background: "#B0455A", color: "#FBF8F3" }}><Check size={13} /></button>
      <button onClick={() => setConfirming(false)} aria-label="Annuler" style={smallConfirmBtn}><X size={13} /></button>
    </span>
  );
}

function StatCard({ label, value, onClick, icon: Icon }) {
  return (
    <button onClick={onClick} style={{ background: "#FBF8F3", border: "1px solid #E3DBCB", borderRadius: 14, padding: 16, textAlign: "left", cursor: "pointer" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#8A8071", marginBottom: 6 }}>
        {Icon && <Icon size={14} />}
        {label}
      </div>
      <div className="mono" style={{ fontSize: 26, fontWeight: 600, color: "var(--accent)" }}>{value}</div>
    </button>
  );
}

function Switch({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      style={{
        width: 46,
        height: 26,
        borderRadius: 13,
        border: "none",
        padding: 2,
        background: checked ? "var(--accent)" : "#D8D2C4",
        display: "flex",
        alignItems: "center",
        justifyContent: checked ? "flex-end" : "flex-start",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.2s ease",
        flexShrink: 0,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#FBF8F3", boxShadow: "0 1px 3px rgba(0,0,0,0.25)" }} />
    </button>
  );
}

function Profil({ accentColor, updateAccent, householdId, username, isAdmin, onLogout, householdConfig, saveHouseholdConfig, navTabs, updateNavTabs }) {
  const [allUsers, setAllUsers] = useState([]);
  useEffect(() => {
    if (!isAdmin) return;
    const unsub = onSnapshot(
      collection(db, "users"),
      (snap) => setAllUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("Erreur de chargement des utilisateurs", err)
    );
    return unsub;
  }, [isAdmin]);

  const moveNavTab = (index, dir) => {
    const next = [...navTabs];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    updateNavTabs(next);
  };
  const removeNavTab = (id) => {
    if (id === "profil") return; // toujours garder Profil accessible
    updateNavTabs(navTabs.filter((t) => t !== id));
  };
  const addNavTab = (id) => updateNavTabs([...navTabs, id]);
  const hiddenTabs = TABS.filter((t) => !navTabs.includes(t.id));

  const [enabled, setEnabled] = useState(() => localStorage.getItem("carnet-notifs-enabled") === "1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [categories, setCategories] = useState({ taches: true, courses: true, valise: true, activites: true, repas: true });
  const [loadingPrefs, setLoadingPrefs] = useState(true);

  useEffect(() => {
    (async () => {
      if (enabled) {
        try {
          const device = await getMyDevice();
          if (device?.categories) setCategories((prev) => ({ ...prev, ...device.categories }));
        } catch (e) {
          console.error(e);
        }
      }
      setLoadingPrefs(false);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [kidInput, setKidInput] = useState("");
  const [workerNameInput, setWorkerNameInput] = useState("");
  const [workerIconInput, setWorkerIconInput] = useState(PROFESSION_ICONS[0].emoji);

  const addKidProfil = () => {
    if (!kidInput.trim() || !householdConfig) return;
    const existing = householdConfig.kids || [];
    const next = [...existing, { name: kidInput.trim(), color: KID_COLOR_PALETTE[existing.length % KID_COLOR_PALETTE.length] }];
    saveHouseholdConfig({ hasKids: true, kids: next });
    setKidInput("");
  };
  const removeKidProfil = (i) => {
    const next = (householdConfig.kids || []).filter((_, idx) => idx !== i);
    saveHouseholdConfig({ kids: next });
  };
  const addWorkerProfil = () => {
    if (!workerNameInput.trim() || !householdConfig) return;
    const existing = householdConfig.workers || [];
    const next = [...existing, { name: workerNameInput.trim(), icon: workerIconInput }];
    saveHouseholdConfig({ hasWork: true, workers: next });
    setWorkerNameInput("");
  };
  const removeWorkerProfil = (i) => {
    const next = (householdConfig.workers || []).filter((_, idx) => idx !== i);
    saveHouseholdConfig({ workers: next });
  };

  const toggleNotifs = async () => {
    setBusy(true);
    setError("");
    try {
      if (!enabled) {
        await enableNotifications(username, householdId);
        localStorage.setItem("carnet-notifs-enabled", "1");
        setEnabled(true);
        setCategories({ taches: true, courses: true, valise: true, activites: true, repas: true });
      } else {
        await disableNotifications();
        localStorage.setItem("carnet-notifs-enabled", "0");
        setEnabled(false);
      }
    } catch (e) {
      setError(e.message || "Erreur");
    }
    setBusy(false);
  };

  const toggleCategory = async (cat) => {
    const next = { ...categories, [cat]: !categories[cat] };
    setCategories(next);
    try {
      await setCategoryPref(cat, next[cat]);
    } catch (e) {
      console.error(e);
    }
  };

  const PRESET_COLORS = [
    { hex: "#5B4B8A", name: "Prune" },
    { hex: "#3E6E63", name: "Sapin" },
    { hex: "#C1683C", name: "Terracotta" },
    { hex: "#34507A", name: "Marine" },
    { hex: "#8C3B4E", name: "Bordeaux" },
    { hex: "#4A7856", name: "Olive" },
    { hex: "#B08968", name: "Noisette" },
    { hex: "#5C6BC0", name: "Indigo" },
  ];
  const isCustom = !PRESET_COLORS.some((p) => p.hex.toLowerCase() === accentColor.toLowerCase());
  const colorInputRef = useRef(null);

  return (
    <div>
      <Card>
        <SectionLabel>Compte</SectionLabel>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: "#262138" }}>{username}</span>
              {isAdmin && (
                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 15%, white)", padding: "2px 8px", borderRadius: 10, textTransform: "uppercase" }}>
                  Admin
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: "#8A8071" }}>{householdId === "default" ? "Foyer principal" : "Votre foyer"}</div>
          </div>
          <button onClick={onLogout} style={ghostBtn}>Déconnexion</button>
        </div>
      </Card>

      <Card>
        <SectionLabel>Onglets de la barre du bas</SectionLabel>
        <div style={{ fontSize: 12, color: "#8A8071", marginBottom: 12 }}>
          Réorganisez, retirez ou ajoutez des onglets — c'est mémorisé sur votre compte, même après reconnexion.
        </div>
        {navTabs.map((id, i) => {
          const tab = TABS.find((t) => t.id === id);
          if (!tab) return null;
          const Icon = tab.icon;
          return (
            <div key={id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid #EFE9DD" }}>
              <Icon size={16} color="#8A8071" />
              <span style={{ flex: 1, fontSize: 14 }}>{tab.label}</span>
              <button
                onClick={() => moveNavTab(i, -1)}
                disabled={i === 0}
                aria-label="Monter"
                style={{ background: "none", border: "none", cursor: i === 0 ? "default" : "pointer", opacity: i === 0 ? 0.3 : 1, padding: 4, fontSize: 16, color: "#5C5346" }}
              >
                ↑
              </button>
              <button
                onClick={() => moveNavTab(i, 1)}
                disabled={i === navTabs.length - 1}
                aria-label="Descendre"
                style={{ background: "none", border: "none", cursor: i === navTabs.length - 1 ? "default" : "pointer", opacity: i === navTabs.length - 1 ? 0.3 : 1, padding: 4, fontSize: 16, color: "#5C5346" }}
              >
                ↓
              </button>
              {id !== "profil" && <DeleteButton onDelete={() => removeNavTab(id)} label={`l'onglet ${tab.label}`} />}
            </div>
          );
        })}
        {hiddenTabs.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: "#8A8071", marginBottom: 8 }}>Onglets masqués :</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {hiddenTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => addNavTab(tab.id)}
                  style={{ display: "flex", alignItems: "center", gap: 6, background: "#F1ECE2", border: "1px solid #E3DBCB", borderRadius: 20, padding: "6px 12px", fontSize: 12, fontWeight: 600, color: "var(--accent)", cursor: "pointer" }}
                >
                  <Plus size={12} /> {tab.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      {isAdmin && (
        <Card>
          <SectionLabel>Utilisateurs ({allUsers.length})</SectionLabel>
          {allUsers.length === 0 ? (
            <div style={{ fontSize: 13, color: "#8A8071" }}>Chargement…</div>
          ) : (
            [...allUsers]
              .sort((a, b) => (a.username || "").localeCompare(b.username || ""))
              .map((u) => (
                <div key={u.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #EFE9DD" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#262138", display: "flex", alignItems: "center", gap: 6 }}>
                      {u.username}
                      {u.isAdmin && <span style={{ fontSize: 9, fontWeight: 700, color: "var(--accent)", textTransform: "uppercase" }}>· Admin</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "#8A8071" }}>{u.householdId === "default" ? "Foyer principal" : "Foyer personnel"}</div>
                    {u.lastLoginAt?.toDate && (
                      <div style={{ fontSize: 11, color: "#9C9384" }}>
                        Dernière connexion : {u.lastLoginAt.toDate().toLocaleDateString("fr-FR")} à {u.lastLoginAt.toDate().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    )}
                  </div>
                  {u.createdAt?.toDate && (
                    <span className="mono" style={{ fontSize: 11, color: "#9C9384" }}>{u.createdAt.toDate().toLocaleDateString("fr-FR")}</span>
                  )}
                </div>
              ))
          )}
        </Card>
      )}

      <Card>
        <SectionLabel>Notifications</SectionLabel>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: enabled ? 16 : 0 }}>
          {enabled ? <Bell size={18} color="var(--accent)" /> : <BellOff size={18} color="#8A8071" />}
          <div style={{ flex: 1, fontSize: 14 }}>{enabled ? "Notifications activées" : "Notifications désactivées"}</div>
          <Switch checked={enabled} onChange={toggleNotifs} disabled={busy} />
        </div>
        {error && <div style={{ fontSize: 12, color: "#B0455A", marginTop: 8 }}>{error}</div>}

        {enabled && !loadingPrefs && (
          <div style={{ borderTop: "1px solid #EFE9DD", paddingTop: 14, marginTop: 4 }}>
            <div style={{ fontSize: 12, color: "#8A8071", marginBottom: 10 }}>Recevoir une notification pour :</div>
            {NOTIF_CATEGORIES.map((c) => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
                <span style={{ flex: 1, fontSize: 14 }}>{c.label}</span>
                <Switch checked={!!categories[c.id]} onChange={() => toggleCategory(c.id)} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <SectionLabel>Couleur de l'application</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 4, justifyItems: "center" }}>
          {PRESET_COLORS.map((c) => {
            const selected = accentColor.toLowerCase() === c.hex.toLowerCase();
            return (
              <button
                key={c.hex}
                onClick={() => updateAccent(c.hex)}
                aria-label={`Choisir la couleur ${c.name}`}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: 0 }}
              >
                <span
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 14,
                    background: c.hex,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: selected ? `0 0 0 2px #FBF8F3, 0 0 0 4px ${c.hex}, 0 4px 10px rgba(0,0,0,0.18)` : "0 2px 6px rgba(0,0,0,0.12)",
                    transform: selected ? "scale(1.05)" : "scale(1)",
                    transition: "box-shadow 0.2s ease, transform 0.15s ease",
                  }}
                >
                  {selected && <Check size={20} color="#FBF8F3" strokeWidth={3} />}
                </span>
                <span style={{ fontSize: 11, color: "#8A8071", fontWeight: 600 }}>{c.name}</span>
              </button>
            );
          })}

          <button
            onClick={() => colorInputRef.current?.click()}
            aria-label="Choisir une couleur personnalisée"
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            <span
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                background: "conic-gradient(from 180deg, #E24C4C, #E2A64C, #D6E24C, #4CE26B, #4CC9E2, #4C6BE2, #A64CE2, #E24C9E, #E24C4C)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: isCustom ? `0 0 0 2px #FBF8F3, 0 0 0 4px ${accentColor}, 0 4px 10px rgba(0,0,0,0.18)` : "0 2px 6px rgba(0,0,0,0.12)",
                transform: isCustom ? "scale(1.05)" : "scale(1)",
                transition: "box-shadow 0.2s ease, transform 0.15s ease",
              }}
            >
              <Palette size={20} color="#FBF8F3" strokeWidth={2.2} />
            </span>
            <span style={{ fontSize: 11, color: "#8A8071", fontWeight: 600 }}>Personnalisée</span>
          </button>
          <input
            ref={colorInputRef}
            type="color"
            value={accentColor}
            onChange={(e) => updateAccent(e.target.value)}
            style={{ position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }}
          />
        </div>
      </Card>

      {householdId !== "default" && householdConfig && (
        <>
          <Card>
            <SectionLabel>Enfants</SectionLabel>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: householdConfig.hasKids ? 14 : 0 }}>
              <span style={{ fontSize: 14 }}>Nous avons des enfants</span>
              <Switch
                checked={!!householdConfig.hasKids}
                onChange={(val) => saveHouseholdConfig({ hasKids: val, kids: val ? householdConfig.kids || [] : [] })}
              />
            </div>
            {householdConfig.hasKids && (
              <>
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <input
                    value={kidInput}
                    onChange={(e) => setKidInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addKidProfil()}
                    placeholder="Prénom…"
                    style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 14 }}
                  />
                  <button onClick={addKidProfil} aria-label="Ajouter" style={{ background: "var(--accent)", color: "#FBF8F3", border: "none", borderRadius: 10, width: 40, cursor: "pointer" }}>
                    <Plus size={16} style={{ margin: "auto" }} />
                  </button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {(householdConfig.kids || []).map((k, i) => (
                    <span key={i} style={{ display: "flex", alignItems: "center", gap: 6, background: "#F1ECE2", borderRadius: 20, padding: "6px 10px 6px 14px", fontSize: 13, fontWeight: 600, color: "#5C5346" }}>
                      {k.name}
                      <button onClick={() => removeKidProfil(i)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex" }}><X size={14} color="#8A8071" /></button>
                    </span>
                  ))}
                </div>
              </>
            )}
          </Card>

          <Card>
            <SectionLabel>Travail</SectionLabel>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: householdConfig.hasWork ? 14 : 0 }}>
              <span style={{ fontSize: 14 }}>Suivre des plannings de travail</span>
              <Switch
                checked={!!householdConfig.hasWork}
                onChange={(val) => saveHouseholdConfig({ hasWork: val, workers: val ? householdConfig.workers || [] : [] })}
              />
            </div>
            {householdConfig.hasWork && (
              <>
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <input
                    value={workerNameInput}
                    onChange={(e) => setWorkerNameInput(e.target.value)}
                    placeholder="Prénom…"
                    style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 14 }}
                  />
                  <select value={workerIconInput} onChange={(e) => setWorkerIconInput(e.target.value)} style={{ width: 60, padding: "10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 15 }}>
                    {PROFESSION_ICONS.map((i) => <option key={i.emoji} value={i.emoji}>{i.emoji} {i.label}</option>)}
                  </select>
                </div>
                <button onClick={addWorkerProfil} style={{ width: "100%", background: "none", border: "1px solid #E3DBCB", color: "var(--accent)", borderRadius: 10, padding: "8px 0", fontWeight: 600, fontSize: 13, cursor: "pointer", marginBottom: 12 }}>
                  + Ajouter
                </button>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {(householdConfig.workers || []).map((w, i) => (
                    <span key={i} style={{ display: "flex", alignItems: "center", gap: 6, background: "#F1ECE2", borderRadius: 20, padding: "6px 10px 6px 14px", fontSize: 13, fontWeight: 600, color: "#5C5346" }}>
                      {w.icon} {w.name}
                      <button onClick={() => removeWorkerProfil(i)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex" }}><X size={14} color="#8A8071" /></button>
                    </span>
                  ))}
                </div>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function weatherIcon(code) {
  if (code === 0) return "☀️";
  if ([1, 2, 3].includes(code)) return "⛅";
  if ([45, 48].includes(code)) return "🌫️";
  if ([51, 53, 55, 56, 57].includes(code)) return "🌦️";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "🌧️";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "🌨️";
  if ([95, 96, 99].includes(code)) return "⛈️";
  return "🌡️";
}

function Meteo({ onData }) {
  const [status, setStatus] = useState("loading"); // loading | ready | denied | error
  const [data, setData] = useState(null);
  const [placeName, setPlaceName] = useState("");

  const load = () => {
    setStatus("loading");
    if (!navigator.geolocation) {
      setStatus("error");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code&timezone=auto&forecast_days=2`;
          const geocodeUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=10&accept-language=fr`;

          // Les deux requêtes partent en parallèle pour gagner du temps.
          const [weatherRes, geoRes] = await Promise.all([
            fetch(weatherUrl),
            fetch(geocodeUrl).catch(() => null),
          ]);
          const json = await weatherRes.json();
          setData(json);
          onData?.(json);

          if (geoRes) {
            try {
              const geoJson = await geoRes.json();
              const a = geoJson.address || {};
              const name = a.city || a.town || a.village || a.municipality || a.county || geoJson.name || "";
              setPlaceName(name);
            } catch {
              // pas grave si le nom du lieu ne se charge pas, la météo reste affichée
            }
          }
          setStatus("ready");
        } catch {
          setStatus("error");
        }
      },
      () => setStatus("denied"),
      { timeout: 8000, maximumAge: 5 * 60 * 1000, enableHighAccuracy: false }
    );
  };

  useEffect(() => {
    load();
  }, []);

  if (status === "loading") {
    return (
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#8A8071", fontSize: 13 }}>
          <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> Chargement de la météo…
        </div>
      </Card>
    );
  }

  if (status === "denied" || status === "error") {
    return (
      <Card>
        <div style={{ fontSize: 13, color: "#8A8071", marginBottom: 8 }}>
          {status === "denied" ? "Localisation refusée — impossible d'afficher la météo." : "Météo indisponible pour le moment."}
        </div>
        <button onClick={load} style={ghostBtn}>Réessayer</button>
      </Card>
    );
  }

  const current = data.current;
  const hourly = data.hourly;
  const now = new Date();
  let startIndex = hourly.time.findIndex((t) => new Date(t) >= now);
  if (startIndex < 0) startIndex = 0;
  const upcoming = hourly.time.slice(startIndex, startIndex + 12).map((t, i) => ({
    time: t,
    temp: hourly.temperature_2m[startIndex + i],
    code: hourly.weather_code[startIndex + i],
  }));

  return (
    <Card>
      <SectionLabel>Météo</SectionLabel>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
        <span style={{ fontSize: 40 }}>{weatherIcon(current.weather_code)}</span>
        <div>
          <div className="mono" style={{ fontSize: 28, fontWeight: 600, color: "#262138", display: "flex", alignItems: "baseline", gap: 8 }}>
            {Math.round(current.temperature_2m)}°C
            {placeName && <span style={{ fontFamily: "'Public Sans', sans-serif", fontSize: 13, fontWeight: 500, color: "#8A8071" }}>{placeName}</span>}
          </div>
          <div style={{ fontSize: 12, color: "#8A8071" }}>Vent {Math.round(current.wind_speed_10m)} km/h</div>
        </div>
      </div>
      <div style={{ display: "flex", overflowX: "auto", gap: 16, paddingBottom: 2, WebkitOverflowScrolling: "touch" }}>
        {upcoming.map((h, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0, minWidth: 40 }}>
            <span style={{ fontSize: 11, color: "#8A8071" }}>{new Date(h.time).getHours()}h</span>
            <span style={{ fontSize: 20 }}>{weatherIcon(h.code)}</span>
            <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: "#5C5346" }}>{Math.round(h.temp)}°</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Overview({ tasks, shopping, repas, activites, goTo, notify, username, householdId }) {
  const iso = todayISO();
  const dayName = todayDayName();
  const dayTasks = tasks.filter((t) => t.date === iso);
  const dayRepas = repas.filter((r) => r.date === iso);
  const dayActs = activites.filter((a) => (a.recurring && a.day === dayName) || (!a.recurring && a.date === iso)).sort((a, b) => a.time.localeCompare(b.time));
  const hasDayInfo = dayTasks.length + dayRepas.length + dayActs.length > 0;
  const pendingTasks = tasks.filter((t) => !t.done && !t.isWork && !t.isFriend);
  const pendingShopping = shopping.filter((s) => !s.done);
  const undatedPending = pendingTasks.filter((t) => !t.date);

  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowIso = toISO(tomorrowDate);
  const tomorrowDayName = (() => {
    const s = tomorrowDate.toLocaleDateString("fr-FR", { weekday: "long" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  })();
  const tomorrowTasks = tasks.filter((t) => t.date === tomorrowIso);
  const tomorrowRepas = repas.filter((r) => r.date === tomorrowIso);
  const tomorrowActs = activites.filter((a) => (a.recurring && a.day === tomorrowDayName) || (!a.recurring && a.date === tomorrowIso)).sort((a, b) => a.time.localeCompare(b.time));
  const hasTomorrowInfo = tomorrowTasks.length + tomorrowRepas.length + tomorrowActs.length > 0;

  const [weatherData, setWeatherData] = useState(null);
  const tomorrowForecast = (() => {
    if (!weatherData) return null;
    const times = weatherData.hourly.time;
    let idx = times.findIndex((t) => t.startsWith(tomorrowIso) && t.slice(11, 13) === "12");
    if (idx < 0) idx = times.findIndex((t) => t.startsWith(tomorrowIso));
    if (idx < 0) return null;
    return { temp: weatherData.hourly.temperature_2m[idx], code: weatherData.hourly.weather_code[idx] };
  })();

  const [notifPromptVisible, setNotifPromptVisible] = useState(
    () => localStorage.getItem("carnet-notifs-enabled") !== "1" && localStorage.getItem("carnet-notifs-prompted") !== "1"
  );
  const [notifBusy, setNotifBusy] = useState(false);
  const [notifError, setNotifError] = useState("");

  const dismissNotifPrompt = () => {
    localStorage.setItem("carnet-notifs-prompted", "1");
    setNotifPromptVisible(false);
  };
  const acceptNotifPrompt = async () => {
    setNotifBusy(true);
    setNotifError("");
    try {
      await enableNotifications(username, householdId);
      localStorage.setItem("carnet-notifs-enabled", "1");
      notify?.("Notifications activées");
    } catch (e) {
      setNotifError(e.message || "Impossible d'activer les notifications sur cet appareil.");
    }
    setNotifBusy(false);
    localStorage.setItem("carnet-notifs-prompted", "1");
    setNotifPromptVisible(false);
  };

  return (
    <div>
      <Meteo onData={setWeatherData} />

      {notifPromptVisible && (
        <Card style={{ border: "1.5px solid var(--accent)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <Bell size={18} color="var(--accent)" />
            <span style={{ fontSize: 14, fontWeight: 600, color: "#262138" }}>Activer les notifications ?</span>
          </div>
          <div style={{ fontSize: 13, color: "#8A8071", marginBottom: 12 }}>
            Soyez prévenu dès qu'une tâche, un repas ou une activité est ajouté par un membre du foyer.
          </div>
          {notifError && <div style={{ fontSize: 12, color: "#B0455A", marginBottom: 10 }}>{notifError}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={dismissNotifPrompt} style={{ ...ghostBtn, flex: 1 }}>Plus tard</button>
            <button
              onClick={acceptNotifPrompt}
              disabled={notifBusy}
              style={{ flex: 1, background: "var(--accent)", color: "#FBF8F3", border: "none", borderRadius: 10, padding: "9px 0", fontWeight: 600, fontSize: 13, cursor: notifBusy ? "not-allowed" : "pointer", opacity: notifBusy ? 0.7 : 1 }}
            >
              {notifBusy ? "…" : "Activer"}
            </button>
          </div>
        </Card>
      )}

      <Card style={{ border: "1.5px solid var(--accent)" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
          <span className="display" style={{ fontStyle: "italic", fontSize: 22, color: "#262138" }}>{dayName}</span>
          <span style={{ fontSize: 13, color: "#8A8071" }}>{new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}</span>
        </div>
        {!hasDayInfo ? (
          <div style={{ fontSize: 14, color: "#9C9384" }}>Rien de prévu aujourd'hui.</div>
        ) : (
          <div>
            {dayActs.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <SectionLabel>Activités</SectionLabel>
                {dayActs.map((a) => (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0" }}>
                    <span style={{ fontSize: 15 }}>{a.icon}</span>
                    <span className="mono" style={{ fontSize: 12, color: "#8A8071", width: 76 }}>{a.time}–{a.endTime || "?"}</span>
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: colorFor(a.child) }} />
                    <span style={{ fontSize: 14 }}>{a.activity} — {a.child}</span>
                  </div>
                ))}
              </div>
            )}
            {dayRepas.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <SectionLabel>Repas</SectionLabel>
                {dayRepas.map((r) => (
                  <div key={r.id} style={{ fontSize: 14, padding: "5px 0", color: "#5C5346" }}><strong>{r.meal}</strong> — {repasSummary(r)}</div>
                ))}
              </div>
            )}
            {dayTasks.length > 0 && (
              <div>
                <SectionLabel>Tâches du jour</SectionLabel>
                {dayTasks.map((t) => (
                  t.isWork ? (
                    <div key={t.id} style={{ fontSize: 14, padding: "5px 0", display: "flex", alignItems: "center", gap: 8 }}>
                      <span>{t.icon}</span> <strong>{t.assignee}</strong>
                      <span style={{ color: "#8A8071", fontSize: 12 }}>{t.isRest ? "— Repos" : `— Travail ${t.time}–${t.endTime}`}</span>
                    </div>
                  ) : t.isFriend ? (
                    <div key={t.id} style={{ fontSize: 14, padding: "5px 0", display: "flex", alignItems: "center", gap: 8 }}>
                      <span>👥</span> <strong>{t.friendName}</strong>
                      <span style={{ color: "#8A8071", fontSize: 12 }}>— {t.moment}{t.arrivalTime && ` · arrivée ${t.arrivalTime}`}</span>
                    </div>
                  ) : (
                    <div key={t.id} style={{ fontSize: 14, padding: "5px 0", textDecoration: t.done ? "line-through" : "none", color: t.done ? "#9C9384" : "#5C5346" }}>✓ {t.text} <span style={{ color: "#8A8071", fontSize: 12 }}>({t.assignee})</span></div>
                  )
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {hasTomorrowInfo && (
        <Card>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="display" style={{ fontStyle: "italic", fontSize: 18, color: "#262138" }}>Prévu demain — {tomorrowDayName}</span>
              {tomorrowForecast && (
                <span style={{ display: "flex", alignItems: "center", gap: 4, background: "#F1ECE2", borderRadius: 20, padding: "2px 8px", fontSize: 12 }}>
                  {weatherIcon(tomorrowForecast.code)} <span className="mono" style={{ fontWeight: 600 }}>{Math.round(tomorrowForecast.temp)}°</span>
                </span>
              )}
            </div>
            <span style={{ fontSize: 13, color: "#8A8071" }}>{tomorrowDate.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}</span>
          </div>
          {tomorrowActs.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <SectionLabel>Activités</SectionLabel>
              {tomorrowActs.map((a) => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0" }}>
                  <span style={{ fontSize: 15 }}>{a.icon}</span>
                  <span className="mono" style={{ fontSize: 12, color: "#8A8071", width: 76 }}>{a.time}–{a.endTime || "?"}</span>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: colorFor(a.child) }} />
                  <span style={{ fontSize: 14 }}>{a.activity} — {a.child}</span>
                </div>
              ))}
            </div>
          )}
          {tomorrowRepas.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <SectionLabel>Repas</SectionLabel>
              {tomorrowRepas.map((r) => (
                <div key={r.id} style={{ fontSize: 14, padding: "5px 0", color: "#5C5346" }}><strong>{r.meal}</strong> — {repasSummary(r)}</div>
              ))}
            </div>
          )}
          {tomorrowTasks.length > 0 && (
            <div>
              <SectionLabel>Tâches</SectionLabel>
              {tomorrowTasks.map((t) => (
                t.isWork ? (
                  <div key={t.id} style={{ fontSize: 14, padding: "5px 0", display: "flex", alignItems: "center", gap: 8 }}>
                    <span>{t.icon}</span> <strong>{t.assignee}</strong>
                    <span style={{ color: "#8A8071", fontSize: 12 }}>{t.isRest ? "— Repos" : `— Travail ${t.time}–${t.endTime}`}</span>
                  </div>
                ) : t.isFriend ? (
                  <div key={t.id} style={{ fontSize: 14, padding: "5px 0", display: "flex", alignItems: "center", gap: 8 }}>
                    <span>👥</span> <strong>{t.friendName}</strong>
                    <span style={{ color: "#8A8071", fontSize: 12 }}>— {t.moment}{t.arrivalTime && ` · arrivée ${t.arrivalTime}`}</span>
                  </div>
                ) : (
                  <div key={t.id} style={{ fontSize: 14, padding: "5px 0", textDecoration: t.done ? "line-through" : "none", color: t.done ? "#9C9384" : "#5C5346" }}>✓ {t.text} <span style={{ color: "#8A8071", fontSize: 12 }}>({t.assignee})</span></div>
                )
              ))}
            </div>
          )}
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 4 }}>
        <StatCard label="Tâches en cours" value={pendingTasks.length} onClick={() => goTo("taches")} icon={CheckSquare} />
        <StatCard label="Liste de courses" value={pendingShopping.length} onClick={() => goTo("courses")} icon={ShoppingCart} />
      </div>

      {undatedPending.length > 0 ? (
        <Card>
          <SectionLabel>Sans date précise</SectionLabel>
          {undatedPending.slice(0, 3).map((t) => (
            <div key={t.id} style={{ fontSize: 15, padding: "6px 0", borderBottom: "1px solid #EFE9DD" }}>✓ {t.text} <span style={{ color: "#8A8071", fontSize: 13 }}>({t.assignee})</span></div>
          ))}
        </Card>
      ) : (
        !hasDayInfo && <Card><div className="display" style={{ fontStyle: "italic", fontSize: 17, color: "var(--accent)" }}>Tout est à jour. Bonne journée à vous tous.</div></Card>
      )}
    </div>
  );
}

// -- Lignes éditables (tap pour modifier, avec suppression à double confirmation) --

function TaskRow({ t, col, notify, toggle, remove }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(t.text);
  const [assignee, setAssignee] = useState(t.assignee);
  const [date, setDate] = useState(t.date || "");

  const save = async () => {
    await col.update(t.id, { text: text.trim() || t.text, assignee, date: date || null });
    notify("Modifié");
    setEditing(false);
  };

  if (editing) {
    return (
      <div style={{ padding: "10px 0", borderBottom: "1px solid #EFE9DD" }}>
        <input value={text} onChange={(e) => setText(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 14, marginBottom: 8 }} />
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} style={{ flex: 1, padding: "8px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }}>
            {ASSIGNEES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ padding: "8px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setEditing(false)} style={{ ...ghostBtn, flex: 1 }}>Annuler</button>
          <button onClick={save} style={{ flex: 1, background: "var(--accent)", color: "#FBF8F3", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>Enregistrer</button>
        </div>
      </div>
    );
  }

  return (
    <div className="row-enter" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #EFE9DD" }}>
      <button onClick={() => toggle(t.id, t.done)} style={checkStyle(t.done)}>{t.done && <Check size={14} color="#FBF8F3" />}</button>
      <div style={{ flex: 1, cursor: "pointer" }} onClick={() => setEditing(true)}>
        <div style={{ fontSize: 15, textDecoration: t.done ? "line-through" : "none", color: t.done ? "#9C9384" : "#262138" }}>{t.text}</div>
        <div style={{ fontSize: 12, color: "#8A8071" }}>{t.assignee}{t.date ? ` · ${new Date(t.date).toLocaleDateString("fr-FR")}` : ""}</div>
      </div>
      <button onClick={() => setEditing(true)} aria-label="Modifier" style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><Pencil size={15} color="#8A8071" /></button>
      <DeleteButton onDelete={() => remove(t.id)} label="cette tâche" />
    </div>
  );
}

function WorkShiftRow({ w, col, notify, remove, workers }) {
  const [editing, setEditing] = useState(false);
  const [assignee, setAssignee] = useState(w.assignee);
  const [isRest, setIsRest] = useState(!!w.isRest);
  const [date, setDate] = useState(w.date);
  const [time, setTime] = useState(w.time || "08:00");
  const [endTime, setEndTime] = useState(w.endTime || "17:00");

  const save = async () => {
    const icon = workers.find((p) => p.name === assignee)?.icon || w.icon;
    await col.update(w.id, { assignee, isRest, date, time: isRest ? null : time, endTime: isRest ? null : endTime, icon });
    notify("Modifié");
    setEditing(false);
  };

  if (editing) {
    return (
      <div style={{ padding: "10px 0", borderBottom: "1px solid #EFE9DD" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} style={{ flex: 1, padding: "8px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }}>
            {workers.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ padding: "8px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 13, color: "#5C5346", cursor: "pointer" }}>
          <input type="checkbox" checked={isRest} onChange={(e) => setIsRest(e.target.checked)} style={{ width: 15, height: 15, accentColor: "var(--accent)" }} />
          Jour de repos
        </label>
        {!isRest && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ flex: 1, padding: "8px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }} />
            <span style={{ fontSize: 12, color: "#8A8071" }}>à</span>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={{ flex: 1, padding: "8px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }} />
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setEditing(false)} style={{ ...ghostBtn, flex: 1 }}>Annuler</button>
          <button onClick={save} style={{ flex: 1, background: "var(--accent)", color: "#FBF8F3", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>Enregistrer</button>
        </div>
      </div>
    );
  }

  return (
    <div className="row-enter" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #EFE9DD" }}>
      <span style={{ fontSize: 18 }}>{w.icon}</span>
      <div style={{ flex: 1, cursor: "pointer" }} onClick={() => setEditing(true)}>
        <div style={{ fontSize: 15 }}>{w.assignee} — {w.isRest ? "Repos" : "Travail"}</div>
        <div className="mono" style={{ fontSize: 12, color: "#8A8071" }}>
          {new Date(w.date + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}{!w.isRest && ` · ${w.time}–${w.endTime}`}
        </div>
      </div>
      <button onClick={() => setEditing(true)} aria-label="Modifier" style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><Pencil size={15} color="#8A8071" /></button>
      <DeleteButton onDelete={() => remove(w.id)} label="ce planning" />
    </div>
  );
}

function FriendVisitRow({ f, col, notify, remove, friends }) {
  const [editing, setEditing] = useState(false);
  const [friendName, setFriendName] = useState(f.friendName);
  const [moment, setMoment] = useState(f.moment);
  const [date, setDate] = useState(f.date);
  const [arrivalTime, setArrivalTime] = useState(f.arrivalTime || "");

  const save = async () => {
    await col.update(f.id, { friendName: friendName.trim() || f.friendName, moment, date, arrivalTime: arrivalTime || null });
    notify("Modifié");
    setEditing(false);
  };

  if (editing) {
    return (
      <div style={{ padding: "10px 0", borderBottom: "1px solid #EFE9DD" }}>
        {friends.length > 0 && (
          <select value="" onChange={(e) => e.target.value && setFriendName(e.target.value)} style={{ width: "100%", padding: "8px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 12, marginBottom: 8, color: "#5C5346" }}>
            <option value="">Choisir un ami déjà enregistré…</option>
            {friends.map((fr) => <option key={fr.id} value={fr.name}>{fr.name}</option>)}
          </select>
        )}
        <input value={friendName} onChange={(e) => setFriendName(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 14, marginBottom: 8 }} />
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <select value={moment} onChange={(e) => setMoment(e.target.value)} style={{ flex: 1, padding: "8px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }}>
            {FRIEND_MOMENTS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ padding: "8px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }} />
        </div>
        <input type="time" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} style={{ width: "100%", padding: "8px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13, marginBottom: 8 }} />
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setEditing(false)} style={{ ...ghostBtn, flex: 1 }}>Annuler</button>
          <button onClick={save} style={{ flex: 1, background: "var(--accent)", color: "#FBF8F3", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>Enregistrer</button>
        </div>
      </div>
    );
  }

  return (
    <div className="row-enter" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #EFE9DD" }}>
      <span style={{ fontSize: 18 }}>👥</span>
      <div style={{ flex: 1, cursor: "pointer" }} onClick={() => setEditing(true)}>
        <div style={{ fontSize: 15 }}>{f.friendName} — {f.moment}</div>
        <div className="mono" style={{ fontSize: 12, color: "#8A8071" }}>
          {new Date(f.date + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}{f.arrivalTime && ` · arrivée ${f.arrivalTime}`}
        </div>
      </div>
      <button onClick={() => setEditing(true)} aria-label="Modifier" style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><Pencil size={15} color="#8A8071" /></button>
      <DeleteButton onDelete={() => remove(f.id)} label="cette visite" />
    </div>
  );
}

function ActivityRow({ a, activitesCol, notify, removeActivity, kids }) {
  const [editing, setEditing] = useState(false);
  const [activity, setActivity] = useState(a.activity);
  const [icon, setIcon] = useState(a.icon);
  const [child, setChild] = useState(a.child);
  const [recurring, setRecurring] = useState(a.recurring);
  const [day, setDay] = useState(a.day || DAYS[0]);
  const [date, setDate] = useState(a.date || todayISO());
  const [time, setTime] = useState(a.time);
  const [endTime, setEndTime] = useState(a.endTime);

  const save = async () => {
    const base = { activity: activity.trim() || a.activity, icon, child, time, endTime, recurring };
    const record = recurring ? { ...base, day, date: null } : { ...base, date, day: dayNameFromDate(date) };
    await activitesCol.update(a.id, record);
    notify("Modifié");
    setEditing(false);
  };

  if (editing) {
    return (
      <div style={{ padding: "10px 0", borderBottom: "1px solid #EFE9DD" }}>
        <input value={activity} onChange={(e) => setActivity(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 14, marginBottom: 8 }} />
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <select value={icon} onChange={(e) => setIcon(e.target.value)} style={{ width: 70, padding: "8px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 14 }}>
            {ACTIVITY_ICONS.map((i) => <option key={i.emoji} value={i.emoji}>{i.emoji} {i.label}</option>)}
          </select>
          <select value={child} onChange={(e) => setChild(e.target.value)} style={{ flex: 1, padding: "8px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }}>
            {kids.map((k) => <option key={k.name} value={k.name}>{k.name}</option>)}
          </select>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 13, color: "#5C5346", cursor: "pointer" }}>
          <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} style={{ width: 15, height: 15, accentColor: "var(--accent)" }} />
          Se répète chaque semaine
        </label>
        {recurring ? (
          <select value={day} onChange={(e) => setDay(e.target.value)} style={{ width: "100%", padding: "8px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13, marginBottom: 8 }}>
            {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        ) : (
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "100%", padding: "8px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13, marginBottom: 8 }} />
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ flex: 1, padding: "8px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }} />
          <span style={{ fontSize: 12, color: "#8A8071" }}>à</span>
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={{ flex: 1, padding: "8px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setEditing(false)} style={{ ...ghostBtn, flex: 1 }}>Annuler</button>
          <button onClick={save} style={{ flex: 1, background: "var(--accent)", color: "#FBF8F3", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>Enregistrer</button>
        </div>
      </div>
    );
  }

  return (
    <div className="row-enter" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #EFE9DD" }}>
      <span style={{ fontSize: 18 }}>{a.icon}</span>
      <div style={{ flex: 1, cursor: "pointer" }} onClick={() => setEditing(true)}>
        <div style={{ fontSize: 15 }}>{a.activity} — {a.child}</div>
        <div className="mono" style={{ fontSize: 12, color: "#8A8071" }}>
          {a.recurring ? a.day : new Date(a.date + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} · {a.time}–{a.endTime}
        </div>
      </div>
      <button onClick={() => setEditing(true)} aria-label="Modifier" style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><Pencil size={15} color="#8A8071" /></button>
      <DeleteButton onDelete={() => removeActivity(a.id)} label="cette activité" />
    </div>
  );
}

function Tasks({ tasks, col, notify, friends, friendsCol, activites, activitesCol, initialCategory, requestToken, initialDate, sendPush, kids, workers }) {
  const [category, setCategory] = useState(initialCategory || "travail"); // "travail" | "amis" | "activite" | "tache"

  // -- Autre tâche --
  const [text, setText] = useState("");
  const [assignee, setAssignee] = useState(ASSIGNEES[0]);
  const [date, setDate] = useState("");

  // -- Travail --
  const [workPerson, setWorkPerson] = useState(workers[0]?.name || "");
  const [workStatus, setWorkStatus] = useState("travail"); // "travail" | "repos"
  const [dateMode, setDateMode] = useState("unique"); // "unique" | "plage"
  const [workDate, setWorkDate] = useState("");
  const [workStartDate, setWorkStartDate] = useState("");
  const [workEndDate, setWorkEndDate] = useState("");
  const [workTime, setWorkTime] = useState("08:00");
  const [workEndTime, setWorkEndTime] = useState("17:00");

  // -- Amis --
  const [friendName, setFriendName] = useState("");
  const [friendMoment, setFriendMoment] = useState(FRIEND_MOMENTS[0]);
  const [friendDate, setFriendDate] = useState("");
  const [friendArrival, setFriendArrival] = useState("");

  // -- Activités --
  const [activityName, setActivityName] = useState("");
  const [activityIcon, setActivityIcon] = useState(ACTIVITY_ICONS[0].emoji);
  const [activityChild, setActivityChild] = useState(kids[0]?.name || "");
  const [activityRecurring, setActivityRecurring] = useState(true);
  const [activityDay, setActivityDay] = useState(DAYS[0]);
  const [activityDate, setActivityDate] = useState(todayISO());
  const [activityTime, setActivityTime] = useState("17:00");
  const [activityEndTime, setActivityEndTime] = useState("18:00");

  useEffect(() => {
    if (!workPerson && workers[0]) setWorkPerson(workers[0].name);
  }, [workers]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!activityChild && kids[0]) setActivityChild(kids[0].name);
  }, [kids]); // eslint-disable-line react-hooks/exhaustive-deps

  // Le "+" flottant (barre du bas ou calendrier) peut être cliqué alors qu'on est déjà
  // sur cette page : useState n'écoute pas les changements de prop après le premier
  // rendu, donc on force la synchronisation à chaque nouvelle demande (jeton unique).
  // Si une date précise a été choisie (ex. depuis le calendrier), on la prérenseigne
  // dans le bon champ selon la catégorie demandée.
  useEffect(() => {
    if (!initialCategory) return;
    setCategory(initialCategory);
    if (initialDate) {
      if (initialCategory === "tache") {
        setDate(initialDate);
      } else if (initialCategory === "travail") {
        setDateMode("unique");
        setWorkDate(initialDate);
      } else if (initialCategory === "amis") {
        setFriendDate(initialDate);
      } else if (initialCategory === "activite") {
        setActivityRecurring(false);
        setActivityDate(initialDate);
      }
    }
  }, [requestToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    if (!text.trim()) return;
    try {
      await col.add({ text: text.trim(), done: false, assignee, date: date || null });
      notify(date ? "Ajoutée au calendrier" : "Tâche ajoutée");
      sendPush("Nouvelle tâche", `${text.trim()} (${assignee})`, "taches");
      setText(""); setDate("");
    } catch (e) {
      console.error("Erreur d'ajout de tâche", e);
      notify("Échec de l'enregistrement, réessayez");
    }
  };

  const workDatesValid = !!workPerson && (dateMode === "unique" ? !!workDate : !!workStartDate && !!workEndDate && workEndDate >= workStartDate);

  const addWork = async () => {
    if (!workDatesValid) return;
    const isRest = workStatus === "repos";
    const dates = dateMode === "unique" ? [workDate] : datesBetween(workStartDate, workEndDate);

    try {
      await Promise.all(
        dates.map((d) =>
          col.add({
            text: isRest ? "Repos" : "Travail",
            done: false,
            assignee: workPerson,
            date: d,
            time: isRest ? null : workTime,
            endTime: isRest ? null : workEndTime,
            isWork: true,
            isRest,
            icon: workers.find((w) => w.name === workPerson)?.icon || "💼",
          })
        )
      );
      notify("Ajouté au calendrier");
      sendPush(
        isRest ? "Jour(s) de repos ajouté(s)" : "Nouveau planning de travail",
        dates.length === 1
          ? `${workPerson} ${isRest ? "est en repos" : `travaille de ${workTime} à ${workEndTime}`} le ${new Date(dates[0] + "T00:00:00").toLocaleDateString("fr-FR")}`
          : `${workPerson} : ${dates.length} jours ajoutés (${new Date(dates[0] + "T00:00:00").toLocaleDateString("fr-FR")} → ${new Date(dates[dates.length - 1] + "T00:00:00").toLocaleDateString("fr-FR")})`,
        "taches"
      );
    } catch (e) {
      console.error("Erreur d'ajout de planning", e);
      notify("Échec de l'enregistrement, réessayez");
    }
  };

  const friendValid = !!friendName.trim() && !!friendDate;

  const addFriend = async () => {
    if (!friendValid) return;
    try {
      await col.add({
        text: "Amis",
        done: false,
        isFriend: true,
        friendName: friendName.trim(),
        moment: friendMoment,
        arrivalTime: friendArrival || null,
        date: friendDate,
        icon: "👥",
      });
      const alreadyKnown = friends.some((f) => f.name.toLowerCase() === friendName.trim().toLowerCase());
      if (!alreadyKnown) {
        await friendsCol.add({ name: friendName.trim() });
      }
      notify("Ajouté au calendrier");
      sendPush(
        "Amis à venir",
        `${friendName.trim()} — ${friendMoment}${friendArrival ? ` (arrivée ${friendArrival})` : ""} le ${new Date(friendDate + "T00:00:00").toLocaleDateString("fr-FR")}`,
        "taches"
      );
      setFriendName(""); setFriendArrival("");
    } catch (e) {
      console.error("Erreur d'ajout de visite", e);
      notify("Échec de l'enregistrement, réessayez");
    }
  };

  const addActivity = async () => {
    if (!activityName.trim()) return;
    const base = { activity: activityName.trim(), icon: activityIcon, child: activityChild, time: activityTime, endTime: activityEndTime, recurring: activityRecurring };
    const record = activityRecurring ? { ...base, day: activityDay, date: null } : { ...base, date: activityDate, day: dayNameFromDate(activityDate) };
    try {
      await activitesCol.add(record);
      notify("Ajouté au calendrier");
      const when = activityRecurring ? `${activityDay} ${activityTime}` : `${new Date(activityDate + "T00:00:00").toLocaleDateString("fr-FR")} ${activityTime}`;
      sendPush("Nouvelle activité", `${activityName.trim()} — ${activityChild} (${when})`, "activites");
      setActivityName("");
    } catch (e) {
      console.error("Erreur d'ajout d'activité", e);
      notify("Échec de l'enregistrement, réessayez");
    }
  };
  const removeActivity = async (id) => { await activitesCol.remove(id); notify("Supprimé"); };

  const toggle = async (id, done) => { await col.update(id, { done: !done }); notify(); };
  const remove = async (id) => { await col.remove(id); notify("Supprimé"); };

  const regularTasks = [...tasks.filter((t) => !t.isWork && !t.isFriend)].sort((a, b) => a.done - b.done);
  const workShifts = [...tasks.filter((t) => t.isWork)].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const friendVisits = [...tasks.filter((t) => t.isFriend)].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const sortedActivites = [...activites].sort((a, b) => (a.recurring ? DAYS.indexOf(a.day) : 99) - (b.recurring ? DAYS.indexOf(b.day) : 99));

  const CATEGORY_LABELS = { travail: "Travail", amis: "Amis", activite: "Activités", tache: "Tâche" };
  const [showSwitcher, setShowSwitcher] = useState(false);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span className="display" style={{ fontStyle: "italic", fontSize: 20, color: "#262138" }}>{CATEGORY_LABELS[category]}</span>
        <button onClick={() => setShowSwitcher((s) => !s)} style={{ ...ghostBtn, fontSize: 12 }}>
          {showSwitcher ? "Masquer" : "Autre catégorie"}
        </button>
      </div>

      {showSwitcher && (
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {[
            { id: "travail", label: "Travail" },
            { id: "amis", label: "Amis" },
            { id: "activite", label: "Activités" },
            { id: "tache", label: "+", isIcon: true },
          ].map((c) => (
            <button
              key={c.id}
              onClick={() => { setCategory(c.id); setShowSwitcher(false); }}
              aria-label={c.isIcon ? "Autre tâche" : c.label}
              style={{
                flex: c.isIcon ? "0 0 44px" : 1,
                padding: "10px 2px",
                borderRadius: 10,
                border: "1px solid #E3DBCB",
                fontWeight: 600,
                fontSize: c.isIcon ? 16 : 12,
                cursor: "pointer",
                background: category === c.id ? "var(--accent)" : "#FBF8F3",
                color: category === c.id ? "#FBF8F3" : "var(--accent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {c.isIcon ? <Plus size={18} /> : c.label}
            </button>
          ))}
        </div>
      )}

      {category === "tache" && (
        <Card>
          <SectionLabel>Nouvelle tâche</SectionLabel>
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Ex. Appeler le plombier…" style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 15, marginBottom: 10 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }}>
              {ASSIGNEES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ padding: "10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }} />
            <button onClick={add} aria-label="Ajouter" style={{ background: "var(--accent)", color: "#FBF8F3", border: "none", borderRadius: 10, width: 44, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Plus size={20} /></button>
          </div>
        </Card>
      )}

      {category === "tache" && (
        regularTasks.length === 0 ? <EmptyState text="Aucune tâche pour l'instant." /> : (
          <Card>
            <SectionLabel>Tâches</SectionLabel>
            {regularTasks.map((t) => <TaskRow key={t.id} t={t} col={col} notify={notify} toggle={toggle} remove={remove} />)}
          </Card>
        )
      )}

      {category === "travail" && (
        <Card>
          <SectionLabel>Nouveau planning de travail</SectionLabel>
          {workers.length === 0 ? (
            <div style={{ fontSize: 14, color: "#8A8071" }}>
              Configurez d'abord qui travaille (et son métier) dans <strong>Profil</strong> pour utiliser cette fonctionnalité.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                {workers.map((w) => (
                  <button
                    key={w.name}
                    onClick={() => setWorkPerson(w.name)}
                    style={{ flex: "1 1 auto", minWidth: 110, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 0", borderRadius: 10, border: workPerson === w.name ? "1.5px solid var(--accent)" : "1px solid #E3DBCB", background: workPerson === w.name ? "color-mix(in srgb, var(--accent) 15%, white)" : "#FBF8F3", cursor: "pointer", fontWeight: 600, fontSize: 14 }}
                  >
                    <span style={{ fontSize: 18 }}>{w.icon}</span> {w.name}
                  </button>
                ))}
              </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button
              onClick={() => setDateMode("unique")}
              style={{ flex: 1, padding: "8px 0", borderRadius: 10, border: "1px solid #E3DBCB", fontWeight: 600, fontSize: 12, cursor: "pointer", background: dateMode === "unique" ? "var(--accent)" : "#FBF8F3", color: dateMode === "unique" ? "#FBF8F3" : "var(--accent)" }}
            >
              Jour unique
            </button>
            <button
              onClick={() => setDateMode("plage")}
              style={{ flex: 1, padding: "8px 0", borderRadius: 10, border: "1px solid #E3DBCB", fontWeight: 600, fontSize: 12, cursor: "pointer", background: dateMode === "plage" ? "var(--accent)" : "#FBF8F3", color: dateMode === "plage" ? "#FBF8F3" : "var(--accent)" }}
            >
              Plage de dates
            </button>
          </div>

          {dateMode === "unique" ? (
            <input
              type="date"
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
              style={{ width: "100%", padding: "10px", borderRadius: 10, border: workDate ? "1px solid #E3DBCB" : "1.5px solid #B0455A", fontSize: 13, marginBottom: 4 }}
            />
          ) : (
            <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              <input
                type="date"
                value={workStartDate}
                onChange={(e) => setWorkStartDate(e.target.value)}
                style={{ flex: 1, padding: "10px", borderRadius: 10, border: workStartDate ? "1px solid #E3DBCB" : "1.5px solid #B0455A", fontSize: 13 }}
              />
              <input
                type="date"
                value={workEndDate}
                onChange={(e) => setWorkEndDate(e.target.value)}
                style={{ flex: 1, padding: "10px", borderRadius: 10, border: workEndDate && workEndDate >= workStartDate ? "1px solid #E3DBCB" : "1.5px solid #B0455A", fontSize: 13 }}
              />
            </div>
          )}
          {!workDatesValid && (
            <div style={{ fontSize: 12, color: "#B0455A", marginBottom: 10 }}>
              {dateMode === "unique" ? "Choisissez une date." : "Choisissez une date de début et de fin (fin après début)."}
            </div>
          )}
          <div style={{ marginTop: 8 }} />

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button
              onClick={() => setWorkStatus("travail")}
              style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: "1px solid #E3DBCB", fontWeight: 600, fontSize: 13, cursor: "pointer", background: workStatus === "travail" ? "#3E6E63" : "#FBF8F3", color: workStatus === "travail" ? "#FBF8F3" : "#3E6E63" }}
            >
              Travail
            </button>
            <button
              onClick={() => setWorkStatus("repos")}
              style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: "1px solid #E3DBCB", fontWeight: 600, fontSize: 13, cursor: "pointer", background: workStatus === "repos" ? "#B0455A" : "#FBF8F3", color: workStatus === "repos" ? "#FBF8F3" : "#B0455A" }}
            >
              Repos
            </button>
          </div>

          {workStatus === "travail" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: "#8A8071" }}>De</span>
              <input type="time" value={workTime} onChange={(e) => setWorkTime(e.target.value)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }} />
              <span style={{ fontSize: 12, color: "#8A8071" }}>à</span>
              <input type="time" value={workEndTime} onChange={(e) => setWorkEndTime(e.target.value)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }} />
            </div>
          )}
          <button
            onClick={addWork}
            disabled={!workDatesValid}
            style={{ width: "100%", background: workDatesValid ? "var(--accent)" : "#C9BFA9", color: "#FBF8F3", border: "none", borderRadius: 10, padding: "10px 0", fontWeight: 600, cursor: workDatesValid ? "pointer" : "not-allowed" }}
          >
            Ajouter au planning
          </button>
            </>
          )}
        </Card>
      )}

      {category === "travail" && workShifts.length > 0 && (
        <Card>
          <SectionLabel>Plannings de travail</SectionLabel>
          {workShifts.map((w) => <WorkShiftRow key={w.id} w={w} col={col} notify={notify} remove={remove} workers={workers} />)}
        </Card>
      )}

      {category === "amis" && (
        <Card>
          <SectionLabel>Nouvelle visite entre amis</SectionLabel>
          {friends.length > 0 && (
            <select
              value=""
              onChange={(e) => e.target.value && setFriendName(e.target.value)}
              style={{ width: "100%", padding: "10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13, marginBottom: 10, color: "#5C5346" }}
            >
              <option value="">Choisir un ami déjà enregistré…</option>
              {friends.map((f) => (
                <option key={f.id} value={f.name}>{f.name}</option>
              ))}
            </select>
          )}
          <input
            value={friendName}
            onChange={(e) => setFriendName(e.target.value)}
            placeholder="Nom de l'ami(e)…"
            style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: friendName.trim() ? "1px solid #E3DBCB" : "1.5px solid #B0455A", fontSize: 15, marginBottom: 10 }}
          />
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <select value={friendMoment} onChange={(e) => setFriendMoment(e.target.value)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }}>
              {FRIEND_MOMENTS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <input
              type="date"
              value={friendDate}
              onChange={(e) => setFriendDate(e.target.value)}
              style={{ flex: 1, padding: "10px", borderRadius: 10, border: friendDate ? "1px solid #E3DBCB" : "1.5px solid #B0455A", fontSize: 13 }}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: "#8A8071", marginBottom: 6 }}>Heure d'arrivée (non obligatoire)</div>
            <input type="time" value={friendArrival} onChange={(e) => setFriendArrival(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }} />
          </div>
          {!friendValid && (
            <div style={{ fontSize: 12, color: "#B0455A", marginBottom: 10 }}>Indiquez au moins un nom et une date.</div>
          )}
          <button
            onClick={addFriend}
            disabled={!friendValid}
            style={{ width: "100%", background: friendValid ? "var(--accent)" : "#C9BFA9", color: "#FBF8F3", border: "none", borderRadius: 10, padding: "10px 0", fontWeight: 600, cursor: friendValid ? "pointer" : "not-allowed" }}
          >
            Ajouter
          </button>
        </Card>
      )}

      {category === "amis" && friendVisits.length > 0 && (
        <Card>
          <SectionLabel>Sorties entre amis</SectionLabel>
          {friendVisits.map((f) => <FriendVisitRow key={f.id} f={f} col={col} notify={notify} remove={remove} friends={friends} />)}
        </Card>
      )}

      {category === "activite" && (
        <Card>
          <SectionLabel>Nouvelle activité</SectionLabel>
          {kids.length === 0 ? (
            <div style={{ fontSize: 14, color: "#8A8071" }}>
              Configurez d'abord les prénoms de vos enfants dans <strong>Profil</strong> pour utiliser cette fonctionnalité.
            </div>
          ) : (
            <>
              <input
                value={activityName}
                onChange={(e) => setActivityName(e.target.value)}
                placeholder="Ex. Danse, Foot…"
                style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 15, marginBottom: 10 }}
              />
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <select value={activityIcon} onChange={(e) => setActivityIcon(e.target.value)} style={{ width: 74, padding: "10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 15 }}>
                  {ACTIVITY_ICONS.map((i) => <option key={i.emoji} value={i.emoji}>{i.emoji} {i.label}</option>)}
                </select>
                <select value={activityChild} onChange={(e) => setActivityChild(e.target.value)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }}>
                  {kids.map((k) => <option key={k.name} value={k.name}>{k.name}</option>)}
                </select>
              </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13, color: "#5C5346", cursor: "pointer" }}>
            <input type="checkbox" checked={activityRecurring} onChange={(e) => setActivityRecurring(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--accent)" }} />
            Se répète chaque semaine
          </label>

          {activityRecurring ? (
            <select value={activityDay} onChange={(e) => setActivityDay(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13, marginBottom: 12 }}>
              {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          ) : (
            <input
              type="date"
              value={activityDate}
              onChange={(e) => setActivityDate(e.target.value)}
              style={{ width: "100%", padding: "10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13, marginBottom: 12 }}
            />
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: "#8A8071" }}>De</span>
            <input type="time" value={activityTime} onChange={(e) => setActivityTime(e.target.value)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }} />
            <span style={{ fontSize: 12, color: "#8A8071" }}>à</span>
            <input type="time" value={activityEndTime} onChange={(e) => setActivityEndTime(e.target.value)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }} />
          </div>
          <button onClick={addActivity} style={{ width: "100%", background: "var(--accent)", color: "#FBF8F3", border: "none", borderRadius: 10, padding: "10px 0", fontWeight: 600, cursor: "pointer" }}>
            Ajouter au planning
          </button>
            </>
          )}
        </Card>
      )}

      {category === "activite" && sortedActivites.length > 0 && (
        <Card>
          <SectionLabel>Activités planifiées</SectionLabel>
          {sortedActivites.map((a) => <ActivityRow key={a.id} a={a} activitesCol={activitesCol} notify={notify} removeActivity={removeActivity} kids={kids} />)}
        </Card>
      )}
    </div>
  );
}

function Shopping({ shopping, col, notify, sendPush }) {
  const [text, setText] = useState("");
  const add = async () => { if (!text.trim()) return; await col.add({ text: text.trim(), done: false }); notify(); sendPush("Ajouté aux courses", text.trim(), "courses"); setText(""); };
  const toggle = async (id, done) => { await col.update(id, { done: !done }); notify(); };
  const remove = async (id) => { await col.remove(id); notify("Supprimé"); };
  const clearDone = async () => { await Promise.all(shopping.filter((s) => s.done).map((s) => col.remove(s.id))); notify("Liste nettoyée"); };
  const sorted = [...shopping].sort((a, b) => a.done - b.done);
  const doneCount = shopping.filter((s) => s.done).length;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Ajouter un article…" style={{ flex: 1, padding: "12px 14px", borderRadius: 10, border: "1px solid #E3DBCB", background: "#FBF8F3", fontSize: 15 }} />
        <button onClick={add} aria-label="Ajouter" style={{ background: "var(--accent)", color: "#FBF8F3", border: "none", borderRadius: 10, width: 44, cursor: "pointer" }}><Plus size={20} style={{ margin: "auto" }} /></button>
      </div>
      {doneCount > 0 && <button onClick={clearDone} style={{ ...ghostBtn, marginBottom: 12 }}>Vider les articles cochés ({doneCount})</button>}
      {sorted.length === 0 ? <EmptyState text="La liste est vide." /> : sorted.map((s) => (
        <div key={s.id} className="row-enter" style={rowStyle}>
          <button onClick={() => toggle(s.id, s.done)} style={checkStyle(s.done)}>{s.done && <Check size={14} color="#FBF8F3" />}</button>
          <div style={{ flex: 1, fontSize: 15, textDecoration: s.done ? "line-through" : "none", color: s.done ? "#9C9384" : "#262138" }}>{s.text}</div>
          <DeleteButton onDelete={() => remove(s.id)} label="cet article" />
        </div>
      ))}
    </div>
  );
}

function Valise({ valise, col, notify, sendPush }) {
  const [text, setText] = useState("");
  const [owner, setOwner] = useState(VALISE_OWNERS[0]);
  const add = async () => { if (!text.trim()) return; await col.add({ text: text.trim(), owner, done: false }); notify(); sendPush("Ajouté à la valise", `${text.trim()} (${owner})`, "valise"); setText(""); };
  const toggle = async (id, done) => { await col.update(id, { done: !done }); notify(); };
  const remove = async (id) => { await col.remove(id); notify("Supprimé"); };
  const clearDone = async () => { await Promise.all(valise.filter((v) => v.done).map((v) => col.remove(v.id))); notify("Valise nettoyée"); };
  const doneCount = valise.filter((v) => v.done).length;

  const groups = VALISE_OWNERS.map((o) => {
    const items = [...valise.filter((v) => v.owner === o)].sort((a, b) => a.done - b.done);
    const done = items.filter((v) => v.done).length;
    return { owner: o, items, done, total: items.length };
  }).filter((g) => g.items.length > 0);

  return (
    <div>
      <Card>
        <SectionLabel>Ajouter à la valise</SectionLabel>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Ex. Maillots de bain, chargeur…" style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 15, marginBottom: 10 }} />
        <div style={{ display: "flex", gap: 8 }}>
          <select value={owner} onChange={(e) => setOwner(e.target.value)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }}>
            {VALISE_OWNERS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <button onClick={add} aria-label="Ajouter" style={{ background: "var(--accent)", color: "#FBF8F3", border: "none", borderRadius: 10, width: 44, cursor: "pointer" }}><Plus size={20} style={{ margin: "auto" }} /></button>
        </div>
      </Card>
      {doneCount > 0 && <button onClick={clearDone} style={{ ...ghostBtn, marginBottom: 12 }}>Vider les éléments cochés ({doneCount})</button>}
      {groups.length === 0 ? <EmptyState text="Aucun élément dans la valise." /> : groups.map((g) => {
        const pct = g.total ? Math.round((g.done / g.total) * 100) : 0;
        return (
          <Card key={g.owner}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span className="display" style={{ fontStyle: "italic", fontSize: 15, color: colorFor(g.owner), fontWeight: 600, flexShrink: 0 }}>{g.owner}</span>
              <div style={{ flex: 1, height: 6, background: "#EFE9DD", borderRadius: 3 }}><div style={{ height: 6, width: `${pct}%`, background: colorFor(g.owner), borderRadius: 3, transition: "width 0.25s ease" }} /></div>
              <span className="mono" style={{ fontSize: 12, color: "#8A8071", flexShrink: 0 }}>{g.done}/{g.total}</span>
            </div>
            {g.items.map((v) => (
              <div key={v.id} className="row-enter" style={{ ...rowStyle, marginBottom: 8 }}>
                <button onClick={() => toggle(v.id, v.done)} style={checkStyle(v.done)}>{v.done && <Check size={14} color="#FBF8F3" />}</button>
                <div style={{ flex: 1, fontSize: 15, textDecoration: v.done ? "line-through" : "none", color: v.done ? "#9C9384" : "#262138" }}>{v.text}</div>
                <DeleteButton onDelete={() => remove(v.id)} label="cet élément" />
              </div>
            ))}
          </Card>
        );
      })}
    </div>
  );
}

// Sélection multiple par puces cliquables (une ou plusieurs personnes par champ).
function KidMultiPicker({ kids, selected, onChange }) {
  const options = [...kids.map((k) => k.name), "Parents"];
  const toggle = (name) => {
    if (selected.includes(name)) onChange(selected.filter((n) => n !== name));
    else onChange([...selected, name]);
  };
  return (
    <div style={{ border: "1px solid #E3DBCB", borderRadius: 10, overflow: "hidden" }}>
      {options.map((name, i) => {
        const active = selected.includes(name);
        return (
          <label
            key={name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 12px",
              borderTop: i === 0 ? "none" : "1px solid #EFE9DD",
              background: active ? "color-mix(in srgb, var(--accent) 10%, white)" : "#FBF8F3",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={active}
              onChange={() => toggle(name)}
              style={{ width: 17, height: 17, accentColor: "var(--accent)", flexShrink: 0 }}
            />
            <span style={{ fontSize: 14, color: active ? "var(--accent)" : "#5C5346", fontWeight: active ? 600 : 400 }}>{name}</span>
          </label>
        );
      })}
    </div>
  );
}

function Repas({ repas, col, notify, sendPush, kids, mealFields, saveHouseholdConfig, presetDate, presetToken }) {
  const [view, setView] = useState("repas"); // "repas" | "parametrage"
  const [date, setDate] = useState(presetDate || todayISO());
  const [meal, setMeal] = useState(MEALS[0]);
  const [assignments, setAssignments] = useState(() => {
    const suggestion = suggestAssignment(repas, kids, mealFields);
    const init = {};
    mealFields.forEach((f) => { init[f.id] = suggestion[f.id] ? [suggestion[f.id]] : []; });
    return init;
  });

  // Arrivée depuis le calendrier avec une date précise (jeton unique à chaque clic,
  // pour forcer la mise à jour même si la page Repas est déjà ouverte).
  useEffect(() => {
    if (presetDate) {
      setDate(presetDate);
      setView("repas");
    }
  }, [presetToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const resuggest = () => {
    const suggestion = suggestAssignment(repas, kids, mealFields);
    const next = { ...assignments };
    mealFields.forEach((f) => { next[f.id] = suggestion[f.id] ? [suggestion[f.id]] : []; });
    setAssignments(next);
  };

  const add = async () => {
    const tasks = mealFields.map((f) => ({ id: f.id, label: f.label, assignees: assignments[f.id] || [] }));
    await col.add({ date, meal, tasks });
    notify();
    sendPush("Nouveau repas planifié", `${meal} du ${new Date(date).toLocaleDateString("fr-FR")}`, "repas");
    const suggestion = suggestAssignment(repas, kids, mealFields);
    const reset = {};
    mealFields.forEach((f) => { reset[f.id] = suggestion[f.id] ? [suggestion[f.id]] : []; });
    setAssignments(reset);
  };
  const remove = async (id) => { await col.remove(id); notify("Supprimé"); };

  if (kids.length === 0) {
    return (
      <Card>
        <SectionLabel>Repas</SectionLabel>
        <div style={{ fontSize: 14, color: "#8A8071" }}>
          Configurez d'abord les prénoms de vos enfants dans <strong>Profil</strong> pour utiliser la répartition des tâches de repas.
        </div>
      </Card>
    );
  }

  // Équité : calculée sur tous les repas déjà enregistrés (ancien + nouveau format),
  // uniquement sur les champs actuellement marqués "à comptabiliser" dans Paramétrage,
  // et seulement pour les enfants (un repas assigné à "Parents" ne compte pas).
  const kidNames = kids.map((k) => k.name);
  const totals = {}; kidNames.forEach((n) => (totals[n] = 0));
  const perLabel = {};
  const fieldById = {}; mealFields.forEach((f) => (fieldById[f.id] = f));
  repas.forEach((r) => {
    getRepasTasks(r).forEach((t) => {
      const field = fieldById[t.id];
      const counted = field ? field.counted !== false : true; // champ supprimé depuis : on compte quand même par défaut
      if (!counted) return;
      const label = field ? field.label : t.label;
      (t.assignees || []).forEach((name) => {
        if (!kidNames.includes(name)) return;
        totals[name] = (totals[name] || 0) + 1;
        if (!perLabel[label]) perLabel[label] = {};
        perLabel[label][name] = (perLabel[label][name] || 0) + 1;
      });
    });
  });
  const counts = kids.map((k) => ({ name: k.name, color: k.color, total: totals[k.name] || 0 }));
  const maxTotal = Math.max(1, ...counts.map((c) => c.total));
  const spread = Math.max(...counts.map((c) => c.total)) - Math.min(...counts.map((c) => c.total));
  const labelList = Object.keys(perLabel);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button
          onClick={() => setView("repas")}
          style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: "1px solid #E3DBCB", fontWeight: 600, fontSize: 13, cursor: "pointer", background: view === "repas" ? "var(--accent)" : "#FBF8F3", color: view === "repas" ? "#FBF8F3" : "var(--accent)" }}
        >
          Repas
        </button>
        <button
          onClick={() => setView("parametrage")}
          style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: "1px solid #E3DBCB", fontWeight: 600, fontSize: 13, cursor: "pointer", background: view === "parametrage" ? "var(--accent)" : "#FBF8F3", color: view === "parametrage" ? "#FBF8F3" : "var(--accent)" }}
        >
          Paramétrage
        </button>
      </div>

      {view === "parametrage" ? (
        <RepasParametrage mealFields={mealFields} saveHouseholdConfig={saveHouseholdConfig} notify={notify} />
      ) : (
        <>
          <Card>
            <SectionLabel>Nouveau repas</SectionLabel>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 14 }} />
              <select value={meal} onChange={(e) => setMeal(e.target.value)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 14 }}>
                {MEALS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            {mealFields.length === 0 ? (
              <div style={{ fontSize: 13, color: "#8A8071", marginBottom: 12 }}>
                Aucun champ configuré. Allez dans l'onglet <strong>Paramétrage</strong> ci-dessus pour en ajouter (ex. "Mettre la table").
              </div>
            ) : (
              mealFields.map((field) => (
                <div key={field.id} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#262138", marginBottom: 8 }}>{field.label}</div>
                  <KidMultiPicker kids={kids} selected={assignments[field.id] || []} onChange={(next) => setAssignments({ ...assignments, [field.id]: next })} />
                </div>
              ))
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button onClick={resuggest} disabled={mealFields.length === 0} style={{ ...ghostBtn, display: "flex", alignItems: "center", gap: 6 }}><Shuffle size={14} /> Suggestion équitable</button>
              <button onClick={add} disabled={mealFields.length === 0} style={{ flex: 1, background: mealFields.length ? "var(--accent)" : "#C9BFA9", color: "#FBF8F3", border: "none", borderRadius: 10, fontWeight: 600, cursor: mealFields.length ? "pointer" : "not-allowed" }}>Enregistrer</button>
            </div>
          </Card>

          {labelList.length > 0 && (
            <Card>
              <SectionLabel>Équité des tâches {spread > 1 && <span style={{ color: "#B0455A" }}>· déséquilibre</span>}</SectionLabel>
              {labelList.map((label) => {
                const taskMax = Math.max(1, ...kids.map((k) => perLabel[label][k.name] || 0));
                return (
                  <div key={label} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 13, color: "#8A8071", marginBottom: 6 }}>{label}</div>
                    {kids.map((k) => (
                      <div key={k.name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 12, width: 44 }}>{k.name}</span>
                        <div style={{ flex: 1, height: 6, background: "#EFE9DD", borderRadius: 3 }}><div style={{ height: 6, width: `${((perLabel[label][k.name] || 0) / taskMax) * 100}%`, background: k.color, borderRadius: 3 }} /></div>
                        <span className="mono" style={{ fontSize: 12, width: 16, textAlign: "right" }}>{perLabel[label][k.name] || 0}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
              <div style={{ borderTop: "1px solid #EFE9DD", paddingTop: 10, marginTop: 4 }}>
                <div style={{ fontSize: 13, color: "#8A8071", marginBottom: 6 }}>Total toutes tâches</div>
                {counts.map((c) => (
                  <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 12, width: 44 }}>{c.name}</span>
                    <div style={{ flex: 1, height: 8, background: "#EFE9DD", borderRadius: 4 }}><div style={{ height: 8, width: `${(c.total / maxTotal) * 100}%`, background: c.color, borderRadius: 4 }} /></div>
                    <span className="mono" style={{ fontSize: 13, width: 16, textAlign: "right", fontWeight: 600 }}>{c.total}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {repas.length === 0 ? <EmptyState text="Aucun repas planifié encore." /> : [...repas].sort((a, b) => new Date(b.date) - new Date(a.date)).map((r) => (
            <RepasHistoryItem key={r.id} r={r} kids={kids} col={col} remove={remove} notify={notify} />
          ))}
        </>
      )}
    </div>
  );
}

// Onglet Paramétrage : gère la liste persistante des champs de repas (label,
// comptabilisation dans l'équité), partagée par tous les nouveaux repas.
function RepasParametrage({ mealFields, saveHouseholdConfig, notify }) {
  const [newLabel, setNewLabel] = useState("");

  const persist = async (next) => {
    await saveHouseholdConfig({ mealFields: next });
    notify("Enregistré");
  };

  const updateField = (id, patch) => persist(mealFields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const removeField = (id) => persist(mealFields.filter((f) => f.id !== id));
  const addField = () => {
    if (!newLabel.trim()) return;
    persist([...mealFields, { id: crypto.randomUUID(), label: newLabel.trim(), counted: true }]);
    setNewLabel("");
  };

  return (
    <Card>
      <SectionLabel>Champs de repas</SectionLabel>
      <div style={{ fontSize: 13, color: "#8A8071", marginBottom: 14 }}>
        Ces champs seront proposés à chaque nouveau repas. Décochez "Comptabiliser" pour qu'un champ n'entre pas dans les statistiques d'équité.
      </div>
      {mealFields.length === 0 ? (
        <div style={{ fontSize: 13, color: "#9C9384", marginBottom: 14 }}>Aucun champ pour l'instant.</div>
      ) : (
        mealFields.map((field) => (
          <div key={field.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #EFE9DD" }}>
            <input
              value={field.label}
              onChange={(e) => updateField(field.id, { label: e.target.value })}
              style={{ flex: 1, padding: "8px 10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#8A8071", cursor: "pointer", whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={field.counted !== false} onChange={(e) => updateField(field.id, { counted: e.target.checked })} style={{ width: 15, height: 15, accentColor: "var(--accent)" }} />
              Comptabiliser
            </label>
            <DeleteButton onDelete={() => removeField(field.id)} label="ce champ" />
          </div>
        ))
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addField()}
          placeholder="Ex. Sortir la poubelle…"
          style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }}
        />
        <button onClick={addField} style={{ background: "var(--accent)", color: "#FBF8F3", border: "none", borderRadius: 10, padding: "0 16px", fontWeight: 600, cursor: "pointer" }}>+ Ajouter</button>
      </div>
    </Card>
  );
}

// Un repas déjà enregistré : chaque champ existant reste modifiable (multi-sélection
// incluse). Pour ajouter/retirer des champs eux-mêmes, ça se passe désormais dans
// Repas → Paramétrage, plus dans chaque repas individuellement.
function RepasHistoryItem({ r, kids, col, remove, notify }) {
  const [tasks, setTasks] = useState(() => getRepasTasks(r));

  const persist = async (nextTasks) => {
    setTasks(nextTasks);
    await col.update(r.id, { tasks: nextTasks });
    notify("Enregistré");
  };

  const updateRow = (rowId, patch) => persist(tasks.map((t) => (t.id === rowId ? { ...t, ...patch } : t)));

  return (
    <div className="row-enter" style={{ ...rowStyle, flexDirection: "column", alignItems: "stretch" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <strong style={{ fontSize: 14 }}>{r.meal} · {new Date(r.date).toLocaleDateString("fr-FR")}</strong>
        <DeleteButton onDelete={() => remove(r.id)} label="ce repas" />
      </div>
      {tasks.map((t) => (
        <div key={t.id} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid #EFE9DD" }}>
          <div style={{ fontSize: 13, color: "#5C5346", marginBottom: 6 }}>{t.label}</div>
          <KidMultiPicker kids={kids} selected={t.assignees || []} onChange={(next) => updateRow(t.id, { assignees: next })} />
        </div>
      ))}
    </div>
  );
}

function Activites({ activites, col, notify, sendPush, kids }) {
  const [activity, setActivity] = useState("");
  const [icon, setIcon] = useState(ACTIVITY_ICONS[0].emoji);
  const [child, setChild] = useState(kids[0]?.name || "");
  const [recurring, setRecurring] = useState(true);
  const [day, setDay] = useState(DAYS[0]);
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState("17:00");
  const [endTime, setEndTime] = useState("18:00");

  const add = async () => {
    if (!activity.trim() || !child) return;
    const base = { activity: activity.trim(), icon, child, time, endTime, recurring };
    const record = recurring ? { ...base, day, date: null } : { ...base, date, day: dayNameFromDate(date) };
    await col.add(record);
    notify();
    const when = recurring ? `${day} ${time}` : `${new Date(date + "T00:00:00").toLocaleDateString("fr-FR")} ${time}`;
    sendPush("Nouvelle activité", `${activity.trim()} — ${child} (${when})`, "activites");
    setActivity("");
  };
  const remove = async (id) => { await col.remove(id); notify("Supprimé"); };

  if (kids.length === 0) {
    return (
      <Card>
        <SectionLabel>Activités</SectionLabel>
        <div style={{ fontSize: 14, color: "#8A8071" }}>
          Configurez d'abord les prénoms de vos enfants dans <strong>Profil</strong> pour utiliser les activités.
        </div>
      </Card>
    );
  }

  const recurrentItems = activites.filter((a) => a.recurring);
  const onceItems = [...activites.filter((a) => !a.recurring)].sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  return (
    <div>
      <Card>
        <SectionLabel>Nouvelle activité</SectionLabel>
        <input value={activity} onChange={(e) => setActivity(e.target.value)} placeholder="Ex. Danse, Foot…" style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 15, marginBottom: 10 }} />
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <select value={icon} onChange={(e) => setIcon(e.target.value)} style={{ width: 74, padding: "10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 15 }}>
            {ACTIVITY_ICONS.map((i) => <option key={i.emoji} value={i.emoji}>{i.emoji} {i.label}</option>)}
          </select>
          <select value={child} onChange={(e) => setChild(e.target.value)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }}>
            {kids.map((k) => <option key={k.name} value={k.name}>{k.name}</option>)}
          </select>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13, color: "#5C5346", cursor: "pointer" }}>
          <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--accent)" }} />
          Se répète chaque semaine
        </label>
        {recurring ? (
          <select value={day} onChange={(e) => setDay(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13, marginBottom: 12 }}>
            {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        ) : (
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13, marginBottom: 12 }} />
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: "#8A8071" }}>De</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }} />
          <span style={{ fontSize: 12, color: "#8A8071" }}>à</span>
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }} />
        </div>
        <button onClick={add} style={{ width: "100%", background: "var(--accent)", color: "#FBF8F3", border: "none", borderRadius: 10, padding: "10px 0", fontWeight: 600, cursor: "pointer" }}>Ajouter au planning</button>
      </Card>

      {onceItems.length > 0 && (
        <Card>
          <SectionLabel>Activités ponctuelles</SectionLabel>
          {onceItems.map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #EFE9DD" }}>
              <span style={{ fontSize: 16 }}>{a.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15 }}>{a.activity} <span style={{ color: "#8A8071" }}>— {a.child}</span></div>
                <div className="mono" style={{ fontSize: 12, color: "#8A8071" }}>{a.date ? new Date(a.date + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) : ""} · {a.time}–{a.endTime || "?"}</div>
              </div>
              <DeleteButton onDelete={() => remove(a.id)} label="cette activité" />
            </div>
          ))}
        </Card>
      )}

      {recurrentItems.length === 0 && onceItems.length === 0 ? <EmptyState text="Aucune activité planifiée." /> : recurrentItems.length > 0 && (
        <>
          <SectionLabel>Activités récurrentes</SectionLabel>
          {DAYS.map((d) => {
            const items = recurrentItems.filter((a) => a.day === d).sort((a, b) => a.time.localeCompare(b.time));
            if (items.length === 0) return null;
            return (
              <Card key={d}>
                <SectionLabel>{d}</SectionLabel>
                {items.map((a) => (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #EFE9DD" }}>
                    <span style={{ fontSize: 16 }}>{a.icon}</span>
                    <span className="mono" style={{ fontSize: 12, color: "#8A8071", width: 76 }}>{a.time}–{a.endTime || "?"}</span>
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: colorFor(a.child) }} />
                    <span style={{ flex: 1, fontSize: 15 }}>{a.activity} <span style={{ color: "#8A8071" }}>— {a.child}</span></span>
                    <DeleteButton onDelete={() => remove(a.id)} label="cette activité" />
                  </div>
                ))}
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}

function RepasDayRow({ r, kids, repasCol, notify, onRemove }) {
  const [tasks, setTasks] = useState(() => getRepasTasks(r));
  const persist = async (nextTasks) => {
    setTasks(nextTasks);
    await repasCol.update(r.id, { tasks: nextTasks });
    notify?.("Modifié");
  };
  return (
    <div style={{ padding: "8px 0", borderBottom: "1px solid #EFE9DD" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 14 }}>🍽️ <strong>{r.meal}</strong></span>
        <DeleteButton onDelete={onRemove} label="ce repas" />
      </div>
      {tasks.map((t) => (
        <div key={t.id} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: "#8A8071", marginBottom: 4 }}>{t.label}</div>
          <KidMultiPicker kids={kids} selected={t.assignees || []} onChange={(next) => persist(tasks.map((x) => (x.id === t.id ? { ...x, assignees: next } : x)))} />
        </div>
      ))}
    </div>
  );
}

function DayDetailModal({ day, tasks, repas, activites, onClose, tasksCol, repasCol, activitesCol, notify, workers, friends, kids, onQuickAdd }) {
  const { iso, dayName, date } = day;
  const dayTasks = tasks.filter((t) => t.date === iso);
  const dayRepas = repas.filter((r) => r.date === iso);
  const dayActs = activites.filter((a) => (a.recurring && a.day === dayName) || (!a.recurring && a.date === iso)).sort((a, b) => a.time.localeCompare(b.time));
  const isEmpty = dayTasks.length + dayRepas.length + dayActs.length === 0;
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const toggleTask = async (id, done) => { await tasksCol.update(id, { done: !done }); notify?.(); };
  const removeTaskItem = async (id) => { await tasksCol.remove(id); notify?.("Supprimé"); };
  const removeActivityItem = async (id) => { await activitesCol.remove(id); notify?.("Supprimé"); };
  const removeRepasItem = async (id) => { await repasCol.remove(id); notify?.("Supprimé"); };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(38,33,56,0.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#FBF8F3", borderRadius: "18px 18px 0 0", padding: "20px 20px 28px", width: "100%", maxWidth: 560, maxHeight: "75vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
          <div>
            <span className="display" style={{ fontStyle: "italic", fontSize: 20, color: "#262138" }}>{dayName}</span>{" "}
            <span style={{ fontSize: 13, color: "#8A8071" }}>{date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={() => setAddMenuOpen((o) => !o)}
              aria-label="Ajouter ce jour-là"
              style={{ background: "var(--accent)", border: "none", borderRadius: "50%", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            >
              <Plus size={17} color="#FBF8F3" />
            </button>
            <button onClick={onClose} aria-label="Fermer" style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
              <X size={22} color="#8A8071" />
            </button>
          </div>
        </div>

        {addMenuOpen && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16, padding: 12, background: "#F1ECE2", borderRadius: 12 }}>
            {QUICK_ADD_CHOICES.map((c) => {
              const Icon = c.icon;
              return (
                <button
                  key={c.id}
                  onClick={() => { onQuickAdd(c.id, iso); onClose(); }}
                  style={{ display: "flex", alignItems: "center", gap: 6, background: "#FBF8F3", border: "1px solid #E3DBCB", borderRadius: 20, padding: "7px 12px", fontSize: 12, fontWeight: 600, color: "var(--accent)", cursor: "pointer" }}
                >
                  <Icon size={14} /> {c.label}
                </button>
              );
            })}
          </div>
        )}

        <div style={{ fontSize: 12, color: "#8A8071", marginBottom: 14 }}>Touchez un élément pour le modifier.</div>

        {isEmpty ? (
          <div style={{ fontSize: 14, color: "#9C9384" }}>Rien de prévu ce jour-là.</div>
        ) : (
          <>
            {dayActs.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <SectionLabel>Activités</SectionLabel>
                {dayActs.map((a) => <ActivityRow key={a.id} a={a} activitesCol={activitesCol} notify={notify} removeActivity={removeActivityItem} kids={kids} />)}
              </div>
            )}
            {dayRepas.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <SectionLabel>Repas</SectionLabel>
                {dayRepas.map((r) => <RepasDayRow key={r.id} r={r} kids={kids} repasCol={repasCol} notify={notify} onRemove={() => removeRepasItem(r.id)} />)}
              </div>
            )}
            {dayTasks.length > 0 && (
              <div>
                <SectionLabel>Tâches, travail & amis</SectionLabel>
                {dayTasks.map((t) => (
                  t.isWork ? (
                    <WorkShiftRow key={t.id} w={t} col={tasksCol} notify={notify} remove={removeTaskItem} workers={workers} />
                  ) : t.isFriend ? (
                    <FriendVisitRow key={t.id} f={t} col={tasksCol} notify={notify} remove={removeTaskItem} friends={friends} />
                  ) : (
                    <TaskRow key={t.id} t={t} col={tasksCol} notify={notify} toggle={toggleTask} remove={removeTaskItem} />
                  )
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Calendrier({ tasks, repas, activites, tasksCol, repasCol, activitesCol, notify, workers, friends, kids, onQuickAdd }) {
  const [viewMode, setViewMode] = useState("mois"); // "mois" | "semaine"
  const [offset, setOffset] = useState(0); // décalage semaines (vue semaine)
  const [monthOffset, setMonthOffset] = useState(0); // décalage mois (vue mois)
  const [selectedDay, setSelectedDay] = useState(null); // jour cliqué en vue mois
  const isoToday = todayISO();
  const undated = tasks.filter((t) => !t.date && !t.done);

  const refMonth = new Date();
  refMonth.setDate(1);
  refMonth.setMonth(refMonth.getMonth() + monthOffset);
  const monthDays = monthGridDates(refMonth);
  const monthLabel = refMonth.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  const dates = weekDates(offset);

  const LEGEND = [
    { id: "tache", label: "Tâche" },
    { id: "travail", label: "Travail" },
    { id: "repos", label: "Repos" },
    { id: "amis", label: "Amis" },
    { id: "activite", label: "Activité" },
    { id: "repas", label: "Repas" },
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button
          onClick={() => setViewMode("mois")}
          style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: "1px solid #E3DBCB", fontWeight: 600, fontSize: 13, cursor: "pointer", background: viewMode === "mois" ? "var(--accent)" : "#FBF8F3", color: viewMode === "mois" ? "#FBF8F3" : "var(--accent)" }}
        >
          Mois
        </button>
        <button
          onClick={() => setViewMode("semaine")}
          style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: "1px solid #E3DBCB", fontWeight: 600, fontSize: 13, cursor: "pointer", background: viewMode === "semaine" ? "var(--accent)" : "#FBF8F3", color: viewMode === "semaine" ? "#FBF8F3" : "var(--accent)" }}
        >
          Semaine
        </button>
      </div>

      {undated.length > 0 && (
        <Card>
          <SectionLabel>Tâches sans date</SectionLabel>
          {undated.map((t) => (
            <TaskRow key={t.id} t={t} col={tasksCol} notify={notify} toggle={async (id, done) => { await tasksCol.update(id, { done: !done }); notify?.(); }} remove={async (id) => { await tasksCol.remove(id); notify?.("Tâche supprimée"); }} />
          ))}
        </Card>
      )}

      {viewMode === "mois" ? (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <button onClick={() => setMonthOffset(monthOffset - 1)} style={navBtn} aria-label="Mois précédent"><ChevronLeft size={18} /></button>
            <button onClick={() => setMonthOffset(0)} style={{ ...ghostBtn, fontSize: 13, textTransform: "capitalize" }}>{monthLabel}</button>
            <button onClick={() => setMonthOffset(monthOffset + 1)} style={navBtn} aria-label="Mois suivant"><ChevronRight size={18} /></button>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {LEGEND.map((l) => (
              <span key={l.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#5C5346" }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: CAT_COLORS[l.id], flexShrink: 0 }} />
                {l.label}
              </span>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 3, marginBottom: 4 }}>
            {DAYS.map((d) => (
              <div key={d} style={{ fontSize: 10, color: "#8A8071", textAlign: "center", fontWeight: 600 }}>{d.slice(0, 2)}</div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 3 }}>
            {monthDays.map((d) => {
              const iso = toISO(d);
              const dayName = DAYS[(d.getDay() + 6) % 7];
              const inMonth = d.getMonth() === refMonth.getMonth();
              const items = buildDayItems(iso, dayName, tasks, repas, activites);
              const isToday = iso === isoToday;
              return (
                <div
                  key={iso}
                  onClick={() => setSelectedDay({ iso, dayName, date: d })}
                  style={{
                    minHeight: 66,
                    minWidth: 0,
                    overflow: "hidden",
                    border: isToday ? "1.5px solid var(--accent)" : "1px solid #E3DBCB",
                    borderRadius: 6,
                    padding: 3,
                    background: inMonth ? "#FBF8F3" : "#F1ECE2",
                    opacity: inMonth ? 1 : 0.5,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: isToday ? 700 : 500, color: isToday ? "var(--accent)" : "#5C5346", marginBottom: 2 }}>{d.getDate()}</div>
                  {items.slice(0, 3).map((it, i) => (
                    <div key={i} style={{ background: it.color, color: "#FBF8F3", fontSize: 9, borderRadius: 3, padding: "1px 3px", marginBottom: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {it.label}
                    </div>
                  ))}
                  {items.length > 3 && <div style={{ fontSize: 9, color: "#8A8071" }}>+{items.length - 3}</div>}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <button onClick={() => setOffset(offset - 1)} style={navBtn} aria-label="Semaine précédente"><ChevronLeft size={18} /></button>
            <button onClick={() => setOffset(0)} style={{ ...ghostBtn, fontSize: 12 }}>
              {offset === 0 ? "Cette semaine" : dates[0].toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) + " – " + dates[6].toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
            </button>
            <button onClick={() => setOffset(offset + 1)} style={navBtn} aria-label="Semaine suivante"><ChevronRight size={18} /></button>
          </div>

          {dates.map((d, i) => {
            const iso = toISO(d);
            const dayName = DAYS[i];
            const dayTasks = tasks.filter((t) => t.date === iso);
            const dayRepas = repas.filter((r) => r.date === iso);
            const dayActs = activites.filter((a) => (a.recurring && a.day === dayName) || (!a.recurring && a.date === iso)).sort((a, b) => a.time.localeCompare(b.time));
            const isToday = iso === isoToday;
            const isEmpty = dayTasks.length + dayRepas.length + dayActs.length === 0;
            return (
              <Card key={iso} style={isToday ? { border: "1.5px solid var(--accent)" } : {}}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
                  <span className="display" style={{ fontStyle: "italic", fontSize: 16, color: isToday ? "var(--accent)" : "#262138" }}>{dayName}</span>
                  <span style={{ fontSize: 12, color: "#8A8071" }}>{d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>
                  {isToday && <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 700, textTransform: "uppercase" }}>· aujourd'hui</span>}
                </div>
                {isEmpty ? <div style={{ fontSize: 13, color: "#9C9384" }}>Rien de prévu.</div> : (
                  <>
                    {dayActs.map((a) => (
                      <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13 }}>
                        <span>{a.icon}</span>
                        <span className="mono" style={{ color: "#8A8071", width: 76 }}>{a.time}–{a.endTime || "?"}</span>
                        <span style={{ width: 7, height: 7, borderRadius: 4, background: colorFor(a.child) }} />
                        <span>{a.activity} — {a.child}</span>
                      </div>
                    ))}
                    {dayRepas.map((r) => (
                      <div key={r.id} style={{ padding: "4px 0", fontSize: 13, color: "#5C5346" }}>🍽️ <strong>{r.meal}</strong> — {repasSummary(r)}</div>
                    ))}
                    {dayTasks.map((t) => (
                      t.isWork ? (
                        <div key={t.id} style={{ padding: "4px 0", fontSize: 13, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", flexWrap: "nowrap" }}>
                          <span style={{ flexShrink: 0 }}>{t.icon}</span>
                          <span className="mono" style={{ color: "#8A8071", flexShrink: 0 }}>{t.isRest ? "Repos" : `${t.time}–${t.endTime}`}</span>
                        </div>
                      ) : t.isFriend ? (
                        <div key={t.id} style={{ padding: "4px 0", fontSize: 13, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", overflow: "hidden" }}>
                          <span style={{ flexShrink: 0 }}>👥</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}><strong>{t.friendName}</strong> — {t.moment}{t.arrivalTime && ` · ${t.arrivalTime}`}</span>
                        </div>
                      ) : (
                        <div key={t.id} style={{ padding: "4px 0", fontSize: 13, textDecoration: t.done ? "line-through" : "none", color: t.done ? "#9C9384" : "#5C5346" }}>✓ {t.text} <span style={{ color: "#8A8071" }}>({t.assignee})</span></div>
                      )
                    ))}
                  </>
                )}
              </Card>
            );
          })}
        </>
      )}

      {selectedDay && (
        <DayDetailModal day={selectedDay} tasks={tasks} repas={repas} activites={activites} onClose={() => setSelectedDay(null)} tasksCol={tasksCol} repasCol={repasCol} activitesCol={activitesCol} notify={notify} workers={workers} friends={friends} kids={kids} onQuickAdd={onQuickAdd} />
      )}
    </div>
  );
}

const rowStyle = { display: "flex", alignItems: "center", gap: 12, background: "#FBF8F3", border: "1px solid #E3DBCB", borderRadius: 12, padding: "12px 14px", marginBottom: 8 };
const trashStyle = { background: "none", border: "none", color: "#C4A5A5", cursor: "pointer", padding: 6, flexShrink: 0 };
const smallConfirmBtn = { border: "1px solid #E3DBCB", background: "#FBF8F3", borderRadius: 7, width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 };
const ghostBtn = { background: "none", border: "1px solid #E3DBCB", color: "var(--accent)", borderRadius: 10, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const navBtn = { background: "#FBF8F3", border: "1px solid #E3DBCB", borderRadius: 10, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--accent)" };
function checkStyle(done) {
  return { width: 24, height: 24, borderRadius: 7, border: done ? "none" : "1.5px solid #C9BFA9", background: done ? "var(--accent)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, padding: 0 };
}

import { useState, useEffect, useRef } from "react";
import {
  Home, CheckSquare, ShoppingCart, UtensilsCrossed, CalendarClock, CalendarDays, Briefcase,
  Plus, Trash2, Check, X, Loader2, Shuffle, ChevronLeft, ChevronRight, Bell, BellOff, User, Palette,
} from "lucide-react";
import { useCollection } from "./hooks/useCollection";
import { enableNotifications, disableNotifications, getMyDevice, setCategoryPref, NOTIF_CATEGORIES } from "./notifications";
import { sendPush } from "./push";

const TABS = [
  { id: "jour", label: "Aujourd'hui", icon: Home },
  { id: "taches", label: "Tâches", icon: CheckSquare },
  { id: "calendrier", label: "Calendrier", icon: CalendarDays },
  { id: "repas", label: "Repas", icon: UtensilsCrossed },
  { id: "activites", label: "Activités", icon: CalendarClock },
  { id: "valise", label: "Valises", icon: Briefcase },
  { id: "courses", label: "Courses", icon: ShoppingCart },
  { id: "profil", label: "Profil", icon: User },
];

const ASSIGNEES = ["Jerem", "Jennifer", "Les deux"];
const WORK_ICON = { Jennifer: "🩺", Jerem: "💳" };
const FRIEND_MOMENTS = ["Journée", "Midi", "Goûter", "Soir"];
const KIDS = [
  { name: "Noé", color: "#5B4B8A" },
  { name: "Thaïs", color: "#C1683C" },
  { name: "Alba", color: "#3E6E63" },
];
const PEOPLE_COLORS = { Jerem: "#3E6E63", Jennifer: "#C1683C", "Les deux": "#5B4B8A", Tous: "#8A8071" };
const VALISE_OWNERS = ["Tous", "Jerem", "Jennifer", "Noé", "Thaïs", "Alba"];
const MEAL_TASKS = [
  { id: "table", label: "Mettre la table" },
  { id: "debarrasser", label: "Débarrasser la table" },
  { id: "yaourts", label: "Chercher les yaourts" },
];
const MEALS = ["Petit-déjeuner", "Déjeuner", "Dîner"];
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
  return PEOPLE_COLORS[name] || "#8A8071";
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
function suggestAssignment(records) {
  const used = new Set();
  const result = {};
  MEAL_TASKS.forEach((task) => {
    const counts = KIDS.map((k) => ({ name: k.name, count: records.filter((r) => r[task.id] === k.name).length })).filter((k) => !used.has(k.name));
    const min = Math.min(...counts.map((c) => c.count));
    const candidates = counts.filter((c) => c.count === min);
    const pick = candidates[Math.floor(Math.random() * candidates.length)].name;
    used.add(pick);
    result[task.id] = pick;
  });
  return result;
}

export default function App() {
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

  const [accentColor, setAccentColor] = useState(() => localStorage.getItem("carnet-accent-color") || "#5B4B8A");
  const updateAccent = (color) => {
    setAccentColor(color);
    localStorage.setItem("carnet-accent-color", color);
  };

  const tasksC = useCollection("tasks");
  const repasC = useCollection("repas");
  const activitesC = useCollection("activites");
  const shoppingC = useCollection("shopping");
  const valiseC = useCollection("valise");
  const friendsC = useCollection("friends");

  const ready = tasksC.ready && repasC.ready && activitesC.ready && shoppingC.ready && valiseC.ready;

  return (
    <div style={{ "--accent": accentColor, fontFamily: "'Public Sans', sans-serif", background: "#F1ECE2", minHeight: "100vh", color: "#262138", display: "flex", flexDirection: "column" }}>
      <header style={{ padding: "28px 20px 20px", background: "linear-gradient(180deg, #FBF8F3 0%, #F1ECE2 100%)", borderBottom: "1px solid #E3DBCB" }}>
        <div style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A8071", marginBottom: 6 }}>{todayFR()}</div>
        <h1 className="display" style={{ fontSize: 28, fontWeight: 600, margin: 0, fontStyle: "italic", color: "#262138" }}>Le carnet du foyer</h1>
      </header>

      <main style={{ flex: 1, overflowY: "auto", padding: "20px 16px 110px", maxWidth: 560, margin: "0 auto", width: "100%" }}>
        {!ready ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 60, color: "#8A8071" }}>
            <Loader2 size={22} style={{ animation: "spin 1s linear infinite" }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : active === "jour" ? (
          <Overview tasks={tasksC.items} shopping={shoppingC.items} repas={repasC.items} activites={activitesC.items} goTo={setActive} notify={notify} />
        ) : active === "taches" ? (
          <Tasks tasks={tasksC.items} col={tasksC} notify={notify} friends={friendsC.items} friendsCol={friendsC} />
        ) : active === "calendrier" ? (
          <Calendrier tasks={tasksC.items} repas={repasC.items} activites={activitesC.items} />
        ) : active === "repas" ? (
          <Repas repas={repasC.items} col={repasC} notify={notify} />
        ) : active === "activites" ? (
          <Activites activites={activitesC.items} col={activitesC} notify={notify} />
        ) : active === "valise" ? (
          <Valise valise={valiseC.items} col={valiseC} notify={notify} />
        ) : active === "profil" ? (
          <Profil accentColor={accentColor} updateAccent={updateAccent} />
        ) : (
          <Shopping shopping={shoppingC.items} col={shoppingC} notify={notify} />
        )}
      </main>

      {toast && (
        <div style={{ position: "fixed", bottom: 78, left: "50%", transform: "translateX(-50%)", background: "#262138", color: "#FBF8F3", padding: "8px 16px", borderRadius: 20, fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, boxShadow: "0 4px 14px rgba(0,0,0,0.18)", zIndex: 20 }}>
          <Check size={14} /> {toast}
        </div>
      )}

      <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#FBF8F3", borderTop: "1px solid #E3DBCB", maxWidth: 560, margin: "0 auto" }}>
        <div className="navscroll" style={{ display: "flex", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          {TABS.map((tab) => {
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

function StatCard({ label, value, onClick }) {
  return (
    <button onClick={onClick} style={{ background: "#FBF8F3", border: "1px solid #E3DBCB", borderRadius: 14, padding: 16, textAlign: "left", cursor: "pointer" }}>
      <div style={{ fontSize: 12, color: "#8A8071", marginBottom: 6 }}>{label}</div>
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

function Profil({ accentColor, updateAccent }) {
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

  const toggleNotifs = async () => {
    setBusy(true);
    setError("");
    try {
      if (!enabled) {
        const person = window.prompt("Qui êtes-vous ? (Jerem / Jennifer)", "Jerem") || "Inconnu";
        await enableNotifications(person);
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
    </div>
  );
}

function Overview({ tasks, shopping, repas, activites, goTo }) {
  const iso = todayISO();
  const dayName = todayDayName();
  const dayTasks = tasks.filter((t) => t.date === iso);
  const dayRepas = repas.filter((r) => r.date === iso);
  const dayActs = activites.filter((a) => (a.recurring && a.day === dayName) || (!a.recurring && a.date === iso)).sort((a, b) => a.time.localeCompare(b.time));
  const hasDayInfo = dayTasks.length + dayRepas.length + dayActs.length > 0;
  const pendingTasks = tasks.filter((t) => !t.done && !t.isWork && !t.isFriend);
  const pendingShopping = shopping.filter((s) => !s.done);
  const undatedPending = pendingTasks.filter((t) => !t.date);

  return (
    <div>
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
                  <div key={r.id} style={{ fontSize: 14, padding: "5px 0", color: "#5C5346" }}><strong>{r.meal}</strong> — table: {r.table}, débarrasse: {r.debarrasser}, yaourts: {r.yaourts}</div>
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 4 }}>
        <StatCard label="Tâches en attente" value={pendingTasks.length} onClick={() => goTo("taches")} />
        <StatCard label="À acheter" value={pendingShopping.length} onClick={() => goTo("courses")} />
      </div>

      {undatedPending.length > 0 || pendingShopping.length > 0 ? (
        <Card>
          <SectionLabel>Sans date précise</SectionLabel>
          {undatedPending.slice(0, 3).map((t) => (
            <div key={t.id} style={{ fontSize: 15, padding: "6px 0", borderBottom: "1px solid #EFE9DD" }}>✓ {t.text} <span style={{ color: "#8A8071", fontSize: 13 }}>({t.assignee})</span></div>
          ))}
          {pendingShopping.slice(0, 3).map((s) => (
            <div key={s.id} style={{ fontSize: 15, padding: "6px 0", borderBottom: "1px solid #EFE9DD" }}>🛒 {s.text}</div>
          ))}
        </Card>
      ) : (
        !hasDayInfo && <Card><div className="display" style={{ fontStyle: "italic", fontSize: 17, color: "var(--accent)" }}>Tout est à jour. Bonne journée à vous tous.</div></Card>
      )}
    </div>
  );
}

function Tasks({ tasks, col, notify, friends, friendsCol }) {
  const [category, setCategory] = useState("travail"); // "travail" | "amis" | "tache"

  // -- Autre tâche --
  const [text, setText] = useState("");
  const [assignee, setAssignee] = useState(ASSIGNEES[0]);
  const [date, setDate] = useState("");

  // -- Travail --
  const [workPerson, setWorkPerson] = useState("Jennifer");
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

  const add = async () => {
    if (!text.trim()) return;
    await col.add({ text: text.trim(), done: false, assignee, date: date || null });
    notify();
    sendPush("Nouvelle tâche", `${text.trim()} (${assignee})`, "taches");
    setText(""); setDate("");
  };

  const workDatesValid = dateMode === "unique" ? !!workDate : !!workStartDate && !!workEndDate && workEndDate >= workStartDate;

  const addWork = async () => {
    if (!workDatesValid) return;
    const isRest = workStatus === "repos";
    const dates = dateMode === "unique" ? [workDate] : datesBetween(workStartDate, workEndDate);

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
          icon: WORK_ICON[workPerson],
        })
      )
    );
    notify();
    sendPush(
      isRest ? "Jour(s) de repos ajouté(s)" : "Nouveau planning de travail",
      dates.length === 1
        ? `${workPerson} ${isRest ? "est en repos" : `travaille de ${workTime} à ${workEndTime}`} le ${new Date(dates[0] + "T00:00:00").toLocaleDateString("fr-FR")}`
        : `${workPerson} : ${dates.length} jours ajoutés (${new Date(dates[0] + "T00:00:00").toLocaleDateString("fr-FR")} → ${new Date(dates[dates.length - 1] + "T00:00:00").toLocaleDateString("fr-FR")})`,
      "taches"
    );
  };

  const friendValid = !!friendName.trim() && !!friendDate;

  const addFriend = async () => {
    if (!friendValid) return;
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
    notify();
    sendPush(
      "Amis à venir",
      `${friendName.trim()} — ${friendMoment}${friendArrival ? ` (arrivée ${friendArrival})` : ""} le ${new Date(friendDate + "T00:00:00").toLocaleDateString("fr-FR")}`,
      "taches"
    );
    setFriendName(""); setFriendArrival("");
  };

  const toggle = async (id, done) => { await col.update(id, { done: !done }); notify(); };
  const remove = async (id) => { await col.remove(id); notify("Supprimé"); };

  const regularTasks = [...tasks.filter((t) => !t.isWork && !t.isFriend)].sort((a, b) => a.done - b.done);
  const workShifts = [...tasks.filter((t) => t.isWork)].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const friendVisits = [...tasks.filter((t) => t.isFriend)].sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {[
          { id: "travail", label: "Travail" },
          { id: "amis", label: "Amis" },
          { id: "tache", label: "Autre tâche" },
        ].map((c) => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            style={{ flex: 1, padding: "10px 2px", borderRadius: 10, border: "1px solid #E3DBCB", fontWeight: 600, fontSize: 12, cursor: "pointer", background: category === c.id ? "var(--accent)" : "#FBF8F3", color: category === c.id ? "#FBF8F3" : "var(--accent)" }}
          >
            {c.label}
          </button>
        ))}
      </div>

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

      {category === "travail" && (
        <Card>
          <SectionLabel>Nouveau planning de travail</SectionLabel>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button
              onClick={() => setWorkPerson("Jennifer")}
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 0", borderRadius: 10, border: workPerson === "Jennifer" ? "1.5px solid var(--accent)" : "1px solid #E3DBCB", background: workPerson === "Jennifer" ? "color-mix(in srgb, var(--accent) 15%, white)" : "#FBF8F3", cursor: "pointer", fontWeight: 600, fontSize: 14 }}
            >
              <span style={{ fontSize: 18 }}>🩺</span> Jennifer
            </button>
            <button
              onClick={() => setWorkPerson("Jerem")}
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 0", borderRadius: 10, border: workPerson === "Jerem" ? "1.5px solid var(--accent)" : "1px solid #E3DBCB", background: workPerson === "Jerem" ? "color-mix(in srgb, var(--accent) 15%, white)" : "#FBF8F3", cursor: "pointer", fontWeight: 600, fontSize: 14 }}
            >
              <span style={{ fontSize: 18 }}>💳</span> Jerem
            </button>
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
        </Card>
      )}

      {category === "amis" && (
        <Card>
          <SectionLabel>Nouvelle visite entre amis</SectionLabel>
          <input
            value={friendName}
            onChange={(e) => setFriendName(e.target.value)}
            placeholder="Nom de l'ami(e)…"
            style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: friendName.trim() ? "1px solid #E3DBCB" : "1.5px solid #B0455A", fontSize: 15, marginBottom: friends.length > 0 ? 8 : 10 }}
          />
          {friends.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {friends.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFriendName(f.name)}
                  style={{
                    padding: "5px 10px",
                    borderRadius: 20,
                    border: friendName === f.name ? "1.5px solid var(--accent)" : "1px solid #E3DBCB",
                    background: friendName === f.name ? "color-mix(in srgb, var(--accent) 15%, white)" : "#FBF8F3",
                    color: friendName === f.name ? "var(--accent)" : "#5C5346",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {f.name}
                </button>
              ))}
            </div>
          )}
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

      {workShifts.length > 0 && (
        <Card>
          <SectionLabel>Plannings de travail</SectionLabel>
          {workShifts.map((w) => (
            <div key={w.id} className="row-enter" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #EFE9DD" }}>
              <span style={{ fontSize: 18 }}>{w.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15 }}>{w.assignee} — {w.isRest ? "Repos" : "Travail"}</div>
                <div className="mono" style={{ fontSize: 12, color: "#8A8071" }}>
                  {new Date(w.date + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}{!w.isRest && ` · ${w.time}–${w.endTime}`}
                </div>
              </div>
              <DeleteButton onDelete={() => remove(w.id)} label="ce planning" />
            </div>
          ))}
        </Card>
      )}

      {friendVisits.length > 0 && (
        <Card>
          <SectionLabel>Sorties entre amis</SectionLabel>
          {friendVisits.map((f) => (
            <div key={f.id} className="row-enter" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #EFE9DD" }}>
              <span style={{ fontSize: 18 }}>👥</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15 }}>{f.friendName} — {f.moment}</div>
                <div className="mono" style={{ fontSize: 12, color: "#8A8071" }}>
                  {new Date(f.date + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}{f.arrivalTime && ` · arrivée ${f.arrivalTime}`}
                </div>
              </div>
              <DeleteButton onDelete={() => remove(f.id)} label="cette visite" />
            </div>
          ))}
        </Card>
      )}

      <SectionLabel>Tâches</SectionLabel>
      {regularTasks.length === 0 ? <EmptyState text="Aucune tâche pour l'instant." /> : regularTasks.map((t) => (
        <div key={t.id} className="row-enter" style={rowStyle}>
          <button onClick={() => toggle(t.id, t.done)} style={checkStyle(t.done)}>{t.done && <Check size={14} color="#FBF8F3" />}</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, textDecoration: t.done ? "line-through" : "none", color: t.done ? "#9C9384" : "#262138" }}>{t.text}</div>
            <div style={{ fontSize: 12, color: "#8A8071" }}>{t.assignee}{t.date ? ` · ${new Date(t.date).toLocaleDateString("fr-FR")}` : ""}</div>
          </div>
          <DeleteButton onDelete={() => remove(t.id)} label="cette tâche" />
        </div>
      ))}
    </div>
  );
}
function Shopping({ shopping, col, notify }) {
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

function Valise({ valise, col, notify }) {
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

function Repas({ repas, col, notify }) {
  const [date, setDate] = useState(todayISO());
  const [meal, setMeal] = useState(MEALS[0]);
  const [assign, setAssign] = useState(() => suggestAssignment(repas));
  const resuggest = () => setAssign(suggestAssignment(repas));

  const add = async () => {
    await col.add({ date, meal, table: assign.table, debarrasser: assign.debarrasser, yaourts: assign.yaourts });
    notify();
    sendPush("Nouveau repas planifié", `${meal} du ${new Date(date).toLocaleDateString("fr-FR")}`, "repas");
    setAssign(suggestAssignment(repas));
  };
  const remove = async (id) => { await col.remove(id); notify("Supprimé"); };

  const counts = KIDS.map((k) => {
    const perTask = {};
    MEAL_TASKS.forEach((t) => { perTask[t.id] = repas.filter((r) => r[t.id] === k.name).length; });
    const total = MEAL_TASKS.reduce((s, t) => s + perTask[t.id], 0);
    return { name: k.name, color: k.color, perTask, total };
  });
  const maxTotal = Math.max(1, ...counts.map((c) => c.total));
  const spread = Math.max(...counts.map((c) => c.total)) - Math.min(...counts.map((c) => c.total));

  return (
    <div>
      <Card>
        <SectionLabel>Nouveau repas</SectionLabel>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 14 }} />
          <select value={meal} onChange={(e) => setMeal(e.target.value)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 14 }}>
            {MEALS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        {MEAL_TASKS.map((t) => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 14 }}>{t.label}</span>
            <select value={assign[t.id]} onChange={(e) => setAssign({ ...assign, [t.id]: e.target.value })} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #E3DBCB", fontSize: 13 }}>
              {KIDS.map((k) => <option key={k.name} value={k.name}>{k.name}</option>)}
            </select>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <button onClick={resuggest} style={{ ...ghostBtn, display: "flex", alignItems: "center", gap: 6 }}><Shuffle size={14} /> Suggestion équitable</button>
          <button onClick={add} style={{ flex: 1, background: "var(--accent)", color: "#FBF8F3", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>Enregistrer</button>
        </div>
      </Card>

      <Card>
        <SectionLabel>Équité des tâches {spread > 1 && <span style={{ color: "#B0455A" }}>· déséquilibre</span>}</SectionLabel>
        {MEAL_TASKS.map((t) => {
          const taskMax = Math.max(1, ...counts.map((c) => c.perTask[t.id]));
          return (
            <div key={t.id} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: "#8A8071", marginBottom: 6 }}>{t.label}</div>
              {counts.map((c) => (
                <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 12, width: 44 }}>{c.name}</span>
                  <div style={{ flex: 1, height: 6, background: "#EFE9DD", borderRadius: 3 }}><div style={{ height: 6, width: `${(c.perTask[t.id] / taskMax) * 100}%`, background: c.color, borderRadius: 3 }} /></div>
                  <span className="mono" style={{ fontSize: 12, width: 16, textAlign: "right" }}>{c.perTask[t.id]}</span>
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

      {repas.length === 0 ? <EmptyState text="Aucun repas planifié encore." /> : [...repas].sort((a, b) => new Date(b.date) - new Date(a.date)).map((r) => (
        <div key={r.id} className="row-enter" style={{ ...rowStyle, flexDirection: "column", alignItems: "stretch" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <strong style={{ fontSize: 14 }}>{r.meal} · {new Date(r.date).toLocaleDateString("fr-FR")}</strong>
            <DeleteButton onDelete={() => remove(r.id)} label="ce repas" />
          </div>
          {MEAL_TASKS.map((t) => (
            <div key={t.id} style={{ fontSize: 13, color: "#5C5346", display: "flex", justifyContent: "space-between" }}>
              <span>{t.label}</span><span style={{ color: colorFor(r[t.id]), fontWeight: 600 }}>{r[t.id]}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Activites({ activites, col, notify }) {
  const [activity, setActivity] = useState("");
  const [icon, setIcon] = useState(ACTIVITY_ICONS[0].emoji);
  const [child, setChild] = useState(KIDS[0].name);
  const [recurring, setRecurring] = useState(true);
  const [day, setDay] = useState(DAYS[0]);
  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState("17:00");
  const [endTime, setEndTime] = useState("18:00");

  const add = async () => {
    if (!activity.trim()) return;
    const base = { activity: activity.trim(), icon, child, time, endTime, recurring };
    const record = recurring ? { ...base, day, date: null } : { ...base, date, day: dayNameFromDate(date) };
    await col.add(record);
    notify();
    const when = recurring ? `${day} ${time}` : `${new Date(date + "T00:00:00").toLocaleDateString("fr-FR")} ${time}`;
    sendPush("Nouvelle activité", `${activity.trim()} — ${child} (${when})`, "activites");
    setActivity("");
  };
  const remove = async (id) => { await col.remove(id); notify("Supprimé"); };

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
            {KIDS.map((k) => <option key={k.name} value={k.name}>{k.name}</option>)}
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

function Calendrier({ tasks, repas, activites }) {
  const [offset, setOffset] = useState(0);
  const dates = weekDates(offset);
  const isoToday = todayISO();
  const undated = tasks.filter((t) => !t.date && !t.done);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <button onClick={() => setOffset(offset - 1)} style={navBtn} aria-label="Semaine précédente"><ChevronLeft size={18} /></button>
        <button onClick={() => setOffset(0)} style={{ ...ghostBtn, fontSize: 12 }}>
          {offset === 0 ? "Cette semaine" : dates[0].toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) + " – " + dates[6].toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
        </button>
        <button onClick={() => setOffset(offset + 1)} style={navBtn} aria-label="Semaine suivante"><ChevronRight size={18} /></button>
      </div>

      {undated.length > 0 && (
        <Card><SectionLabel>Tâches sans date</SectionLabel>{undated.map((t) => (
          <div key={t.id} style={{ fontSize: 14, padding: "5px 0" }}>✓ {t.text} <span style={{ color: "#8A8071", fontSize: 12 }}>({t.assignee})</span></div>
        ))}</Card>
      )}

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
                  <div key={r.id} style={{ padding: "4px 0", fontSize: 13, color: "#5C5346" }}>🍽️ <strong>{r.meal}</strong> — table: {r.table}, débarrasse: {r.debarrasser}, yaourts: {r.yaourts}</div>
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


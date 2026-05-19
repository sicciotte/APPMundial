import { firebaseConfig, PORRA_ID } from "./firebase-config.js";

const LOCAL_SESSION_KEY = "porra-mundial-2026-session";
const state = { users: [], predictions: {}, results: {} };

let viewMode = "date";
let activeGroup = "all";
let searchTerm = "";
let authMode = "login";
let currentUser = null;
let currentProfile = null;
let authReady = false;
let syncReady = false;
let unsubscribers = [];

const firebaseReady = isFirebaseConfigured();
let auth = null;
let db = null;
let createUserWithEmailAndPassword = null;
let signInWithEmailAndPassword = null;
let signOut = null;
let updateProfile = null;
let collection = null;
let doc = null;
let getDoc = null;
let onSnapshot = null;
let serverTimestamp = null;
let setDoc = null;

async function initializeFirebase() {
  const appModule = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js");
  const authModule = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js");
  const firestoreModule = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js");
  const firebaseApp = appModule.initializeApp(firebaseConfig);

  auth = authModule.getAuth(firebaseApp);
  db = firestoreModule.getFirestore(firebaseApp);
  createUserWithEmailAndPassword = authModule.createUserWithEmailAndPassword;
  signInWithEmailAndPassword = authModule.signInWithEmailAndPassword;
  signOut = authModule.signOut;
  updateProfile = authModule.updateProfile;
  collection = firestoreModule.collection;
  doc = firestoreModule.doc;
  getDoc = firestoreModule.getDoc;
  onSnapshot = firestoreModule.onSnapshot;
  serverTimestamp = firestoreModule.serverTimestamp;
  setDoc = firestoreModule.setDoc;

  authModule.onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    authReady = true;
    localStorage.setItem(LOCAL_SESSION_KEY, user?.uid || "");

    if (user) {
      try {
        await ensureUserProfile(user);
        startSync();
      } catch {
        syncReady = false;
        render();
        showToast("Revisa la configuración y reglas de Firebase.");
      }
    } else {
      stopSync();
    }

    render();
  });
}

function isFirebaseConfigured() {
  return firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("TU_") && firebaseConfig.projectId !== "TU_PROYECTO";
}

function appDoc(...parts) {
  return doc(db, "porras", PORRA_ID, ...parts);
}

function appCollection(...parts) {
  return collection(db, "porras", PORRA_ID, ...parts);
}

function formatDate(date) {
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function getOutcome(result) {
  if (!result || result.home === "" || result.away === "") return "";
  const home = Number(result.home);
  const away = Number(result.away);
  if (home > away) return "1";
  if (home < away) return "2";
  return "X";
}

function userPoints(userId) {
  return MATCHES.reduce((total, match) => {
    const real = getOutcome(state.results[match.id]);
    const pick = state.predictions[userId]?.[match.id];
    return real && pick === real ? total + 1 : total;
  }, 0);
}

function teamLabel(team) {
  const code = FLAG_CODES[team];
  const flag = code
    ? `<img class="flag" src="https://flagcdn.com/w40/${code}.png" srcset="https://flagcdn.com/w80/${code}.png 2x" width="28" height="20" alt="Bandera de ${team}" loading="lazy" />`
    : `<span class="flag flag-empty" aria-hidden="true"></span>`;
  return `<span class="team-name">${flag}<span>${team}</span></span>`;
}

function groupStandings(group) {
  const teams = GROUPS[group].map((name) => ({
    name,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0,
  }));
  const byName = Object.fromEntries(teams.map((team) => [team.name, team]));

  MATCHES.filter((match) => match.group === group).forEach((match) => {
    const result = state.results[match.id];
    if (!result || result.home === "" || result.away === "") return;

    const homeGoals = Number(result.home);
    const awayGoals = Number(result.away);
    const home = byName[match.home];
    const away = byName[match.away];
    home.played += 1;
    away.played += 1;
    home.goalsFor += homeGoals;
    home.goalsAgainst += awayGoals;
    away.goalsFor += awayGoals;
    away.goalsAgainst += homeGoals;

    if (homeGoals > awayGoals) {
      home.won += 1;
      away.lost += 1;
      home.points += 3;
    } else if (homeGoals < awayGoals) {
      away.won += 1;
      home.lost += 1;
      away.points += 3;
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
    }
  });

  return teams.sort((a, b) => {
    const goalDiffA = a.goalsFor - a.goalsAgainst;
    const goalDiffB = b.goalsFor - b.goalsAgainst;
    return b.points - a.points || goalDiffB - goalDiffA || b.goalsFor - a.goalsFor;
  });
}

function ranking() {
  return [...state.users]
    .map((user) => ({
      ...user,
      points: userPoints(user.id),
      picks: Object.keys(state.predictions[user.id] || {}).length,
    }))
    .sort((a, b) => b.points - a.points || b.picks - a.picks || a.name.localeCompare(b.name));
}

async function handleAuth(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.elements.name?.value.trim() || "";
  const email = form.elements.email.value.trim();
  const password = form.elements.password.value;

  try {
    if (authMode === "register") {
      if (!name) {
        showToast("Escribe tu nombre para crear la cuenta.");
        return;
      }
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName: name });
      await saveUserProfile(credential.user, name);
      showToast("Cuenta creada. Ya puedes pronosticar.");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      showToast("Sesión iniciada.");
    }
    form.reset();
  } catch (error) {
    showToast(authErrorMessage(error));
  }
}

function authErrorMessage(error) {
  const code = error?.code || "";
  if (code.includes("email-already-in-use")) return "Ese email ya tiene cuenta.";
  if (code.includes("invalid-email")) return "El email no parece correcto.";
  if (code.includes("weak-password")) return "La contraseña debe tener al menos 6 caracteres.";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "Email o contraseña incorrectos.";
  }
  return "No se pudo completar el acceso.";
}

async function saveUserProfile(user, fallbackName = "") {
  const name = fallbackName || user.displayName || user.email.split("@")[0];
  await setDoc(
    appDoc("users", user.uid),
    {
      name,
      email: user.email,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );
}

async function ensureUserProfile(user) {
  const profileRef = appDoc("users", user.uid);
  const snapshot = await getDoc(profileRef);
  if (!snapshot.exists()) await saveUserProfile(user);
}

async function setPrediction(matchId, pick) {
  if (!currentUser) {
    showToast("Inicia sesión para guardar pronósticos.");
    return;
  }

  const nextPicks = { ...(state.predictions[currentUser.uid] || {}), [matchId]: pick };
  state.predictions[currentUser.uid] = nextPicks;
  render();

  try {
    await setDoc(
      appDoc("predictions", currentUser.uid),
      {
        picks: nextPicks,
        userId: currentUser.uid,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch {
    showToast("No se pudo guardar el pronóstico.");
  }
}

function filteredMatches() {
  return MATCHES.filter((match) => {
    const groupMatch = activeGroup === "all" || match.group === activeGroup;
    const haystack = `${match.home} ${match.away} ${match.venue}`.toLowerCase();
    return groupMatch && haystack.includes(searchTerm.toLowerCase());
  });
}

function groupedMatches() {
  const key = viewMode === "date" ? "date" : "group";
  return filteredMatches().reduce((acc, match) => {
    const groupKey = match[key];
    acc[groupKey] ||= [];
    acc[groupKey].push(match);
    return acc;
  }, {});
}

function predictionCell(user, match) {
  const pick = state.predictions[user.id]?.[match.id] || "-";
  const real = getOutcome(state.results[match.id]);
  const status = real ? (pick === real ? "hit" : "miss") : "";
  return `<td class="${status}">${pick}</td>`;
}

function render() {
  if (!firebaseReady) {
    renderFirebaseSetup();
    return;
  }

  if (!authReady) {
    renderLoading("Preparando acceso...");
    return;
  }

  if (!currentUser) {
    renderAuth();
    return;
  }

  renderApp();
}

function renderFirebaseSetup() {
  document.querySelector("#app").innerHTML = `
    <main class="auth-page">
      <section class="auth-card">
        <p class="eyebrow">Configuración pendiente</p>
        <h1>Conecta Firebase</h1>
        <p class="empty">Rellena el archivo <strong>firebase-config.js</strong> con los datos de tu proyecto Firebase para activar usuarios y guardado compartido.</p>
      </section>
    </main>
  `;
}

function renderLoading(message) {
  document.querySelector("#app").innerHTML = `
    <main class="auth-page">
      <section class="auth-card">
        <p class="eyebrow">Porra Mundial 2026</p>
        <h1>${message}</h1>
      </section>
    </main>
  `;
}

function renderAuth() {
  document.querySelector("#app").innerHTML = `
    <main class="auth-page">
      <section class="auth-card">
        <p class="eyebrow">Copa Mundial FIFA 2026</p>
        <h1>Porra Mundial 2026</h1>
        <form class="auth-form" data-action="auth">
          ${
            authMode === "register"
              ? `<label>Nombre<input name="name" type="text" autocomplete="name" placeholder="Ej. Marta" required /></label>`
              : ""
          }
          <label>Email<input name="email" type="email" autocomplete="email" required /></label>
          <label>Contraseña<input name="password" type="password" autocomplete="${authMode === "register" ? "new-password" : "current-password"}" minlength="6" required /></label>
          <button type="submit">${authMode === "register" ? "Crear cuenta" : "Entrar"}</button>
        </form>
        <button class="text-button" data-action="toggle-auth">
          ${authMode === "register" ? "Ya tengo cuenta" : "Crear una cuenta nueva"}
        </button>
      </section>
      <div id="toast" class="toast" aria-live="polite"></div>
    </main>
  `;
  bindAuthEvents();
}

function renderApp() {
  const activeElement = document.activeElement;
  const restoreSearchFocus = activeElement?.dataset?.action === "search";
  const searchCursor = restoreSearchFocus ? activeElement.selectionStart : null;
  const app = document.querySelector("#app");
  const board = ranking();
  const groups = Object.keys(GROUPS);
  const matchesByKey = groupedMatches();
  const totalPicks = Object.keys(state.predictions[currentUser.uid] || {}).length;
  const displayName = currentProfile?.name || currentUser.displayName || currentUser.email;

  app.innerHTML = `
    <header class="topbar">
      <div>
        <p class="eyebrow">Copa Mundial FIFA 2026</p>
        <h1>Porra Mundial 2026</h1>
      </div>
      <div class="source">
        <span>${syncReady ? "Firebase activo" : "Conectando con Firebase"}</span>
        <span>${MATCHES.length} partidos de grupos</span>
        <a href="${WORLD_CUP_SOURCE}" target="_blank" rel="noreferrer">Fuente FIFA</a>
      </div>
    </header>

    <main class="layout">
      <aside class="sidebar">
        <section class="panel">
          <h2>Tu cuenta</h2>
          <div class="account-box">
            <strong>${displayName}</strong>
            <span>${currentUser.email}</span>
          </div>
          <button class="secondary" data-action="logout">Cerrar sesión</button>
          <div class="mini-stats">
            <div><strong>${state.users.length}</strong><span>usuarios</span></div>
            <div><strong>${MATCHES.length}</strong><span>partidos</span></div>
            <div><strong>${totalPicks}</strong><span>tus picks</span></div>
          </div>
        </section>

        <section class="panel">
          <h2>Clasificación</h2>
          <ol class="ranking">
            ${
              board.length
                ? board
                    .map(
                      (user, index) => `
                        <li class="${user.id === currentUser.uid ? "active" : ""}">
                          <span class="rank">${index + 1}</span>
                          <span>${user.name}</span>
                          <strong>${user.points}</strong>
                        </li>`,
                    )
                    .join("")
                : `<p class="empty">Cuando entren participantes aparecerán aquí.</p>`
            }
          </ol>
        </section>

        <section class="panel compact">
          <h2>Grupos</h2>
          <div class="groups">
            ${groups
              .map(
                (group) => `
                  <details ${group === activeGroup ? "open" : ""}>
                    <summary>Grupo ${group}</summary>
                    <p>${GROUPS[group].map(teamLabel).join("")}</p>
                  </details>`,
              )
              .join("")}
          </div>
        </section>
      </aside>

      <section class="content">
        <div class="toolbar">
          <div class="segmented" role="tablist" aria-label="Vista">
            <button class="${viewMode === "date" ? "selected" : ""}" data-action="view" data-view="date">Fecha</button>
            <button class="${viewMode === "group" ? "selected" : ""}" data-action="view" data-view="group">Grupo</button>
          </div>
          <select data-action="filter-group" aria-label="Filtrar grupo">
            <option value="all">Todos los grupos</option>
            ${groups.map((group) => `<option value="${group}" ${group === activeGroup ? "selected" : ""}>Grupo ${group}</option>`).join("")}
          </select>
          <input class="search" data-action="search" type="search" value="${searchTerm}" placeholder="Buscar selección o sede" />
        </div>

        <div class="notice">
          <span>Pronósticos de ${displayName}</span>
          <span>1 local · X empate · 2 visitante</span>
        </div>

        ${Object.entries(matchesByKey)
          .map(([key, matches]) => renderMatchSection(key, matches))
          .join("")}

        <section class="panel group-standings">
          <div class="section-title">
            <h2>Clasificación por grupos</h2>
            <span>Según resultados oficiales cuando estén cargados</span>
          </div>
          <div class="standings-grid">
            ${groups.map(renderGroupTable).join("")}
          </div>
        </section>

        <section class="panel predictions">
          <div class="section-title">
            <h2>Todos los pronósticos</h2>
            <span>${state.users.length ? "Sincronizado con Firebase" : "Sin participantes aún"}</span>
          </div>
          ${renderPredictionsTable()}
        </section>
      </section>
    </main>
    <div id="toast" class="toast" aria-live="polite"></div>
  `;

  bindAppEvents();
  if (restoreSearchFocus) {
    const search = document.querySelector('[data-action="search"]');
    search.focus();
    search.setSelectionRange(searchCursor, searchCursor);
  }
}

function renderMatchSection(key, matches) {
  const title = viewMode === "date" ? formatDate(key) : `Grupo ${key}`;
  return `
    <section class="match-section">
      <div class="section-title">
        <h2>${title}</h2>
        <span>${matches.length} partidos</span>
      </div>
      <div class="match-list">
        ${matches.map(renderMatchCard).join("")}
      </div>
    </section>
  `;
}

function renderMatchCard(match) {
  const selected = state.predictions[currentUser.uid]?.[match.id] || "";
  return `
    <article class="match-card">
      <div class="match-meta">
        <span>Partido ${match.number}</span>
        <span>Grupo ${match.group}</span>
        <span>${match.venue}</span>
      </div>
      <div class="teams">
        <strong>${teamLabel(match.home)}</strong>
        <span>vs</span>
        <strong>${teamLabel(match.away)}</strong>
      </div>
      <div class="pick-row" aria-label="Pronóstico">
        ${["1", "X", "2"]
          .map(
            (pick) => `
              <button class="${selected === pick ? "selected" : ""}" data-action="pick" data-match="${match.id}" data-pick="${pick}">
                ${pick}
              </button>`,
          )
          .join("")}
      </div>
    </article>
  `;
}

function renderGroupTable(group) {
  return `
    <div class="standings-table">
      <h3>Grupo ${group}</h3>
      <table>
        <thead>
          <tr>
            <th>Selección</th>
            <th>J</th>
            <th>G</th>
            <th>E</th>
            <th>P</th>
            <th>DG</th>
            <th>Pts</th>
          </tr>
        </thead>
        <tbody>
          ${groupStandings(group)
            .map(
              (team) => `
                <tr>
                  <td>${teamLabel(team.name)}</td>
                  <td>${team.played}</td>
                  <td>${team.won}</td>
                  <td>${team.drawn}</td>
                  <td>${team.lost}</td>
                  <td>${team.goalsFor - team.goalsAgainst}</td>
                  <td><strong>${team.points}</strong></td>
                </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderPredictionsTable() {
  if (!state.users.length) return `<p class="empty">Cuando haya usuarios registrados aparecerá aquí la tabla completa.</p>`;
  const visible = filteredMatches();
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Partido</th>
            ${state.users.map((user) => `<th>${user.name}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${visible
            .map(
              (match) => `
                <tr>
                  <td><strong>${teamLabel(match.home)}</strong> - ${teamLabel(match.away)}<small>Grupo ${match.group} · ${formatDate(match.date)}</small></td>
                  ${state.users.map((user) => predictionCell(user, match)).join("")}
                </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function bindAuthEvents() {
  document.querySelector('[data-action="auth"]').addEventListener("submit", handleAuth);
  document.querySelector('[data-action="toggle-auth"]').addEventListener("click", () => {
    authMode = authMode === "login" ? "register" : "login";
    renderAuth();
  });
}

function bindAppEvents() {
  document.querySelector('[data-action="logout"]').addEventListener("click", () => signOut(auth));
  document.querySelectorAll('[data-action="view"]').forEach((button) => {
    button.addEventListener("click", () => {
      viewMode = button.dataset.view;
      render();
    });
  });
  document.querySelector('[data-action="filter-group"]').addEventListener("change", (event) => {
    activeGroup = event.target.value;
    render();
  });
  document.querySelector('[data-action="search"]').addEventListener("input", (event) => {
    searchTerm = event.target.value;
    render();
  });
  document.querySelectorAll('[data-action="pick"]').forEach((button) => {
    button.addEventListener("click", () => setPrediction(button.dataset.match, button.dataset.pick));
  });
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2400);
}

function stopSync() {
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [];
  state.users = [];
  state.predictions = {};
  state.results = {};
  currentProfile = null;
  syncReady = false;
}

function startSync() {
  stopSync();

  unsubscribers.push(
    onSnapshot(
      appCollection("users"),
      (snapshot) => {
        state.users = snapshot.docs
          .map((userDoc) => ({ id: userDoc.id, ...userDoc.data() }))
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        currentProfile = state.users.find((user) => user.id === currentUser?.uid) || currentProfile;
        syncReady = true;
        render();
      },
      () => showToast("No se pudieron leer los usuarios."),
    ),
  );

  unsubscribers.push(
    onSnapshot(
      appCollection("predictions"),
      (snapshot) => {
        state.predictions = Object.fromEntries(snapshot.docs.map((predictionDoc) => [predictionDoc.id, predictionDoc.data().picks || {}]));
        syncReady = true;
        render();
      },
      () => showToast("No se pudieron leer los pronósticos."),
    ),
  );

  unsubscribers.push(
    onSnapshot(
      appDoc("app", "results"),
      (snapshot) => {
        state.results = snapshot.exists() ? snapshot.data().results || {} : {};
        syncReady = true;
        render();
      },
      () => showToast("No se pudieron leer los resultados."),
    ),
  );
}

render();
if (firebaseReady) {
  initializeFirebase().catch(() => {
    authReady = true;
    renderLoading("No se pudo conectar con Firebase.");
  });
}

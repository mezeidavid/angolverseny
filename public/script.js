let teams = [];
let tasks = [];
let scores = {};
let appStarted = false;

const $ = (id) => document.getElementById(id);

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

let toastTimer;
function showToast(message, type = 'info') {
    const el = $('toast');
    el.textContent = message;
    el.className = 'toast ' + type;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

// Keresésekhez: kisbetű, ékezetek nélkül (így "kovacs" is megtalálja a "Kovács"-ot)
function norm(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function notifyError(err) {
    console.error(err);
    showToast('Hiba: ' + (err && err.message ? err.message : err), 'error');
}

// ---------- Clerk + API ----------

async function api(path, options = {}) {
    const token = await window.Clerk.session.getToken();
    const headers = { Authorization: `Bearer ${token}` };
    if (options.body) headers['Content-Type'] = 'application/json';

    const res = await fetch(path, { ...options, headers });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `${res.status} ${res.statusText}`);
    }
    return res.json();
}

function loadScript(src, attributes = {}) {
    return new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.async = true;
        el.crossOrigin = 'anonymous';
        el.src = src;
        Object.entries(attributes).forEach(([k, v]) => el.setAttribute(k, v));
        el.onload = resolve;
        el.onerror = () => reject(new Error(`Nem tölthető be: ${src}`));
        document.head.appendChild(el);
    });
}

// Clerk JS SDK (6-os főverzió) + különálló UI csomag (@clerk/ui 1-es főverzió)
async function loadClerk(publishableKey, frontendApi) {
    await loadScript(`https://${frontendApi}/npm/@clerk/ui@1/dist/ui.browser.js`);
    await loadScript(`https://${frontendApi}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, {
        'data-clerk-publishable-key': publishableKey
    });
}


// Picit belenyult a ChatGPT
async function initAuth() {
    try {
        const cfg = await (await fetch('/api/config')).json();
        if (!cfg.publishableKey) throw new Error(cfg.error || 'Hiányzó Clerk konfiguráció');

        await loadClerk(cfg.publishableKey, cfg.frontendApi);
        await window.Clerk.load({
            ui: { ClerkUI: window.__internal_ClerkUICtor },
            afterSignOutUrl: '/',
             appearance: {
        variables: {
            colorPrimary: "#6366f1",
            colorPrimaryForeground: "#ffffff",

            colorBackground: "#20212a",
            colorForeground: "#f4f4f5",

            colorInput: "#191a22",
            colorInputForeground: "#f4f4f5",

            colorMuted: "#292a35",
            colorMutedForeground: "#a1a1aa",

            colorBorder: "#353743",
            colorRing: "#818cf8",

            borderRadius: "12px",
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "14px"
        },

        elements: {
            rootBox: {
                width: "100%"
            },

            card: {
                backgroundColor: "transparent",
                boxShadow: "none",
                border: "none",
                width: "100%"
            },

            headerTitle: {
                display: "none"
            },

            headerSubtitle: {
                display: "none"
            },

            formFieldInput: {
                backgroundColor: "#191a22",
                border: "1px solid #353743",
                color: "#f4f4f5"
            },

            formButtonPrimary: {
                backgroundColor: "#6366f1",
                color: "#ffffff",
                boxShadow: "none"
            },

            footer: {
                backgroundColor: "transparent"
            }
        }
    }

        });

        let signInMounted = false;
        let userButtonMounted = false;

        const render = () => {
    const signedIn = window.Clerk.isSignedIn;

    $('authView').hidden = signedIn;
    $('appView').hidden = !signedIn;

    if (signedIn) {
        if (!userButtonMounted) {
            window.Clerk.mountUserButton($('userButton'));
            userButtonMounted = true;
        }

        if (!appStarted) {
            appStarted = true;
            loadState().catch(notifyError);
        }
    } else {
        if (userButtonMounted) {
            window.Clerk.unmountUserButton($('userButton'));
            userButtonMounted = false;
        }

        appStarted = false;

        if (!signInMounted) {
            $('authMsg').hidden = true;
            window.Clerk.mountSignIn($('signIn'));
            signInMounted = true;
        }
    }
};

window.Clerk.addListener(render);
render();

        window.Clerk.addListener(() => {
            // Kijelentkezés után a legegyszerűbb tiszta lappal indulni
            if (appStarted && !window.Clerk.session) {
                location.reload();
                return;
            }
            render();
        });
        render();
    } catch (err) {
        $('authMsg').hidden = false;
        $('authMsg').textContent = 'Hiba az indításnál: ' + err.message;
    }
}

// Picit belenyult a ChatGPT
async function signOut() {
    try {
        await window.Clerk.signOut({
            redirectUrl: '/'
        });
    } catch (err) {
        notifyError(err);
    }
}

// ---------- Adatok betöltése ----------

async function loadState() {
    const data = await api('/api/state');
    teams = data.teams;
    tasks = data.tasks;
    scores = {};
    data.scores.forEach((s) => {
        scores[`${s.teamId}-${s.taskId}`] = s.score;
    });
    renderTeamsList();
    renderScoringTable();
    renderRankingTable();
}

function switchTab(index) {
    const tabs = document.querySelectorAll('.tab');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach((t) => t.classList.remove('active'));
    contents.forEach((c) => c.classList.remove('active'));

    tabs[index].classList.add('active');
    contents[index].classList.add('active');

    // Mások módosításai miatt fülváltáskor frissítünk
    loadState().catch(notifyError);
}

// ---------- Excel import ----------

async function handleFile(e) {
    const input = e.target;
    const file = input.files[0];
    if (!file) return;

    if (teams.length > 0 &&
        !confirm('Az import törli a meglévő csapatokat és a hozzájuk tartozó pontokat. Folytatod?')) {
        input.value = '';
        return;
    }

    try {
        const data = new Uint8Array(await file.arrayBuffer());
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet);

        const importedTeams = rows
            .map((row) => ({
                name: String(row['Csapatnév'] ?? row['Csapatnev'] ?? '').trim(),
                member1: String(row['Tag1'] ?? '').trim(),
                member2: String(row['Tag2'] ?? '').trim(),
                member3: String(row['Tag3'] ?? '').trim(),
                school: String(row['Iskola'] ?? '').trim()
            }))
            .filter((t) => t.name);

        if (importedTeams.length === 0) {
            showToast('Nem találtam csapatot a fájlban. Ellenőrizd az oszlopneveket!', 'error');
            return;
        }

        await api('/api/teams/import', {
            method: 'POST',
            body: JSON.stringify({ teams: importedTeams })
        });
        await loadState();
    } catch (err) {
        notifyError(err);
    } finally {
        input.value = '';
    }
}

// ---------- Jelenléti ív ----------

function renderTeamsList() {
    const container = $('teamsList');
    const summary = $('teamsSummary');

    if (teams.length === 0) {
        summary.innerHTML = '';
        container.innerHTML = '<div class="empty-state">Nincs még importált csapat. Tölts fel egy Excel fájlt!</div>';
        $('teamsNoResult').hidden = true;
        return;
    }

    const present = teams.filter((t) => t.presence === true).length;
    const absent = teams.filter((t) => t.presence === false).length;
    const unmarked = teams.length - present - absent;
    summary.innerHTML = `
        <span class="chip"><strong>${teams.length}</strong> csapat</span>
        <span class="chip ok"><strong>${present}</strong> jelen</span>
        <span class="chip bad"><strong>${absent}</strong> hiányzik</span>
        <span class="chip"><strong>${unmarked}</strong> jelöletlen</span>`;

    container.innerHTML = teams.map((team, idx) => {
        const members = [1, 2, 3].map((n) => {
            const current = team[`member${n}`];
            const original = team[`originalMember${n}`];
            const changed = current !== original;
            return `
                <label class="member">
                    <span class="member-label">${n}. tag</span>
                    <input type="text" class="field" value="${esc(current)}"
                           onchange="updateMember(${team.id}, ${n}, this.value)">
                    ${changed ? `<span class="member-note">Korábban: ${esc(original) || '(üres)'}</span>` : ''}
                </label>`;
        }).join('');

        const state = team.presence === true ? 'present' : team.presence === false ? 'absent' : '';
        const searchKey = norm([
            team.name, team.school,
            team.member1, team.member2, team.member3,
            team.originalMember1, team.originalMember2, team.originalMember3
        ].join(' '));

        return `
            <article class="team-card ${state}" data-search="${esc(searchKey)}">
                <div class="team-head">
                    <span class="team-index">${idx + 1}</span>
                    <div class="team-title">
                        <h3 class="team-name">${esc(team.name)}</h3>
                        <p class="team-school">${esc(team.school)}</p>
                    </div>
                    <div class="seg" role="group" aria-label="Jelenlét">
                        <button class="seg-btn ${team.presence === true ? 'on-present' : ''}"
                                onclick="setPresence(${team.id}, true)">Jelen</button>
                        <button class="seg-btn ${team.presence === false ? 'on-absent' : ''}"
                                onclick="setPresence(${team.id}, false)">Hiányzik</button>
                    </div>
                </div>
                <div class="members">${members}</div>
            </article>`;
    }).join('');

    filterTeams();
}

function filterTeams() {
    const q = norm(($('teamSearch').value || '').trim());
    const cards = [...document.querySelectorAll('#teamsList .team-card')];
    let visible = 0;
    cards.forEach((card) => {
        const match = q === '' || card.dataset.search.includes(q);
        card.hidden = !match;
        if (match) visible++;
    });
    $('teamsNoResult').hidden = !(cards.length > 0 && visible === 0);
}

function replaceTeam(updated) {
    const i = teams.findIndex((t) => t.id === updated.id);
    if (i !== -1) teams[i] = updated;
}

async function setPresence(teamId, value) {
    const team = teams.find((t) => t.id === teamId);
    // Ugyanarra kattintva a jelölés törlődik
    const next = team.presence === value ? null : value;
    try {
        replaceTeam(await api(`/api/teams/${teamId}`, {
            method: 'PATCH',
            body: JSON.stringify({ presence: next })
        }));
    } catch (err) {
        notifyError(err);
    }
    renderTeamsList();
}

async function updateMember(teamId, memberNum, value) {
    try {
        replaceTeam(await api(`/api/teams/${teamId}`, {
            method: 'PATCH',
            body: JSON.stringify({ [`member${memberNum}`]: value.trim() })
        }));
    } catch (err) {
        notifyError(err);
    }
    renderTeamsList();
}

// ---------- Cserék szövege ----------

function buildSwapText() {
    const lines = [];
    teams.forEach((team) => {
        [1, 2, 3].forEach((n) => {
            const before = team[`originalMember${n}`];
            const after = team[`member${n}`];
            if (before !== after) {
                lines.push(`${before || '(üres)'} → ${after || '(üres)'} (${team.name})`);
            }
        });
    });
    return lines.length > 0 ? lines.join('\n') : 'Nem történt csere.';
}

function openSwapModal() {
    $('swapText').value = buildSwapText();
    $('copyBtn').textContent = 'Másolás';
    $('swapModal').hidden = false;
}

function closeSwapModal() {
    $('swapModal').hidden = true;
}

async function copySwapText() {
    const textarea = $('swapText');
    try {
        await navigator.clipboard.writeText(textarea.value);
    } catch {
        textarea.select();
        document.execCommand('copy');
    }
    $('copyBtn').textContent = 'Kimásolva';
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSwapModal();
});

// ---------- Pontozás ----------

function toggleTaskForm() {
    const form = $('taskForm');
    form.hidden = !form.hidden;
    if (!form.hidden) $('taskName').focus();
}

async function addTask() {
    const name = $('taskName').value.trim();
    const maxScore = parseInt($('taskMaxScore').value, 10);

    if (!name || !maxScore || maxScore < 1) {
        showToast('Add meg a feladat nevét és a maximum pontszámot!', 'error');
        return;
    }

    try {
        const task = await api('/api/tasks', {
            method: 'POST',
            body: JSON.stringify({ name, maxScore })
        });
        tasks.push(task);
        $('taskName').value = '';
        $('taskMaxScore').value = '';
        $('taskForm').hidden = true;
        renderScoringTable();
    } catch (err) {
        notifyError(err);
    }
}

function renderScoringTable() {
    const container = $('scoringTable');

    if (teams.length === 0) {
        container.innerHTML = '<div class="empty-state">Először importálj csapatokat a Jelenléti ív fülön!</div>';
        return;
    }

    if (tasks.length === 0) {
        container.innerHTML = `<div class="empty-state">Nincs még feladat.<br>
            <button class="btn btn-primary empty-action" onclick="toggleTaskForm()">Feladat hozzáadása</button></div>`;
        return;
    }

    const maxTotal = tasks.reduce((sum, t) => sum + t.maxScore, 0);

    let html = '<div class="table-wrap scoring"><table class="score-table"><thead><tr><th class="sticky-col">Csapat</th>';
    tasks.forEach((task) => {
        html += `<th class="task-col" data-task="${task.id}">
                    <span class="task-name">${esc(task.name)}</span>
                    <span class="task-meta">max ${task.maxScore}</span>
                    <span class="task-meta col-progress"></span>
                 </th>`;
    });
    html += `<th class="total-col"><span class="task-name">Összesen</span><span class="task-meta">max ${maxTotal}</span></th></tr></thead><tbody>`;

    teams.forEach((team, idx) => {
        const searchText = esc(norm(`${team.name} ${team.school} ${team.member1} ${team.member2} ${team.member3}`));
        html += `<tr data-team="${team.id}" data-search="${searchText}" class="${team.presence === false ? 'is-absent' : ''}">
                    <td class="sticky-col">
                        <span class="row-index">${idx + 1}</span>
                        <span class="row-name">${esc(team.name)}</span>
                        ${team.presence === false ? '<span class="badge-absent">Hiányzik</span>' : ''}
                    </td>`;
        tasks.forEach((task) => {
            const value = scores[`${team.id}-${task.id}`];
            html += `<td class="task-col"><input type="number" inputmode="numeric" step="1" min="0" max="${task.maxScore}"
                        class="field score-input ${value !== undefined ? 'filled' : ''}" placeholder="–"
                        value="${value !== undefined ? value : ''}"
                        data-team="${team.id}" data-task="${task.id}" data-max="${task.maxScore}"
                        onfocus="this.select()" onkeydown="scoreKey(event)" onchange="updateScore(this)"></td>`;
        });
        html += `<td class="total-col">
                    <div class="total-cell"><span class="total-num">0</span><span class="total-of">/ ${maxTotal}</span></div>
                    <div class="bar"><span></span></div>
                 </td></tr>`;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
    refreshScoringSummary();
    filterScoringRows();
}

// Csak az összegeket és a számlálókat frissíti, a mezők (és a fókusz) érintetlenek maradnak
function refreshScoringSummary() {
    const maxTotal = tasks.reduce((sum, t) => sum + t.maxScore, 0);

    document.querySelectorAll('#scoringTable tr[data-team]').forEach((tr) => {
        const teamId = tr.dataset.team;
        let total = 0;
        tasks.forEach((task) => {
            total += scores[`${teamId}-${task.id}`] ?? 0;
        });
        tr.querySelector('.total-num').textContent = total;
        tr.querySelector('.bar > span').style.width = maxTotal ? `${Math.min(100, (total / maxTotal) * 100)}%` : '0%';
    });

    document.querySelectorAll('#scoringTable th[data-task]').forEach((th) => {
        const taskId = th.dataset.task;
        const done = teams.filter((t) => scores[`${t.id}-${taskId}`] !== undefined).length;
        const el = th.querySelector('.col-progress');
        el.textContent = `${done}/${teams.length} kitöltve`;
        el.classList.toggle('complete', done === teams.length);
    });
}

function filterScoringRows() {
    const q = norm(($('scoreSearch').value || '').trim());
    document.querySelectorAll('#scoringTable tr[data-team]').forEach((tr) => {
        tr.hidden = q !== '' && !tr.dataset.search.includes(q);
    });
}

function scoreKey(e) {
    if (!['Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();

    const input = e.target;
    const rows = [...document.querySelectorAll('#scoringTable tr[data-team]')].filter((tr) => !tr.hidden);
    const index = rows.indexOf(input.closest('tr'));
    const target = rows[index + (e.key === 'ArrowUp' ? -1 : 1)];

    if (target) {
        target.querySelector(`input[data-task="${input.dataset.task}"]`).focus();
    } else {
        input.blur();
    }
}

function flashSaved(input) {
    input.classList.remove('saved');
    void input.offsetWidth;
    input.classList.add('saved');
}

async function updateScore(input) {
    const teamId = Number(input.dataset.team);
    const taskId = Number(input.dataset.task);
    const max = Number(input.dataset.max);
    const key = `${teamId}-${taskId}`;
    const previous = scores[key];
    const raw = input.value.trim();

    let score = null;
    if (raw !== '') {
        score = Number(raw);
        if (!Number.isInteger(score) || score < 0 || score > max) {
            input.classList.add('invalid');
            setTimeout(() => input.classList.remove('invalid'), 1500);
            showToast(`A pont 0 és ${max} közötti egész szám lehet`, 'error');
            input.value = previous !== undefined ? previous : '';
            return;
        }
    }

    input.classList.toggle('filled', score !== null);
    if (score === (previous !== undefined ? previous : null)) return;

    try {
        await api('/api/scores', {
            method: 'PUT',
            body: JSON.stringify({ teamId, taskId, score })
        });
        if (score === null) delete scores[key];
        else scores[key] = score;
        flashSaved(input);
        refreshScoringSummary();
    } catch (err) {
        input.value = previous !== undefined ? previous : '';
        input.classList.toggle('filled', previous !== undefined);
        notifyError(err);
    }
}

// ---------- Helyezések ----------

function getRankings() {
    return teams.map((team) => {
        let total = 0;
        tasks.forEach((task) => {
            total += scores[`${team.id}-${task.id}`] || 0;
        });
        return { ...team, totalScore: total };
    }).sort((a, b) => b.totalScore - a.totalScore);
}

function buildPrintSheet() {
    const sheet = $('printBody');
    const date = new Date().toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' });
    const rankings = getRankings();

    if (rankings.length === 0) {
        sheet.innerHTML = '<p>Nincs megjeleníthető adat.</p>';
        return;
    }

    const maxTotal = tasks.reduce((sum, t) => sum + t.maxScore, 0);

    const podium = rankings.slice(0, 3).map((team, idx) => `
        <td class="p-pod-cell">
            <div class="p-pod p-pod-${idx + 1}">
                <div class="p-pod-rank">${idx + 1}.</div>
                <div class="p-pod-name">${esc(team.name)}</div>
                <div class="p-pod-school">${esc(team.school)}</div>
                <div class="p-pod-score"><strong>${team.totalScore}</strong> pont</div>
            </div>
        </td>`).join('');

    const rows = rankings.map((team, idx) => {
        const members = [team.member1, team.member2, team.member3].filter(Boolean).map(esc).join(' &middot; ');
        return `<tr>
                    <td class="p-rank"><span class="p-rank-num${idx < 3 ? ' top' : ''}">${idx + 1}</span></td>
                    <td class="p-team"><div class="p-team-name">${esc(team.name)}</div><div class="p-team-school">${esc(team.school)}</div></td>
                    <td class="p-members">${members}</td>
                    <td class="p-score">${team.totalScore}</td>
                </tr>`;
    }).join('');

    sheet.innerHTML = `
        <div class="p-header">
            <div class="p-kicker">Végleges helyezések</div>
            <h1>Angol verseny</h1>
            <div class="p-meta">
                <span>${esc(date)}</span>
                <span>${rankings.length} csapat${maxTotal ? ` &middot; elérhető maximum: ${maxTotal} pont` : ''}</span>
            </div>
        </div>
        <table class="p-podium"><tr>${podium}</tr></table>
        <table class="p-table">
            <thead>
                <tr><th class="p-rank">Helyezés</th><th>Csapat</th><th>Tagok</th><th class="p-score">Pont</th></tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>`;
}

function printRanking() {
    window.print();
}

// A böngésző saját nyomtatása (Ctrl+P) esetén is friss legyen a nézet, és szép legyen a PDF fájlneve
let originalTitle = document.title;
window.addEventListener('beforeprint', () => {
    originalTitle = document.title;
    document.title = 'Angol verseny - végleges helyezések';
    buildPrintSheet();
});
window.addEventListener('afterprint', () => {
    document.title = originalTitle;
});

function renderRankingTable() {
    const container = $('rankingTable');

    if (teams.length === 0) {
        container.innerHTML = '<div class="empty-state">Nincs még csapat az értékeléshez!</div>';
        return;
    }

    const rankings = getRankings();

    let html = '<div class="table-wrap"><table><thead><tr><th>Helyezés</th><th>Csapat</th><th>Iskola</th><th class="num">Összpontszám</th></tr></thead><tbody>';

    rankings.forEach((team, idx) => {
        const cls = idx < 3 ? ` rank-${idx + 1}` : '';
        html += `<tr>
                    <td><span class="rank${cls}">${idx + 1}</span></td>
                    <td><strong>${esc(team.name)}</strong></td>
                    <td>${esc(team.school)}</td>
                    <td class="num total-score">${team.totalScore}</td>
                </tr>`;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
}

['taskName', 'taskMaxScore'].forEach((id) => {
    $(id).addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addTask();
    });
});

initAuth();

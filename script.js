let teams = [];
let tasks = [];
let scores = {};
let supabaseClient = null;

function toggleDatabaseConfig() {
    const config = document.getElementById('dbConfig');
    config.classList.toggle('visible');
}

async function connectDatabase() {
    const url = document.getElementById('supabaseUrl').value.trim();
    const key = document.getElementById('supabaseKey').value.trim();

    if (!url || !key) {
        alert('Kérlek add meg a Supabase URL-t és a kulcsot!');
        return;
    }

    try {
        supabaseClient = supabase.createClient(url, key);
        const { data, error } = await supabaseClient.from('teams').select('count');

        if (error && error.code !== 'PGRST116') {
            throw error;
        }

        document.getElementById('dbStatus').textContent = '✓ Kapcsolódva';
        document.getElementById('dbStatus').classList.remove('disconnected');
        document.getElementById('dbStatus').classList.add('connected');

        await loadFromDatabase();
    } catch (err) {
        alert('Hiba a kapcsolódás során: ' + err.message);
        document.getElementById('dbStatus').textContent = '✗ Hiba';
    }
}

async function loadFromDatabase() {
    if (!supabaseClient) return;

    try {
        const { data: teamsData } = await supabaseClient
            .from('teams')
            .select('*')
            .order('id');

        if (teamsData) {
            teams = teamsData.map(t => ({
                ...t,
                originalMember1: t.original_member1 || t.member1,
                originalMember2: t.original_member2 || t.member2,
                originalMember3: t.original_member3 || t.member3
            }));
            renderTeamsList();
        }

        const { data: tasksData } = await supabaseClient
            .from('tasks')
            .select('*')
            .order('id');

        if (tasksData) {
            tasks = tasksData;
        }

        const { data: scoresData } = await supabaseClient
            .from('scores')
            .select('*');

        if (scoresData) {
            scores = {};
            scoresData.forEach(s => {
                scores[`${s.team_id}-${s.task_id}`] = s.score;
            });
        }
    } catch (err) {
        console.error('Adatbázis betöltési hiba:', err);
    }
}

async function saveTeamToDatabase(team) {
    if (!supabaseClient) return;

    try {
        const dbTeam = {
            id: team.id,
            name: team.name,
            member1: team.member1,
            member2: team.member2,
            member3: team.member3,
            original_member1: team.originalMember1,
            original_member2: team.originalMember2,
            original_member3: team.originalMember3,
            school: team.school,
            presence: team.presence
        };

        const { error } = await supabaseClient
            .from('teams')
            .upsert(dbTeam);

        if (error) throw error;
    } catch (err) {
        console.error('Mentési hiba:', err);
    }
}

async function saveTaskToDatabase(task) {
    if (!supabaseClient) return;

    try {
        const { error } = await supabaseClient
            .from('tasks')
            .upsert(task);

        if (error) throw error;
    } catch (err) {
        console.error('Feladat mentési hiba:', err);
    }
}

async function saveScoreToDatabase(teamId, taskId, score) {
    if (!supabaseClient) return;

    try {
        const { error } = await supabaseClient
            .from('scores')
            .upsert({
                team_id: teamId,
                task_id: taskId,
                score: score
            });

        if (error) throw error;
    } catch (err) {
        console.error('Pont mentési hiba:', err);
    }
}

function switchTab(index) {
    const tabs = document.querySelectorAll('.tab');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach(t => t.classList.remove('active'));
    contents.forEach(c => c.classList.remove('active'));

    tabs[index].classList.add('active');
    contents[index].classList.add('active');

    if (index === 1) renderScoringTable();
    if (index === 2) renderRankingTable();
}

function handleFile(e) {
    const file = e.target.files[0];
    const reader = new FileReader();

    reader.onload = function (e) {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet);

        teams = jsonData.map((row, idx) => ({
            id: idx + 1,
            name: row['Csapatnév'] || row['Csapatnev'] || '',
            member1: row['Tag1'] || '',
            member2: row['Tag2'] || '',
            member3: row['Tag3'] || '',
            originalMember1: row['Tag1'] || '',
            originalMember2: row['Tag2'] || '',
            originalMember3: row['Tag3'] || '',
            school: row['Iskola'] || '',
            presence: null
        }));

        renderTeamsList();

        if (supabaseClient) {
            teams.forEach(team => saveTeamToDatabase(team));
        }
    };

    reader.readAsArrayBuffer(file);
}

function renderTeamsList() {
    const container = document.getElementById('teamsList');
    if (teams.length === 0) {
        container.innerHTML = '<div class="empty-state">Nincs még importált csapat. Tölts fel egy Excel fájlt!</div>';
        return;
    }

    container.innerHTML = teams.map((team, idx) => {
        const member1Changed = team.member1 !== team.originalMember1;
        const member2Changed = team.member2 !== team.originalMember2;
        const member3Changed = team.member3 !== team.originalMember3;

        return `
                <div class="team-card ${team.presence === true ? 'present' : team.presence === false ? 'absent' : ''}">
                    <div class="team-number">${idx + 1}.</div>
                    <div class="team-content">
                        <div class="team-header">
                            <span class="team-name">${team.name}</span>
                            <button class="presence-btn ${team.presence === true ? 'present' : team.presence === false ? 'absent' : 'unmarked'}" 
                                    onclick="togglePresence(${team.id})">
                                ${team.presence === true ? '✓ Jelen' : team.presence === false ? '✗ Hiányzik' : 'Jelenlét?'}
                            </button>
                        </div>
                        <div class="team-info">
                            <div style="margin-bottom: 8px;">
                                <strong>Tagok:</strong><br>
                                <div class="member-row">
                                    <input type="text" class="member-input" value="${team.member1}" 
                                           onchange="updateMember(${team.id}, 1, this.value)">
                                    ${member1Changed ? `<span class="replacement-note">(${team.originalMember1} helyett)</span>` : ''}
                                </div>
                                <div class="member-row">
                                    <input type="text" class="member-input" value="${team.member2}" 
                                           onchange="updateMember(${team.id}, 2, this.value)">
                                    ${member2Changed ? `<span class="replacement-note">(${team.originalMember2} helyett)</span>` : ''}
                                </div>
                                <div class="member-row">
                                    <input type="text" class="member-input" value="${team.member3}" 
                                           onchange="updateMember(${team.id}, 3, this.value)">
                                    ${member3Changed ? `<span class="replacement-note">(${team.originalMember3} helyett)</span>` : ''}
                                </div>
                            </div>
                            <div><strong>Iskola:</strong> ${team.school}</div>
                        </div>
                    </div>
                </div>
            `}).join('');
}

function togglePresence(teamId) {
    const team = teams.find(t => t.id === teamId);
    if (team.presence === null) team.presence = true;
    else if (team.presence === true) team.presence = false;
    else team.presence = null;
    renderTeamsList();
    saveTeamToDatabase(team);
}

function updateMember(teamId, memberNum, value) {
    const team = teams.find(t => t.id === teamId);
    team[`member${memberNum}`] = value;
    renderTeamsList();
    saveTeamToDatabase(team);
}

function addTask() {
    const name = document.getElementById('taskName').value.trim();
    const maxScore = parseInt(document.getElementById('taskMaxScore').value);

    if (!name || !maxScore) {
        alert('Kérlek add meg a feladat nevét és a maximum pontszámot!');
        return;
    }

    const task = { id: Date.now(), name, maxScore };
    tasks.push(task);
    document.getElementById('taskName').value = '';
    document.getElementById('taskMaxScore').value = '';
    renderScoringTable();
    saveTaskToDatabase(task);
}

function renderScoringTable() {
    const container = document.getElementById('scoringTable');

    if (teams.length === 0) {
        container.innerHTML = '<div class="empty-state">Először importálj csapatokat a Jelenléti ív fülön!</div>';
        return;
    }

    if (tasks.length === 0) {
        container.innerHTML = '<div class="empty-state">Nincs még feladat. Add hozzá az első feladatot!</div>';
        return;
    }

    let html = '<table><thead><tr><th>Csapat</th>';
    tasks.forEach(task => {
        html += `<th>${task.name}<br><small>(max: ${task.maxScore})</small></th>`;
    });
    html += '<th>Összesen</th></tr></thead><tbody>';

    teams.forEach(team => {
        html += `<tr><td><strong>${team.name}</strong></td>`;
        let total = 0;
        tasks.forEach(task => {
            const key = `${team.id}-${task.id}`;
            const score = scores[key] || 0;
            total += score;
            html += `<td><input type="number" class="score-input" min="0" max="${task.maxScore}" 
                                       value="${score}" onchange="updateScore(${team.id}, ${task.id}, this.value)"></td>`;
        });
        html += `<td class="total-score">${total}</td></tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

function updateScore(teamId, taskId, value) {
    const key = `${teamId}-${taskId}`;
    scores[key] = parseInt(value) || 0;
    renderScoringTable();
    saveScoreToDatabase(teamId, taskId, scores[key]);
}

function renderRankingTable() {
    const container = document.getElementById('rankingTable');

    if (teams.length === 0) {
        container.innerHTML = '<div class="empty-state">Nincs még csapat az értékeléshez!</div>';
        return;
    }

    const rankings = teams.map(team => {
        let total = 0;
        tasks.forEach(task => {
            const key = `${team.id}-${task.id}`;
            total += scores[key] || 0;
        });
        return { ...team, totalScore: total };
    }).sort((a, b) => b.totalScore - a.totalScore);

    const medals = ['🥇', '🥈', '🥉'];

    let html = '<table class="ranking-table"><thead><tr><th>Helyezés</th><th>Csapat</th><th>Iskola</th><th>Összpontszám</th></tr></thead><tbody>';

    rankings.forEach((team, idx) => {
        const medal = idx < 3 ? `<span class="rank-medal">${medals[idx]}</span>` : '';
        html += `<tr>
                    <td>${medal}${idx + 1}.</td>
                    <td><strong>${team.name}</strong></td>
                    <td>${team.school}</td>
                    <td class="total-score">${team.totalScore}</td>
                </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}
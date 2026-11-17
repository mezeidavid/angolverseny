import { neon } from '@neondatabase/serverless';
import { createRemoteJWKSet, jwtVerify } from 'jose';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

// ---------- segédfüggvények ----------

const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

function int(v, name) {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new HttpError(400, `Érvénytelen érték: ${name}`);
  return n;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Érvénytelen JSON');
  }
}

// A Clerk publishable key base64-ben tartalmazza a Frontend API domaint ("xxx.clerk.accounts.dev$")
function clerkDomain(publishableKey) {
  const b64 = publishableKey.split('_').slice(2).join('_');
  return atob(b64).replace(/\$$/, '');
}

// ---------- Clerk hitelesítés (JWKS alapú, hálózati hívás a Clerk API-hoz nélkül) ----------

const jwksCache = new Map();

async function authenticate(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new HttpError(401, 'Bejelentkezés szükséges');

  const issuer = `https://${clerkDomain(env.CLERK_PUBLISHABLE_KEY)}`;
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    jwksCache.set(issuer, jwks);
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwks, { issuer, clockTolerance: 5 }));
  } catch {
    throw new HttpError(401, 'Érvénytelen vagy lejárt munkamenet');
  }

  if (env.ALLOWED_USER_IDS) {
    const allowed = env.ALLOWED_USER_IDS.split(',').map((s) => s.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(payload.sub)) {
      throw new HttpError(403, 'Nincs jogosultságod az alkalmazáshoz');
    }
  }
  return payload;
}

// ---------- API ----------

async function handleApi(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  if (!env.DATABASE_URL || !env.CLERK_PUBLISHABLE_KEY) {
    throw new HttpError(500, 'Hiányzó konfiguráció (DATABASE_URL vagy CLERK_PUBLISHABLE_KEY)');
  }

  // Nyilvános: a frontendnek erre van szüksége a Clerk betöltéséhez
  if (pathname === '/api/config' && method === 'GET') {
    return json({
      publishableKey: env.CLERK_PUBLISHABLE_KEY,
      frontendApi: clerkDomain(env.CLERK_PUBLISHABLE_KEY),
    });
  }

  await authenticate(request, env);
  const sql = neon(env.DATABASE_URL);

  // Teljes állapot
  if (pathname === '/api/state' && method === 'GET') {
    const [teams, tasks, scores] = await Promise.all([
      sql`SELECT id, name, school, member1, member2, member3,
                 original_member1 AS "originalMember1",
                 original_member2 AS "originalMember2",
                 original_member3 AS "originalMember3",
                 presence
          FROM teams ORDER BY id`,
      sql`SELECT id, name, max_score AS "maxScore" FROM tasks ORDER BY id`,
      sql`SELECT team_id AS "teamId", task_id AS "taskId", score FROM scores`,
    ]);
    return json({ teams, tasks, scores });
  }

  // Excel import: lecseréli a csapatokat (a pontok a csapatokkal együtt törlődnek)
  if (pathname === '/api/teams/import' && method === 'POST') {
    const body = await readJson(request);
    if (!Array.isArray(body.teams) || body.teams.length === 0 || body.teams.length > 500) {
      throw new HttpError(400, 'Hibás vagy üres csapatlista');
    }
    const clean = body.teams
      .map((t) => ({
        name: str(t.name),
        school: str(t.school),
        member1: str(t.member1),
        member2: str(t.member2),
        member3: str(t.member3),
      }))
      .filter((t) => t.name);
    if (clean.length === 0) throw new HttpError(400, 'Nincs érvényes csapatnév');

    const payload = JSON.stringify(clean);
    await sql.transaction([
      sql`DELETE FROM teams`,
      sql`INSERT INTO teams (name, school, member1, member2, member3,
                             original_member1, original_member2, original_member3)
          SELECT el->>'name', el->>'school',
                 el->>'member1', el->>'member2', el->>'member3',
                 el->>'member1', el->>'member2', el->>'member3'
          FROM jsonb_array_elements(${payload}::jsonb) WITH ORDINALITY AS x(el, ord)
          ORDER BY ord`,
    ]);
    return json({ ok: true, count: clean.length });
  }

  // Csapat módosítása: tagok és/vagy jelenlét
  const teamMatch = pathname.match(/^\/api\/teams\/(\d+)$/);
  if (teamMatch && method === 'PATCH') {
    const id = int(teamMatch[1], 'id');
    const body = await readJson(request);

    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
    const hasP = has('presence');
    if (hasP && body.presence !== null && typeof body.presence !== 'boolean') {
      throw new HttpError(400, 'Érvénytelen jelenlét érték');
    }
    const presence = hasP ? body.presence : null;
    const [h1, h2, h3] = [has('member1'), has('member2'), has('member3')];
    const [m1, m2, m3] = [str(body.member1), str(body.member2), str(body.member3)];

    const rows = await sql`
      UPDATE teams SET
        member1  = CASE WHEN ${h1}::boolean THEN ${m1}::text ELSE member1 END,
        member2  = CASE WHEN ${h2}::boolean THEN ${m2}::text ELSE member2 END,
        member3  = CASE WHEN ${h3}::boolean THEN ${m3}::text ELSE member3 END,
        presence = CASE WHEN ${hasP}::boolean THEN ${presence}::boolean ELSE presence END
      WHERE id = ${id}::int
      RETURNING id, name, school, member1, member2, member3,
                original_member1 AS "originalMember1",
                original_member2 AS "originalMember2",
                original_member3 AS "originalMember3",
                presence`;
    if (rows.length === 0) throw new HttpError(404, 'Nincs ilyen csapat');
    return json(rows[0]);
  }

  // Új feladat
  if (pathname === '/api/tasks' && method === 'POST') {
    const body = await readJson(request);
    const name = str(body.name, 100);
    const maxScore = int(body.maxScore, 'maxScore');
    if (!name || maxScore < 1 || maxScore > 100000) {
      throw new HttpError(400, 'Hibás feladatnév vagy maximum pontszám');
    }
    const rows = await sql`
      INSERT INTO tasks (name, max_score) VALUES (${name}, ${maxScore})
      RETURNING id, name, max_score AS "maxScore"`;
    return json(rows[0], 201);
  }

  // Pont mentése
  if (pathname === '/api/scores' && method === 'PUT') {
    const body = await readJson(request);
    const teamId = int(body.teamId, 'teamId');
    const taskId = int(body.taskId, 'taskId');

    // Üres mező: a pont törlése (még nincs értékelve)
    if (body.score === null) {
      await sql`DELETE FROM scores WHERE team_id = ${teamId}::int AND task_id = ${taskId}::int`;
      return json({ score: null });
    }

    const score = int(body.score, 'score');
    if (score < 0) throw new HttpError(400, 'A pont nem lehet negatív');

    const rows = await sql`
      INSERT INTO scores (team_id, task_id, score)
      SELECT ${teamId}::int, t.id, ${score}::int
      FROM tasks t
      WHERE t.id = ${taskId}::int
        AND ${score}::int <= t.max_score
        AND EXISTS (SELECT 1 FROM teams WHERE id = ${teamId}::int)
      ON CONFLICT (team_id, task_id) DO UPDATE SET score = EXCLUDED.score
      RETURNING score`;
    if (rows.length === 0) {
      throw new HttpError(400, 'A pont meghaladja a maximumot, vagy a csapat/feladat nem létezik');
    }
    return json(rows[0]);
  }

  throw new HttpError(404, 'Nincs ilyen végpont');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }
    try {
      return await handleApi(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Szerverhiba' }, 500);
    }
  },
};

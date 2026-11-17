# Angol Verseny Menedzser – Cloudflare Workers + Neon + Clerk

```
public/        statikus frontend (Workers Static Assets)
src/index.js   Worker: /api/* végpontok, Clerk JWT ellenőrzés, Neon lekérdezések
schema.sql     Neon adatbázis séma
```

## 1. Neon
1. Hozz létre egy projektet a [Neonon](https://neon.tech).
2. A **SQL Editorban** futtasd le a `schema.sql` tartalmát.
3. Másold ki a connection stringet (`postgresql://...`).

## 2. Clerk
1. Hozz létre egy alkalmazást a [Clerk Dashboardon](https://dashboard.clerk.com), válaszd ki a belépési módokat (pl. e-mail / Google).
2. **Fontos:** tiltsd le a szabad regisztrációt (a Dashboard „Restrictions” / sign-up beállításainál; a pontos menünév változhat), és a szervezőket meghívóval vedd fel. Különben bárki regisztrálhat és belép.
3. Másold ki a **Publishable key**-t (`pk_test_...`) a `wrangler.jsonc`-be (`CLERK_PUBLISHABLE_KEY`).
4. Extra védelem (opcionális): `ALLOWED_USER_IDS` a `wrangler.jsonc`-ben – a Worker ekkor csak ezeket a Clerk user ID-kat engedi be.

## 3. Telepítés
```bash
npm install @neondatabase/serverless jose
npm install -D wrangler
npx wrangler login
npx wrangler secret put DATABASE_URL     # ide a Neon connection string
npx wrangler deploy
```

## Helyi fejlesztés
Hozz létre egy `.dev.vars` fájlt (nem kerül gitbe):
```
DATABASE_URL=postgresql://...
```
majd `npx wrangler dev`.

## Megjegyzések
- A Clerk development kulccsal (`pk_test_`) workers.dev címen is működik. Éles (`pk_live_`) kulcshoz a Clerk saját domaint kér.
- Az Excel-import törli a meglévő csapatokat és a pontjaikat.
- Nincs élő szinkron: fülváltáskor frissül az adat mások módosításaival.
- A csereszöveg az eredeti (importált) és az aktuális tagnév különbségéből készül, ezért A→B→C csere esetén A → C lesz benne, visszacserélésnél pedig eltűnik.

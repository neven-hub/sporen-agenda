/**
 * Test van supabase/schema.sql in een echte (lokale) Postgres via PGlite.
 * Supabase wordt nagebootst: rollen anon/authenticated, auth.users, auth.uid()
 * en pgcrypto in het schema "extensions". Zo controleren we de toegangsregels
 * (RLS) en functies vóór ze in Supabase komen.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const schema = readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8');

const SUPABASE_NABOOTSING = `
  create schema if not exists extensions;
  create extension if not exists pgcrypto schema extensions;
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  create schema auth;
  create table auth.users (id uuid primary key, email text unique, encrypted_password text, updated_at timestamptz);
  create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

let db: PGlite;
let teller = 0;
const sleutel = (n: string) => JSON.stringify({ test: n });

/** Nieuwe gebruiker in auth.users, zoals Supabase bij signUp. */
async function gebruiker(naam: string, wachtwoord = 'wachtwoord-1'): Promise<string> {
  const id = `00000000-0000-4000-8000-${String(++teller).padStart(12, '0')}`;
  await db.query(`insert into auth.users (id, email, encrypted_password) values ($1, $2, extensions.crypt($3, extensions.gen_salt('bf')))`, [
    id,
    `${naam}@agenda.invalid`,
    wachtwoord,
  ]);
  return id;
}

/** Voer SQL uit als een aangemelde gebruiker (rol authenticated), of als anon (id null). */
async function als<T = Record<string, unknown>>(id: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${id ? 'authenticated' : 'anon'}`);
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [id ?? '']);
    const r = await db.query<T>(sql, params);
    await db.exec('commit');
    return r.rows;
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
}

const een = async <T = Record<string, unknown>>(id: string | null, sql: string, params: unknown[] = []) => (await als<T>(id, sql, params))[0];

async function ruimte(id: string, soort: string, eigenaar: string | null): Promise<string> {
  const r = await een<{ id: string }>(id, `insert into public.ruimtes (leefgroep_id, soort, eigenaar_id) values (public.mijn_leefgroep(), $1, $2) returning id`, [
    soort,
    eigenaar,
  ]);
  return r.id;
}

async function geefSleutel(door: string, ruimteId: string, aan: string) {
  await als(door, `insert into public.sleutels (ruimte_id, profiel_id, ingepakt) values ($1, $2, $3)`, [ruimteId, aan, sleutel('k')]);
}

async function afspraak(door: string, ruimteId: string): Promise<string> {
  return (await een<{ id: string }>(door, `insert into public.afspraken (ruimte_id, inhoud, bewaren_tot) values ($1, $2, '2027-07-01') returning id`, [ruimteId, sleutel('a')])).id;
}

const zichtbareAfspraken = async (id: string) => (await als<{ id: string }>(id, `select id from public.afspraken`)).map((r) => r.id);

// Personen en ruimtes, opgebouwd in beforeAll
let ro: string, an: string, jo: string, li: string;
let team: string, gedeeld: string, roPrive: string, joPrive: string, joBeg: string, liBeg: string;

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_NABOOTSING);
  await db.exec(schema);
  await db.exec(`insert into private.startcodes (code) values ('start-123')`);

  ro = await gebruiker('ro');
  await als(ro, `select public.start_leefgroep('Studio 3', 'start-123', 'Ro', $1, $1, 'zout')`, [sleutel('ro')]);
  team = await ruimte(ro, 'team', null);
  gedeeld = await ruimte(ro, 'gedeeld', null);
  roPrive = await ruimte(ro, 'prive', ro);
  for (const r of [team, gedeeld, roPrive]) await geefSleutel(ro, r, ro);

  const codes: Record<string, string> = {};
  for (const [n, rol, ini] of [
    ['an', 'begeleider', 'An'],
    ['jo', 'jongere', 'Jo'],
    ['li', 'jongere', 'Li'],
  ]) {
    codes[n] = (await een<{ code: string }>(ro, `select (public.maak_uitnodiging($1, $2)).code`, [rol, ini])).code;
  }
  an = await gebruiker('an');
  jo = await gebruiker('jo');
  li = await gebruiker('li');
  for (const [id, n] of [
    [an, 'an'],
    [jo, 'jo'],
    [li, 'li'],
  ]) {
    await als(id, `select public.gebruik_uitnodiging($1, $2, $2, 'zout')`, [codes[n], sleutel(n)]);
  }
  joPrive = await ruimte(jo, 'prive', jo);
  joBeg = await ruimte(jo, 'begeleiding', jo);
  await geefSleutel(jo, joPrive, jo);
  for (const aan of [jo, ro, an]) await geefSleutel(jo, joBeg, aan);
  liBeg = await ruimte(li, 'begeleiding', li);
  for (const aan of [li, ro, an]) await geefSleutel(li, liBeg, aan);
  // Ro geeft An het team en iedereen de gedeelde agenda
  await geefSleutel(ro, team, an);
  for (const aan of [an, jo, li]) await geefSleutel(ro, gedeeld, aan);
}, 60_000);

describe('schema.sql in Postgres', () => {
  it('start alleen een leefgroep met een geldige, ongebruikte startcode', async () => {
    const x = await gebruiker('x');
    await expect(als(x, `select public.start_leefgroep('X', 'start-123', 'X', '{}', '{}', 'z')`)).rejects.toThrow(/startcode/);
    await expect(als(x, `select public.start_leefgroep('X', 'fout', 'X', '{}', '{}', 'z')`)).rejects.toThrow(/startcode/);
  });

  it('een uitnodigingscode werkt één keer', async () => {
    const code = (await een<{ code: string }>(ro, `select (public.maak_uitnodiging('jongere', 'Ka')).code`)).code;
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const ka = await gebruiker('ka');
    await als(ka, `select public.gebruik_uitnodiging($1, '{}', '{}', 'z')`, [code]);
    const ka2 = await gebruiker('ka2');
    await expect(als(ka2, `select public.gebruik_uitnodiging($1, '{}', '{}', 'z')`, [code])).rejects.toThrow(/uitnodiging/);
  });

  it('een jongere kan geen uitnodiging maken en geen team- of gedeelde ruimte', async () => {
    await expect(als(jo, `select public.maak_uitnodiging('begeleider', 'Zz')`)).rejects.toThrow(/begeleiders/);
    await expect(ruimte(jo, 'team', null)).rejects.toThrow(/row-level security/);
    await expect(ruimte(jo, 'gedeeld', null)).rejects.toThrow(/row-level security/);
  });

  it('afspraak met begeleiding: zichtbaar voor de jongere en de begeleiders, niet voor andere jongeren', async () => {
    const a = await afspraak(jo, joBeg);
    expect(await zichtbareAfspraken(jo)).toContain(a);
    expect(await zichtbareAfspraken(ro)).toContain(a);
    expect(await zichtbareAfspraken(an)).toContain(a);
    expect(await zichtbareAfspraken(li)).not.toContain(a);
  });

  it('privé: alleen de eigenaar, en de sleutel kan niet gedeeld worden', async () => {
    const a = await afspraak(jo, joPrive);
    expect(await zichtbareAfspraken(jo)).toContain(a);
    expect(await zichtbareAfspraken(ro)).not.toContain(a);
    await expect(geefSleutel(jo, joPrive, ro)).rejects.toThrow(/row-level security/);
    await expect(afspraak(ro, joPrive)).rejects.toThrow(/row-level security/);
  });

  it('team: alleen begeleiders', async () => {
    const a = await afspraak(ro, team);
    expect(await zichtbareAfspraken(an)).toContain(a);
    expect(await zichtbareAfspraken(jo)).not.toContain(a);
    await expect(geefSleutel(ro, team, jo)).rejects.toThrow(/row-level security/); // jongere hoort niet bij team
  });

  it('gedeeld: iedereen', async () => {
    const a = await afspraak(ro, gedeeld);
    for (const p of [ro, an, jo, li]) expect(await zichtbareAfspraken(p)).toContain(a);
  });

  it('wie een sleutel niet heeft, kan hem ook niet aan zichzelf geven', async () => {
    await expect(geefSleutel(li, joBeg, li)).rejects.toThrow(/row-level security/);
  });

  it('versleutelde private sleutels van anderen zijn niet op te vragen', async () => {
    await expect(als(jo, `select prive_sleutel from public.profielen`)).rejects.toThrow(/permission denied/);
    const rijen = await als<{ initialen: string }>(jo, `select initialen from public.profielen order by initialen`);
    expect(rijen.map((r) => r.initialen)).toEqual(expect.arrayContaining(['An', 'Jo', 'Li', 'Ro']));
    const mijn = await een<{ prive_sleutel: unknown }>(jo, `select * from public.mijn_profiel()`);
    expect(mijn.prive_sleutel).toEqual({ test: 'jo' });
  });

  it('een jongere kan andermans afspraak niet wijzigen of verwijderen, een begeleider wel (behalve privé)', async () => {
    const a = await afspraak(li, gedeeld);
    const r1 = await als(jo, `update public.afspraken set inhoud = '{}' where id = $1 returning id`, [a]);
    expect(r1).toHaveLength(0);
    const r2 = await als(ro, `update public.afspraken set inhoud = '{}' where id = $1 returning id`, [a]);
    expect(r2).toHaveLength(1);
    const p = await afspraak(jo, joPrive);
    expect(await als(ro, `delete from public.afspraken where id = $1 returning id`, [p])).toHaveLength(0);
  });

  it('niet aangemeld (anon): geen gegevens en geen functies, behalve herstellen', async () => {
    expect(await als(null, `select * from public.afspraken`)).toHaveLength(0);
    expect(await als(null, `select id from public.profielen`).catch(() => [])).toHaveLength(0);
    await expect(als(null, `select public.maak_uitnodiging('jongere', 'Q')`)).rejects.toThrow(/permission denied/);
    await expect(als(null, `select * from public.mijn_profiel()`)).rejects.toThrow(/permission denied/);
    await expect(als(null, `select public.gebruik_herstelcode('BESTAAT-NIET', 'nieuw-wachtwoord', '{}', '{}', 'z')`)).rejects.toThrow(/herstelcode/);
  });

  it('wachtwoord vergeten: herstelcode van een begeleider, nieuw wachtwoord, oude sleutels en privé weg', async () => {
    await expect(als(li, `select public.maak_herstelcode($1)`, [jo])).rejects.toThrow(/begeleiders/);
    const code = (await een<{ code: string }>(ro, `select public.maak_herstelcode($1) as code`, [jo])).code;
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const naam = (await een<{ n: string }>(null, `select public.gebruik_herstelcode($1, 'nieuw-wachtwoord', $2, $2, 'z2') as n`, [code, sleutel('jo2')])).n;
    expect(naam).toBe('jo');
    const pw = await db.query(`select encrypted_password = extensions.crypt('nieuw-wachtwoord', encrypted_password) as ok from auth.users where id = $1`, [jo]);
    expect((pw.rows[0] as { ok: boolean }).ok).toBe(true);
    expect(await als(jo, `select * from public.sleutels`)).toHaveLength(0);
    expect(await als(ro, `select id from public.ruimtes where id = $1`, [joPrive])).toHaveLength(0);
    await expect(als(null, `select public.gebruik_herstelcode($1, 'nog-een-keer', '{}', '{}', 'z')`, [code])).rejects.toThrow(/herstelcode/);
    // Ro geeft Jo opnieuw toegang tot de begeleiding en de gedeelde agenda
    await als(ro, `insert into public.sleutels (ruimte_id, profiel_id, ingepakt) values ($1, $3, '{}'), ($2, $3, '{}')`, [joBeg, gedeeld, jo]);
    expect((await als(jo, `select ruimte_id from public.sleutels`)).length).toBe(2);
  });

  it('wachtwoord wijzigen controleert het huidige', async () => {
    await expect(als(li, `select public.wijzig_wachtwoord('fout', 'nieuw-wachtwoord', '{}', 'z')`)).rejects.toThrow(/huidig wachtwoord/);
    await als(li, `select public.wijzig_wachtwoord('wachtwoord-1', 'nieuw-wachtwoord', $1, 'z3')`, [sleutel('li2')]);
    const mijn = await een<{ zout: string }>(li, `select * from public.mijn_profiel()`);
    expect(mijn.zout).toBe('z3');
  });

  it('een lid verwijderen: alleen door een begeleider, eigen agenda weg, afspraken in gedeelde agenda blijven', async () => {
    const inGedeeld = await afspraak(li, gedeeld);
    const inEigen = await afspraak(li, liBeg);
    await expect(als(jo, `select public.verwijder_lid($1)`, [li])).rejects.toThrow(/begeleiders/);
    await expect(als(ro, `select public.verwijder_lid($1)`, [ro])).rejects.toThrow(/jezelf/);
    await als(ro, `select public.verwijder_lid($1)`, [li]);
    const zicht = await zichtbareAfspraken(ro);
    expect(zicht).toContain(inGedeeld);
    expect(zicht).not.toContain(inEigen);
    expect((await een<{ auteur_id: string | null }>(ro, `select auteur_id from public.afspraken where id = $1`, [inGedeeld])).auteur_id).toBeNull();
    expect(await db.query(`select 1 from auth.users where id = $1`, [li]).then((r) => r.rows.length)).toBe(0);
  });

  it('de begeleider die de leefgroep startte verwijderen, laat team en gedeeld bestaan', async () => {
    await als(an, `select public.verwijder_lid($1)`, [ro]);
    const r = await als<{ soort: string }>(an, `select soort from public.ruimtes where soort in ('team', 'gedeeld') order by soort`);
    expect(r.map((x) => x.soort)).toEqual(['gedeeld', 'team']);
  });

  it('opruimen na de bewaartermijn', async () => {
    await db.query(`update public.afspraken set bewaren_tot = current_date - 1 where ruimte_id = $1`, [gedeeld]);
    await db.exec(`select public.ruim_op()`);
    expect((await db.query(`select 1 from public.afspraken where ruimte_id = $1`, [gedeeld])).rows).toHaveLength(0);
    await expect(als(an, `select public.ruim_op()`)).rejects.toThrow(/permission denied/);
  });
});

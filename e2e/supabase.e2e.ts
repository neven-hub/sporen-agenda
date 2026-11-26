/**
 * Volledige test tegen het echte Supabase-project, met de echte app-logica.
 * Start een testleefgroep met een eenmalige startcode, en ruimt daarna zoveel
 * mogelijk op (de testbegeleider en de testleefgroep blijven; zie README).
 *
 * Gebruik: E2E_STARTCODE=... pnpm test:e2e
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseOpslag } from '../src/opslag/supabase';
import { Sessie } from '../src/kluis/sessie';
import type { AfspraakInhoud } from '../src/kluis/model';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const sleutel = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const startcode = process.env.E2E_STARTCODE ?? '';
const tag = `rt${Date.now().toString(36)}`;
const ww = `Test-${crypto.randomUUID()}`;
const opslag = () => new SupabaseOpslag(url, sleutel);
const a = (titel: string): AfspraakInhoud => ({ titel, datum: '2026-12-03', van: '19:00', tot: '20:00', plaats: '', notitie: '' });
const meld = (n: string, w = ww) => Sessie.meldAan(opslag(), `${tag}-${n}`, w);

let roId = '';

beforeAll(async () => {
  if (!url || !sleutel || !startcode) throw new Error('VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY en E2E_STARTCODE zijn nodig.');
  const ro = await Sessie.startLeefgroep(opslag(), `${tag}-ro`, ww, `Rooktest ${tag}`, 'Ro', startcode);
  roId = ro.profiel.id;
  const codes = { an: await ro.nodigUit('begeleider', 'An'), jo: await ro.nodigUit('jongere', 'Jo'), li: await ro.nodigUit('jongere', 'Li') };
  await ro.meldAf();
  for (const [n, c] of Object.entries(codes)) await (await Sessie.registreerMetCode(opslag(), `${tag}-${n}`, ww, c.code)).meldAf();
  const ro2 = await meld('ro');
  await ro2.geefToegang(await ro2.ontbrekendeToegang());
  await ro2.meldAf();
});

afterAll(async () => {
  try {
    const ro = await meld('ro');
    for (const p of ro.profielen.filter((x) => x.id !== roId)) await ro.verwijderLid(p.id);
    for (const af of await ro.afspraken()) await ro.verwijder(af.id);
    await ro.meldAf();
  } catch (e) {
    console.warn('Opruimen niet volledig gelukt:', e);
  }
  console.log(`\nTestleefgroep "Rooktest ${tag}" en account ${tag}-ro blijven over (zie README om op te ruimen).`);
});

describe('echte Supabase', () => {
  it('jongere → begeleiding: begeleiders zien het, andere jongeren niet', async () => {
    const jo = await meld('jo');
    await jo.bewaar(a('Tandarts e2e'), jo.ruimte('begeleiding', jo.profiel.id)!.id);
    await jo.meldAf();
    const titels = async (n: string) => {
      const s = await meld(n);
      const t = (await s.afspraken()).map((x) => x.titel);
      await s.meldAf();
      return t;
    };
    expect(await titels('ro')).toContain('Tandarts e2e');
    expect(await titels('an')).toContain('Tandarts e2e');
    expect(await titels('li')).not.toContain('Tandarts e2e');
  });

  it('privé: alleen de jongere zelf', async () => {
    const jo = await meld('jo');
    await jo.bewaar(a('Privé e2e'), jo.ruimte('prive', jo.profiel.id)!.id);
    await jo.meldAf();
    const ro = await meld('ro');
    expect((await ro.afspraken()).map((x) => x.titel)).not.toContain('Privé e2e');
    await ro.meldAf();
  });

  it('bewonersvergadering in gedeeld: iedereen', async () => {
    const ro = await meld('ro');
    await ro.bewaar(a('Bewonersvergadering e2e'), ro.ruimte('gedeeld')!.id);
    await ro.meldAf();
    for (const n of ['an', 'jo', 'li']) {
      const s = await meld(n);
      expect((await s.afspraken()).map((x) => x.titel)).toContain('Bewonersvergadering e2e');
      await s.meldAf();
    }
  });

  it('de database bevat geen leesbare titels', async () => {
    const jo = await meld('jo');
    const rijen = await jo.opslag.afspraken(jo.ruimtes.map((r) => r.id));
    expect(rijen.length).toBeGreaterThan(0);
    expect(JSON.stringify(rijen)).not.toMatch(/Tandarts|Privé|Bewonersvergadering/);
    await jo.meldAf();
  });

  it('wachtwoord vergeten met herstelcode, daarna toegang terug', async () => {
    const ro = await meld('ro');
    const li = ro.jongeren().find((j) => j.initialen === 'Li')!;
    const code = await ro.herstelcode(li.id);
    await ro.meldAf();
    const nieuw = `Nieuw-${crypto.randomUUID()}`;
    await (await Sessie.herstel(opslag(), code, nieuw)).meldAf();
    await expect(meld('li')).rejects.toThrow();
    const ro2 = await meld('ro');
    await ro2.geefToegang(await ro2.ontbrekendeToegang());
    await ro2.meldAf();
    const li2 = await meld('li', nieuw);
    expect((await li2.afspraken()).map((x) => x.titel)).toContain('Bewonersvergadering e2e');
    await li2.meldAf();
  });

  it('wachtwoord wijzigen', async () => {
    const an = await meld('an');
    const nieuw = `Ander-${crypto.randomUUID()}`;
    await an.wijzigWachtwoord(ww, nieuw);
    await an.meldAf();
    await expect(meld('an')).rejects.toThrow();
    const an2 = await meld('an', nieuw);
    await an2.wijzigWachtwoord(nieuw, ww); // terugzetten voor het opruimen
    await an2.meldAf();
  });

  it('jongere verwijderen: weg, sleutels vernieuwd, de rest leest nog', async () => {
    const ro = await meld('ro');
    const jo = ro.jongeren().find((j) => j.initialen === 'Jo')!;
    await ro.verwijderLid(jo.id);
    expect(ro.profielen.some((p) => p.id === jo.id)).toBe(false);
    await ro.meldAf();
    await expect(meld('jo')).rejects.toThrow();
    const an = await meld('an');
    expect((await an.afspraken()).map((x) => x.titel)).toContain('Bewonersvergadering e2e');
    await an.meldAf();
  });
});

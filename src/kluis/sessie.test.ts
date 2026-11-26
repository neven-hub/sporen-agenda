import { beforeAll, describe, expect, it } from 'vitest';
import { DemoOpslag, geheugenBewaarder } from '../opslag/demo';
import { Sessie } from './sessie';
import { bewarenTot, type AfspraakInhoud } from './model';
import { nieuweRuimteSleutel, ontsleutelJson, versleutelJson } from './crypto';

const afspraak = (titel: string, datum = '2026-12-03'): AfspraakInhoud => ({
  titel,
  datum,
  van: '14:00',
  tot: '15:00',
  plaats: '',
  notitie: '',
});

beforeAll(() => {
  Sessie.iteraties = 1000; // snel in tests; in de app 600 000
});

/** Leefgroep met begeleider Ro, jongeren Jo en Li, en een tweede begeleider An. */
async function opzet() {
  const opslag = new DemoOpslag(geheugenBewaarder());
  const ro = await Sessie.startLeefgroep(opslag, 'ro', 'ww-ro', 'Studio 3', 'Ro');
  const cJo = await ro.nodigUit('jongere', 'Jo');
  const cLi = await ro.nodigUit('jongere', 'Li');
  const cAn = await ro.nodigUit('begeleider', 'An');
  await ro.meldAf();
  for (const [naam, c] of [
    ['jo', cJo],
    ['li', cLi],
    ['an', cAn],
  ] as const) {
    const s = await Sessie.registreerMetCode(opslag, naam, `ww-${naam}`, c.code);
    await s.meldAf();
  }
  // Ro geeft de nieuwe leden toegang tot wat ze missen.
  const ro2 = await Sessie.meldAan(opslag, 'ro', 'ww-ro');
  await ro2.geefToegang(await ro2.ontbrekendeToegang());
  await ro2.meldAf();
  const meld = (n: string) => Sessie.meldAan(opslag, n, `ww-${n}`);
  return { opslag, meld };
}

describe('versleuteling', () => {
  it('ontsleutelt wat versleuteld is, en niet met een andere sleutel', async () => {
    const k1 = await nieuweRuimteSleutel();
    const k2 = await nieuweRuimteSleutel();
    const p = await versleutelJson(k1, { a: 1 });
    expect(await ontsleutelJson(k1, p)).toEqual({ a: 1 });
    await expect(ontsleutelJson(k2, p)).rejects.toThrow();
  });

  it('bewaart afspraken onleesbaar in de opslag', async () => {
    const { opslag, meld } = await opzet();
    const jo = await meld('jo');
    await jo.bewaar(afspraak('Tandarts geheim-woord'), jo.ruimte('begeleiding', jo.profiel.id)!.id);
    expect(JSON.stringify((opslag as unknown as { t: unknown }).t)).not.toContain('geheim-woord');
  });
});

describe('wie ziet wat', () => {
  it('een afspraak van een jongere is standaard zichtbaar voor begeleiders, niet voor andere jongeren', async () => {
    const { meld } = await opzet();
    const jo = await meld('jo');
    await jo.bewaar(afspraak('Dokter'), jo.ruimte('begeleiding', jo.profiel.id)!.id);
    await jo.meldAf();

    const titels = async (n: string) => (await (await meld(n)).afspraken()).map((a) => a.titel);
    expect(await titels('jo')).toContain('Dokter');
    expect(await titels('ro')).toContain('Dokter');
    expect(await titels('an')).toContain('Dokter');
    expect(await titels('li')).not.toContain('Dokter');
  });

  it('privé ziet alleen de jongere zelf, ook de begeleiders niet', async () => {
    const { meld } = await opzet();
    const jo = await meld('jo');
    await jo.bewaar(afspraak('Iets van mij'), jo.ruimte('prive', jo.profiel.id)!.id);
    await jo.meldAf();
    const titels = async (n: string) => (await (await meld(n)).afspraken()).map((a) => a.titel);
    expect(await titels('jo')).toContain('Iets van mij');
    expect(await titels('ro')).not.toContain('Iets van mij');
    expect(await titels('li')).not.toContain('Iets van mij');
  });

  it('een bewonersvergadering in de gedeelde agenda ziet iedereen', async () => {
    const { meld } = await opzet();
    const ro = await meld('ro');
    await ro.bewaar(afspraak('Bewonersvergadering'), ro.ruimte('gedeeld')!.id);
    await ro.meldAf();
    for (const n of ['ro', 'an', 'jo', 'li']) {
      expect((await (await meld(n)).afspraken()).map((a) => a.titel)).toContain('Bewonersvergadering');
    }
  });

  it('teamafspraken zien alleen begeleiders', async () => {
    const { meld } = await opzet();
    const ro = await meld('ro');
    await ro.bewaar(afspraak('Teamoverleg'), ro.ruimte('team')!.id);
    await ro.meldAf();
    expect((await (await meld('an')).afspraken()).map((a) => a.titel)).toContain('Teamoverleg');
    expect((await (await meld('jo')).afspraken()).map((a) => a.titel)).not.toContain('Teamoverleg');
  });

  it('een jongere kan een privé-ruimte niet met anderen delen', async () => {
    const { opslag, meld } = await opzet();
    const jo = await meld('jo');
    const ro = jo.profielen.find((p) => p.initialen === 'Ro')!;
    await expect(jo.geefToegang([{ profiel: ro, ruimte: jo.ruimte('prive', jo.profiel.id)! }])).rejects.toThrow(/privé/);
    void opslag;
  });

  it('een nieuwe jongere wacht op toegang tot de gedeelde agenda tot een begeleider die geeft', async () => {
    const { meld, opslag } = await opzet();
    const ro = await meld('ro');
    const c = await ro.nodigUit('jongere', 'Sa');
    await ro.meldAf();
    const sa = await Sessie.registreerMetCode(opslag, 'sa', 'ww-sa', c.code);
    expect(sa.heeftToegang(sa.ruimte('gedeeld')!.id)).toBe(false);
    await sa.meldAf();
    const ro2 = await meld('ro');
    const ontbreekt = await ro2.ontbrekendeToegang();
    expect(ontbreekt.map((o) => `${o.profiel.initialen}:${o.ruimte.soort}`)).toEqual(['Sa:gedeeld']);
    await ro2.geefToegang(ontbreekt);
    await ro2.meldAf();
    const sa2 = await meld('sa');
    expect(sa2.heeftToegang(sa2.ruimte('gedeeld')!.id)).toBe(true);
  });

  it('een uitnodigingscode werkt maar één keer', async () => {
    const { meld, opslag } = await opzet();
    const ro = await meld('ro');
    const c = await ro.nodigUit('jongere', 'Ka');
    await ro.meldAf();
    await (await Sessie.registreerMetCode(opslag, 'ka', 'ww-ka', c.code)).meldAf();
    await expect(Sessie.registreerMetCode(opslag, 'ka2', 'ww', c.code)).rejects.toThrow(/al gebruikt/);
  });

  it('een fout wachtwoord opent niets', async () => {
    const { meld, opslag } = await opzet();
    void meld;
    await expect(Sessie.meldAan(opslag, 'jo', 'fout')).rejects.toThrow();
  });
});

describe('bewaartermijn', () => {
  it('rekent zes maanden na de maand van de afspraak', () => {
    expect(bewarenTot('2026-12-03')).toBe('2027-07-01');
    expect(bewarenTot('2026-01-31')).toBe('2026-08-01');
  });
});

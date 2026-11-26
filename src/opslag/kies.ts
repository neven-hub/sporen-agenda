import { Sessie } from '../kluis/sessie';
import { maandagVan, plusDagen, vandaag } from '../datum';
import { browserBewaarder, DemoOpslag } from './demo';
import type { Opslag } from './opslag';
import { SupabaseOpslag } from './supabase';

export const DEMO_WACHTWOORD = 'demo1234';
export const DEMO_GEBRUIKERS = [
  { naam: 'ro', label: 'Ro', rol: 'begeleider' },
  { naam: 'an', label: 'An', rol: 'begeleider' },
  { naam: 'jo', label: 'Jo', rol: 'jongere' },
  { naam: 'li', label: 'Li', rol: 'jongere' },
] as const;

/** Supabase als de twee waarden bij het bouwen zijn meegegeven, anders demo. */
export function kiesOpslag(): Opslag {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const sleutel = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (url && sleutel) return new SupabaseOpslag(url, sleutel);
  // In de demo minder rekenwerk bij het aanmelden; echte accounts gebruiken 600 000.
  Sessie.iteraties = 50_000;
  return new DemoOpslag(browserBewaarder());
}

/** Vult de demo met een verzonnen leefgroep. Alle namen zijn verzonnen initialen. */
export async function vulDemo(opslag: DemoOpslag): Promise<void> {
  opslag.wis();
  const ma = maandagVan(vandaag());
  const dag = (n: number) => plusDagen(ma, n);
  const a = (titel: string, datum: string, van = '', tot = '', plaats = '', notitie = '') => ({ titel, datum, van, tot, plaats, notitie });

  const ro = await Sessie.startLeefgroep(opslag, 'ro', DEMO_WACHTWOORD, 'Studio 3 (demo)', 'Ro');
  const codes = {
    an: await ro.nodigUit('begeleider', 'An'),
    jo: await ro.nodigUit('jongere', 'Jo'),
    li: await ro.nodigUit('jongere', 'Li'),
  };
  await ro.meldAf();
  for (const [naam, c] of Object.entries(codes)) {
    await (await Sessie.registreerMetCode(opslag, naam, DEMO_WACHTWOORD, c.code)).meldAf();
  }
  const ro2 = await Sessie.meldAan(opslag, 'ro', DEMO_WACHTWOORD);
  await ro2.geefToegang(await ro2.ontbrekendeToegang());
  await ro2.laad();
  const jo = ro2.jongeren().find((j) => j.initialen === 'Jo')!;
  const li = ro2.jongeren().find((j) => j.initialen === 'Li')!;
  await ro2.bewaar(a('Bewonersvergadering', dag(3), '19:00', '20:00', 'Living', 'Agenda: huisregels, uitstap voorjaar'), ro2.ruimte('gedeeld')!.id);
  await ro2.bewaar(a('JOVO teamoverleg', dag(1), '11:00', '13:00'), ro2.ruimte('team')!.id);
  await ro2.bewaar(a('Gesprek met consulent', dag(2), '10:00', '11:00', '', 'Ro gaat mee'), ro2.ruimte('begeleiding', li.id)!.id);
  await ro2.bewaar(a('Kerstfeestje leefgroep', dag(11), '17:00', '21:00', 'Living'), ro2.ruimte('gedeeld')!.id);
  await ro2.meldAf();

  const sJo = await Sessie.meldAan(opslag, 'jo', DEMO_WACHTWOORD);
  await sJo.bewaar(a('Tandarts', dag(1), '15:30', '16:00', 'Centrum'), sJo.ruimte('begeleiding', jo.id)!.id);
  await sJo.bewaar(a('Examen wiskunde', dag(4), '08:30', '10:30', 'School'), sJo.ruimte('begeleiding', jo.id)!.id);
  await sJo.bewaar(a('Verjaardag van een vriend', dag(5), '', '', '', 'Alleen voor mij'), sJo.ruimte('prive', jo.id)!.id);
  await sJo.meldAf();

  const sLi = await Sessie.meldAan(opslag, 'li', DEMO_WACHTWOORD);
  await sLi.bewaar(a('Huisarts', dag(0), '09:00', '09:15'), sLi.ruimte('begeleiding', li.id)!.id);
  await sLi.bewaar(a('Werken (studentenjob)', dag(5), '13:00', '18:00'), sLi.ruimte('begeleiding', li.id)!.id);
  await sLi.meldAf();
}

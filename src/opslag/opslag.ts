import type { AfspraakRij, Leefgroep, Profiel, Rol, Ruimte, SleutelRij, Uitnodiging } from '../kluis/model';

/** Een nieuw profiel zonder id en leefgroep: die bepaalt de opslag. */
export type NieuwProfiel = Omit<Profiel, 'id' | 'leefgroepId'>;
export type NieuwProfielMetCode = Omit<Profiel, 'id' | 'leefgroepId' | 'rol' | 'initialen'>;

/**
 * Alles wat de app van de opslag nodig heeft. Twee uitvoeringen:
 * - demo:     alles in deze browser (localStorage), voor tonen en testen
 * - supabase: logins en tabellen in Supabase (Frankfurt), met toegangsregels (RLS)
 *
 * De opslag ziet nooit leesbare afspraken: die komen versleuteld binnen.
 */
export interface Opslag {
  readonly modus: 'demo' | 'supabase';

  registreer(gebruikersnaam: string, wachtwoord: string): Promise<string>;
  meldAan(gebruikersnaam: string, wachtwoord: string): Promise<string>;
  meldAf(): Promise<void>;

  /** Maakt een leefgroep met de aanmelder als eerste begeleider. */
  /** startcode: geheime code die de beheerder in Supabase zet (in de demo niet nodig). */
  startLeefgroep(naam: string, profiel: NieuwProfiel, startcode: string): Promise<{ leefgroep: Leefgroep; profiel: Profiel }>;
  /** Gebruikt een uitnodigingscode (eenmalig): maakt het profiel met de rol en initialen uit de code. */
  gebruikUitnodiging(code: string, profiel: NieuwProfielMetCode): Promise<Profiel>;
  maakUitnodiging(leefgroepId: string, rol: Rol, initialen: string): Promise<Uitnodiging>;
  openUitnodigingen(leefgroepId: string): Promise<Uitnodiging[]>;
  trekUitnodigingIn(code: string): Promise<void>;

  mijnProfiel(): Promise<Profiel | null>;
  leefgroep(id: string): Promise<Leefgroep>;
  profielen(leefgroepId: string): Promise<Profiel[]>;
  ruimtes(leefgroepId: string): Promise<Ruimte[]>;
  maakRuimte(r: Omit<Ruimte, 'id'>): Promise<Ruimte>;

  /** Mijn ingepakte sleutels. */
  mijnSleutels(): Promise<SleutelRij[]>;
  /** Wie heeft welke sleutel (zonder inhoud), om ontbrekende toegang te vinden. */
  sleutelLeden(leefgroepId: string): Promise<{ ruimteId: string; profielId: string }[]>;
  zetSleutel(rij: SleutelRij): Promise<void>;

  afspraken(ruimteIds: string[]): Promise<AfspraakRij[]>;
  bewaarAfspraak(rij: Omit<AfspraakRij, 'id'> & { id?: string }): Promise<AfspraakRij>;
  verwijderAfspraak(id: string): Promise<void>;
}

export class OpslagFout extends Error {}

/** Leesbare uitnodigingscode zonder verwarrende tekens (geen 0/O, 1/I/L). */
export function nieuweCode(): string {
  const tekens = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const b = crypto.getRandomValues(new Uint8Array(8));
  let s = '';
  for (let i = 0; i < b.length; i++) s += tekens[b[i] % tekens.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function normaliseerNaam(n: string): string {
  return n.trim().toLowerCase();
}

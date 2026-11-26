import type { IngepakteSleutel, Pakket } from './crypto';

export type Rol = 'begeleider' | 'jongere';

/**
 * Soorten ruimtes (wie kan lezen):
 * - prive:       alleen de eigenaar
 * - begeleiding: één jongere + alle begeleiders van de leefgroep
 * - team:        alle begeleiders
 * - gedeeld:     iedereen van de leefgroep (bv. bewonersvergadering)
 */
export type RuimteSoort = 'prive' | 'begeleiding' | 'team' | 'gedeeld';

export interface Leefgroep {
  id: string;
  naam: string;
}

/** Wat in de tabel "profielen" staat. Alleen pseudoniemen (initialen). */
export interface Profiel {
  id: string;
  leefgroepId: string;
  initialen: string;
  rol: Rol;
  publiekeSleutel: JsonWebKey;
  /** Private sleutel, versleuteld met de wachtwoordsleutel */
  priveSleutel: Pakket;
  /** base64, zout voor PBKDF2 */
  zout: string;
}

export interface Ruimte {
  id: string;
  leefgroepId: string;
  soort: RuimteSoort;
  /** Bij prive en begeleiding: de persoon van wie de ruimte is */
  eigenaarId: string | null;
}

export interface SleutelRij {
  ruimteId: string;
  profielId: string;
  ingepakt: IngepakteSleutel;
}

/** Zoals de afspraak in de opslag staat: alles behalve de ruimte is versleuteld. */
export interface AfspraakRij {
  id: string;
  ruimteId: string;
  auteurId: string;
  inhoud: Pakket;
  /** Grove datum (eerste dag van de maand na het einde + bewaartermijn), voor het automatisch opruimen. */
  bewarenTot: string;
}

/** Wat versleuteld in een afspraak zit. */
export interface AfspraakInhoud {
  titel: string;
  /** YYYY-MM-DD */
  datum: string;
  /** HH:MM, leeg bij hele dag */
  van: string;
  tot: string;
  plaats: string;
  notitie: string;
}

export interface Uitnodiging {
  code: string;
  leefgroepId: string;
  rol: Rol;
  initialen: string;
}

/** Een afspraak zoals de app hem toont. */
export interface Afspraak extends AfspraakInhoud {
  id: string;
  ruimte: Ruimte;
  auteur: Profiel | undefined;
}

export const BEWAARTERMIJN_MAANDEN = 6;

export function bewarenTot(datum: string, maanden = BEWAARTERMIJN_MAANDEN): string {
  const [j, m] = datum.split('-').map(Number);
  const totaal = j * 12 + (m - 1) + 1 + maanden; // eerste dag van de maand ná de afspraak, plus de termijn
  const jj = Math.floor(totaal / 12);
  const mm = (totaal % 12) + 1;
  return `${jj}-${String(mm).padStart(2, '0')}-01`;
}

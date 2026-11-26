/** Datums als 'YYYY-MM-DD' in lokale tijd (geen tijdzone-verrassingen). */

export function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function uitIso(s: string): Date {
  const [j, m, d] = s.split('-').map(Number);
  return new Date(j, m - 1, d);
}

export function plusDagen(s: string, n: number): string {
  const d = uitIso(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}

export function maandagVan(s: string): string {
  const d = uitIso(s);
  const dag = (d.getDay() + 6) % 7; // maandag = 0
  d.setDate(d.getDate() - dag);
  return iso(d);
}

export function vandaag(): string {
  return iso(new Date());
}

const dagen = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const maanden = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

export function dagLabel(s: string): string {
  const d = uitIso(s);
  return `${dagen[d.getDay()]} ${d.getDate()} ${maanden[d.getMonth()]}`;
}

export function kortLabel(s: string): string {
  const d = uitIso(s);
  return `${d.getDate()} ${maanden[d.getMonth()].slice(0, 3)}`;
}

export function eersteVanMaand(s: string): string {
  return `${s.slice(0, 7)}-01`;
}

export function plusMaanden(s: string, n: number): string {
  const d = uitIso(eersteVanMaand(s));
  d.setMonth(d.getMonth() + n);
  return iso(d);
}

export function maandLabel(s: string): string {
  const d = uitIso(s);
  return `${maanden[d.getMonth()]} ${d.getFullYear()}`;
}

/** Alle dagen van de maandkalender: van de maandag vóór de 1e tot de zondag na de laatste. */
export function maandRaster(s: string): string[] {
  const eerste = eersteVanMaand(s);
  const volgende = plusMaanden(eerste, 1);
  const start = maandagVan(eerste);
  const dagen: string[] = [];
  for (let d = start; d < volgende || dagen.length % 7 !== 0; d = plusDagen(d, 1)) dagen.push(d);
  return dagen;
}

export const dagKort = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

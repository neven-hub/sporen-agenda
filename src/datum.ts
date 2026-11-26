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

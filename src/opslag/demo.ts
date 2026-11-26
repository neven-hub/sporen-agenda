import type { AfspraakRij, Leefgroep, Profiel, Rol, Ruimte, SleutelRij, Uitnodiging } from '../kluis/model';
import { naarBase64 } from '../kluis/crypto';
import { nieuweCode, normaliseerNaam, OpslagFout, type NieuwProfiel, type NieuwProfielMetCode, type Opslag } from './opslag';

const DAG = 24 * 60 * 60 * 1000;

interface Tabellen {
  gebruikers: { id: string; naam: string; hash: string }[];
  leefgroepen: Leefgroep[];
  profielen: Profiel[];
  ruimtes: Ruimte[];
  sleutels: SleutelRij[];
  afspraken: AfspraakRij[];
  uitnodigingen: Uitnodiging[];
  herstelcodes?: { code: string; profielId: string; vervalt: number }[];
}

const leeg = (): Tabellen => ({
  gebruikers: [],
  leefgroepen: [],
  profielen: [],
  ruimtes: [],
  sleutels: [],
  afspraken: [],
  uitnodigingen: [],
});

async function hash(s: string): Promise<string> {
  return naarBase64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

const id = () => crypto.randomUUID();

/** Bewaarplaats voor de demo: localStorage in de browser, of in het geheugen (tests). */
export interface Bewaarder {
  lees(): string | null;
  schrijf(s: string): void;
}

export function browserBewaarder(sleutel = 'sporen-agenda-demo-v1'): Bewaarder {
  return {
    lees: () => {
      try {
        return localStorage.getItem(sleutel);
      } catch {
        return null;
      }
    },
    schrijf: (s) => {
      try {
        localStorage.setItem(sleutel, s);
      } catch {
        /* privévenster: dan blijft het in het geheugen */
      }
    },
  };
}

export function geheugenBewaarder(): Bewaarder {
  let s: string | null = null;
  return { lees: () => s, schrijf: (x) => (s = x) };
}

/**
 * Demo-opslag: dezelfde regels als Supabase, maar alles in deze browser.
 * Ook hier staan de afspraken versleuteld.
 */
export class DemoOpslag implements Opslag {
  readonly modus = 'demo' as const;
  private t: Tabellen;
  private ik: string | null = null;

  constructor(private bewaarder: Bewaarder) {
    const ruw = bewaarder.lees();
    this.t = ruw ? (JSON.parse(ruw) as Tabellen) : leeg();
  }

  isLeeg(): boolean {
    return this.t.gebruikers.length === 0;
  }

  wis(): void {
    this.t = leeg();
    this.ik = null;
    this.bewaar();
  }

  private bewaar() {
    this.bewaarder.schrijf(JSON.stringify(this.t));
  }

  private mij(): string {
    if (!this.ik) throw new OpslagFout('Niet aangemeld.');
    return this.ik;
  }

  private mijnLeefgroep(): string {
    const p = this.t.profielen.find((x) => x.id === this.mij());
    if (!p) throw new OpslagFout('Geen profiel.');
    return p.leefgroepId;
  }

  private heeftSleutel(ruimteId: string): boolean {
    return this.t.sleutels.some((s) => s.ruimteId === ruimteId && s.profielId === this.ik);
  }

  async registreer(gebruikersnaam: string, wachtwoord: string): Promise<string> {
    const naam = normaliseerNaam(gebruikersnaam);
    if (this.t.gebruikers.some((g) => g.naam === naam)) throw new OpslagFout('Deze gebruikersnaam bestaat al.');
    const g = { id: id(), naam, hash: await hash(wachtwoord) };
    this.t.gebruikers.push(g);
    this.ik = g.id;
    this.bewaar();
    return g.id;
  }

  async meldAan(gebruikersnaam: string, wachtwoord: string): Promise<string> {
    const g = this.t.gebruikers.find((x) => x.naam === normaliseerNaam(gebruikersnaam));
    if (!g || g.hash !== (await hash(wachtwoord))) throw new OpslagFout('Gebruikersnaam of wachtwoord klopt niet.');
    this.ik = g.id;
    return g.id;
  }

  async meldAf(): Promise<void> {
    this.ik = null;
  }

  async startLeefgroep(naam: string, profiel: NieuwProfiel, _startcode: string) {
    const ik = this.mij();
    if (this.t.profielen.some((p) => p.id === ik)) throw new OpslagFout('Je hoort al bij een leefgroep.');
    const leefgroep = { id: id(), naam };
    const p: Profiel = { ...profiel, id: ik, leefgroepId: leefgroep.id, rol: 'begeleider' };
    this.t.leefgroepen.push(leefgroep);
    this.t.profielen.push(p);
    this.bewaar();
    return { leefgroep, profiel: p };
  }

  async gebruikUitnodiging(code: string, profiel: NieuwProfielMetCode): Promise<Profiel> {
    const ik = this.mij();
    const c = code.trim().toUpperCase();
    const u = this.t.uitnodigingen.find((x) => x.code === c);
    if (!u) throw new OpslagFout('Deze code bestaat niet of is al gebruikt.');
    const p: Profiel = { ...profiel, id: ik, leefgroepId: u.leefgroepId, rol: u.rol, initialen: u.initialen };
    this.t.profielen.push(p);
    this.t.uitnodigingen = this.t.uitnodigingen.filter((x) => x.code !== c);
    this.bewaar();
    return p;
  }

  private eisBegeleider(leefgroepId: string) {
    const p = this.t.profielen.find((x) => x.id === this.mij());
    if (!p || p.rol !== 'begeleider' || p.leefgroepId !== leefgroepId) throw new OpslagFout('Alleen voor begeleiders.');
  }

  async maakUitnodiging(leefgroepId: string, rol: Rol, initialen: string): Promise<Uitnodiging> {
    this.eisBegeleider(leefgroepId);
    const u = { code: nieuweCode(), leefgroepId, rol, initialen };
    this.t.uitnodigingen.push(u);
    this.bewaar();
    return u;
  }

  async openUitnodigingen(leefgroepId: string): Promise<Uitnodiging[]> {
    this.eisBegeleider(leefgroepId);
    return this.t.uitnodigingen.filter((u) => u.leefgroepId === leefgroepId);
  }

  async trekUitnodigingIn(code: string): Promise<void> {
    const u = this.t.uitnodigingen.find((x) => x.code === code);
    if (!u) return;
    this.eisBegeleider(u.leefgroepId);
    this.t.uitnodigingen = this.t.uitnodigingen.filter((x) => x.code !== code);
    this.bewaar();
  }

  async mijnProfiel(): Promise<Profiel | null> {
    return this.t.profielen.find((p) => p.id === this.mij()) ?? null;
  }

  async leefgroep(lid: string): Promise<Leefgroep> {
    const l = this.t.leefgroepen.find((x) => x.id === lid);
    if (!l || lid !== this.mijnLeefgroep()) throw new OpslagFout('Leefgroep niet gevonden.');
    return l;
  }

  async profielen(leefgroepId: string): Promise<Profiel[]> {
    if (leefgroepId !== this.mijnLeefgroep()) return [];
    // Zoals in Supabase: van anderen alleen wat nodig is (geen versleutelde private sleutel).
    return this.t.profielen
      .filter((p) => p.leefgroepId === leefgroepId)
      .map((p) => (p.id === this.ik ? p : { ...p, priveSleutel: { iv: '', ct: '' }, zout: '' }));
  }

  async ruimtes(leefgroepId: string): Promise<Ruimte[]> {
    if (leefgroepId !== this.mijnLeefgroep()) return [];
    return this.t.ruimtes.filter((r) => r.leefgroepId === leefgroepId);
  }

  async maakRuimte(r: Omit<Ruimte, 'id'>): Promise<Ruimte> {
    const ik = this.mij();
    const p = this.t.profielen.find((x) => x.id === ik)!;
    if (r.leefgroepId !== p.leefgroepId) throw new OpslagFout('Verkeerde leefgroep.');
    if ((r.soort === 'prive' || r.soort === 'begeleiding') && r.eigenaarId !== ik)
      throw new OpslagFout('Je kan alleen je eigen ruimte maken.');
    if ((r.soort === 'team' || r.soort === 'gedeeld') && p.rol !== 'begeleider')
      throw new OpslagFout('Alleen begeleiders.');
    if (this.t.ruimtes.some((x) => x.leefgroepId === r.leefgroepId && x.soort === r.soort && x.eigenaarId === r.eigenaarId))
      throw new OpslagFout('Die ruimte bestaat al.');
    const nieuw = { ...r, id: id() };
    this.t.ruimtes.push(nieuw);
    this.bewaar();
    return nieuw;
  }

  async mijnSleutels(): Promise<SleutelRij[]> {
    return this.t.sleutels.filter((s) => s.profielId === this.mij());
  }

  async sleutelLeden(leefgroepId: string) {
    const ruimteIds = new Set(this.t.ruimtes.filter((r) => r.leefgroepId === leefgroepId).map((r) => r.id));
    return this.t.sleutels.filter((s) => ruimteIds.has(s.ruimteId)).map(({ ruimteId, profielId }) => ({ ruimteId, profielId }));
  }

  async zetSleutel(rij: SleutelRij): Promise<void> {
    const ik = this.mij();
    const r = this.t.ruimtes.find((x) => x.id === rij.ruimteId);
    if (!r) throw new OpslagFout('Ruimte bestaat niet.');
    const ikBenEigenaar = r.eigenaarId === ik;
    if (!ikBenEigenaar && !this.heeftSleutel(r.id) && !(r.soort !== 'prive' && this.t.sleutels.every((s) => s.ruimteId !== r.id)))
      throw new OpslagFout('Je hebt zelf geen toegang tot deze ruimte.');
    if (r.soort === 'prive' && rij.profielId !== r.eigenaarId) throw new OpslagFout('Een privé-ruimte deel je niet.');
    this.t.sleutels = this.t.sleutels.filter((s) => !(s.ruimteId === rij.ruimteId && s.profielId === rij.profielId));
    this.t.sleutels.push(rij);
    this.bewaar();
  }

  async afspraken(ruimteIds: string[]): Promise<AfspraakRij[]> {
    const mag = new Set(ruimteIds.filter((r) => this.heeftSleutel(r)));
    return this.t.afspraken.filter((a) => mag.has(a.ruimteId));
  }

  async bewaarAfspraak(rij: Omit<AfspraakRij, 'id'> & { id?: string }): Promise<AfspraakRij> {
    const ik = this.mij();
    if (!this.heeftSleutel(rij.ruimteId)) throw new OpslagFout('Geen toegang tot deze agenda.');
    if (rij.id) {
      const oud = this.t.afspraken.find((a) => a.id === rij.id);
      if (!oud) throw new OpslagFout('Afspraak niet gevonden.');
      if (!this.magWijzigen(oud)) throw new OpslagFout('Je kan deze afspraak niet wijzigen.');
      if (!this.heeftSleutel(oud.ruimteId)) throw new OpslagFout('Geen toegang.');
      const nieuw = { ...rij, id: rij.id, auteurId: oud.auteurId };
      this.t.afspraken = this.t.afspraken.map((a) => (a.id === rij.id ? nieuw : a));
      this.bewaar();
      return nieuw;
    }
    const nieuw = { ...rij, id: id(), auteurId: ik };
    this.t.afspraken.push(nieuw);
    this.bewaar();
    return nieuw;
  }

  private magWijzigen(a: AfspraakRij): boolean {
    if (a.auteurId === this.ik) return true;
    const p = this.t.profielen.find((x) => x.id === this.ik);
    const r = this.t.ruimtes.find((x) => x.id === a.ruimteId);
    return !!p && p.rol === 'begeleider' && !!r && r.soort !== 'prive' && this.heeftSleutel(r.id);
  }

  async verwijderAfspraak(aid: string): Promise<void> {
    const a = this.t.afspraken.find((x) => x.id === aid);
    if (!a) return;
    if (!this.magWijzigen(a)) throw new OpslagFout('Je kan deze afspraak niet verwijderen.');
    this.t.afspraken = this.t.afspraken.filter((x) => x.id !== aid);
    this.bewaar();
  }

  // ── Beheer van accounts ──

  async maakHerstelcode(profielId: string): Promise<string> {
    const doel = this.t.profielen.find((p) => p.id === profielId);
    if (!doel) throw new OpslagFout('Lid niet gevonden.');
    this.eisBegeleider(doel.leefgroepId);
    const code = `${nieuweCode()}-${nieuweCode().slice(0, 4)}`;
    this.t.herstelcodes = [...(this.t.herstelcodes ?? []).filter((h) => h.profielId !== profielId), { code, profielId, vervalt: Date.now() + DAG }];
    this.bewaar();
    return code;
  }

  async gebruikHerstelcode(code: string, wachtwoord: string, m: NieuwProfielMetCode): Promise<string> {
    const c = code.trim().toUpperCase();
    const h = (this.t.herstelcodes ?? []).find((x) => x.code === c && x.vervalt > Date.now());
    if (!h) throw new OpslagFout('Deze herstelcode bestaat niet, is verlopen of is al gebruikt.');
    this.t.herstelcodes = (this.t.herstelcodes ?? []).filter((x) => x.code !== c);
    const g = this.t.gebruikers.find((x) => x.id === h.profielId)!;
    g.hash = await hash(wachtwoord);
    this.t.profielen = this.t.profielen.map((p) => (p.id === h.profielId ? { ...p, ...m } : p));
    this.t.sleutels = this.t.sleutels.filter((s) => s.profielId !== h.profielId);
    const prive = this.t.ruimtes.filter((r) => r.soort === 'prive' && r.eigenaarId === h.profielId).map((r) => r.id);
    this.t.afspraken = this.t.afspraken.filter((a) => !prive.includes(a.ruimteId));
    this.t.ruimtes = this.t.ruimtes.filter((r) => !prive.includes(r.id));
    this.bewaar();
    return g.naam;
  }

  async wijzigWachtwoord(oud: string, nieuw: string, m: Pick<Profiel, 'priveSleutel' | 'zout'>): Promise<void> {
    const g = this.t.gebruikers.find((x) => x.id === this.mij())!;
    if (g.hash !== (await hash(oud))) throw new OpslagFout('Je huidige wachtwoord klopt niet.');
    g.hash = await hash(nieuw);
    this.t.profielen = this.t.profielen.map((p) => (p.id === g.id ? { ...p, ...m } : p));
    this.bewaar();
  }

  async verwijderLid(profielId: string): Promise<void> {
    const doel = this.t.profielen.find((p) => p.id === profielId);
    if (!doel) return;
    this.eisBegeleider(doel.leefgroepId);
    if (profielId === this.ik) throw new OpslagFout('Je kan jezelf niet verwijderen.');
    const eigen = this.t.ruimtes.filter((r) => r.eigenaarId === profielId).map((r) => r.id);
    this.t.afspraken = this.t.afspraken
      .filter((a) => !eigen.includes(a.ruimteId))
      .map((a) => (a.auteurId === profielId ? { ...a, auteurId: null } : a));
    this.t.sleutels = this.t.sleutels.filter((s) => s.profielId !== profielId && !eigen.includes(s.ruimteId));
    this.t.ruimtes = this.t.ruimtes.filter((r) => !eigen.includes(r.id));
    this.t.profielen = this.t.profielen.filter((p) => p.id !== profielId);
    this.t.gebruikers = this.t.gebruikers.filter((g) => g.id !== profielId);
    this.t.herstelcodes = (this.t.herstelcodes ?? []).filter((h) => h.profielId !== profielId);
    this.bewaar();
  }
}

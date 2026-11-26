import {
  bewaarPrive,
  exporteerPubliek,
  importeerPubliek,
  naarBase64,
  nieuweRuimteSleutel,
  nieuwSleutelpaar,
  ontsleutelJson,
  openPrive,
  pakIn,
  pakUit,
  sleutelUitWachtwoord,
  uitBase64,
  versleutelJson,
  willekeurig,
  PBKDF2_ITERATIES,
} from './crypto';
import {
  bewarenTot,
  type Afspraak,
  type AfspraakInhoud,
  type Leefgroep,
  type Profiel,
  type Rol,
  type Ruimte,
  type Uitnodiging,
} from './model';
import { OpslagFout, type NieuwProfielMetCode, type Opslag } from '../opslag/opslag';

export interface OntbrekendeToegang {
  profiel: Profiel;
  ruimte: Ruimte;
}

/** Wie hoort een sleutel te hebben voor deze ruimte? */
export function verwachteLeden(r: Ruimte, profielen: Profiel[]): Profiel[] {
  switch (r.soort) {
    case 'prive':
      return profielen.filter((p) => p.id === r.eigenaarId);
    case 'begeleiding':
      return profielen.filter((p) => p.id === r.eigenaarId || p.rol === 'begeleider');
    case 'team':
      return profielen.filter((p) => p.rol === 'begeleider');
    case 'gedeeld':
      return profielen;
  }
}

async function nieuwProfielMateriaal(wachtwoord: string, iteraties: number): Promise<NieuwProfielMetCode & { prive: CryptoKey }> {
  const zout = willekeurig(16);
  const ws = await sleutelUitWachtwoord(wachtwoord, zout, iteraties);
  const kp = await nieuwSleutelpaar();
  return {
    publiekeSleutel: await exporteerPubliek(kp.publiek),
    priveSleutel: await bewaarPrive(kp.prive, ws),
    zout: naarBase64(zout),
    prive: kp.prive,
  };
}

/**
 * Maakt het account, of meldt aan als het al bestaat maar nog geen profiel heeft
 * (bv. een vorige poging met een foute code).
 */
async function zorgVoorAccount(opslag: Opslag, gebruikersnaam: string, wachtwoord: string): Promise<void> {
  try {
    await opslag.registreer(gebruikersnaam, wachtwoord);
  } catch (e) {
    if (!(e instanceof OpslagFout) || !/bestaat al/.test(e.message)) throw e;
    await opslag.meldAan(gebruikersnaam, wachtwoord);
    if (await opslag.mijnProfiel()) {
      await opslag.meldAf();
      throw new OpslagFout('Deze gebruikersnaam bestaat al. Kies een andere, of meld je gewoon aan.');
    }
  }
}

/**
 * Een aangemelde sessie: houdt de geopende sleutels in het geheugen (nooit in
 * opslag) en vertaalt tussen leesbare afspraken en versleutelde rijen.
 */
export class Sessie {
  profielen: Profiel[] = [];
  ruimtes: Ruimte[] = [];
  private sleutels = new Map<string, CryptoKey>();

  private constructor(
    readonly opslag: Opslag,
    public profiel: Profiel,
    readonly leefgroep: Leefgroep,
    private prive: CryptoKey,
  ) {}

  /** Lager aantal iteraties alleen voor tests. */
  static iteraties = PBKDF2_ITERATIES;

  static async meldAan(opslag: Opslag, gebruikersnaam: string, wachtwoord: string): Promise<Sessie> {
    await opslag.meldAan(gebruikersnaam, wachtwoord);
    const profiel = await opslag.mijnProfiel();
    if (!profiel) throw new OpslagFout('Dit account hoort nog bij geen leefgroep.');
    const ws = await sleutelUitWachtwoord(wachtwoord, uitBase64(profiel.zout), Sessie.iteraties);
    let prive: CryptoKey;
    try {
      prive = await openPrive(profiel.priveSleutel, ws);
    } catch {
      throw new OpslagFout('Je sleutel kon niet geopend worden met dit wachtwoord.');
    }
    const s = new Sessie(opslag, profiel, await opslag.leefgroep(profiel.leefgroepId), prive);
    await s.laad();
    await s.zorgEigenRuimtes();
    return s;
  }

  /** Wachtwoord vergeten: nieuw wachtwoord met een herstelcode van een begeleider. */
  static async herstel(opslag: Opslag, code: string, wachtwoord: string): Promise<Sessie> {
    const { prive: _weg, ...materiaal } = await nieuwProfielMateriaal(wachtwoord, Sessie.iteraties);
    void _weg;
    const gebruikersnaam = await opslag.gebruikHerstelcode(code, wachtwoord, materiaal);
    return Sessie.meldAan(opslag, gebruikersnaam, wachtwoord);
  }

  /** Na een herstel ontbreekt de privé-ruimte: maak ze opnieuw. */
  private async zorgEigenRuimtes() {
    let gemaakt = false;
    if (!this.ruimte('prive', this.profiel.id)) {
      await this.maakRuimteMetSleutel('prive', this.profiel.id);
      gemaakt = true;
    }
    if (!this.isBegeleider && !this.ruimte('begeleiding', this.profiel.id)) {
      await this.maakRuimteMetSleutel('begeleiding', this.profiel.id);
      gemaakt = true;
    }
    if (gemaakt) await this.laad();
  }

  /** Eerste begeleider: maakt de leefgroep met een team- en een gedeelde agenda. */
  static async startLeefgroep(
    opslag: Opslag,
    gebruikersnaam: string,
    wachtwoord: string,
    leefgroepNaam: string,
    initialen: string,
    startcode = '',
  ): Promise<Sessie> {
    await zorgVoorAccount(opslag, gebruikersnaam, wachtwoord);
    const m = await nieuwProfielMateriaal(wachtwoord, Sessie.iteraties);
    const { prive, ...materiaal } = m;
    const { leefgroep, profiel } = await opslag.startLeefgroep(leefgroepNaam, { ...materiaal, rol: 'begeleider', initialen }, startcode);
    const s = new Sessie(opslag, profiel, leefgroep, prive);
    await s.laad();
    for (const soort of ['team', 'gedeeld'] as const) await s.maakRuimteMetSleutel(soort, null);
    await s.maakRuimteMetSleutel('prive', profiel.id);
    await s.laad();
    return s;
  }

  /** Nieuw account met een uitnodigingscode (jongere of begeleider). */
  static async registreerMetCode(opslag: Opslag, gebruikersnaam: string, wachtwoord: string, code: string): Promise<Sessie> {
    await zorgVoorAccount(opslag, gebruikersnaam, wachtwoord);
    const m = await nieuwProfielMateriaal(wachtwoord, Sessie.iteraties);
    const { prive, ...materiaal } = m;
    const profiel = await opslag.gebruikUitnodiging(code, materiaal);
    const s = new Sessie(opslag, profiel, await opslag.leefgroep(profiel.leefgroepId), prive);
    await s.laad();
    await s.maakRuimteMetSleutel('prive', profiel.id);
    if (profiel.rol === 'jongere') await s.maakRuimteMetSleutel('begeleiding', profiel.id);
    await s.laad();
    return s;
  }

  private async maakRuimteMetSleutel(soort: Ruimte['soort'], eigenaarId: string | null) {
    const r = await this.opslag.maakRuimte({ leefgroepId: this.leefgroep.id, soort, eigenaarId });
    const k = await nieuweRuimteSleutel();
    this.sleutels.set(r.id, k);
    this.ruimtes.push(r);
    // Inpakken voor iedereen die erbij hoort en die we nu al kennen.
    for (const lid of verwachteLeden(r, this.profielen)) {
      await this.opslag.zetSleutel({ ruimteId: r.id, profielId: lid.id, ingepakt: await pakIn(k, await importeerPubliek(lid.publiekeSleutel)) });
    }
  }

  async laad(): Promise<void> {
    this.profielen = await this.opslag.profielen(this.leefgroep.id);
    const ik = this.profielen.find((p) => p.id === this.profiel.id);
    if (ik) this.profiel = { ...ik, priveSleutel: this.profiel.priveSleutel, zout: this.profiel.zout };
    this.ruimtes = await this.opslag.ruimtes(this.leefgroep.id);
    // Altijd opnieuw uitpakken: een begeleider kan intussen een sleutel vernieuwd hebben.
    for (const rij of await this.opslag.mijnSleutels()) {
      try {
        this.sleutels.set(rij.ruimteId, await pakUit(rij.ingepakt, this.prive));
      } catch {
        /* beschadigde of verouderde sleutel: overslaan */
      }
    }
  }

  get isBegeleider(): boolean {
    return this.profiel.rol === 'begeleider';
  }

  heeftToegang(ruimteId: string): boolean {
    return this.sleutels.has(ruimteId);
  }

  ruimte(soort: Ruimte['soort'], eigenaarId: string | null = null): Ruimte | undefined {
    return this.ruimtes.find((r) => r.soort === soort && (eigenaarId === null || r.eigenaarId === eigenaarId));
  }

  /** Ruimtes waar ik in mag schrijven, met een uitleg wie het ziet. */
  schrijfKeuzes(): { ruimte: Ruimte; label: string; uitleg: string }[] {
    const k: { ruimte: Ruimte; label: string; uitleg: string }[] = [];
    const ik = this.profiel.id;
    const voeg = (r: Ruimte | undefined, label: string, uitleg: string) => {
      if (r && this.heeftToegang(r.id)) k.push({ ruimte: r, label, uitleg });
    };
    if (this.isBegeleider) {
      voeg(this.ruimte('team'), 'Leefgroep (begeleiders)', 'Alle begeleiders zien dit.');
      voeg(this.ruimte('gedeeld'), 'Gedeeld met iedereen', 'Begeleiders én jongeren van de leefgroep zien dit.');
      for (const j of this.jongeren()) {
        voeg(this.ruimte('begeleiding', j.id), `Voor ${j.initialen}`, `${j.initialen} en de begeleiders zien dit.`);
      }
      voeg(this.ruimte('prive', ik), 'Alleen ik (privé)', 'Niemand anders ziet dit.');
    } else {
      voeg(this.ruimte('begeleiding', ik), 'Ik en de begeleiding', 'Jij en je begeleiders zien dit. Zo kunnen ze je helpen.');
      voeg(this.ruimte('prive', ik), 'Alleen ik (privé)', 'Niemand anders ziet dit, ook de begeleiders niet.');
      voeg(this.ruimte('gedeeld'), 'Gedeeld met iedereen', 'Iedereen van de leefgroep ziet dit.');
    }
    return k;
  }

  jongeren(): Profiel[] {
    return this.profielen.filter((p) => p.rol === 'jongere').sort((a, b) => a.initialen.localeCompare(b.initialen));
  }

  async afspraken(): Promise<Afspraak[]> {
    const ids = this.ruimtes.filter((r) => this.heeftToegang(r.id)).map((r) => r.id);
    const rijen = await this.opslag.afspraken(ids);
    const uit: Afspraak[] = [];
    for (const rij of rijen) {
      const k = this.sleutels.get(rij.ruimteId);
      const ruimte = this.ruimtes.find((r) => r.id === rij.ruimteId);
      if (!k || !ruimte) continue;
      try {
        const inhoud = await ontsleutelJson<AfspraakInhoud>(k, rij.inhoud);
        uit.push({ ...inhoud, id: rij.id, ruimte, auteur: this.profielen.find((p) => p.id === rij.auteurId) });
      } catch {
        /* niet te openen: overslaan */
      }
    }
    return uit.sort((a, b) => (a.datum + (a.van || '00:00')).localeCompare(b.datum + (b.van || '00:00')));
  }

  async bewaar(inhoud: AfspraakInhoud, ruimteId: string, id?: string): Promise<void> {
    const k = this.sleutels.get(ruimteId);
    if (!k) throw new OpslagFout('Geen toegang tot deze agenda.');
    if (id) {
      // Verhuist de afspraak naar een andere ruimte? Dan oude weg, nieuwe erbij.
      const bestaande = (await this.opslag.afspraken([ruimteId])).some((a) => a.id === id);
      if (!bestaande) {
        await this.opslag.verwijderAfspraak(id);
        id = undefined;
      }
    }
    await this.opslag.bewaarAfspraak({
      id,
      ruimteId,
      auteurId: this.profiel.id,
      inhoud: await versleutelJson(k, inhoud),
      bewarenTot: bewarenTot(inhoud.datum),
    });
  }

  async verwijder(id: string): Promise<void> {
    await this.opslag.verwijderAfspraak(id);
  }

  magWijzigen(a: Afspraak): boolean {
    if (a.auteur?.id === this.profiel.id) return true;
    return this.isBegeleider && a.ruimte.soort !== 'prive';
  }

  // ── Voor begeleiders ──────────────────────────────────────────────────────

  async nodigUit(rol: Rol, initialen: string): Promise<Uitnodiging> {
    return this.opslag.maakUitnodiging(this.leefgroep.id, rol, initialen);
  }

  async openUitnodigingen(): Promise<Uitnodiging[]> {
    return this.isBegeleider ? this.opslag.openUitnodigingen(this.leefgroep.id) : [];
  }

  /** Leden die een sleutel missen die ik wel heb (bv. nieuwe jongere → gedeelde agenda). */
  async ontbrekendeToegang(): Promise<OntbrekendeToegang[]> {
    if (!this.isBegeleider) return [];
    const leden = await this.opslag.sleutelLeden(this.leefgroep.id);
    const heeft = new Set(leden.map((l) => `${l.ruimteId}|${l.profielId}`));
    const uit: OntbrekendeToegang[] = [];
    for (const r of this.ruimtes) {
      if (r.soort === 'prive' || !this.heeftToegang(r.id)) continue;
      for (const p of verwachteLeden(r, this.profielen)) {
        if (!heeft.has(`${r.id}|${p.id}`)) uit.push({ profiel: p, ruimte: r });
      }
    }
    return uit;
  }

  async geefToegang(lijst: OntbrekendeToegang[]): Promise<void> {
    for (const { profiel, ruimte } of lijst) {
      const k = this.sleutels.get(ruimte.id);
      if (!k) continue;
      await this.opslag.zetSleutel({
        ruimteId: ruimte.id,
        profielId: profiel.id,
        ingepakt: await pakIn(k, await importeerPubliek(profiel.publiekeSleutel)),
      });
    }
  }

  async herstelcode(profielId: string): Promise<string> {
    return this.opslag.maakHerstelcode(profielId);
  }

  /**
   * Verwijdert een lid en vernieuwt daarna de sleutels van elke agenda waar die
   * persoon bij kon: nieuwe sleutel, afspraken opnieuw versleuteld, opnieuw
   * ingepakt voor wie overblijft. Zo helpt een oude sleutel niet meer.
   */
  async verwijderLid(profielId: string): Promise<void> {
    if (profielId === this.profiel.id) throw new OpslagFout('Je kan jezelf niet verwijderen.');
    const weg = this.profielen.find((p) => p.id === profielId);
    if (!weg) return;
    const geraakt = this.ruimtes.filter(
      (r) => r.eigenaarId !== profielId && this.heeftToegang(r.id) && verwachteLeden(r, this.profielen).some((p) => p.id === profielId),
    );
    await this.opslag.verwijderLid(profielId);
    await this.laad();
    for (const r of geraakt) {
      if (this.ruimtes.some((x) => x.id === r.id)) await this.vernieuwSleutel(r);
    }
  }

  private async vernieuwSleutel(r: Ruimte): Promise<void> {
    const oud = this.sleutels.get(r.id);
    if (!oud) return;
    const nieuw = await nieuweRuimteSleutel();
    for (const rij of await this.opslag.afspraken([r.id])) {
      let inhoud: AfspraakInhoud;
      try {
        inhoud = await ontsleutelJson<AfspraakInhoud>(oud, rij.inhoud);
      } catch {
        continue;
      }
      await this.opslag.bewaarAfspraak({ ...rij, inhoud: await versleutelJson(nieuw, inhoud) });
    }
    for (const lid of verwachteLeden(r, this.profielen)) {
      await this.opslag.zetSleutel({ ruimteId: r.id, profielId: lid.id, ingepakt: await pakIn(nieuw, await importeerPubliek(lid.publiekeSleutel)) });
    }
    this.sleutels.set(r.id, nieuw);
  }

  /** Nieuw wachtwoord: de private sleutel opnieuw inpakken met een nieuwe wachtwoordsleutel. */
  async wijzigWachtwoord(oud: string, nieuw: string): Promise<void> {
    const zout = willekeurig(16);
    const ws = await sleutelUitWachtwoord(nieuw, zout, Sessie.iteraties);
    const pkcs8Sleutel = await this.exporteerbarePrive(oud);
    const priveSleutel = await bewaarPrive(pkcs8Sleutel, ws);
    await this.opslag.wijzigWachtwoord(oud, nieuw, { priveSleutel, zout: naarBase64(zout) });
    this.profiel = { ...this.profiel, priveSleutel, zout: naarBase64(zout) };
  }

  /** De private sleutel in het geheugen is niet exporteerbaar: open hem opnieuw, nu exporteerbaar. */
  private async exporteerbarePrive(wachtwoord: string): Promise<CryptoKey> {
    const ws = await sleutelUitWachtwoord(wachtwoord, uitBase64(this.profiel.zout), Sessie.iteraties);
    try {
      return await openPrive(this.profiel.priveSleutel, ws, true);
    } catch {
      throw new OpslagFout('Je huidige wachtwoord klopt niet.');
    }
  }

  async meldAf(): Promise<void> {
    this.sleutels.clear();
    await this.opslag.meldAf();
  }
}

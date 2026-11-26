import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AfspraakRij, Leefgroep, Profiel, Rol, Ruimte, SleutelRij, Uitnodiging } from '../kluis/model';
import { normaliseerNaam, OpslagFout, type NieuwProfiel, type NieuwProfielMetCode, type Opslag } from './opslag';

/**
 * Supabase heeft een e-mailadres nodig om in te loggen. We gebruiken geen echte
 * adressen: de gebruikersnaam wordt een adres op het gereserveerde domein
 * ".invalid". Zo staat er geen e-mail van een jongere in de opslag.
 * (In Supabase: Authentication → Providers → Email → "Confirm email" uit.)
 */
const naarEmail = (naam: string) => `${normaliseerNaam(naam).replace(/[^a-z0-9._-]/g, '')}@agenda.invalid`;

interface ProfielDb {
  id: string;
  leefgroep_id: string;
  initialen: string;
  rol: Rol;
  publieke_sleutel: JsonWebKey;
  prive_sleutel?: Profiel['priveSleutel'];
  zout?: string;
}

const uitProfiel = (r: ProfielDb): Profiel => ({
  id: r.id,
  leefgroepId: r.leefgroep_id,
  initialen: r.initialen,
  rol: r.rol,
  publiekeSleutel: r.publieke_sleutel,
  priveSleutel: r.prive_sleutel ?? { iv: '', ct: '' },
  zout: r.zout ?? '',
});

const uitRuimte = (r: { id: string; leefgroep_id: string; soort: Ruimte['soort']; eigenaar_id: string | null }): Ruimte => ({
  id: r.id,
  leefgroepId: r.leefgroep_id,
  soort: r.soort,
  eigenaarId: r.eigenaar_id,
});

const uitAfspraak = (r: { id: string; ruimte_id: string; auteur_id: string | null; inhoud: AfspraakRij['inhoud']; bewaren_tot: string }): AfspraakRij => ({
  id: r.id,
  ruimteId: r.ruimte_id,
  auteurId: r.auteur_id,
  inhoud: r.inhoud,
  bewarenTot: r.bewaren_tot,
});

const uitUitnodiging = (r: { code: string; leefgroep_id: string; rol: Rol; initialen: string }): Uitnodiging => ({
  code: r.code,
  leefgroepId: r.leefgroep_id,
  rol: r.rol,
  initialen: r.initialen,
});

function vertaal(e: { message?: string; code?: string } | null, standaard: string): never {
  const m = e?.message ?? '';
  if (/already registered|already exists/i.test(m)) throw new OpslagFout('Deze gebruikersnaam bestaat al.');
  if (/invalid login credentials/i.test(m)) throw new OpslagFout('Gebruikersnaam of wachtwoord klopt niet.');
  if (/password should be at least/i.test(m)) throw new OpslagFout('Kies een wachtwoord van minstens 8 tekens.');
  if (/startcode/i.test(m)) throw new OpslagFout('De startcode klopt niet.');
  if (/herstelcode/i.test(m)) throw new OpslagFout('Deze herstelcode bestaat niet, is verlopen of is al gebruikt.');
  if (/huidig wachtwoord/i.test(m)) throw new OpslagFout('Je huidige wachtwoord klopt niet.');
  if (/uitnodiging/i.test(m)) throw new OpslagFout('Deze code bestaat niet, is verlopen of is al gebruikt.');
  throw new OpslagFout(m ? `${standaard} (${m})` : standaard);
}

export class SupabaseOpslag implements Opslag {
  readonly modus = 'supabase' as const;
  private db: SupabaseClient;
  private ik: string | null = null;

  constructor(url: string, anonSleutel: string) {
    // Geen sessie bewaren in de browser: na herladen opnieuw aanmelden,
    // want zonder wachtwoord gaan de sleutels toch niet open.
    this.db = createClient(url, anonSleutel, { auth: { persistSession: false, autoRefreshToken: true } });
  }

  private mij(): string {
    if (!this.ik) throw new OpslagFout('Niet aangemeld.');
    return this.ik;
  }

  async registreer(gebruikersnaam: string, wachtwoord: string): Promise<string> {
    const { data, error } = await this.db.auth.signUp({ email: naarEmail(gebruikersnaam), password: wachtwoord });
    if (error || !data.user) vertaal(error, 'Account maken lukte niet.');
    if (!data.session) throw new OpslagFout('Supabase vraagt een e-mailbevestiging. Zet "Confirm email" uit in de instellingen.');
    // Supabase geeft bij een bestaand adres soms een "lege" gebruiker terug.
    if (data.user.identities && data.user.identities.length === 0) throw new OpslagFout('Deze gebruikersnaam bestaat al.');
    this.ik = data.user.id;
    return data.user.id;
  }

  async meldAan(gebruikersnaam: string, wachtwoord: string): Promise<string> {
    const { data, error } = await this.db.auth.signInWithPassword({ email: naarEmail(gebruikersnaam), password: wachtwoord });
    if (error || !data.user) vertaal(error, 'Aanmelden lukte niet.');
    this.ik = data.user.id;
    return data.user.id;
  }

  async meldAf(): Promise<void> {
    this.ik = null;
    await this.db.auth.signOut();
  }

  async startLeefgroep(naam: string, profiel: NieuwProfiel, startcode: string) {
    const { data, error } = await this.db.rpc('start_leefgroep', {
      p_naam: naam,
      p_startcode: startcode,
      p_initialen: profiel.initialen,
      p_publieke_sleutel: profiel.publiekeSleutel,
      p_prive_sleutel: profiel.priveSleutel,
      p_zout: profiel.zout,
    });
    if (error) vertaal(error, 'Leefgroep maken lukte niet.');
    const p = uitProfiel(data as ProfielDb);
    return { leefgroep: await this.leefgroep(p.leefgroepId), profiel: p };
  }

  async gebruikUitnodiging(code: string, profiel: NieuwProfielMetCode): Promise<Profiel> {
    const { data, error } = await this.db.rpc('gebruik_uitnodiging', {
      p_code: code.trim().toUpperCase(),
      p_publieke_sleutel: profiel.publiekeSleutel,
      p_prive_sleutel: profiel.priveSleutel,
      p_zout: profiel.zout,
    });
    if (error) vertaal(error, 'De code gebruiken lukte niet.');
    return uitProfiel(data as ProfielDb);
  }

  async maakUitnodiging(leefgroepId: string, rol: Rol, initialen: string): Promise<Uitnodiging> {
    const { data, error } = await this.db.rpc('maak_uitnodiging', { p_rol: rol, p_initialen: initialen });
    if (error) vertaal(error, 'Uitnodiging maken lukte niet.');
    const u = uitUitnodiging(data as Parameters<typeof uitUitnodiging>[0]);
    if (u.leefgroepId !== leefgroepId) throw new OpslagFout('Verkeerde leefgroep.');
    return u;
  }

  async openUitnodigingen(leefgroepId: string): Promise<Uitnodiging[]> {
    const { data, error } = await this.db.from('uitnodigingen').select('code, leefgroep_id, rol, initialen').eq('leefgroep_id', leefgroepId);
    if (error) vertaal(error, 'Uitnodigingen laden lukte niet.');
    return data.map(uitUitnodiging);
  }

  async trekUitnodigingIn(code: string): Promise<void> {
    const { error } = await this.db.from('uitnodigingen').delete().eq('code', code);
    if (error) vertaal(error, 'Intrekken lukte niet.');
  }

  async mijnProfiel(): Promise<Profiel | null> {
    this.mij();
    const { data, error } = await this.db.rpc('mijn_profiel');
    if (error) vertaal(error, 'Profiel laden lukte niet.');
    const rij = (Array.isArray(data) ? data[0] : data) as ProfielDb | null;
    return rij && rij.id ? uitProfiel(rij) : null;
  }

  async leefgroep(id: string): Promise<Leefgroep> {
    const { data, error } = await this.db.from('leefgroepen').select('id, naam').eq('id', id).single();
    if (error) vertaal(error, 'Leefgroep laden lukte niet.');
    return data as Leefgroep;
  }

  async profielen(leefgroepId: string): Promise<Profiel[]> {
    const { data, error } = await this.db
      .from('profielen')
      .select('id, leefgroep_id, initialen, rol, publieke_sleutel')
      .eq('leefgroep_id', leefgroepId);
    if (error) vertaal(error, 'Leden laden lukte niet.');
    return (data as ProfielDb[]).map(uitProfiel);
  }

  async ruimtes(leefgroepId: string): Promise<Ruimte[]> {
    const { data, error } = await this.db.from('ruimtes').select('id, leefgroep_id, soort, eigenaar_id').eq('leefgroep_id', leefgroepId);
    if (error) vertaal(error, 'Agenda\'s laden lukte niet.');
    return data.map(uitRuimte);
  }

  async maakRuimte(r: Omit<Ruimte, 'id'>): Promise<Ruimte> {
    const { data, error } = await this.db
      .from('ruimtes')
      .insert({ leefgroep_id: r.leefgroepId, soort: r.soort, eigenaar_id: r.eigenaarId })
      .select('id, leefgroep_id, soort, eigenaar_id')
      .single();
    if (error) vertaal(error, 'Agenda maken lukte niet.');
    return uitRuimte(data);
  }

  async mijnSleutels(): Promise<SleutelRij[]> {
    const { data, error } = await this.db.from('sleutels').select('ruimte_id, profiel_id, ingepakt').eq('profiel_id', this.mij());
    if (error) vertaal(error, 'Sleutels laden lukte niet.');
    return data.map((r) => ({ ruimteId: r.ruimte_id, profielId: r.profiel_id, ingepakt: r.ingepakt }));
  }

  async sleutelLeden(): Promise<{ ruimteId: string; profielId: string }[]> {
    const { data, error } = await this.db.rpc('sleutel_leden');
    if (error) vertaal(error, 'Toegang nakijken lukte niet.');
    return (data as { ruimte_id: string; profiel_id: string }[]).map((r) => ({ ruimteId: r.ruimte_id, profielId: r.profiel_id }));
  }

  async zetSleutel(rij: SleutelRij): Promise<void> {
    const { error } = await this.db
      .from('sleutels')
      .upsert({ ruimte_id: rij.ruimteId, profiel_id: rij.profielId, ingepakt: rij.ingepakt });
    if (error) vertaal(error, /privé|prive/i.test(error.message) ? 'Een privé-ruimte deel je niet.' : 'Toegang geven lukte niet.');
  }

  async afspraken(ruimteIds: string[]): Promise<AfspraakRij[]> {
    if (ruimteIds.length === 0) return [];
    const { data, error } = await this.db
      .from('afspraken')
      .select('id, ruimte_id, auteur_id, inhoud, bewaren_tot')
      .in('ruimte_id', ruimteIds);
    if (error) vertaal(error, 'Afspraken laden lukte niet.');
    return data.map(uitAfspraak);
  }

  async bewaarAfspraak(rij: Omit<AfspraakRij, 'id'> & { id?: string }): Promise<AfspraakRij> {
    const velden = { ruimte_id: rij.ruimteId, inhoud: rij.inhoud, bewaren_tot: rij.bewarenTot };
    const q = rij.id
      ? this.db.from('afspraken').update({ ...velden, gewijzigd: new Date().toISOString() }).eq('id', rij.id)
      : this.db.from('afspraken').insert(velden);
    const { data, error } = await q.select('id, ruimte_id, auteur_id, inhoud, bewaren_tot').single();
    if (error) vertaal(error, 'Bewaren lukte niet.');
    return uitAfspraak(data);
  }

  async verwijderAfspraak(id: string): Promise<void> {
    const { error } = await this.db.from('afspraken').delete().eq('id', id);
    if (error) vertaal(error, 'Verwijderen lukte niet.');
  }

  // ── Beheer van accounts ──

  async maakHerstelcode(profielId: string): Promise<string> {
    const { data, error } = await this.db.rpc('maak_herstelcode', { p_profiel: profielId });
    if (error) vertaal(error, 'Herstelcode maken lukte niet.');
    return data as string;
  }

  async gebruikHerstelcode(code: string, wachtwoord: string, m: NieuwProfielMetCode): Promise<string> {
    const { data, error } = await this.db.rpc('gebruik_herstelcode', {
      p_code: code.trim().toUpperCase(),
      p_wachtwoord: wachtwoord,
      p_publieke_sleutel: m.publiekeSleutel,
      p_prive_sleutel: m.priveSleutel,
      p_zout: m.zout,
    });
    if (error) vertaal(error, 'Herstellen lukte niet.');
    return data as string;
  }

  async wijzigWachtwoord(oud: string, nieuw: string, m: Pick<Profiel, 'priveSleutel' | 'zout'>): Promise<void> {
    const { error } = await this.db.rpc('wijzig_wachtwoord', {
      p_oud: oud,
      p_nieuw: nieuw,
      p_prive_sleutel: m.priveSleutel,
      p_zout: m.zout,
    });
    if (error) vertaal(error, 'Wachtwoord wijzigen lukte niet.');
  }

  async verwijderLid(profielId: string): Promise<void> {
    const { error } = await this.db.rpc('verwijder_lid', { p_profiel: profielId });
    if (error) vertaal(error, 'Verwijderen lukte niet.');
  }
}

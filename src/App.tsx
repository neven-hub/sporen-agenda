import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Sessie, type OntbrekendeToegang } from './kluis/sessie';
import type { Afspraak, AfspraakInhoud, Rol, Ruimte, Uitnodiging } from './kluis/model';
import { DemoOpslag } from './opslag/demo';
import { DEMO_GEBRUIKERS, DEMO_WACHTWOORD, kiesOpslag, vulDemo } from './opslag/kies';
import { dagLabel, kortLabel, maandagVan, plusDagen, vandaag } from './datum';

const opslag = kiesOpslag();
const isDemo = opslag.modus === 'demo';

function foutTekst(e: unknown): string {
  return e instanceof Error ? e.message : 'Er ging iets mis.';
}

const AFMELDEN_NA_MINUTEN = 15;

export default function App() {
  const [sessie, setSessie] = useState<Sessie | null>(null);
  const [melding, setMelding] = useState<string | null>(null);

  // Automatisch afmelden na een tijd zonder activiteit (gedeelde pc in het bureau).
  useEffect(() => {
    if (!sessie) return;
    let klok = 0;
    const herstart = () => {
      window.clearTimeout(klok);
      klok = window.setTimeout(async () => {
        await sessie.meldAf();
        setSessie(null);
        setMelding(`Je bent afgemeld na ${AFMELDEN_NA_MINUTEN} minuten zonder activiteit.`);
      }, AFMELDEN_NA_MINUTEN * 60 * 1000);
    };
    const gebeurtenissen = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    gebeurtenissen.forEach((g) => window.addEventListener(g, herstart, { passive: true }));
    herstart();
    return () => {
      window.clearTimeout(klok);
      gebeurtenissen.forEach((g) => window.removeEventListener(g, herstart));
    };
  }, [sessie]);
  return (
    <div className="ag">
      <div className="sp-kleurbalk" />
      {isDemo && (
        <div className="ag-demo">
          Demo: verzonnen leefgroep, alles blijft in deze browser. Er gaat niets naar een server.
        </div>
      )}
      {sessie ? (
        <Agenda sessie={sessie} onAfmelden={() => setSessie(null)} />
      ) : (
        <Aanmelden
          melding={melding}
          onSessie={(s) => {
            setMelding(null);
            setSessie(s);
          }}
        />
      )}
    </div>
  );
}

// ── Aanmelden ────────────────────────────────────────────────────────────────

type AanmeldTab = 'aanmelden' | 'code' | 'start' | 'herstel';

function Aanmelden({ onSessie, melding }: { onSessie: (s: Sessie) => void; melding?: string | null }) {
  const [tab, setTab] = useState<AanmeldTab>('aanmelden');
  const [naam, setNaam] = useState('');
  const [ww, setWw] = useState('');
  const [ww2, setWw2] = useState('');
  const [code, setCode] = useState('');
  const [lgNaam, setLgNaam] = useState('');
  const [initialen, setInitialen] = useState('');
  const [startcode, setStartcode] = useState('');
  const [bezig, setBezig] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  async function doe(label: string, f: () => Promise<Sessie>) {
    setFout(null);
    setBezig(label);
    try {
      onSessie(await f());
    } catch (e) {
      setFout(foutTekst(e));
    } finally {
      setBezig(null);
    }
  }

  function verstuur(e: FormEvent) {
    e.preventDefault();
    if (tab !== 'aanmelden') {
      if (ww.length < 8) return setFout('Kies een wachtwoord van minstens 8 tekens.');
      if (ww !== ww2) return setFout('De twee wachtwoorden zijn niet gelijk.');
    }
    if (tab === 'aanmelden') doe('Aanmelden en sleutels openen…', () => Sessie.meldAan(opslag, naam, ww));
    if (tab === 'code') doe('Account maken en sleutels aanmaken…', () => Sessie.registreerMetCode(opslag, naam, ww, code));
    if (tab === 'herstel') doe('Nieuw wachtwoord en nieuwe sleutels maken…', () => Sessie.herstel(opslag, code, ww));
    if (tab === 'start')
      doe('Leefgroep maken…', () => Sessie.startLeefgroep(opslag, naam, ww, lgNaam.trim(), initialen.trim(), startcode.trim()));
  }

  async function demoAls(n: string) {
    const d = opslag as DemoOpslag;
    if (d.isLeeg()) {
      setBezig('Demo klaarzetten met verzonnen gegevens…');
      try {
        await vulDemo(d);
      } catch (e) {
        setBezig(null);
        return setFout(foutTekst(e));
      }
    }
    await doe('Aanmelden…', () => Sessie.meldAan(opslag, n, DEMO_WACHTWOORD));
  }

  return (
    <main className="ag-aanmelden">
      <h1 className="sp-titel">Agenda</h1>
      <p className="ag-zacht">Voor de leefgroep en de jongeren. Afspraken worden op je toestel versleuteld.</p>

      {isDemo && (
        <section className="sp-kaart ag-demo-knoppen">
          <h2>Probeer de demo als…</h2>
          <div className="ag-rij">
            {DEMO_GEBRUIKERS.map((g) => (
              <button key={g.naam} className="sp-knop sp-knop--rand" disabled={!!bezig} onClick={() => demoAls(g.naam)}>
                {g.label} <span className="ag-zacht">({g.rol})</span>
              </button>
            ))}
          </div>
          <button
            className="ag-link"
            disabled={!!bezig}
            onClick={async () => {
              setBezig('Demo opnieuw klaarzetten…');
              try {
                await vulDemo(opslag as DemoOpslag);
              } finally {
                setBezig(null);
              }
            }}
          >
            Demo terugzetten naar het begin
          </button>
        </section>
      )}

      <div className="sp-tabs" role="tablist">
        {(
          [
            ['aanmelden', 'Aanmelden'],
            ['code', 'Ik heb een code'],
            ['start', 'Nieuwe leefgroep'],
            ['herstel', 'Wachtwoord vergeten'],
          ] as const
        ).map(([t, l]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`sp-tab ${tab === t ? 'sp-tab--actief' : ''}`}
            onClick={() => {
              setTab(t);
              setFout(null);
            }}
          >
            {l}
          </button>
        ))}
      </div>

      {melding && <p className="sp-melding sp-melding--let-op ag-boven">{melding}</p>}

      <form className="ag-formulier" onSubmit={verstuur}>
        {tab === 'herstel' && (
          <>
            <p className="ag-zacht ag-geen-marge">
              Vraag een begeleider om een herstelcode en kies een nieuw wachtwoord. Je gewone en gedeelde afspraken komen terug zodra een
              begeleider je opnieuw toegang geeft. Je privé-afspraken zijn helaas weg.
            </p>
            <Veld label="Herstelcode">
              <input className="sp-invoer" value={code} onChange={(e) => setCode(e.target.value)} required placeholder="ABCD-EFGH-JKMN" autoCapitalize="characters" />
            </Veld>
          </>
        )}
        {tab === 'code' && (
          <Veld label="Uitnodigingscode" hulp="Die kreeg je van een begeleider.">
            <input className="sp-invoer" value={code} onChange={(e) => setCode(e.target.value)} required placeholder="ABCD-EFGH" autoCapitalize="characters" />
          </Veld>
        )}
        {tab === 'start' && (
          <>
            <Veld label="Naam van de leefgroep" hulp="Neutraal houden, zonder naam van de organisatie of plaats (bv. Groep 3). Deze naam is niet versleuteld.">
              <input className="sp-invoer" value={lgNaam} onChange={(e) => setLgNaam(e.target.value)} required maxLength={60} />
            </Veld>
            <Veld label="Jouw initialen" hulp="Geen volledige naam, bv. Ro.">
              <input className="sp-invoer" value={initialen} onChange={(e) => setInitialen(e.target.value)} required maxLength={6} />
            </Veld>
            {!isDemo && (
              <Veld label="Startcode" hulp="Krijg je van de beheerder.">
                <input className="sp-invoer" value={startcode} onChange={(e) => setStartcode(e.target.value)} required />
              </Veld>
            )}
          </>
        )}
        {tab !== 'herstel' && (
          <Veld label="Gebruikersnaam" hulp={tab === 'aanmelden' ? undefined : 'Kies iets zonder je volledige naam, bv. ro-studio3.'}>
            <input className="sp-invoer" value={naam} onChange={(e) => setNaam(e.target.value)} required autoComplete="username" autoCapitalize="none" />
          </Veld>
        )}
        <Veld label={tab === 'herstel' ? 'Nieuw wachtwoord' : 'Wachtwoord'}>
          <input
            className="sp-invoer"
            type="password"
            value={ww}
            onChange={(e) => setWw(e.target.value)}
            required
            autoComplete={tab === 'aanmelden' ? 'current-password' : 'new-password'}
          />
        </Veld>
        {tab !== 'aanmelden' && (
          <>
            <Veld label="Wachtwoord nog eens">
              <input className="sp-invoer" type="password" value={ww2} onChange={(e) => setWw2(e.target.value)} required autoComplete="new-password" />
            </Veld>
            <p className="sp-melding sp-melding--let-op">
              Onthoud je wachtwoord goed. Het opent je sleutels: vergeet je het, dan zijn je privé-afspraken weg. Niemand kan ze terughalen.
            </p>
          </>
        )}
        {fout && <p className="sp-melding sp-melding--fout">{fout}</p>}
        <button className="sp-knop" disabled={!!bezig}>
          {{ aanmelden: 'Aanmelden', code: 'Account maken', start: 'Leefgroep starten', herstel: 'Nieuw wachtwoord instellen' }[tab]}
        </button>
        {bezig && <p className="ag-zacht" aria-live="polite">{bezig}</p>}
      </form>
    </main>
  );
}

function Veld({ label, hulp, children }: { label: string; hulp?: string; children: React.ReactNode }) {
  return (
    <label className="sp-veld">
      <span>{label}</span>
      {children}
      {hulp && <small className="ag-zacht">{hulp}</small>}
    </label>
  );
}

// ── Agenda ───────────────────────────────────────────────────────────────────

function soortLabel(r: Ruimte, sessie: Sessie): string {
  const eigenaar = sessie.profielen.find((p) => p.id === r.eigenaarId);
  switch (r.soort) {
    case 'gedeeld':
      return 'Gedeeld';
    case 'team':
      return 'Leefgroep';
    case 'prive':
      return 'Privé';
    case 'begeleiding':
      return eigenaar && eigenaar.id !== sessie.profiel.id ? eigenaar.initialen : 'Met begeleiding';
  }
}

type Filter = 'alles' | Ruimte['soort'] | `jongere:${string}`;

function Agenda({ sessie, onAfmelden }: { sessie: Sessie; onAfmelden: () => void }) {
  const [week, setWeek] = useState(maandagVan(vandaag()));
  const [afspraken, setAfspraken] = useState<Afspraak[]>([]);
  const [filter, setFilter] = useState<Filter>('alles');
  const [bewerk, setBewerk] = useState<{ afspraak?: Afspraak; datum: string } | null>(null);
  const [beheer, setBeheer] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [ontbreekt, setOntbreekt] = useState<OntbrekendeToegang[]>([]);
  const [wwVenster, setWwVenster] = useState(false);
  const [, herteken] = useState(0);

  const laad = useCallback(async () => {
    try {
      await sessie.laad();
      setAfspraken(await sessie.afspraken());
      setOntbreekt(await sessie.ontbrekendeToegang());
      herteken((x) => x + 1);
    } catch (e) {
      setFout(foutTekst(e));
    }
  }, [sessie]);

  useEffect(() => {
    void laad();
  }, [laad]);

  const dagen = useMemo(() => Array.from({ length: 7 }, (_, i) => plusDagen(week, i)), [week]);
  const zichtbaar = afspraken.filter((a) => {
    if (filter === 'alles') return true;
    if (filter.startsWith('jongere:')) return a.ruimte.soort === 'begeleiding' && a.ruimte.eigenaarId === filter.slice(8);
    return a.ruimte.soort === filter;
  });

  const wachtOpToegang = !sessie.isBegeleider && !sessie.heeftToegang(sessie.ruimte('gedeeld')?.id ?? '');

  const filters: [Filter, string][] = sessie.isBegeleider
    ? [
        ['alles', 'Alles'],
        ['team', 'Leefgroep'],
        ['gedeeld', 'Gedeeld'],
        ...sessie.jongeren().map((j) => [`jongere:${j.id}`, j.initialen] as [Filter, string]),
        ['prive', 'Privé'],
      ]
    : [
        ['alles', 'Alles'],
        ['begeleiding', 'Met begeleiding'],
        ['prive', 'Privé'],
        ['gedeeld', 'Gedeeld'],
      ];

  return (
    <div className="ag-scherm">
      <header className="ag-kop">
        <div>
          <strong>Agenda</strong> <span className="ag-zacht">· {sessie.leefgroep.naam}</span>
        </div>
        <div className="ag-rij">
          <span className="sp-etiket">
            {sessie.profiel.initialen} · {sessie.profiel.rol}
          </span>
          {sessie.isBegeleider && (
            <button className="sp-knop sp-knop--klein sp-knop--rand" onClick={() => setBeheer((b) => !b)}>
              {beheer ? 'Naar de agenda' : 'Leefgroep beheren'}
              {!beheer && ontbreekt.length > 0 && <span className="ag-teller">{new Set(ontbreekt.map((o) => o.profiel.id)).size}</span>}
            </button>
          )}
          <button className="sp-knop sp-knop--klein sp-knop--plat" onClick={() => setWwVenster(true)}>
            Wachtwoord
          </button>
          <button
            className="sp-knop sp-knop--klein sp-knop--plat"
            onClick={async () => {
              await sessie.meldAf();
              onAfmelden();
            }}
          >
            Afmelden
          </button>
        </div>
      </header>

      {fout && <p className="sp-melding sp-melding--fout">{fout}</p>}

      {beheer && sessie.isBegeleider ? (
        <Beheer sessie={sessie} ontbreekt={ontbreekt} onKlaar={laad} />
      ) : (
        <main>
          {!sessie.isBegeleider && (
            <p className="sp-melding">
              Je afspraken zijn standaard zichtbaar voor je begeleiders, zodat ze je kunnen helpen. Is iets alleen voor jou? Kies dan{' '}
              <strong>Alleen ik (privé)</strong>.
            </p>
          )}
          {wachtOpToegang && (
            <p className="sp-melding sp-melding--let-op">
              Welkom! Een begeleider moet je nog toegang geven tot de gedeelde agenda. Je eigen agenda werkt al.
            </p>
          )}

          <div className="ag-balk">
            <div className="ag-rij">
              <button className="sp-knop sp-knop--klein sp-knop--rand" onClick={() => setWeek(plusDagen(week, -7))} aria-label="Vorige week">
                ‹
              </button>
              <strong className="ag-week">
                {kortLabel(dagen[0])} – {kortLabel(dagen[6])}
              </strong>
              <button className="sp-knop sp-knop--klein sp-knop--rand" onClick={() => setWeek(plusDagen(week, 7))} aria-label="Volgende week">
                ›
              </button>
              <button className="sp-knop sp-knop--klein sp-knop--plat" onClick={() => setWeek(maandagVan(vandaag()))}>
                Vandaag
              </button>
            </div>
            <button className="sp-knop" onClick={() => setBewerk({ datum: dagen.includes(vandaag()) ? vandaag() : dagen[0] })}>
              + Afspraak
            </button>
          </div>

          <div className="ag-filters" role="group" aria-label="Toon">
            {filters.map(([f, l]) => (
              <button key={f} className={`ag-chip ${filter === f ? 'ag-chip--aan' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {l}
              </button>
            ))}
          </div>

          <ol className="ag-dagen">
            {dagen.map((d) => {
              const lijst = zichtbaar.filter((a) => a.datum === d);
              return (
                <li key={d} className={`ag-dag ${d === vandaag() ? 'ag-dag--vandaag' : ''}`}>
                  <div className="ag-dagkop">
                    <span>{dagLabel(d)}</span>
                    <button className="ag-plus" onClick={() => setBewerk({ datum: d })} aria-label={`Afspraak op ${dagLabel(d)}`}>
                      +
                    </button>
                  </div>
                  {lijst.length === 0 ? (
                    <p className="ag-leeg">—</p>
                  ) : (
                    lijst.map((a) => (
                      <button key={a.id} className={`ag-item ag-item--${a.ruimte.soort}`} onClick={() => setBewerk({ afspraak: a, datum: a.datum })}>
                        <span className="ag-tijd">{a.van ? `${a.van}${a.tot ? `–${a.tot}` : ''}` : 'hele dag'}</span>
                        <span className="ag-titel">{a.titel}</span>
                        <span className="ag-meta">
                          <span className={`ag-label ag-label--${a.ruimte.soort}`}>{soortLabel(a.ruimte, sessie)}</span>
                          {a.plaats && <span>{a.plaats}</span>}
                          {a.auteur && a.auteur.id !== sessie.profiel.id && <span className="ag-zacht">door {a.auteur.initialen}</span>}
                        </span>
                      </button>
                    ))
                  )}
                </li>
              );
            })}
          </ol>

          <Legende sessie={sessie} />
        </main>
      )}

      {wwVenster && <WachtwoordVenster sessie={sessie} onDicht={() => setWwVenster(false)} />}

      {bewerk && (
        <AfspraakVenster
          sessie={sessie}
          afspraak={bewerk.afspraak}
          datum={bewerk.datum}
          onDicht={() => setBewerk(null)}
          onBewaard={async () => {
            setBewerk(null);
            await laad();
          }}
        />
      )}
    </div>
  );
}

function Legende({ sessie }: { sessie: Sessie }) {
  const items: [Ruimte['soort'], string][] = sessie.isBegeleider
    ? [
        ['team', 'Leefgroep: alleen begeleiders'],
        ['begeleiding', 'Jongere + begeleiders'],
        ['gedeeld', 'Gedeeld: iedereen'],
        ['prive', 'Privé: alleen jij'],
      ]
    : [
        ['begeleiding', 'Jij + je begeleiders'],
        ['prive', 'Privé: alleen jij'],
        ['gedeeld', 'Gedeeld: iedereen'],
      ];
  return (
    <ul className="ag-legende">
      {items.map(([s, l]) => (
        <li key={s}>
          <span className={`ag-stip ag-stip--${s}`} /> {l}
        </li>
      ))}
    </ul>
  );
}

// ── Afspraak toevoegen of wijzigen ───────────────────────────────────────────

function AfspraakVenster({
  sessie,
  afspraak,
  datum,
  onDicht,
  onBewaard,
}: {
  sessie: Sessie;
  afspraak?: Afspraak;
  datum: string;
  onDicht: () => void;
  onBewaard: () => void;
}) {
  const keuzes = sessie.schrijfKeuzes();
  const magWijzigen = !afspraak || sessie.magWijzigen(afspraak);
  const [inhoud, setInhoud] = useState<AfspraakInhoud>(
    afspraak
      ? { titel: afspraak.titel, datum: afspraak.datum, van: afspraak.van, tot: afspraak.tot, plaats: afspraak.plaats, notitie: afspraak.notitie }
      : { titel: '', datum, van: '', tot: '', plaats: '', notitie: '' },
  );
  const [ruimteId, setRuimteId] = useState(afspraak?.ruimte.id ?? keuzes[0]?.ruimte.id ?? '');
  const [heleDag, setHeleDag] = useState(afspraak ? !afspraak.van : false);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const zet = (k: keyof AfspraakInhoud) => (e: { target: { value: string } }) => setInhoud({ ...inhoud, [k]: e.target.value });

  // Een begeleider die de afspraak van een jongere opent: die ruimte staat misschien niet in de keuzes.
  const keuzesMetHuidige =
    afspraak && !keuzes.some((k) => k.ruimte.id === afspraak.ruimte.id)
      ? [{ ruimte: afspraak.ruimte, label: soortLabel(afspraak.ruimte, sessie), uitleg: '' }, ...keuzes]
      : keuzes;

  async function bewaar(e: FormEvent) {
    e.preventDefault();
    setBezig(true);
    setFout(null);
    try {
      await sessie.bewaar({ ...inhoud, titel: inhoud.titel.trim(), van: heleDag ? '' : inhoud.van, tot: heleDag ? '' : inhoud.tot }, ruimteId, afspraak?.id);
      onBewaard();
    } catch (er) {
      setFout(foutTekst(er));
      setBezig(false);
    }
  }

  async function verwijder() {
    if (!afspraak || !confirm(`"${afspraak.titel}" verwijderen?`)) return;
    setBezig(true);
    try {
      await sessie.verwijder(afspraak.id);
      onBewaard();
    } catch (er) {
      setFout(foutTekst(er));
      setBezig(false);
    }
  }

  return (
    <div className="ag-achtergrond" onClick={onDicht}>
      <form className="ag-venster sp-kaart" onClick={(e) => e.stopPropagation()} onSubmit={bewaar} aria-label="Afspraak">
        <h2>{afspraak ? (magWijzigen ? 'Afspraak wijzigen' : 'Afspraak') : 'Nieuwe afspraak'}</h2>
        <fieldset disabled={!magWijzigen || bezig}>
          <Veld label="Wat">
            <input className="sp-invoer" value={inhoud.titel} onChange={zet('titel')} required maxLength={120} autoFocus={!afspraak} />
          </Veld>
          <div className="ag-rij ag-rij--velden">
            <Veld label="Datum">
              <input className="sp-invoer" type="date" value={inhoud.datum} onChange={zet('datum')} required />
            </Veld>
            {!heleDag && (
              <>
                <Veld label="Van">
                  <input className="sp-invoer" type="time" value={inhoud.van} onChange={zet('van')} required />
                </Veld>
                <Veld label="Tot">
                  <input className="sp-invoer" type="time" value={inhoud.tot} onChange={zet('tot')} min={inhoud.van || undefined} />
                </Veld>
              </>
            )}
          </div>
          <label className="ag-vink">
            <input type="checkbox" checked={heleDag} onChange={(e) => setHeleDag(e.target.checked)} /> Hele dag
          </label>
          <Veld label="Waar (niet verplicht)">
            <input className="sp-invoer" value={inhoud.plaats} onChange={zet('plaats')} maxLength={120} />
          </Veld>
          <Veld label="Notitie (niet verplicht)">
            <textarea className="sp-invoer" rows={2} value={inhoud.notitie} onChange={zet('notitie')} maxLength={1000} />
          </Veld>

          <div className="ag-wie" role="radiogroup" aria-label="Wie ziet dit?">
            <span className="ag-wie-titel">Wie ziet dit?</span>
            {keuzesMetHuidige.map((k) => (
              <label key={k.ruimte.id} className={`ag-wie-keuze ag-wie-keuze--${k.ruimte.soort} ${ruimteId === k.ruimte.id ? 'ag-wie-keuze--aan' : ''}`}>
                <input type="radio" name="wie" checked={ruimteId === k.ruimte.id} onChange={() => setRuimteId(k.ruimte.id)} />
                <span>
                  <strong>{k.label}</strong>
                  {k.uitleg && <small>{k.uitleg}</small>}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {!magWijzigen && <p className="ag-zacht">Deze afspraak is van {afspraak?.auteur?.initialen ?? 'iemand anders'}. Je kan hem bekijken, niet wijzigen.</p>}
        {fout && <p className="sp-melding sp-melding--fout">{fout}</p>}
        <div className="ag-rij ag-rij--knoppen">
          {afspraak && magWijzigen && (
            <button type="button" className="sp-knop sp-knop--gevaar sp-knop--rand" onClick={verwijder} disabled={bezig}>
              Verwijderen
            </button>
          )}
          <span className="ag-vul" />
          <button type="button" className="sp-knop sp-knop--plat" onClick={onDicht}>
            {magWijzigen ? 'Annuleren' : 'Sluiten'}
          </button>
          {magWijzigen && (
            <button className="sp-knop" disabled={bezig || !ruimteId}>
              {bezig ? 'Versleutelen…' : 'Bewaren'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

// ── Leefgroep beheren (begeleiders) ──────────────────────────────────────────

function Beheer({ sessie, ontbreekt, onKlaar }: { sessie: Sessie; ontbreekt: OntbrekendeToegang[]; onKlaar: () => Promise<void> }) {
  const [rol, setRol] = useState<Rol>('jongere');
  const [initialen, setInitialen] = useState('');
  const [open, setOpen] = useState<Uitnodiging[]>([]);
  const [nieuw, setNieuw] = useState<Uitnodiging | null>(null);
  const [herstel, setHerstel] = useState<{ initialen: string; code: string } | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  const laadOpen = useCallback(async () => setOpen(await sessie.openUitnodigingen()), [sessie]);
  useEffect(() => {
    void laadOpen();
  }, [laadOpen]);

  const perPersoon = new Map<string, OntbrekendeToegang[]>();
  for (const o of ontbreekt) perPersoon.set(o.profiel.id, [...(perPersoon.get(o.profiel.id) ?? []), o]);

  async function nodigUit(e: FormEvent) {
    e.preventDefault();
    setFout(null);
    try {
      setNieuw(await sessie.nodigUit(rol, initialen.trim()));
      setInitialen('');
      await laadOpen();
    } catch (er) {
      setFout(foutTekst(er));
    }
  }

  const ruimteNaam = (o: OntbrekendeToegang) =>
    o.ruimte.soort === 'begeleiding' ? `agenda van ${sessie.profielen.find((p) => p.id === o.ruimte.eigenaarId)?.initialen}` : soortLabel(o.ruimte, sessie).toLowerCase();

  return (
    <main className="ag-beheer">
      {perPersoon.size > 0 && (
        <section className="sp-kaart sp-kaart--accent">
          <h2>Wacht op toegang</h2>
          <p className="ag-zacht">Nieuwe leden kunnen de gedeelde agenda's pas lezen als een begeleider de sleutel doorgeeft.</p>
          <ul className="ag-lijst">
            {[...perPersoon.entries()].map(([id, lijst]) => (
              <li key={id} className="ag-rij">
                <span>
                  <strong>{lijst[0].profiel.initialen}</strong> ({lijst[0].profiel.rol}): {lijst.map(ruimteNaam).join(', ')}
                </span>
                <button
                  className="sp-knop sp-knop--klein"
                  disabled={bezig}
                  onClick={async () => {
                    setBezig(true);
                    try {
                      await sessie.geefToegang(lijst);
                      await onKlaar();
                    } catch (er) {
                      setFout(foutTekst(er));
                    } finally {
                      setBezig(false);
                    }
                  }}
                >
                  Toegang geven
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="sp-kaart">
        <h2>Iemand uitnodigen</h2>
        <form className="ag-rij ag-rij--velden" onSubmit={nodigUit}>
          <Veld label="Rol">
            <select className="sp-invoer" value={rol} onChange={(e) => setRol(e.target.value as Rol)}>
              <option value="jongere">Jongere</option>
              <option value="begeleider">Begeleider</option>
            </select>
          </Veld>
          <Veld label="Initialen" hulp="Geen volledige naam.">
            <input className="sp-invoer" value={initialen} onChange={(e) => setInitialen(e.target.value)} required maxLength={6} />
          </Veld>
          <button className="sp-knop ag-onder">Code maken</button>
        </form>
        {nieuw && (
          <p className="sp-melding sp-melding--goed">
            Code voor {nieuw.initialen}: <strong className="ag-code">{nieuw.code}</strong>
            <br />
            Geef deze code persoonlijk door. Hij werkt één keer en vervalt na 14 dagen.
          </p>
        )}
        {fout && <p className="sp-melding sp-melding--fout">{fout}</p>}
        {open.length > 0 && (
          <>
            <h3>Openstaande codes</h3>
            <ul className="ag-lijst">
              {open.map((u) => (
                <li key={u.code} className="ag-rij">
                  <span>
                    <span className="ag-code">{u.code}</span> · {u.initialen} ({u.rol})
                  </span>
                  <button
                    className="sp-knop sp-knop--klein sp-knop--plat"
                    onClick={async () => {
                      await sessie.opslag.trekUitnodigingIn(u.code);
                      await laadOpen();
                    }}
                  >
                    Intrekken
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="sp-kaart">
        <h2>Leden van {sessie.leefgroep.naam}</h2>
        {herstel && (
          <p className="sp-melding sp-melding--goed">
            Herstelcode voor {herstel.initialen}: <strong className="ag-code">{herstel.code}</strong>
            <br />
            Geef ze persoonlijk door. Ze werkt één keer, 24 uur lang. Daarna staat {herstel.initialen} hierboven bij "Wacht op toegang".
          </p>
        )}
        <ul className="ag-lijst">
          {[...sessie.profielen]
            .sort((a, b) => a.rol.localeCompare(b.rol) || a.initialen.localeCompare(b.initialen))
            .map((p) => (
              <li key={p.id} className="ag-rij">
                <span>
                  <strong>{p.initialen}</strong> <span className="ag-zacht">{p.rol}</span>
                  {p.id === sessie.profiel.id && <span className="ag-zacht"> (jij)</span>}
                </span>
                {p.id !== sessie.profiel.id && (
                  <span className="ag-rij">
                    <button
                      className="sp-knop sp-knop--klein sp-knop--plat"
                      disabled={bezig}
                      onClick={async () => {
                        setFout(null);
                        try {
                          setHerstel({ initialen: p.initialen, code: await sessie.herstelcode(p.id) });
                        } catch (er) {
                          setFout(foutTekst(er));
                        }
                      }}
                    >
                      Wachtwoord vergeten
                    </button>
                    <button
                      className="sp-knop sp-knop--klein sp-knop--gevaar sp-knop--rand"
                      disabled={bezig}
                      onClick={async () => {
                        const uitleg =
                          p.rol === 'jongere'
                            ? `${p.initialen} verwijderen? Het account, de eigen agenda en alle afspraken van ${p.initialen} worden gewist. Dit kan niet ongedaan gemaakt worden.`
                            : `${p.initialen} verwijderen? Het account wordt gewist. Afspraken die ${p.initialen} in de gedeelde agenda's zette, blijven staan. Dit kan niet ongedaan gemaakt worden.`;
                        if (!confirm(uitleg)) return;
                        setBezig(true);
                        setFout(null);
                        try {
                          await sessie.verwijderLid(p.id);
                          await onKlaar();
                        } catch (er) {
                          setFout(foutTekst(er));
                        } finally {
                          setBezig(false);
                        }
                      }}
                    >
                      Verwijderen
                    </button>
                  </span>
                )}
              </li>
            ))}
        </ul>
        {bezig && <p className="ag-zacht">Bezig… de sleutels worden vernieuwd.</p>}
      </section>
    </main>
  );
}

// ── Wachtwoord wijzigen ──────────────────────────────────────────────────────

function WachtwoordVenster({ sessie, onDicht }: { sessie: Sessie; onDicht: () => void }) {
  const [oud, setOud] = useState('');
  const [nieuw, setNieuw] = useState('');
  const [nieuw2, setNieuw2] = useState('');
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [klaar, setKlaar] = useState(false);

  async function bewaar(e: FormEvent) {
    e.preventDefault();
    setFout(null);
    if (nieuw.length < 8) return setFout('Kies een wachtwoord van minstens 8 tekens.');
    if (nieuw !== nieuw2) return setFout('De twee nieuwe wachtwoorden zijn niet gelijk.');
    setBezig(true);
    try {
      await sessie.wijzigWachtwoord(oud, nieuw);
      setKlaar(true);
    } catch (er) {
      setFout(foutTekst(er));
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="ag-achtergrond" onClick={onDicht}>
      <form className="ag-venster sp-kaart" onClick={(e) => e.stopPropagation()} onSubmit={bewaar} aria-label="Wachtwoord wijzigen">
        <h2>Wachtwoord wijzigen</h2>
        {klaar ? (
          <p className="sp-melding sp-melding--goed">Je wachtwoord is gewijzigd. Gebruik voortaan het nieuwe.</p>
        ) : (
          <fieldset disabled={bezig}>
            <Veld label="Huidig wachtwoord">
              <input className="sp-invoer" type="password" value={oud} onChange={(e) => setOud(e.target.value)} required autoComplete="current-password" />
            </Veld>
            <Veld label="Nieuw wachtwoord">
              <input className="sp-invoer" type="password" value={nieuw} onChange={(e) => setNieuw(e.target.value)} required autoComplete="new-password" />
            </Veld>
            <Veld label="Nieuw wachtwoord nog eens">
              <input className="sp-invoer" type="password" value={nieuw2} onChange={(e) => setNieuw2(e.target.value)} required autoComplete="new-password" />
            </Veld>
          </fieldset>
        )}
        {fout && <p className="sp-melding sp-melding--fout">{fout}</p>}
        <div className="ag-rij ag-rij--knoppen">
          <span className="ag-vul" />
          <button type="button" className="sp-knop sp-knop--plat" onClick={onDicht}>
            {klaar ? 'Sluiten' : 'Annuleren'}
          </button>
          {!klaar && (
            <button className="sp-knop" disabled={bezig}>
              {bezig ? 'Bezig…' : 'Wijzigen'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

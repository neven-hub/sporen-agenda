import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Sessie } from './kluis/sessie';
import type { AfvinkInhoud, Notitie, OverdrachtInhoud, TaakInhoud } from './kluis/model';
import { dagLabel, kortLabel, plusDagen, vandaag } from './datum';

function foutTekst(e: unknown): string {
  return e instanceof Error ? e.message : 'Er ging iets mis.';
}

function tijdstip(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const dag = d.toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' });
  const uur = d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
  return `${dag} ${uur}`;
}

const VERVERS_MS = 60_000;

/**
 * Alleen voor begeleiders: de dagchecklist (begint elke dag leeg) en de
 * overdracht. Alles staat versleuteld in de teamruimte.
 */
export function Dag({ sessie }: { sessie: Sessie }) {
  const [notities, setNotities] = useState<Notitie[]>([]);
  const [datum, setDatum] = useState(vandaag());
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);

  const laad = useCallback(async () => {
    try {
      setNotities(await sessie.notities());
      setFout(null);
    } catch (e) {
      setFout(foutTekst(e));
    }
  }, [sessie]);

  useEffect(() => {
    void laad();
    const klok = window.setInterval(() => void laad(), VERVERS_MS);
    const opFocus = () => void laad();
    window.addEventListener('focus', opFocus);
    return () => {
      window.clearInterval(klok);
      window.removeEventListener('focus', opFocus);
    };
  }, [laad]);

  async function doe(f: () => Promise<void>) {
    setBezig(true);
    setFout(null);
    try {
      await f();
      await laad();
    } catch (e) {
      setFout(foutTekst(e));
    } finally {
      setBezig(false);
    }
  }

  const taken = notities.filter((n): n is Notitie<TaakInhoud> => n.soort === 'taak').sort((a, b) => a.volgorde - b.volgorde);
  const afgevinkt = new Map(
    notities.filter((n): n is Notitie<AfvinkInhoud> => n.soort === 'afvink' && n.datum === datum).map((n) => [n.taakId, n]),
  );
  const overdracht = notities
    .filter((n): n is Notitie<OverdrachtInhoud> => n.soort === 'overdracht' && (!n.tot || n.tot >= vandaag()))
    .sort((a, b) => Number(b.belangrijk) - Number(a.belangrijk) || b.om.localeCompare(a.om));

  return (
    <main className="ag-dagscherm">
      {fout && <p className="sp-melding sp-melding--fout">{fout}</p>}
      <div className="ag-dag-kolommen">
        <Checklist
          sessie={sessie}
          datum={datum}
          setDatum={setDatum}
          taken={taken}
          afgevinkt={afgevinkt}
          bezig={bezig}
          doe={doe}
        />
        <Overdracht sessie={sessie} lijst={overdracht} bezig={bezig} doe={doe} />
      </div>
      <p className="ag-zacht ag-klein">Alleen begeleiders zien dit. Alles is versleuteld. Wordt elke minuut ververst.</p>
    </main>
  );
}

// ── Checklist ────────────────────────────────────────────────────────────────

function Checklist({
  sessie,
  datum,
  setDatum,
  taken,
  afgevinkt,
  bezig,
  doe,
}: {
  sessie: Sessie;
  datum: string;
  setDatum: (d: string) => void;
  taken: Notitie<TaakInhoud>[];
  afgevinkt: Map<string, Notitie<AfvinkInhoud>>;
  bezig: boolean;
  doe: (f: () => Promise<void>) => Promise<void>;
}) {
  const [beheren, setBeheren] = useState(false);
  const [nieuw, setNieuw] = useState('');
  const klaar = taken.filter((t) => afgevinkt.has(t.id)).length;

  function vink(t: Notitie<TaakInhoud>) {
    const a = afgevinkt.get(t.id);
    void doe(() =>
      a
        ? sessie.verwijderNotitie(a.id)
        : sessie.bewaarNotitie({ soort: 'afvink', taakId: t.id, datum, door: sessie.profiel.initialen, om: new Date().toISOString() }),
    );
  }

  function voegToe(e: FormEvent) {
    e.preventDefault();
    const tekst = nieuw.trim();
    if (!tekst) return;
    const volgorde = (taken.at(-1)?.volgorde ?? 0) + 1;
    setNieuw('');
    void doe(() => sessie.bewaarNotitie({ soort: 'taak', tekst, volgorde }));
  }

  function verschuif(i: number, richting: -1 | 1) {
    const a = taken[i];
    const b = taken[i + richting];
    if (!a || !b) return;
    void doe(async () => {
      await sessie.bewaarNotitie({ soort: 'taak', tekst: a.tekst, volgorde: b.volgorde }, a.id);
      await sessie.bewaarNotitie({ soort: 'taak', tekst: b.tekst, volgorde: a.volgorde }, b.id);
    });
  }

  return (
    <section className="sp-kaart ag-checklist">
      <div className="ag-sectiekop">
        <h2>Checklist</h2>
        <button className="sp-knop sp-knop--klein sp-knop--plat" onClick={() => setBeheren((x) => !x)}>
          {beheren ? 'Klaar met aanpassen' : 'Lijst aanpassen'}
        </button>
      </div>

      {!beheren && (
        <div className="ag-rij ag-dagkiezer">
          <button className="sp-knop sp-knop--klein sp-knop--rand" onClick={() => setDatum(plusDagen(datum, -1))} aria-label="Vorige dag">
            ‹
          </button>
          <strong className="ag-dagnaam">{dagLabel(datum)}</strong>
          <button className="sp-knop sp-knop--klein sp-knop--rand" onClick={() => setDatum(plusDagen(datum, 1))} aria-label="Volgende dag">
            ›
          </button>
          {datum !== vandaag() && (
            <button className="sp-knop sp-knop--klein sp-knop--plat" onClick={() => setDatum(vandaag())}>
              Vandaag
            </button>
          )}
          {taken.length > 0 && (
            <span className="ag-voortgang" aria-live="polite">
              {klaar} van {taken.length} gedaan
            </span>
          )}
        </div>
      )}

      {taken.length === 0 && !beheren && (
        <p className="ag-zacht">Nog geen taken. Klik op "Lijst aanpassen" om de vaste taken van de dag toe te voegen.</p>
      )}

      {!beheren ? (
        <ul className="ag-taken">
          {taken.map((t) => {
            const a = afgevinkt.get(t.id);
            return (
              <li key={t.id} className={a ? 'ag-taak ag-taak--klaar' : 'ag-taak'}>
                <label>
                  <input type="checkbox" checked={!!a} disabled={bezig} onChange={() => vink(t)} />
                  <span className="ag-taaktekst">{t.tekst}</span>
                </label>
                {a && (
                  <span className="ag-zacht ag-klein">
                    {a.door} · {tijdstip(a.om).split(' ').at(-1)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <>
          <p className="ag-zacht ag-klein">
            Dit is de vaste lijst: hij geldt voor elke dag. Wat al afgevinkt is, blijft afgevinkt. Een taak verwijderen haalt hem weg voor alle dagen.
          </p>
          <ul className="ag-taken ag-taken--beheer">
            {taken.map((t, i) => (
              <TaakRegel
                key={t.id}
                taak={t}
                eerste={i === 0}
                laatste={i === taken.length - 1}
                bezig={bezig}
                onOp={() => verschuif(i, -1)}
                onNeer={() => verschuif(i, 1)}
                onTekst={(tekst) => void doe(() => sessie.bewaarNotitie({ soort: 'taak', tekst, volgorde: t.volgorde }, t.id))}
                onWeg={() => {
                  if (confirm(`"${t.tekst}" van de checklist halen?`)) void doe(() => sessie.verwijderNotitie(t.id));
                }}
              />
            ))}
          </ul>
          <form className="ag-rij ag-nieuwe-taak" onSubmit={voegToe}>
            <input
              className="sp-invoer"
              value={nieuw}
              onChange={(e) => setNieuw(e.target.value)}
              placeholder="Nieuwe taak, bv. Medicatie klaarzetten"
              maxLength={200}
              aria-label="Nieuwe taak"
            />
            <button className="sp-knop" disabled={bezig || !nieuw.trim()}>
              Toevoegen
            </button>
          </form>
        </>
      )}
    </section>
  );
}

function TaakRegel({
  taak,
  eerste,
  laatste,
  bezig,
  onOp,
  onNeer,
  onTekst,
  onWeg,
}: {
  taak: Notitie<TaakInhoud>;
  eerste: boolean;
  laatste: boolean;
  bezig: boolean;
  onOp: () => void;
  onNeer: () => void;
  onTekst: (t: string) => void;
  onWeg: () => void;
}) {
  const [tekst, setTekst] = useState(taak.tekst);
  useEffect(() => setTekst(taak.tekst), [taak.tekst]);
  const bewaar = () => {
    const t = tekst.trim();
    if (t && t !== taak.tekst) onTekst(t);
    else setTekst(taak.tekst);
  };
  return (
    <li className="ag-taak ag-taak--beheer">
      <input
        className="sp-invoer"
        value={tekst}
        onChange={(e) => setTekst(e.target.value)}
        onBlur={bewaar}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        maxLength={200}
        aria-label="Taak"
      />
      <button className="sp-knop sp-knop--klein sp-knop--plat" disabled={bezig || eerste} onClick={onOp} aria-label="Omhoog">
        ↑
      </button>
      <button className="sp-knop sp-knop--klein sp-knop--plat" disabled={bezig || laatste} onClick={onNeer} aria-label="Omlaag">
        ↓
      </button>
      <button className="sp-knop sp-knop--klein sp-knop--gevaar sp-knop--rand" disabled={bezig} onClick={onWeg} aria-label={`${taak.tekst} verwijderen`}>
        ✕
      </button>
    </li>
  );
}

// ── Overdracht ───────────────────────────────────────────────────────────────

function Overdracht({
  sessie,
  lijst,
  bezig,
  doe,
}: {
  sessie: Sessie;
  lijst: Notitie<OverdrachtInhoud>[];
  bezig: boolean;
  doe: (f: () => Promise<void>) => Promise<void>;
}) {
  const [tekst, setTekst] = useState('');
  const [belangrijk, setBelangrijk] = useState(false);
  const [tijdelijk, setTijdelijk] = useState(false);
  const [tot, setTot] = useState(plusDagen(vandaag(), 1));

  function bewaar(e: FormEvent) {
    e.preventDefault();
    const t = tekst.trim();
    if (!t) return;
    void doe(async () => {
      await sessie.bewaarNotitie({
        soort: 'overdracht',
        tekst: t,
        tot: tijdelijk ? tot : '',
        belangrijk,
        door: sessie.profiel.initialen,
        om: new Date().toISOString(),
      });
      setTekst('');
      setBelangrijk(false);
      setTijdelijk(false);
    });
  }

  return (
    <section className="sp-kaart ag-overdracht">
      <div className="ag-sectiekop">
        <h2>Overdracht</h2>
      </div>
      <form className="ag-overdracht-form" onSubmit={bewaar}>
        <textarea
          className="sp-invoer"
          rows={3}
          value={tekst}
          onChange={(e) => setTekst(e.target.value)}
          placeholder="Wat moet de volgende dienst weten?"
          maxLength={2000}
          aria-label="Overdracht"
        />
        <div className="ag-rij">
          <label className="ag-vink">
            <input type="checkbox" checked={belangrijk} onChange={(e) => setBelangrijk(e.target.checked)} /> Belangrijk
          </label>
          <label className="ag-vink">
            <input type="checkbox" checked={tijdelijk} onChange={(e) => setTijdelijk(e.target.checked)} /> Tijdelijk, tot en met
          </label>
          {tijdelijk && (
            <input className="sp-invoer ag-datumveld" type="date" value={tot} min={vandaag()} onChange={(e) => setTot(e.target.value)} aria-label="Tot en met" />
          )}
          <span className="ag-vul" />
          <button className="sp-knop" disabled={bezig || !tekst.trim()}>
            Noteren
          </button>
        </div>
      </form>

      {lijst.length === 0 ? (
        <p className="ag-zacht">Geen openstaande overdracht.</p>
      ) : (
        <ul className="ag-overdracht-lijst">
          {lijst.map((n) => (
            <li key={n.id} className={n.belangrijk ? 'ag-notitie ag-notitie--belangrijk' : 'ag-notitie'}>
              <p className="ag-notitie-tekst">{n.tekst}</p>
              <div className="ag-rij ag-notitie-meta">
                {n.belangrijk && <span className="ag-label ag-label--gedeeld">Belangrijk</span>}
                {n.tot && <span className="ag-label ag-label--team">tot en met {kortLabel(n.tot)}</span>}
                <span className="ag-zacht">
                  {n.door} · {tijdstip(n.om)}
                </span>
                <span className="ag-vul" />
                <button
                  className="sp-knop sp-knop--klein sp-knop--plat"
                  disabled={bezig}
                  onClick={() => {
                    if (confirm('Deze notitie verwijderen?')) void doe(() => sessie.verwijderNotitie(n.id));
                  }}
                >
                  Verwijderen
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="ag-zacht ag-klein">Tijdelijke notities verdwijnen na hun datum vanzelf. Andere blijven staan tot iemand ze verwijdert.</p>
    </section>
  );
}

// Rooktest tegen het echte Supabase-project (geen startcode nodig).
// Controleert: verbinding, "Confirm email" uit, rechten voor niet-aangemelden,
// functies bereikbaar, startcode-controle.
// Gebruik: node --env-file=.env.production.local scripts/rooktest.mjs
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('VITE_SUPABASE_URL en VITE_SUPABASE_ANON_KEY ontbreken (.env.production.local).');

const db = createClient(url, key, { auth: { persistSession: false } });
let fouten = 0;
const ok = (naam, voorwaarde, extra = '') => {
  console.log(`${voorwaarde ? '✓' : '✗'} ${naam}${extra ? ` (${extra})` : ''}`);
  if (!voorwaarde) fouten++;
};

// 1. Niet aangemeld: geen tabellen, geen functies behalve herstellen
for (const t of ['afspraken', 'profielen', 'sleutels', 'ruimtes', 'leefgroepen', 'uitnodigingen', 'herstelcodes', 'notities']) {
  const { data, error } = await db.from(t).select('*').limit(1);
  ok(`anon leest ${t} niet`, !!error || (data ?? []).length === 0, error?.message ?? 'leeg');
}
{
  const { error } = await db.rpc('maak_uitnodiging', { p_rol: 'jongere', p_initialen: 'X' });
  ok('anon kan geen uitnodiging maken', !!error, error?.message);
}
{
  const { error } = await db.rpc('gebruik_herstelcode', { p_code: 'BESTAAT-NIET-0000', p_wachtwoord: 'xxxxxxxxxx', p_publieke_sleutel: {}, p_prive_sleutel: {}, p_zout: 'z' });
  ok('herstelfunctie bereikbaar en weigert foute code', !!error && /herstelcode/i.test(error.message), error?.message);
}

// 2. Account maken zonder e-mailbevestiging
const naam = `rooktest-${Date.now()}`;
const { data: su, error: suFout } = await db.auth.signUp({ email: `${naam}@agenda.invalid`, password: `Rook-${crypto.randomUUID()}` });
ok('account maken werkt', !suFout && !!su.user, suFout?.message);
ok('geen e-mailbevestiging nodig (meteen aangemeld)', !!su.session);

if (su.session) {
  const { data: p, error: pFout } = await db.rpc('mijn_profiel');
  ok('aangemeld zonder profiel: mijn_profiel is leeg', !pFout && (!p || !p.id), pFout?.message);
  const { error: sFout } = await db.rpc('start_leefgroep', {
    p_naam: 'Rooktest', p_startcode: 'fout-code', p_initialen: 'Rt', p_publieke_sleutel: {}, p_prive_sleutel: {}, p_zout: 'z',
  });
  ok('leefgroep starten met foute startcode wordt geweigerd', !!sFout && /startcode/i.test(sFout.message), sFout?.message);
  const { error: rFout } = await db.from('ruimtes').insert({ leefgroep_id: crypto.randomUUID(), soort: 'team' });
  ok('zonder leefgroep geen agenda maken', !!rFout, rFout?.message);
  console.log(`\nTestaccount: ${naam}@agenda.invalid (zonder profiel, mag weg in Authentication → Users).`);
}

console.log(fouten ? `\n${fouten} controle(s) mislukt.` : '\nAlles in orde.');
process.exit(fouten ? 1 : 0);

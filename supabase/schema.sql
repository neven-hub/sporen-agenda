-- ═══════════════════════════════════════════════════════════════════════════
-- Agenda Sporen — schema voor Supabase (regio Frankfurt, eu-central-1)
--
-- Plak dit in Supabase → SQL Editor → New query → Run. Het mag opnieuw
-- gedraaid worden (alles is "if not exists" / "or replace").
--
-- Principe: de database ziet nooit leesbare afspraken. De app versleutelt in de
-- browser; hier staan alleen pseudoniemen (initialen), publieke sleutels en
-- versleutelde pakketten. De regels hieronder (RLS) zijn een tweede slot:
-- ook wie de versleutelde rijen niet mag zien, krijgt ze niet.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Tabellen ────────────────────────────────────────────────────────────────

create table if not exists public.leefgroepen (
  id          uuid primary key default gen_random_uuid(),
  naam        text not null check (char_length(naam) between 1 and 60),
  aangemaakt  timestamptz not null default now()
);

create table if not exists public.profielen (
  id                uuid primary key references auth.users (id) on delete cascade,
  leefgroep_id      uuid not null references public.leefgroepen (id) on delete cascade,
  initialen         text not null check (char_length(initialen) between 1 and 6),
  rol               text not null check (rol in ('begeleider', 'jongere')),
  publieke_sleutel  jsonb not null,
  prive_sleutel     jsonb not null,   -- versleuteld met het wachtwoord van de persoon
  zout              text not null,
  aangemaakt        timestamptz not null default now()
);

create table if not exists public.ruimtes (
  id               uuid primary key default gen_random_uuid(),
  leefgroep_id     uuid not null references public.leefgroepen (id) on delete cascade,
  soort            text not null check (soort in ('prive', 'begeleiding', 'team', 'gedeeld')),
  eigenaar_id      uuid references public.profielen (id) on delete cascade,
  aangemaakt_door  uuid default auth.uid() references public.profielen (id) on delete set null,
  check ((soort in ('prive', 'begeleiding')) = (eigenaar_id is not null)),
  unique nulls not distinct (leefgroep_id, soort, eigenaar_id)
);

create table if not exists public.sleutels (
  ruimte_id   uuid not null references public.ruimtes (id) on delete cascade,
  profiel_id  uuid not null references public.profielen (id) on delete cascade,
  ingepakt    jsonb not null,   -- ruimtesleutel, ingepakt met de publieke sleutel van dit lid
  primary key (ruimte_id, profiel_id)
);

create table if not exists public.afspraken (
  id           uuid primary key default gen_random_uuid(),
  ruimte_id    uuid not null references public.ruimtes (id) on delete cascade,
  auteur_id    uuid default auth.uid() references public.profielen (id) on delete set null,
  inhoud       jsonb not null,   -- versleuteld: titel, datum, uren, plaats, notitie
  bewaren_tot  date not null,    -- grove datum (1e van een maand) voor automatisch opruimen
  aangemaakt   timestamptz not null default now(),
  gewijzigd    timestamptz not null default now()
);
create index if not exists afspraken_ruimte on public.afspraken (ruimte_id);

create table if not exists public.uitnodigingen (
  code             text primary key,
  leefgroep_id     uuid not null references public.leefgroepen (id) on delete cascade,
  rol              text not null check (rol in ('begeleider', 'jongere')),
  initialen        text not null check (char_length(initialen) between 1 and 6),
  aangemaakt_door  uuid not null default auth.uid() references public.profielen (id) on delete cascade,
  vervalt          timestamptz not null default now() + interval '14 days'
);

-- Herstelcodes voor wie zijn wachtwoord vergat (24 uur geldig, eenmalig).
create table if not exists public.herstelcodes (
  code             text primary key,
  profiel_id       uuid not null references public.profielen (id) on delete cascade,
  aangemaakt_door  uuid references public.profielen (id) on delete set null,
  vervalt          timestamptz not null default now() + interval '24 hours'
);

-- Startcodes: alleen te zien en te maken in de SQL Editor (geen toegang voor de app).
-- Een nieuwe leefgroep starten kan alleen met zo'n code. Voorbeeld:
--   insert into private.startcodes (code) values ('kies-hier-een-lange-code');
create schema if not exists private;
create table if not exists private.startcodes (
  code       text primary key,
  gebruikt   timestamptz
);
revoke all on schema private from anon, authenticated;
alter table private.startcodes enable row level security;  -- extra slot; alleen functies (als eigenaar) komen erbij

-- ── Hulpfuncties ────────────────────────────────────────────────────────────

create or replace function public.mijn_leefgroep() returns uuid
language sql stable security definer set search_path = '' as $$
  select leefgroep_id from public.profielen where id = auth.uid()
$$;

create or replace function public.ben_begeleider() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profielen where id = auth.uid() and rol = 'begeleider')
$$;

create or replace function public.heb_sleutel(p_ruimte uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sleutels where ruimte_id = p_ruimte and profiel_id = auth.uid())
$$;

-- Hoort dit profiel een sleutel voor deze ruimte te hebben?
create or replace function public.verwacht_lid(p_ruimte uuid, p_profiel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.ruimtes r
    join public.profielen p on p.id = p_profiel and p.leefgroep_id = r.leefgroep_id
    where r.id = p_ruimte
      and case r.soort
            when 'prive'       then p.id = r.eigenaar_id
            when 'begeleiding' then p.id = r.eigenaar_id or p.rol = 'begeleider'
            when 'team'        then p.rol = 'begeleider'
            when 'gedeeld'     then true
          end
  )
$$;

-- ── Tabelrechten ────────────────────────────────────────────────────────────
-- Expliciet, zodat het niet afhangt van "Grant API access to new tables
-- automatically". Alleen aangemelde gebruikers; anon krijgt geen enkele tabel.
-- Wat ze per rij mogen, bepalen de regels (RLS) hieronder.
revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete on public.leefgroepen, public.ruimtes, public.sleutels,
  public.afspraken, public.uitnodigingen to authenticated;

-- ── Toegangsregels (RLS) ────────────────────────────────────────────────────

alter table public.leefgroepen   enable row level security;
alter table public.profielen     enable row level security;
alter table public.ruimtes       enable row level security;
alter table public.sleutels      enable row level security;
alter table public.afspraken     enable row level security;
alter table public.uitnodigingen enable row level security;
alter table public.herstelcodes  enable row level security;  -- geen regels: alleen via functies

-- Leefgroep: alleen je eigen.
drop policy if exists leefgroep_lezen on public.leefgroepen;
create policy leefgroep_lezen on public.leefgroepen for select to authenticated
  using (id = public.mijn_leefgroep());

-- Profielen: leden van je leefgroep zien elkaars initialen, rol en publieke sleutel.
-- De versleutelde private sleutel en het zout zijn kolommen die de app niet
-- rechtstreeks mag lezen; je eigen profiel komt via mijn_profiel().
drop policy if exists profiel_lezen on public.profielen;
create policy profiel_lezen on public.profielen for select to authenticated
  using (leefgroep_id = public.mijn_leefgroep());
revoke select on public.profielen from anon, authenticated;
grant select (id, leefgroep_id, initialen, rol, publieke_sleutel) on public.profielen to authenticated;
revoke insert, update, delete on public.profielen from anon, authenticated;

-- Ruimtes: zien binnen je leefgroep. Maken: je eigen privé-ruimte; een jongere
-- ook zijn begeleidingsruimte; team en gedeeld alleen begeleiders.
drop policy if exists ruimte_lezen on public.ruimtes;
create policy ruimte_lezen on public.ruimtes for select to authenticated
  using (leefgroep_id = public.mijn_leefgroep());
drop policy if exists ruimte_maken on public.ruimtes;
create policy ruimte_maken on public.ruimtes for insert to authenticated
  with check (
    leefgroep_id = public.mijn_leefgroep()
    and aangemaakt_door = auth.uid()
    and (
      (soort = 'prive' and eigenaar_id = auth.uid())
      or (soort = 'begeleiding' and eigenaar_id = auth.uid() and not public.ben_begeleider())
      or (soort in ('team', 'gedeeld') and public.ben_begeleider())
    )
  );

-- Sleutels: je ziet je eigen ingepakte sleutels, en die van een ruimte waarvan je
-- zelf de sleutel hebt of die je maakte. (Nodig omdat toegang geven een
-- "insert of update" is, en Postgres dan ook leesrecht vraagt. Een ingepakte
-- sleutel van iemand anders is onbruikbaar zonder diens private sleutel.)
-- Iemand toegang geven kan als je zelf de sleutel hebt (of de ruimte net maakte),
-- en alleen aan wie erbij hoort. Een privé-ruimte deel je met niemand:
-- verwacht_lid laat alleen de eigenaar toe.
drop policy if exists sleutel_lezen on public.sleutels;
create policy sleutel_lezen on public.sleutels for select to authenticated
  using (
    profiel_id = auth.uid()
    or public.heb_sleutel(ruimte_id)
    or exists (select 1 from public.ruimtes r where r.id = ruimte_id and r.aangemaakt_door = auth.uid())
  );
drop policy if exists sleutel_geven on public.sleutels;
create policy sleutel_geven on public.sleutels for insert to authenticated
  with check (
    public.verwacht_lid(ruimte_id, profiel_id)
    and (
      public.heb_sleutel(ruimte_id)
      or exists (select 1 from public.ruimtes r where r.id = ruimte_id and r.aangemaakt_door = auth.uid())
    )
  );
drop policy if exists sleutel_vervangen on public.sleutels;
create policy sleutel_vervangen on public.sleutels for update to authenticated
  using (public.heb_sleutel(ruimte_id) or profiel_id = auth.uid())
  with check (public.verwacht_lid(ruimte_id, profiel_id) and public.heb_sleutel(ruimte_id));

-- Afspraken: lezen en toevoegen als je de sleutel van de ruimte hebt.
-- Wijzigen/verwijderen: je eigen afspraken; begeleiders ook die van anderen,
-- behalve in een privé-ruimte.
drop policy if exists afspraak_lezen on public.afspraken;
create policy afspraak_lezen on public.afspraken for select to authenticated
  using (public.heb_sleutel(ruimte_id));
drop policy if exists afspraak_maken on public.afspraken;
create policy afspraak_maken on public.afspraken for insert to authenticated
  with check (public.heb_sleutel(ruimte_id) and auteur_id = auth.uid());
drop policy if exists afspraak_wijzigen on public.afspraken;
create policy afspraak_wijzigen on public.afspraken for update to authenticated
  using (
    public.heb_sleutel(ruimte_id)
    and (auteur_id = auth.uid()
         or (public.ben_begeleider() and (select soort from public.ruimtes where id = ruimte_id) <> 'prive'))
  )
  with check (public.heb_sleutel(ruimte_id));
drop policy if exists afspraak_verwijderen on public.afspraken;
create policy afspraak_verwijderen on public.afspraken for delete to authenticated
  using (
    public.heb_sleutel(ruimte_id)
    and (auteur_id = auth.uid()
         or (public.ben_begeleider() and (select soort from public.ruimtes where id = ruimte_id) <> 'prive'))
  );

-- Uitnodigingen: alleen begeleiders van de leefgroep (maken gaat via maak_uitnodiging).
drop policy if exists uitnodiging_lezen on public.uitnodigingen;
create policy uitnodiging_lezen on public.uitnodigingen for select to authenticated
  using (public.ben_begeleider() and leefgroep_id = public.mijn_leefgroep());
drop policy if exists uitnodiging_intrekken on public.uitnodigingen;
create policy uitnodiging_intrekken on public.uitnodigingen for delete to authenticated
  using (public.ben_begeleider() and leefgroep_id = public.mijn_leefgroep());

-- ── Functies die de app aanroept ────────────────────────────────────────────

create or replace function public.mijn_profiel() returns public.profielen
language sql stable security definer set search_path = '' as $$
  select * from public.profielen where id = auth.uid()
$$;

create or replace function public.start_leefgroep(
  p_naam text, p_startcode text, p_initialen text,
  p_publieke_sleutel jsonb, p_prive_sleutel jsonb, p_zout text
) returns public.profielen
language plpgsql security definer set search_path = '' as $$
declare
  v_lg uuid;
  v_p public.profielen;
begin
  if auth.uid() is null then raise exception 'niet aangemeld'; end if;
  if exists (select 1 from public.profielen where id = auth.uid()) then
    raise exception 'je hoort al bij een leefgroep';
  end if;
  update private.startcodes set gebruikt = now()
    where code = p_startcode and gebruikt is null;
  if not found then raise exception 'startcode ongeldig'; end if;

  insert into public.leefgroepen (naam) values (p_naam) returning id into v_lg;
  insert into public.profielen (id, leefgroep_id, initialen, rol, publieke_sleutel, prive_sleutel, zout)
    values (auth.uid(), v_lg, p_initialen, 'begeleider', p_publieke_sleutel, p_prive_sleutel, p_zout)
    returning * into v_p;
  return v_p;
end $$;

create or replace function public.maak_uitnodiging(p_rol text, p_initialen text) returns public.uitnodigingen
language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
  v_u public.uitnodigingen;
begin
  if not public.ben_begeleider() then raise exception 'alleen begeleiders'; end if;
  v_code := public.maak_code(8);
  insert into public.uitnodigingen (code, leefgroep_id, rol, initialen)
    values (v_code, public.mijn_leefgroep(), p_rol, p_initialen)
    returning * into v_u;
  return v_u;
end $$;

create or replace function public.gebruik_uitnodiging(
  p_code text, p_publieke_sleutel jsonb, p_prive_sleutel jsonb, p_zout text
) returns public.profielen
language plpgsql security definer set search_path = '' as $$
declare
  v_u public.uitnodigingen;
  v_p public.profielen;
begin
  if auth.uid() is null then raise exception 'niet aangemeld'; end if;
  if exists (select 1 from public.profielen where id = auth.uid()) then
    raise exception 'je hoort al bij een leefgroep';
  end if;
  delete from public.uitnodigingen
    where code = upper(trim(p_code)) and vervalt > now()
    returning * into v_u;
  if v_u.code is null then raise exception 'uitnodiging ongeldig'; end if;

  insert into public.profielen (id, leefgroep_id, initialen, rol, publieke_sleutel, prive_sleutel, zout)
    values (auth.uid(), v_u.leefgroep_id, v_u.initialen, v_u.rol, p_publieke_sleutel, p_prive_sleutel, p_zout)
    returning * into v_p;
  return v_p;
end $$;

-- Wie heeft welke sleutel (zonder inhoud): alleen voor begeleiders, om
-- ontbrekende toegang van nieuwe leden te vinden.
create or replace function public.sleutel_leden()
returns table (ruimte_id uuid, profiel_id uuid)
language sql stable security definer set search_path = '' as $$
  select s.ruimte_id, s.profiel_id
  from public.sleutels s
  join public.ruimtes r on r.id = s.ruimte_id
  where public.ben_begeleider() and r.leefgroep_id = public.mijn_leefgroep()
$$;


-- Leesbare code van n tekens (zonder 0/O, 1/I/L), in blokken van 4.
create or replace function public.maak_code(p_lengte int) returns text
language plpgsql volatile set search_path = '' as $$
declare
  v_tekens text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text := '';
begin
  for i in 1..p_lengte loop
    if i > 1 and (i - 1) % 4 = 0 then v_code := v_code || '-'; end if;
    v_code := v_code || substr(v_tekens, 1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(v_tekens)), 1);
  end loop;
  return v_code;
end $$;

-- Begeleider: herstelcode voor een lid van de eigen leefgroep.
create or replace function public.maak_herstelcode(p_profiel uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_code text;
begin
  if not public.ben_begeleider() then raise exception 'alleen begeleiders'; end if;
  if not exists (select 1 from public.profielen where id = p_profiel and leefgroep_id = public.mijn_leefgroep()) then
    raise exception 'lid niet gevonden';
  end if;
  delete from public.herstelcodes where profiel_id = p_profiel;
  v_code := public.maak_code(12);
  insert into public.herstelcodes (code, profiel_id, aangemaakt_door) values (v_code, p_profiel, auth.uid());
  return v_code;
end $$;

-- Zonder aanmelden (rol anon): nieuw wachtwoord en nieuwe sleutels met een herstelcode.
-- De oude sleutels en de privé-agenda vervallen (niemand kan die nog openen).
create or replace function public.gebruik_herstelcode(
  p_code text, p_wachtwoord text, p_publieke_sleutel jsonb, p_prive_sleutel jsonb, p_zout text
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_profiel uuid;
  v_email text;
begin
  if char_length(p_wachtwoord) < 8 then raise exception 'wachtwoord te kort'; end if;
  delete from public.herstelcodes
    where code = upper(trim(p_code)) and vervalt > now()
    returning profiel_id into v_profiel;
  if v_profiel is null then raise exception 'herstelcode ongeldig'; end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_wachtwoord, extensions.gen_salt('bf')),
         updated_at = now()
   where id = v_profiel
   returning email into v_email;
  delete from auth.sessions where user_id = v_profiel;

  update public.profielen
     set publieke_sleutel = p_publieke_sleutel, prive_sleutel = p_prive_sleutel, zout = p_zout
   where id = v_profiel;
  delete from public.sleutels where profiel_id = v_profiel;
  delete from public.ruimtes where soort = 'prive' and eigenaar_id = v_profiel;
  return split_part(v_email, '@', 1);
end $$;

-- Eigen wachtwoord wijzigen: controleert het huidige, en pakt de private sleutel opnieuw in.
create or replace function public.wijzig_wachtwoord(
  p_oud text, p_nieuw text, p_prive_sleutel jsonb, p_zout text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if char_length(p_nieuw) < 8 then raise exception 'wachtwoord te kort'; end if;
  if not exists (
    select 1 from auth.users
     where id = auth.uid() and encrypted_password = extensions.crypt(p_oud, encrypted_password)
  ) then
    raise exception 'huidig wachtwoord klopt niet';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_nieuw, extensions.gen_salt('bf')), updated_at = now()
   where id = auth.uid();
  update public.profielen set prive_sleutel = p_prive_sleutel, zout = p_zout where id = auth.uid();
end $$;

-- Begeleider: een lid verwijderen (account, profiel, eigen agenda's, sleutels).
-- Afspraken die die persoon in andere agenda's zette, blijven staan (zonder auteur).
create or replace function public.verwijder_lid(p_profiel uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.ben_begeleider() then raise exception 'alleen begeleiders'; end if;
  if p_profiel = auth.uid() then raise exception 'je kan jezelf niet verwijderen'; end if;
  if not exists (select 1 from public.profielen where id = p_profiel and leefgroep_id = public.mijn_leefgroep()) then
    raise exception 'lid niet gevonden';
  end if;
  delete from auth.users where id = p_profiel;
end $$;

-- Rechten op functies. Postgres geeft standaard iedereen (PUBLIC) uitvoerrecht:
-- dat halen we weg, en geven het alleen aan aangemelde gebruikers.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.maak_code(int) from authenticated;
-- De enige functie zonder aanmelden: herstellen met een code.
grant execute on function public.gebruik_herstelcode(text, text, jsonb, jsonb, text) to anon;

-- ── Bewaartermijn: automatisch opruimen ─────────────────────────────────────
-- Afspraken worden 6 maanden na de maand van de afspraak verwijderd, verlopen
-- uitnodigingen meteen. Zet eerst de extensie pg_cron aan (Database → Extensions).

create or replace function public.ruim_op() returns void
language sql security definer set search_path = '' as $$
  delete from public.afspraken where bewaren_tot <= current_date;
  delete from public.uitnodigingen where vervalt <= now();
  delete from public.herstelcodes where vervalt <= now();
$$;
revoke execute on function public.ruim_op() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('agenda-opruimen', '17 3 * * *', 'select public.ruim_op()');
  end if;
end $$;

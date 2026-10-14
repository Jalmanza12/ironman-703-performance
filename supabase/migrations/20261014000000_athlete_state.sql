-- IM703 Phase 1: one private state document per athlete, plus recent history for recovery.
-- Security model:
--   * Row level security on every table; athletes can read only their own rows.
--   * No direct INSERT/UPDATE/DELETE from clients. All writes go through save_state(), which
--     derives the owner from the caller's JWT (auth.uid()) and enforces optimistic concurrency.
--   * History rows are written only by a trigger and pruned to the latest 30 per athlete.
--   * Deleting an auth user deletes their data (on delete cascade).

-- ---------- Tables ----------
create table public.athlete_state (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  schema_version integer     not null check (schema_version between 1 and 1000),
  state          jsonb       not null check (jsonb_typeof(state) = 'object'),
  rev            bigint      not null default 1 check (rev >= 1),
  updated_at     timestamptz not null default now(),
  device_id      text        check (char_length(device_id) <= 64)
);

comment on table public.athlete_state is 'One im703:v1 state document per athlete (see docs/storage-schema.md). Written only via save_state().';

create table public.athlete_state_history (
  id             bigint generated always as identity primary key,
  user_id        uuid        not null references auth.users (id) on delete cascade,
  rev            bigint      not null,
  schema_version integer     not null,
  state          jsonb       not null,
  device_id      text,
  saved_at       timestamptz not null default now()
);

create index athlete_state_history_user_idx on public.athlete_state_history (user_id, id desc);

comment on table public.athlete_state_history is 'Previous versions of athlete_state (latest 30 per athlete), written by trigger for recovery/rollback.';

-- ---------- Row level security ----------
alter table public.athlete_state enable row level security;
alter table public.athlete_state force row level security;
alter table public.athlete_state_history enable row level security;
alter table public.athlete_state_history force row level security;

create policy "athletes read own state"
  on public.athlete_state for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "athletes read own history"
  on public.athlete_state_history for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Supabase grants broad default privileges on new public tables; remove them and grant only reads.
revoke all on public.athlete_state, public.athlete_state_history from public, anon, authenticated;
grant select on public.athlete_state, public.athlete_state_history to authenticated;

-- ---------- History trigger ----------
create function public.athlete_state_keep_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.athlete_state_history (user_id, rev, schema_version, state, device_id, saved_at)
  values (old.user_id, old.rev, old.schema_version, old.state, old.device_id, old.updated_at);

  delete from public.athlete_state_history h
  where h.user_id = old.user_id
    and h.id not in (
      select k.id from public.athlete_state_history k
      where k.user_id = old.user_id
      order by k.id desc
      limit 30
    );
  return new;
end;
$$;

revoke all on function public.athlete_state_keep_history() from public, anon, authenticated;

create trigger athlete_state_history_on_update
  before update on public.athlete_state
  for each row execute function public.athlete_state_keep_history();

-- ---------- Write path ----------
-- p_expected_rev = 0 creates the athlete's first row; otherwise it must equal the stored rev.
-- A mismatch raises SQLSTATE PT409 (PostgREST returns HTTP 409): the client must pull, merge, retry.
create function public.save_state(
  p_expected_rev   bigint,
  p_state          jsonb,
  p_schema_version integer,
  p_device_id      text default null
)
returns table (rev bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'state must be a JSON object' using errcode = '22023';
  end if;
  if octet_length(p_state::text) > 1048576 then
    raise exception 'state exceeds 1 MB' using errcode = '22023';
  end if;
  if p_schema_version is null or p_schema_version not between 1 and 1000 then
    raise exception 'invalid schema_version' using errcode = '22023';
  end if;
  if p_expected_rev is null or p_expected_rev < 0 then
    raise exception 'invalid expected rev' using errcode = '22023';
  end if;

  if p_expected_rev = 0 then
    return query
      insert into public.athlete_state as s (user_id, schema_version, state, rev, updated_at, device_id)
      values (v_uid, p_schema_version, p_state, 1, now(), p_device_id)
      on conflict (user_id) do nothing
      returning s.rev, s.updated_at;
  else
    return query
      update public.athlete_state as s
      set schema_version = p_schema_version,
          state          = p_state,
          rev            = s.rev + 1,
          updated_at     = now(),
          device_id      = p_device_id
      where s.user_id = v_uid
        and s.rev = p_expected_rev
      returning s.rev, s.updated_at;
  end if;

  if not found then
    raise exception 'rev conflict: state changed on another device' using errcode = 'PT409';
  end if;
end;
$$;

revoke all on function public.save_state(bigint, jsonb, integer, text) from public, anon, authenticated;
grant execute on function public.save_state(bigint, jsonb, integer, text) to authenticated;

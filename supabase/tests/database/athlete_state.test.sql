-- Access-rule tests for athlete_state (run: npx supabase@2.118.0 test db).
-- Two athletes (A, B) plus anon. Each "as X" block switches role and JWT claims the same way
-- PostgREST does for a real request.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

-- ---------- fixtures (as postgres) ----------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.local');

create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_anon() returns void language sql as $$
  select set_config('role', 'anon', true),
         set_config('request.jwt.claims', '{"role":"anon"}', true);
$$;
create function pg_temp.as_admin() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
$$;

-- ---------- structure ----------
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.athlete_state'::regclass), 'RLS enabled and forced on athlete_state');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.athlete_state_history'::regclass), 'RLS enabled and forced on athlete_state_history');
select ok(not has_table_privilege('anon', 'public.athlete_state', 'select,insert,update,delete'), 'anon has no table privileges on athlete_state');
select ok(not has_table_privilege('anon', 'public.athlete_state_history', 'select,insert,update,delete'), 'anon has no table privileges on history');
select ok(not has_table_privilege('authenticated', 'public.athlete_state', 'insert,update,delete,truncate'), 'authenticated cannot write athlete_state directly');
select ok(not has_table_privilege('authenticated', 'public.athlete_state_history', 'insert,update,delete,truncate'), 'authenticated cannot write history directly');
select ok(not has_function_privilege('anon', 'public.save_state(bigint, jsonb, integer, text)', 'execute'), 'anon cannot call save_state');
select ok(not has_function_privilege('authenticated', 'public.athlete_state_keep_history()', 'execute'), 'clients cannot call the history trigger function');

-- ---------- anon ----------
select pg_temp.as_anon();
select throws_ok($$ select * from public.athlete_state $$, '42501', null, 'anon cannot read athlete_state');
select throws_ok($$ select public.save_state(0, '{}'::jsonb, 1) $$, '42501', null, 'anon cannot save');

-- ---------- authenticated without a user id ----------
select set_config('role', 'authenticated', true), set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$ select public.save_state(0, '{}'::jsonb, 1) $$, '28000', 'not authenticated', 'a token without sub cannot save');

-- ---------- athlete A creates and updates ----------
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is((select rev from public.save_state(0, '{"logs":{"a":1}}'::jsonb, 1, 'laptop')), 1::bigint, 'A creates their row at rev 1');
select throws_ok($$ select public.save_state(0, '{}'::jsonb, 1) $$, 'PT409', null, 'creating twice is a rev conflict');
select throws_ok($$ select public.save_state(5, '{}'::jsonb, 1) $$, 'PT409', null, 'stale/unknown rev is rejected with PT409');
select is((select rev from public.save_state(1, '{"logs":{"a":2}}'::jsonb, 1, 'phone')), 2::bigint, 'A updates with the correct rev → rev 2');
select is((select state from public.athlete_state), '{"logs":{"a":2}}'::jsonb, 'A reads their latest state');
select is((select count(*) from public.athlete_state_history), 1::bigint, 'A sees one history row');
select is((select state from public.athlete_state_history), '{"logs":{"a":1}}'::jsonb, 'history holds the previous version');

-- invalid payloads
select throws_ok($$ select public.save_state(2, '[1,2]'::jsonb, 1) $$, '22023', null, 'non-object state rejected');
select throws_ok($$ select public.save_state(2, jsonb_build_object('x', repeat('y', 1100000)), 1) $$, '22023', null, 'state over 1 MB rejected');
select throws_ok($$ select public.save_state(2, '{}'::jsonb, 0) $$, '22023', null, 'schema_version 0 rejected');
select throws_ok($$ select public.save_state(-1, '{}'::jsonb, 1) $$, '22023', null, 'negative rev rejected');

-- direct writes are denied even for your own row
select throws_ok($$ update public.athlete_state set state = '{}' $$, '42501', null, 'A cannot UPDATE directly');
select throws_ok($$ delete from public.athlete_state $$, '42501', null, 'A cannot DELETE directly');
select throws_ok($$ insert into public.athlete_state_history (user_id, rev, schema_version, state) values ('11111111-1111-1111-1111-111111111111', 9, 1, '{}') $$, '42501', null, 'A cannot forge history');

-- ---------- athlete B is isolated from A ----------
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is((select count(*) from public.athlete_state), 0::bigint, 'B sees no rows before saving');
select is((select count(*) from public.athlete_state_history), 0::bigint, 'B sees none of A''s history');
select throws_ok($$ select public.save_state(2, '{"hijack":true}'::jsonb, 1) $$, 'PT409', null, 'B using A''s rev cannot touch A''s row');
select throws_ok($$ insert into public.athlete_state (user_id, schema_version, state) values ('11111111-1111-1111-1111-111111111111', 1, '{}') $$, '42501', null, 'B cannot insert a row for A');
select is((select rev from public.save_state(0, '{"logs":{"b":1}}'::jsonb, 1)), 1::bigint, 'B creates their own row');
select is((select count(*) from public.athlete_state), 1::bigint, 'B still sees only their own row');

-- ---------- admin checks: A untouched, history pruning ----------
select pg_temp.as_admin();
select is((select state from public.athlete_state where user_id = '11111111-1111-1111-1111-111111111111'), '{"logs":{"a":2}}'::jsonb, 'A''s data unchanged by B');

select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select public.save_state(r, jsonb_build_object('n', r), 1) from generate_series(2, 41) as r; -- 40 more saves
select pg_temp.as_admin();
select is((select count(*) from public.athlete_state_history where user_id = '11111111-1111-1111-1111-111111111111'), 30::bigint, 'history pruned to the latest 30');

select * from finish();
rollback;

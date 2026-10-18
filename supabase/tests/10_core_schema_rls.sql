-- supabase/tests/10_core_schema_rls.sql
--
-- RLS verification for the core schema (profiles, workspaces, memberships,
-- projects). Run against a database with migrations applied:
--
--   psql -d testpilot_test -v ON_ERROR_STOP=1 -f supabase/tests/10_core_schema_rls.sql
--
-- Every check is a DO block that raises EXCEPTION on failure (aborting the
-- script under ON_ERROR_STOP) and emits NOTICE on success. All test data is
-- created and rolled back inside one transaction, so the script is
-- repeatable. Requires supabase/tests/00_auth_shim.sql on non-Supabase
-- Postgres (provides auth.users, auth.uid(), and the anon/authenticated/
-- service_role roles).

begin;

-- ---------------------------------------------------------------- setup --
do $$
begin
  insert into auth.users (id, email) values
    ('11111111-1111-1111-1111-111111111111', 'u1@test.local'),
    ('22222222-2222-2222-2222-222222222222', 'u2@test.local');

  insert into public.profiles (id, email, display_name) values
    ('11111111-1111-1111-1111-111111111111', 'u1@test.local', 'User One'),
    ('22222222-2222-2222-2222-222222222222', 'u2@test.local', 'User Two');

  insert into public.workspaces (id, name, created_by) values
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Workspace One', '11111111-1111-1111-1111-111111111111'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Workspace Two', '22222222-2222-2222-2222-222222222222');

  insert into public.memberships (workspace_id, user_id, role) values
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'owner');

  insert into public.projects (id, workspace_id, name, created_by) values
    ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Project One', '11111111-1111-1111-1111-111111111111'),
    ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Project Two', '22222222-2222-2222-2222-222222222222');
end
$$;

-- helper: switch to a simulated user
-- usage: select test_login('11111111-1111-1111-1111-111111111111', 'authenticated');

create or replace function test_login(p_uid uuid, p_role text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
  execute format('set role %I', p_role);
end $$;

create or replace function test_logout()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- ==================================================== unauthenticated ====
select test_login(null, 'anon');

do $$ begin
  perform (select count(*) from public.profiles);
  raise exception 'T01 FAIL: anon could select profiles';
exception when insufficient_privilege then
  raise notice 'T01 PASS: anon select on profiles denied';
end $$;

do $$ begin
  perform (select count(*) from public.workspaces);
  raise exception 'T02 FAIL: anon could select workspaces';
exception when insufficient_privilege then
  raise notice 'T02 PASS: anon select on workspaces denied';
end $$;

do $$ begin
  perform (select count(*) from public.memberships);
  raise exception 'T03 FAIL: anon could select memberships';
exception when insufficient_privilege then
  raise notice 'T03 PASS: anon select on memberships denied';
end $$;

do $$ begin
  perform (select count(*) from public.projects);
  raise exception 'T04 FAIL: anon could select projects';
exception when insufficient_privilege then
  raise notice 'T04 PASS: anon select on projects denied';
end $$;

select test_logout();

-- ==================================================== u1 (owner of w1) ====
select test_login('11111111-1111-1111-1111-111111111111', 'authenticated');

do $$ declare c int; begin
  select count(*) into c from public.profiles;
  if c <> 1 then raise exception 'T05 FAIL: u1 saw % profiles, want 1', c; end if;
  perform (select 1 from public.profiles where id = '11111111-1111-1111-1111-111111111111');
  if not found then raise exception 'T05 FAIL: u1 cannot see own profile'; end if;
  raise notice 'T05 PASS: u1 sees exactly their own profile';
end $$;

do $$ declare c int; begin
  select count(*) into c from public.workspaces;
  if c <> 1 then raise exception 'T06 FAIL: u1 saw % workspaces, want 1', c; end if;
  raise notice 'T06 PASS: u1 sees only workspace w1';
end $$;

do $$ declare c int; begin
  select count(*) into c from public.memberships;
  if c <> 1 then raise exception 'T07 FAIL: u1 saw % memberships, want 1', c; end if;
  raise notice 'T07 PASS: u1 sees only their own membership';
end $$;

do $$ declare c int; begin
  select count(*) into c from public.projects;
  if c <> 1 then raise exception 'T08 FAIL: u1 saw % projects, want 1', c; end if;
  raise notice 'T08 PASS: u1 sees only project p1 (own workspace)';
end $$;

do $$ begin
  insert into public.projects (workspace_id, name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tmp');
  delete from public.projects where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and name = 'Tmp';
  raise notice 'T09 PASS: u1 can create/delete projects in own workspace';
end $$;

do $$ begin
  insert into public.projects (workspace_id, name) values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Evil');
  raise exception 'T10 FAIL: u1 inserted a project into w2';
exception when others then
  if sqlstate <> '42501' then raise; end if;
  raise notice 'T10 PASS: cross-workspace project insert denied (RLS)';
end $$;

do $$ declare r int; begin
  update public.projects set name = 'Hacked' where id = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';
  get diagnostics r = row_count;
  if r <> 0 then raise exception 'T11 FAIL: u1 updated p2 (% rows)', r; end if;
  raise notice 'T11 PASS: cross-workspace update touched 0 rows';
end $$;

do $$ declare r int; begin
  delete from public.projects where id = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';
  get diagnostics r = row_count;
  if r <> 0 then raise exception 'T12 FAIL: u1 deleted p2 (% rows)', r; end if;
  raise notice 'T12 PASS: cross-workspace delete touched 0 rows';
end $$;

do $$ begin
  insert into public.memberships (workspace_id, user_id, role) values
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'member');
  raise exception 'T13 FAIL: u1 added themselves to w2';
exception when others then
  if sqlstate <> '42501' then raise; end if;
  raise notice 'T13 PASS: non-admin cannot grant themselves membership in another workspace';
end $$;

do $$ declare r int; begin
  delete from public.memberships
  where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    and user_id = '11111111-1111-1111-1111-111111111111';
  get diagnostics r = row_count;
  if r <> 0 then raise exception 'T14 FAIL: last owner removed (% rows)', r; end if;
  raise notice 'T14 PASS: last owner cannot be removed';
end $$;

do $$ begin
  update public.memberships set role = 'member'
  where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    and user_id = '11111111-1111-1111-1111-111111111111';
  raise exception 'T15 FAIL: last owner demoted';
exception when others then
  if sqlstate <> '42501' then raise; end if;
  raise notice 'T15 PASS: last owner cannot be demoted';
end $$;

do $$ begin
  insert into public.memberships (workspace_id, user_id, role) values
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member');
  raise notice 'T16 PASS: workspace owner can add a member';
end $$;

select test_logout();

-- ==================================================== u2 (now member of w1) ====
select test_login('22222222-2222-2222-2222-222222222222', 'authenticated');

do $$ declare c int; begin
  select count(*) into c from public.projects where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if c < 1 then raise exception 'T17 FAIL: u2 (new w1 member) saw % w1 projects', c; end if;
  raise notice 'T17 PASS: new member can read workspace projects';
end $$;

select test_logout();
select test_login('11111111-1111-1111-1111-111111111111', 'authenticated');

do $$ declare r int; begin
  delete from public.memberships
  where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    and user_id = '22222222-2222-2222-2222-222222222222';
  get diagnostics r = row_count;
  if r <> 1 then raise exception 'T18 FAIL: owner could not remove member (% rows)', r; end if;
  raise notice 'T18 PASS: owner can remove a non-owner member';
end $$;

select test_logout();
select test_login('22222222-2222-2222-2222-222222222222', 'authenticated');

do $$ declare c int; begin
  select count(*) into c from public.projects where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if c <> 0 then raise exception 'T19 FAIL: removed member still saw % w1 projects', c; end if;
  raise notice 'T19 PASS: removed member loses workspace access immediately';
end $$;

do $$ declare c int; begin
  select count(*) into c from public.workspaces;
  if c <> 1 then raise exception 'T20 FAIL: u2 saw % workspaces, want 1 (w2)', c; end if;
  raise notice 'T20 PASS: u2 sees only their own workspace';
end $$;

select test_logout();

-- ============================================ ownership bootstrap flow ====
select test_login('11111111-1111-1111-1111-111111111111', 'authenticated');

do $$ begin
  insert into public.workspaces (id, name, created_by) values
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Workspace Three', '11111111-1111-1111-1111-111111111111');
  insert into public.memberships (workspace_id, user_id, role) values
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'owner');
  raise notice 'T21 PASS: user can create a workspace and bootstrap as owner';
end $$;

select test_logout();
select test_login('22222222-2222-2222-2222-222222222222', 'authenticated');

do $$ begin
  insert into public.memberships (workspace_id, user_id, role) values
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222', 'owner');
  raise exception 'T22 FAIL: u2 bootstrapped ownership of an owned workspace';
exception when others then
  if sqlstate <> '42501' then raise; end if;
  raise notice 'T22 PASS: bootstrap blocked once a workspace has members';
end $$;

select test_logout();
select test_login('11111111-1111-1111-1111-111111111111', 'authenticated');

do $$ declare r int; begin
  delete from public.workspaces where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  get diagnostics r = row_count;
  if r <> 1 then raise exception 'T23 FAIL: owner could not delete workspace'; end if;
  raise notice 'T23 PASS: owner can delete workspace (memberships cascade)';
end $$;

select test_logout();

-- ==================================================== service_role ====
-- Documents the bypass: server code MUST authorize explicitly.
select test_login(null, 'service_role');

do $$ declare c int; begin
  select count(*) into c from public.projects;
  if c <> 2 then raise exception 'T24 FAIL: service_role saw % projects, want 2', c; end if;
  raise notice 'T24 PASS (documented): service_role bypasses RLS and sees all rows';
end $$;

select test_logout();

drop function test_login(uuid, text);
drop function test_logout();

rollback;

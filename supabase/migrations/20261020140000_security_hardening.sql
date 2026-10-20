-- 20261020140000_security_hardening.sql
--
-- Security audit hardening (2026-10-20). Two confirmed issues:
--
-- 1. The usage-metering RPCs were intended to be service-role-only, and
--    the migration granted EXECUTE to service_role — but Postgres
--    grants EXECUTE to PUBLIC by default and nothing revoked it, so
--    any caller (including anon) could invoke reserve/release/meter/
--    set_storage_usage through PostgREST with arbitrary workspace ids
--    and amounts, manipulating usage counters and defeating the
--    free-plan quotas. Revoke the default and keep only service_role.
--
-- 2. The public_reports UPDATE policy was row-scoped (membership) but
--    column-blind, so a workspace member could bypass the app through
--    PostgREST and: clear revoked_at on a revoked report (resurrecting
--    a share link the owner deliberately killed), replace token_hash
--    with the hash of a token they chose, or rewrite the snapshot
--    wholesale (defeating the validated snapshot builder). Two
--    enforcement-point fixes:
--    a) The policy now excludes revoked rows entirely (USING is
--       evaluated on the pre-update row), so a revoked report is
--       immutable to members. Revocation itself still works: the row
--       is un-revoked when the revoke update runs.
--    b) Column-level privileges: members lose blanket UPDATE and keep
--       UPDATE on revoked_at only — the one column the app ever writes
--       as a member (view counts go through the service role).

revoke execute on function public.reserve_usage(uuid, date, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint) from public, anon, authenticated;
revoke execute on function public.release_usage(uuid, date, bigint, bigint, bigint, bigint) from public, anon, authenticated;
revoke execute on function public.meter_usage(uuid, date, bigint, bigint, bigint, bigint) from public, anon, authenticated;
revoke execute on function public.set_storage_usage(uuid, date, bigint) from public, anon, authenticated;

grant execute on function public.reserve_usage(uuid, date, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint) to service_role;
grant execute on function public.release_usage(uuid, date, bigint, bigint, bigint, bigint) to service_role;
grant execute on function public.meter_usage(uuid, date, bigint, bigint, bigint, bigint) to service_role;
grant execute on function public.set_storage_usage(uuid, date, bigint) to service_role;

drop policy "Workspace members can update public reports" on public.public_reports;

create policy "Workspace members can update public reports"
  on public.public_reports for update to authenticated
  using (public.is_workspace_member(workspace_id) and revoked_at is null)
  with check (public.is_workspace_member(workspace_id));

revoke update on public.public_reports from authenticated;
grant update (revoked_at) on public.public_reports to authenticated;

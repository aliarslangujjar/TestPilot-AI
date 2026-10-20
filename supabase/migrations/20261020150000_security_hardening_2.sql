-- 20261020150000_security_hardening_2.sql
--
-- Security audit addendum 2 (2026-10-20) — full Scope A report
-- follow-ups. (The first hardening migration, 20261020140000, covers
-- the usage-RPC execute exposure and public_reports immutability.)
--
-- F7: members held an UPDATE policy on github_workflow_dispatches and
--    could forge dispatch status/conclusion/run URLs through the
--    table API, bypassing the HMAC-verified webhook as the source of
--    truth. All dispatch writes are service-role now (the webhook,
--    and the dispatch action's failure marking — application change
--    shipped with this migration), so member UPDATE goes away.
--
-- F5: the memberships UPDATE policy's WITH CHECK evaluates the NEW
--    row, so an admin of two workspaces could UPDATE a membership
--    row's workspace_id and orphan the source workspace's last owner.
--    No application code updates memberships through the member
--    client today; remove member UPDATE entirely. When member
--    management is built, it gets a purpose-built policy that also
--    pins workspace_id/user_id.
--
-- F8: the browser_jobs INSERT policy required only membership, so a
--    member could insert pre-completed jobs (status='succeeded' with
--    a fabricated result), spoofed creators, or pre-claimed rows via
--    the table API. The worker's re-validation bounded the blast
--    radius; the policy now requires a fresh, caller-authored queue
--    row — exactly what the enqueue paths insert.
--
-- F10: workspaces.created_by was spoofable (INSERT policy checks
--    `true`) and the app never set it. A trigger now forces it from
--    the caller's JWT whenever one is present.

drop policy "Members can update workflow dispatches" on public.github_workflow_dispatches;
revoke update on public.github_workflow_dispatches from authenticated;

drop policy "Admins can update memberships, but never demote the last owner" on public.memberships;
revoke update on public.memberships from authenticated;

drop policy "Workspace members can enqueue browser jobs" on public.browser_jobs;

create policy "Workspace members can enqueue browser jobs"
  on public.browser_jobs for insert to authenticated
  with check (
    public.is_workspace_member(workspace_id)
    and created_by = auth.uid()
    and status = 'queued'
    and result is null
    and error is null
    and claimed_by is null
  );

create or replace function public.force_workspace_creator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_force_workspace_creator on public.workspaces;

create trigger trg_force_workspace_creator
  before insert on public.workspaces
  for each row execute function public.force_workspace_creator();

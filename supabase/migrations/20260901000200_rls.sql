-- =====================================================================
-- Row Level Security. The frontend never decides who sees what:
-- every table is locked down here, including client isolation for POCs.
-- =====================================================================

alter table public.app_settings     enable row level security;
alter table public.clients          enable row level security;
alter table public.profiles         enable row level security;
alter table public.client_pocs      enable row level security;
alter table public.status_master    enable row level security;
alter table public.status_mappings  enable row level security;
alter table public.aging_buckets    enable row level security;
alter table public.column_aliases   enable row level security;
alter table public.sheet_sources    enable row level security;
alter table public.sync_runs        enable row level security;
alter table public.emails           enable row level security;
alter table public.cases            enable row level security;
alter table public.case_private     enable row level security;
alter table public.source_records   enable row level security;
alter table public.case_updates     enable row level security;
alter table public.case_comments    enable row level security;
alter table public.lost_approvals   enable row level security;
alter table public.notifications    enable row level security;
alter table public.audit_logs       enable row level security;
alter table public.report_runs      enable row level security;

-- ---------- Reference data: readable by any signed-in active user, editable by admins ----------
create policy status_master_read on public.status_master for select to authenticated using (public.app_role() is not null);
create policy status_master_write on public.status_master for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy aging_buckets_read on public.aging_buckets for select to authenticated using (public.app_role() is not null);
create policy aging_buckets_write on public.aging_buckets for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy status_mappings_read on public.status_mappings for select to authenticated using (public.is_internal());
create policy status_mappings_write on public.status_mappings for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy column_aliases_read on public.column_aliases for select to authenticated using (public.is_internal());
create policy column_aliases_write on public.column_aliases for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy app_settings_read on public.app_settings for select to authenticated using (public.is_internal());
create policy app_settings_write on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- Clients ----------
create policy clients_read on public.clients for select to authenticated
  using (public.is_internal() or id in (select public.poc_client_ids()));
create policy clients_write on public.clients for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- Profiles ----------
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_internal());
-- Role/activation changes go through server actions with the service role after an admin check.
create policy profiles_admin_write on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- Client POCs ----------
create policy client_pocs_read on public.client_pocs for select to authenticated
  using (public.is_internal() or client_id in (select public.poc_client_ids()));
create policy client_pocs_write on public.client_pocs for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- Ingestion ----------
create policy sheet_sources_read on public.sheet_sources for select to authenticated using (public.is_internal());
create policy sheet_sources_write on public.sheet_sources for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy sync_runs_read on public.sync_runs for select to authenticated using (public.is_internal());

create policy emails_read on public.emails for select to authenticated using (public.is_internal());
create policy emails_insert on public.emails for insert to authenticated with check (public.is_internal());
create policy emails_update on public.emails for update to authenticated using (public.is_internal()) with check (public.is_internal());

create policy source_records_read on public.source_records for select to authenticated using (public.is_internal());
create policy source_records_insert on public.source_records for insert to authenticated with check (public.is_internal());

-- ---------- Cases ----------
-- Internal users see everything; a POC sees only cases of the client(s) they are assigned to.
create policy cases_read on public.cases for select to authenticated
  using (public.is_internal() or (client_id is not null and client_id in (select public.poc_client_ids())));

create policy cases_insert on public.cases for insert to authenticated
  with check (public.is_internal());

-- Admins update any case; internal team updates cases assigned to them or still unassigned.
-- POCs have no update rights at all: their only write is request_lost().
create policy cases_update on public.cases for update to authenticated
  using (public.is_admin() or (public.app_role() = 'internal_team' and (assigned_agent = auth.uid() or assigned_agent is null)))
  with check (public.is_admin() or (public.app_role() = 'internal_team' and (assigned_agent = auth.uid() or assigned_agent is null)));
-- No delete policy: cases are soft-deleted (is_deleted) by admins via update.

create policy case_private_rw on public.case_private for all to authenticated
  using (public.is_internal()) with check (public.is_internal());

-- ---------- Timeline, comments, approvals ----------
create policy case_updates_read on public.case_updates for select to authenticated
  using (public.is_internal()
         or (client_visible and case_id in (select id from public.cases where client_id in (select public.poc_client_ids()))));

create policy case_comments_read on public.case_comments for select to authenticated
  using (public.is_internal()
         or (visibility = 'client' and case_id in (select id from public.cases where client_id in (select public.poc_client_ids()))));
create policy case_comments_insert_internal on public.case_comments for insert to authenticated
  with check (public.is_internal() and user_id = auth.uid());
create policy case_comments_insert_poc on public.case_comments for insert to authenticated
  with check (public.app_role() = 'client_poc' and user_id = auth.uid() and visibility = 'client'
              and case_id in (select id from public.cases where client_id in (select public.poc_client_ids())));

create policy lost_approvals_read on public.lost_approvals for select to authenticated
  using (public.is_internal()
         or case_id in (select id from public.cases where client_id in (select public.poc_client_ids())));
-- Writes only through request_lost() / decide_lost() (security definer).

-- ---------- Notifications ----------
create policy notifications_read on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Audit & reports ----------
create policy audit_logs_read on public.audit_logs for select to authenticated using (public.is_admin());
create policy report_runs_read on public.report_runs for select to authenticated using (public.is_admin());

-- ---------- Guards that RLS alone cannot express ----------
-- Only a Super Admin can grant or touch Super Admin; nobody changes their own role or access.
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;  -- service role (server-side user management after its own checks)
  end if;
  if (old.role = 'super_admin' or new.role = 'super_admin') and not public.is_super_admin() then
    raise exception 'Only a Super Admin can manage Super Admin accounts';
  end if;
  if new.id = auth.uid() and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception 'You cannot change your own role or access';
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- Only admins can soft-delete or restore a case.
create or replace function public.cases_delete_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.is_deleted is distinct from old.is_deleted and not public.is_admin() then
    raise exception 'Only an Admin can remove or restore a case';
  end if;
  return new;
end $$;

create trigger cases_delete_guard before update on public.cases
  for each row execute function public.cases_delete_guard();

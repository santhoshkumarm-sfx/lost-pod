-- =====================================================================
-- Lost & POD desk — base schema: tables, workflow functions, security rules, email cases.
-- (Part 1 of 2. Part 2 is re-runnable and holds everything added since.)
-- =====================================================================


-- ######## schema ########
-- =====================================================================
-- Lost / POD escalation management — core schema
-- Supabase is the master operational database. Google Sheets and Gmail
-- are input sources only; every case lives here with its source lineage.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------- Enums ----------
create type public.user_role as enum ('super_admin', 'admin', 'internal_team', 'client_poc');
create type public.source_type as enum ('google_sheet', 'email', 'manual');
create type public.status_category as enum ('open', 'lost_pending', 'lost', 'closed');
create type public.approval_status as enum ('pending', 'approved', 'rejected', 'sent_back');

-- ---------- Settings ----------
create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- ---------- Clients & users ----------
create table public.clients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  code          text unique,
  aliases       text[] not null default '{}',   -- names used in sheets/emails, e.g. "Swift Premium"
  email_domains text[] not null default '{}',   -- sender domains used to identify the client in email
  sla_days      int check (sla_days is null or sla_days > 0),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null unique,
  full_name  text,
  role       public.user_role not null default 'client_poc',
  is_active  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A POC is a client-side contact. It may or may not have a login (user_id).
-- One client can have many POCs; a POC login only ever sees its client's cases.
create table public.client_pocs (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients (id) on delete restrict,
  user_id    uuid references public.profiles (id) on delete set null,
  name       text not null,
  email      text,
  phone      text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, user_id)
);
create unique index client_pocs_client_name_uq on public.client_pocs (client_id, lower(name));
create index client_pocs_user_idx on public.client_pocs (user_id) where user_id is not null;
create index client_pocs_email_idx on public.client_pocs (lower(email));

-- ---------- Status workflow ----------
create table public.status_master (
  code        text primary key check (code ~ '^[a-z0-9_]+$'),
  label       text not null,
  category    public.status_category not null,
  sort_order  int not null default 100,     -- also used as "progress" when resolving imported statuses
  color       text not null default 'slate',
  is_system   boolean not null default false,
  allow_manual boolean not null default true, -- false for Lost states: only the approval workflow sets them
  is_active   boolean not null default true
);

-- Raw tracker / email wording -> controlled status
create table public.status_mappings (
  id          uuid primary key default gen_random_uuid(),
  pattern     text not null,                          -- stored normalised (lower case, single spaces)
  match_type  text not null default 'exact' check (match_type in ('exact', 'contains', 'regex')),
  status_code text not null references public.status_master (code),
  priority    int not null default 100,               -- lower wins
  created_at  timestamptz not null default now(),
  unique (pattern, match_type)
);

create table public.aging_buckets (
  id         serial primary key,
  label      text not null unique,
  min_days   int not null check (min_days >= 0),
  max_days   int check (max_days is null or max_days >= min_days),
  sort_order int not null
);

-- ---------- Ingestion configuration ----------
-- Global header aliases: "awb no" -> awb, "esc date" -> escalation_date, ...
create table public.column_aliases (
  id           uuid primary key default gen_random_uuid(),
  alias        text not null unique,     -- normalised: lower case, letters/digits only
  target_field text not null,
  created_at   timestamptz not null default now()
);

-- One row per Google Sheets tab that the system reads.
create table public.sheet_sources (
  id                uuid primary key default gen_random_uuid(),
  workbook_id       text not null,
  workbook_name     text,
  sheet_name        text not null,
  default_client_id uuid references public.clients (id),
  mode              text not null default 'cases' check (mode in ('cases', 'enrich')),
  header_row        int check (header_row is null or header_row >= 1),   -- null = auto detect
  date_order        text not null default 'auto' check (date_order in ('auto', 'DMY', 'MDY')),
  column_map        jsonb not null default '[]'::jsonb,  -- per-tab overrides: [{ "index": 3, "target": "awb" }]
  is_active         boolean not null default true,
  last_synced_at    timestamptz,
  last_sync_status  text,
  last_sync_message text,
  last_row_count    int,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (workbook_id, sheet_name)
);

create table public.sync_runs (
  id              uuid primary key default gen_random_uuid(),
  sheet_source_id uuid references public.sheet_sources (id) on delete cascade,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  status          text not null default 'running' check (status in ('running', 'success', 'partial', 'failed')),
  rows_read       int not null default 0,
  rows_skipped    int not null default 0,
  cases_created   int not null default 0,
  cases_updated   int not null default 0,
  cases_linked    int not null default 0,
  rows_unchanged  int not null default 0,
  lost_requests   int not null default 0,
  header_row      int,
  mapping         jsonb,
  issues          jsonb not null default '[]'::jsonb,
  triggered_by    uuid references public.profiles (id),
  trigger_type    text not null default 'manual'
);
create index sync_runs_source_idx on public.sync_runs (sheet_source_id, started_at desc);

-- ---------- Email escalations ----------
create table public.emails (
  id               uuid primary key default gen_random_uuid(),
  gmail_thread_id  text not null unique,
  gmail_message_id text not null,       -- the message the escalation was taken from
  subject          text,
  sender           text,
  sender_email     text,
  recipients       text,
  email_date       timestamptz,
  messages         jsonb not null default '[]'::jsonb,  -- [{id, from, date, subject, text}] for the whole thread
  body_text        text,
  body_html        text,
  client_id        uuid references public.clients (id),
  extraction       jsonb,
  status           text not null default 'needs_review' check (status in ('needs_review', 'processed', 'ignored')),
  imported_by      uuid references public.profiles (id),
  processed_by     uuid references public.profiles (id),
  processed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index emails_status_idx on public.emails (status, created_at desc);
create index emails_subject_trgm on public.emails using gin (subject extensions.gin_trgm_ops);

-- ---------- Cases ----------
create table public.cases (
  id                        uuid primary key default gen_random_uuid(),
  case_number               bigint generated always as identity unique,
  awb                       text not null check (awb = upper(awb) and length(awb) between 4 and 40),
  client_id                 uuid references public.clients (id),
  client_name               text,            -- raw client name from the source (kept even when matched)
  client_poc_id             uuid references public.client_pocs (id),
  escalation_date           date not null,
  escalation_date_estimated boolean not null default false,
  location                  text,
  hub                       text,
  delivery_date             date,
  seller_name               text,
  complaint_type            text,
  reason                    text,
  priority                  text,
  shipment_status           text,
  pod_status                text not null default 'pending' check (pod_status in ('pending', 'shared', 'not_available', 'disputed')),
  pod_link                  text,
  product_name              text,
  product_value             numeric(14, 2) check (product_value is null or product_value >= 0),
  order_id                  text,
  rider_name                text,
  rider_id                  text,
  source_type               public.source_type not null,
  source_workbook           text,
  source_sheet              text,
  source_row                int,
  sheet_source_id           uuid references public.sheet_sources (id) on delete set null,
  email_id                  uuid references public.emails (id) on delete set null,
  email_subject             text,
  email_message_id          text,
  email_thread_id           text,
  email_sender              text,
  team_status               text not null default 'pending' references public.status_master (code),
  status_source             text not null default 'app' check (status_source in ('app', 'import')),
  status_changed_at         timestamptz not null default now(),
  team_remark               text,            -- Shadowfax remark, visible to the client POC
  client_remark             text,
  assigned_agent            uuid references public.profiles (id) on delete set null,
  assigned_agent_name       text,            -- raw agent name from the source when it does not match a user
  closure_date              date,
  final_aging_days          int,
  lost_requested_at         timestamptz,
  lost_approved_at          timestamptz,
  lost_approved_by          uuid references public.profiles (id),
  extra                     jsonb not null default '{}'::jsonb,
  is_deleted                boolean not null default false,
  created_by                uuid references public.profiles (id),
  last_changed_by           uuid references public.profiles (id),
  last_change_source        text not null default 'app',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index cases_awb_idx            on public.cases (awb);
create index cases_awb_trgm           on public.cases using gin (awb extensions.gin_trgm_ops);
create index cases_client_status_idx  on public.cases (client_id, team_status) where not is_deleted;
create index cases_status_idx         on public.cases (team_status) where not is_deleted;
create index cases_esc_date_idx       on public.cases (escalation_date);
create index cases_hub_idx            on public.cases (hub);
create index cases_agent_idx          on public.cases (assigned_agent);
create index cases_thread_idx         on public.cases (email_thread_id) where email_thread_id is not null;
create index cases_sheet_source_idx   on public.cases (sheet_source_id);
create index cases_lost_approved_idx  on public.cases (lost_approved_at) where lost_approved_at is not null;
create index cases_subject_trgm       on public.cases using gin (email_subject extensions.gin_trgm_ops);
create index cases_product_value_idx  on public.cases (product_value desc nulls last) where product_value is not null;

-- Internal-only data, split out so Row Level Security can hide it from client POCs entirely.
create table public.case_private (
  case_id         uuid primary key references public.cases (id) on delete cascade,
  internal_remark text,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles (id)
);

-- Where each case came from (one case can have several source records, e.g. a sheet row and an email).
create table public.source_records (
  id              uuid primary key default gen_random_uuid(),
  source_type     public.source_type not null,
  sheet_source_id uuid references public.sheet_sources (id) on delete set null,
  email_id        uuid references public.emails (id) on delete set null,
  workbook_id     text,
  sheet_name      text,
  row_number      int,
  source_key      text not null,
  record_hash     text not null,
  raw             jsonb not null default '{}'::jsonb,
  case_id         uuid references public.cases (id) on delete set null,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  last_changed_at timestamptz not null default now(),
  unique (source_type, source_key)
);
create index source_records_case_idx on public.source_records (case_id);
create index source_records_sheet_idx on public.source_records (sheet_source_id);

-- Immutable case timeline. Written by triggers and workflow functions only.
create table public.case_updates (
  id             bigint generated always as identity primary key,
  case_id        uuid not null references public.cases (id) on delete cascade,
  action         text not null,
  field          text,
  old_value      text,
  new_value      text,
  note           text,
  source         text not null default 'app',
  client_visible boolean not null default false,
  user_id        uuid references public.profiles (id),
  created_at     timestamptz not null default now()
);
create index case_updates_case_idx on public.case_updates (case_id, created_at);
create index case_updates_created_idx on public.case_updates (created_at desc);

create table public.case_comments (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null references public.cases (id) on delete cascade,
  user_id    uuid references public.profiles (id),
  body       text not null check (length(trim(body)) > 0),
  visibility text not null default 'internal' check (visibility in ('internal', 'client')),
  created_at timestamptz not null default now()
);
create index case_comments_case_idx on public.case_comments (case_id, created_at);

-- POC (or team / tracker) asks for Lost -> Admin approves, rejects or sends back.
create table public.lost_approvals (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references public.cases (id) on delete cascade,
  requested_by    uuid references public.profiles (id),
  requested_via   text not null default 'app' check (requested_via in ('app', 'poc_portal', 'google_sheet', 'email')),
  requested_at    timestamptz not null default now(),
  request_reason  text,
  previous_status text not null references public.status_master (code),
  status          public.approval_status not null default 'pending',
  decided_by      uuid references public.profiles (id),
  decided_at      timestamptz,
  decision_note   text            -- shared with the client POC
);
create unique index lost_approvals_one_pending on public.lost_approvals (case_id) where status = 'pending';
create index lost_approvals_status_idx on public.lost_approvals (status, requested_at);

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  case_id    uuid references public.cases (id) on delete cascade,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

create table public.audit_logs (
  id         bigint generated always as identity primary key,
  table_name text not null,
  record_id  text,
  action     text not null,
  old_data   jsonb,
  new_data   jsonb,
  user_id    uuid,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_table_idx on public.audit_logs (table_name, record_id);

create table public.report_runs (
  id           uuid primary key default gen_random_uuid(),
  report_type  text not null default 'daily_admin',
  run_at       timestamptz not null default now(),
  status       text not null check (status in ('sent', 'failed', 'preview')),
  recipients   text[] not null default '{}',
  summary      jsonb,
  error        text,
  triggered_by uuid references public.profiles (id),
  trigger_type text not null default 'cron'
);
create index report_runs_run_idx on public.report_runs (run_at desc);

-- ######## functions ########
-- =====================================================================
-- Helpers, triggers, workflow functions, analytics
-- =====================================================================

-- ---------- Settings / time ----------
create or replace function public.app_setting(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select value from public.app_settings where key = p_key
$$;

create or replace function public.app_setting_int(p_key text, p_default int)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from public.app_settings where key = p_key), p_default)
$$;

-- "Today" in the operating timezone (default Asia/Kolkata). Aging is always computed from this.
create or replace function public.app_today()
returns date language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce(
    (select value #>> '{}' from public.app_settings where key = 'timezone'), 'Asia/Kolkata'))::date
$$;

-- ---------- Role helpers (security definer so policies never recurse into profiles RLS) ----------
create or replace function public.app_role()
returns public.user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_internal()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() in ('super_admin', 'admin', 'internal_team'), false)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() in ('super_admin', 'admin'), false)
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = 'super_admin', false)
$$;

-- Clients the signed-in POC may see. Empty for everyone else.
create or replace function public.poc_client_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select cp.client_id
  from public.client_pocs cp
  join public.profiles p on p.id = cp.user_id
  where cp.user_id = auth.uid() and cp.is_active and p.is_active and p.role = 'client_poc'
$$;

create or replace function public.status_category_of(p_code text)
returns public.status_category language sql stable security definer set search_path = public as $$
  select category from public.status_master where code = p_code
$$;

-- ---------- New auth user -> profile ----------
-- Role comes from app_metadata, which only the service role can set. Self sign-ups land inactive.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role public.user_role;
begin
  begin
    v_role := (new.raw_app_meta_data ->> 'role')::public.user_role;
  exception when others then
    v_role := null;
  end;
  insert into public.profiles (id, email, full_name, role, is_active)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
          coalesce(v_role, 'client_poc'), v_role is not null)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- updated_at ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger clients_touch before update on public.clients for each row execute function public.touch_updated_at();
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger client_pocs_touch before update on public.client_pocs for each row execute function public.touch_updated_at();
create trigger sheet_sources_touch before update on public.sheet_sources for each row execute function public.touch_updated_at();
create trigger emails_touch before update on public.emails for each row execute function public.touch_updated_at();

-- ---------- Case guard: Lost workflow + closure / aging bookkeeping ----------
create or replace function public.cases_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_lost_flow boolean := coalesce(current_setting('app.lost_flow', true), '') = 'on';
  v_new_cat public.status_category;
  v_old_cat public.status_category;
  v_status_changed boolean;
begin
  v_new_cat := public.status_category_of(new.team_status);
  if v_new_cat is null then
    raise exception 'Unknown status "%"', new.team_status;
  end if;
  if tg_op = 'UPDATE' then
    v_old_cat := public.status_category_of(old.team_status);
    v_status_changed := old.team_status is distinct from new.team_status;
  else
    v_status_changed := true;
  end if;

  -- Nobody can set or leave a Lost state outside the approval workflow functions.
  if not v_lost_flow and v_status_changed then
    if v_new_cat in ('lost', 'lost_pending') then
      raise exception 'LOST_WORKFLOW: Lost can only be set through a Lost request and Admin approval.';
    end if;
    if tg_op = 'UPDATE' and v_old_cat in ('lost', 'lost_pending') then
      raise exception 'LOST_WORKFLOW: This case is in the Lost workflow. Use the approval actions to change its status.';
    end if;
  end if;

  if (tg_op = 'INSERT' or new.escalation_date is distinct from old.escalation_date)
     and new.escalation_date > public.app_today() then
    raise exception 'Escalation date % is in the future', new.escalation_date;
  end if;

  new.awb := upper(regexp_replace(new.awb, '\s', '', 'g'));
  if auth.uid() is not null then
    new.last_changed_by := auth.uid();
  end if;
  new.updated_at := now();

  if v_status_changed then
    new.status_changed_at := now();
    if new.team_status = 'pod_shared' and new.pod_status <> 'shared' then
      new.pod_status := 'shared';
    end if;
    if v_new_cat in ('closed', 'lost') and (tg_op = 'INSERT' or v_old_cat not in ('closed', 'lost')) then
      new.closure_date := coalesce(new.closure_date, public.app_today());
    elsif v_new_cat in ('open', 'lost_pending') and tg_op = 'UPDATE' and v_old_cat in ('closed', 'lost') then
      new.closure_date := null;   -- reopened
    end if;
  end if;

  -- Final aging is frozen at closure and always measured from the ORIGINAL escalation date.
  if v_new_cat in ('closed', 'lost') and new.closure_date is not null then
    new.final_aging_days := greatest(new.closure_date - new.escalation_date, 0);
  else
    new.final_aging_days := null;
  end if;
  return new;
end $$;

create trigger cases_before_write
  before insert or update on public.cases
  for each row execute function public.cases_before_write();

-- ---------- Case history (never overwritten) ----------
create or replace function public.cases_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := coalesce(auth.uid(), new.last_changed_by);
  v_src text := coalesce(new.last_change_source, 'app');
  v_old jsonb;
  v_new jsonb;
  k text;
  v_fields text[] := array['team_status', 'pod_status', 'pod_link', 'team_remark', 'client_remark', 'assigned_agent',
    'assigned_agent_name', 'hub', 'location', 'priority', 'reason', 'complaint_type', 'escalation_date', 'delivery_date',
    'client_id', 'client_poc_id', 'closure_date', 'product_name', 'product_value', 'seller_name', 'shipment_status', 'awb',
    'is_deleted'];
  v_client_visible text[] := array['team_status', 'pod_status', 'pod_link', 'team_remark', 'client_remark', 'closure_date'];
begin
  if tg_op = 'INSERT' then
    insert into public.case_updates (case_id, action, new_value, note, source, client_visible, user_id)
    values (new.id, 'created', new.team_status,
            'Case created from ' || case new.source_type when 'google_sheet' then 'Google Sheet' when 'email' then 'email' else 'manual entry' end,
            v_src, true, v_user);
    return null;
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  foreach k in array v_fields loop
    if v_old -> k is distinct from v_new -> k then
      insert into public.case_updates (case_id, action, field, old_value, new_value, source, client_visible, user_id)
      values (new.id, case when k = 'team_status' then 'status_changed' else 'field_updated' end,
              k, v_old ->> k, v_new ->> k, v_src, k = any (v_client_visible), v_user);
    end if;
  end loop;
  return null;
end $$;

create trigger cases_after_write
  after insert or update on public.cases
  for each row execute function public.cases_after_write();

-- ---------- Generic audit ----------
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_logs (table_name, record_id, action, old_data, new_data, user_id)
  values (tg_table_name, coalesce(v_row ->> 'id', v_row ->> 'key', v_row ->> 'code', v_row ->> 'case_id'), lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          auth.uid());
  return null;
end $$;

create trigger audit_clients        after insert or update or delete on public.clients        for each row execute function public.audit_row();
create trigger audit_profiles       after insert or update or delete on public.profiles       for each row execute function public.audit_row();
create trigger audit_client_pocs    after insert or update or delete on public.client_pocs    for each row execute function public.audit_row();
create trigger audit_status_master  after insert or update or delete on public.status_master  for each row execute function public.audit_row();
create trigger audit_status_maps    after insert or update or delete on public.status_mappings for each row execute function public.audit_row();
create trigger audit_aging_buckets  after insert or update or delete on public.aging_buckets  for each row execute function public.audit_row();
create trigger audit_column_aliases after insert or update or delete on public.column_aliases for each row execute function public.audit_row();
create trigger audit_sheet_sources  after insert or update or delete on public.sheet_sources  for each row execute function public.audit_row();
create trigger audit_app_settings   after insert or update or delete on public.app_settings   for each row execute function public.audit_row();
create trigger audit_lost_approvals after insert or update or delete on public.lost_approvals for each row execute function public.audit_row();
create trigger audit_case_private   after insert or update or delete on public.case_private   for each row execute function public.audit_row();

-- ---------- Consolidated case view (aging computed at read time, never stored from sheets) ----------
create or replace view public.v_cases with (security_invoker = true) as
select
  c.*,
  coalesce(cl.name, c.client_name)            as client_display_name,
  cl.sla_days                                  as client_sla_days,
  ag.full_name                                 as agent_name,
  coalesce(ag.full_name, c.assigned_agent_name) as agent_display_name,
  poc.name                                     as poc_name,
  sm.label                                     as status_label,
  sm.category                                  as status_category,
  sm.color                                     as status_color,
  a.current_aging_days,
  a.aging_days,
  b.label                                      as aging_bucket,
  b.sort_order                                 as aging_bucket_order,
  (sm.category in ('open', 'lost_pending')
     and a.current_aging_days > coalesce(cl.sla_days, public.app_setting_int('default_sla_days', 7))) as sla_breached
from public.cases c
join public.status_master sm on sm.code = c.team_status
left join public.clients cl on cl.id = c.client_id
left join public.profiles ag on ag.id = c.assigned_agent
left join public.client_pocs poc on poc.id = c.client_poc_id
cross join lateral (
  select greatest(public.app_today() - c.escalation_date, 0) as current_aging_days,
         case when sm.category in ('closed', 'lost') and c.final_aging_days is not null
              then c.final_aging_days
              else greatest(public.app_today() - c.escalation_date, 0) end as aging_days
) a
left join lateral (
  select ab.label, ab.sort_order from public.aging_buckets ab
  where a.aging_days >= ab.min_days and (ab.max_days is null or a.aging_days <= ab.max_days)
  order by ab.sort_order limit 1
) b on true
where not c.is_deleted;

-- ---------- Notifications ----------
create or replace function public.notify_admins(p_type text, p_title text, p_body text, p_case uuid, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, type, title, body, case_id, link)
  select id, p_type, p_title, p_body, p_case, p_link
  from public.profiles where is_active and role in ('super_admin', 'admin')
$$;

-- ---------- Lost workflow ----------
-- POC (own client only) or internal team requests Lost. Never sets the final Lost status.
create or replace function public.request_lost(p_case_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_role public.user_role := public.app_role();
  v_case public.cases%rowtype;
  v_cat public.status_category;
  v_approval uuid;
begin
  if v_role is null then
    raise exception 'Not signed in or account inactive';
  end if;
  select * into v_case from public.cases where id = p_case_id and not is_deleted for update;
  if not found then
    raise exception 'Case not found';
  end if;
  if v_role = 'client_poc' and (v_case.client_id is null or v_case.client_id not in (select public.poc_client_ids())) then
    raise exception 'Case not found';   -- do not reveal other clients' cases
  end if;
  v_cat := public.status_category_of(v_case.team_status);
  if v_cat = 'lost' then raise exception 'This case is already Lost'; end if;
  if v_cat = 'lost_pending' then raise exception 'A Lost request is already waiting for Admin approval'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for the Lost request'; end if;

  insert into public.lost_approvals (case_id, requested_by, requested_via, request_reason, previous_status)
  values (p_case_id, auth.uid(), case when v_role = 'client_poc' then 'poc_portal' else 'app' end, trim(p_reason), v_case.team_status)
  returning id into v_approval;

  insert into public.case_updates (case_id, action, note, source, client_visible, user_id)
  values (p_case_id, 'lost_requested', trim(p_reason), case when v_role = 'client_poc' then 'poc' else 'app' end, true, auth.uid());

  perform set_config('app.lost_flow', 'on', true);
  update public.cases
     set team_status = 'lost_pending_approval', lost_requested_at = now(),
         last_change_source = case when v_role = 'client_poc' then 'poc' else 'app' end
   where id = p_case_id;
  perform set_config('app.lost_flow', 'off', true);

  perform public.notify_admins('lost_request', 'Lost approval needed: ' || v_case.awb,
    coalesce((select name from public.clients where id = v_case.client_id), v_case.client_name, 'Unknown client') || ' — ' || trim(p_reason),
    p_case_id, '/lost-approval');
  return v_approval;
end $$;

-- Admin decision. Only an approval sets the final Lost status.
create or replace function public.decide_lost(p_approval_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_appr public.lost_approvals%rowtype;
  v_case public.cases%rowtype;
  v_target text;
begin
  if not public.is_admin() then
    raise exception 'Only an Admin can decide Lost requests';
  end if;
  if p_decision not in ('approved', 'rejected', 'sent_back') then
    raise exception 'Unknown decision %', p_decision;
  end if;
  select * into v_appr from public.lost_approvals where id = p_approval_id for update;
  if not found then raise exception 'Approval request not found'; end if;
  if v_appr.status <> 'pending' then raise exception 'This request was already decided'; end if;
  select * into v_case from public.cases where id = v_appr.case_id for update;

  update public.lost_approvals
     set status = p_decision::public.approval_status, decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_approval_id;

  perform set_config('app.lost_flow', 'on', true);
  if p_decision = 'approved' then
    update public.cases
       set team_status = 'lost', lost_approved_at = now(), lost_approved_by = auth.uid(),
           closure_date = public.app_today(), last_change_source = 'app'
     where id = v_case.id;
  else
    v_target := case
      when p_decision = 'sent_back' then 'working_on_it'
      when public.status_category_of(v_appr.previous_status) in ('lost', 'lost_pending') then 'working_on_it'
      else v_appr.previous_status end;
    update public.cases
       set team_status = v_target, lost_requested_at = null, last_change_source = 'app'
     where id = v_case.id;
  end if;
  perform set_config('app.lost_flow', 'off', true);

  insert into public.case_updates (case_id, action, note, source, client_visible, user_id)
  values (v_case.id,
          case p_decision when 'approved' then 'lost_approved' when 'rejected' then 'lost_rejected' else 'lost_sent_back' end,
          nullif(trim(coalesce(p_note, '')), ''), 'app', true, auth.uid());

  if v_appr.requested_by is not null and v_appr.requested_by <> auth.uid() then
    insert into public.notifications (user_id, type, title, body, case_id, link)
    values (v_appr.requested_by, 'lost_decision',
            'Lost request ' || case p_decision when 'approved' then 'approved' when 'rejected' then 'rejected' else 'sent back for investigation' end || ': ' || v_case.awb,
            nullif(trim(coalesce(p_note, '')), ''), v_case.id, null);
  end if;
end $$;

create or replace function public.decide_lost_bulk(p_approval_ids uuid[], p_decision text, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_n int := 0;
begin
  if not public.is_admin() then raise exception 'Only an Admin can decide Lost requests'; end if;
  foreach v_id in array p_approval_ids loop
    perform public.decide_lost(v_id, p_decision, p_note);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Admin-only escape hatch to take a case out of Lost (e.g. shipment found). Fully audited.
create or replace function public.reopen_lost_case(p_case_id uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an Admin can reopen a Lost case'; end if;
  if public.status_category_of(p_status) in ('lost', 'lost_pending') or public.status_category_of(p_status) is null then
    raise exception 'Choose a non-Lost status';
  end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Give a reason for reopening'; end if;
  update public.lost_approvals set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
         decision_note = trim(p_note)
   where case_id = p_case_id and status = 'pending';
  perform set_config('app.lost_flow', 'on', true);
  update public.cases set team_status = p_status, lost_approved_at = null, lost_approved_by = null,
         lost_requested_at = null, last_change_source = 'app'
   where id = p_case_id;
  perform set_config('app.lost_flow', 'off', true);
  insert into public.case_updates (case_id, action, note, source, client_visible, user_id)
  values (p_case_id, 'lost_reopened', trim(p_note), 'app', true, auth.uid());
end $$;


-- ---------- Daily admin report data (computed from the database, never from sheets) ----------
create or replace function public.daily_report_data(p_lost_days int default 30)
returns jsonb language sql stable security invoker set search_path = public as $$
  with base as (select * from public.v_cases),
  open_cases as (select * from base where status_category in ('open', 'lost_pending')),
  top_clients as (
    select client_display_name as client, count(*) as n from open_cases
    group by 1 order by 2 desc limit 10
  )
  select jsonb_build_object(
    'generated_at', now(),
    'report_date', public.app_today(),
    'summary', jsonb_build_object(
      'total_cases',      (select count(*) from base),
      'total_open',       (select count(*) from open_cases),
      'new_escalations',  (select count(*) from base where escalation_date >= public.app_today() - 1),
      'pending',          (select count(*) from base where team_status = 'pending'),
      'working_on_it',    (select count(*) from base where team_status = 'working_on_it'),
      'pod_shared',       (select count(*) from base where team_status = 'pod_shared'),
      'shipment_at_dc',   (select count(*) from base where team_status = 'shipment_at_dc'),
      'shipment_at_hub',  (select count(*) from base where team_status = 'shipment_at_hub'),
      'lost_pending',     (select count(*) from base where team_status = 'lost_pending_approval'),
      'lost',             (select count(*) from base where status_category = 'lost'),
      'closed',           (select count(*) from base where status_category = 'closed'),
      'tat_breached',     (select count(*) from base where sla_breached)
    ),
    'client_wise', coalesce((select jsonb_agg(t order by t.open desc, t.total desc) from (
        select coalesce(client_display_name, 'Unassigned') as client,
               count(*) as total,
               count(*) filter (where status_category in ('open', 'lost_pending')) as open,
               count(*) filter (where team_status = 'pending') as pending,
               count(*) filter (where team_status = 'lost_pending_approval') as lost_pending,
               count(*) filter (where status_category = 'lost') as lost,
               count(*) filter (where team_status = 'pod_shared') as pod_shared,
               count(*) filter (where status_category in ('open', 'lost_pending') and aging_days <= 7) as aging_0_7,
               count(*) filter (where status_category in ('open', 'lost_pending') and aging_days between 8 and 15) as aging_8_15,
               count(*) filter (where status_category in ('open', 'lost_pending') and aging_days between 16 and 30) as aging_16_30,
               count(*) filter (where status_category in ('open', 'lost_pending') and aging_days > 30) as aging_30_plus
        from base group by 1) t), '[]'::jsonb),
    'aging_wise', coalesce((select jsonb_agg(jsonb_build_object('label', ab.label, 'count', coalesce(x.n, 0)) order by ab.sort_order)
        from public.aging_buckets ab
        left join (select aging_bucket, count(*) n from open_cases group by 1) x on x.aging_bucket = ab.label), '[]'::jsonb),
    -- Rows: the 10 clients with the most open cases. Columns: aging day 1..10 and 10+.
    'top10_aging', coalesce((select jsonb_agg(t order by t.total desc) from (
        select coalesce(tc.client, 'Unassigned') as client, tc.n as total,
               (select jsonb_object_agg(d::text, coalesce(x.cnt, 0))
                  from generate_series(1, 11) d
                  left join (select least(greatest(oc.aging_days, 1), 11) as dd, count(*) as cnt
                               from open_cases oc
                              where oc.client_display_name is not distinct from tc.client
                              group by 1) x on x.dd = d) as by_day
        from top_clients tc) t), '[]'::jsonb),
    'top10_value', coalesce((select jsonb_agg(t) from (
        select row_number() over (order by product_value desc) as rank, awb, client_display_name as client,
               product_name, product_value, aging_days, status_label as status
        from base where product_value is not null and status_category in ('open', 'lost_pending')
        order by product_value desc limit 10) t), '[]'::jsonb),
    'top10_awb_count', coalesce((select jsonb_agg(t) from (
        select row_number() over (order by count(*) desc) as rank, coalesce(client_display_name, 'Unassigned') as client,
               count(*) as awb_count,
               count(*) filter (where status_category in ('open', 'lost_pending')) as pending_count,
               count(*) filter (where status_category = 'lost') as lost_count,
               round(avg(aging_days) filter (where status_category in ('open', 'lost_pending'))::numeric, 1) as avg_aging
        from base group by 2 order by count(*) desc limit 10) t), '[]'::jsonb),
    'lost_cases', coalesce((select jsonb_agg(t order by t.approved_at desc) from (
        select client_display_name as client, awb, escalation_date, aging_days, coalesce(hub, location) as hub,
               reason, team_remark as final_remark, lost_approved_at as approved_at
        from base where status_category = 'lost'
          and lost_approved_at >= now() - make_interval(days => p_lost_days)
        order by lost_approved_at desc limit 200) t), '[]'::jsonb),
    'lost_total', (select count(*) from base where status_category = 'lost'),
    'pending_lost', coalesce((select jsonb_agg(t order by t.requested_at) from (
        select b.client_display_name as client, b.awb, b.escalation_date, b.aging_days, coalesce(b.hub, b.location) as hub,
               la.request_reason as reason, la.requested_at, la.requested_via,
               coalesce(p.full_name, p.email) as requested_by
        from public.lost_approvals la
        join base b on b.id = la.case_id
        left join public.profiles p on p.id = la.requested_by
        where la.status = 'pending'
        order by la.requested_at limit 500) t), '[]'::jsonb),
    'pending_lost_total', (select count(*) from public.lost_approvals where status = 'pending')
  )
$$;

-- ---------- Data quality ----------
create or replace function public.data_quality_summary()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'estimated_escalation_date', (select count(*) from public.cases where escalation_date_estimated and not is_deleted),
    'missing_client',            (select count(*) from public.cases where client_id is null and not is_deleted),
    'missing_hub',               (select count(*) from public.cases where hub is null and location is null and not is_deleted),
    'open_duplicates',           (select count(*) from (
                                    select awb from public.v_cases where status_category in ('open', 'lost_pending')
                                    group by awb having count(*) > 1) d),
    'unmatched_clients', coalesce((select jsonb_agg(t) from (
                                    select client_name, count(*) as cases from public.cases
                                    where client_id is null and client_name is not null and not is_deleted
                                    group by 1 order by 2 desc limit 50) t), '[]'::jsonb),
    'unmapped_statuses', coalesce((select jsonb_agg(t) from (
                                    select v as value, count(*) as cases from public.cases,
                                           jsonb_array_elements_text(coalesce(extra -> 'unmapped_status', '[]'::jsonb)) v
                                    where not is_deleted group by 1 order by 2 desc limit 50) t), '[]'::jsonb),
    'emails_needing_review',     (select count(*) from public.emails where status = 'needs_review'),
    'failed_syncs', coalesce((select jsonb_agg(t) from (
                                    select id, workbook_name, sheet_name, last_sync_status, last_sync_message, last_synced_at
                                    from public.sheet_sources where is_active and last_sync_status in ('failed', 'partial')) t), '[]'::jsonb)
  )
$$;

-- ---------- Function privileges ----------
revoke execute on function public.notify_admins(text, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.request_lost(uuid, text) from public, anon;
revoke execute on function public.decide_lost(uuid, text, text) from public, anon;
revoke execute on function public.decide_lost_bulk(uuid[], text, text) from public, anon;
revoke execute on function public.reopen_lost_case(uuid, text, text) from public, anon;
grant execute on function public.request_lost(uuid, text) to authenticated;
grant execute on function public.decide_lost(uuid, text, text) to authenticated;
grant execute on function public.decide_lost_bulk(uuid[], text, text) to authenticated;
grant execute on function public.reopen_lost_case(uuid, text, text) to authenticated;

-- ######## rls ########
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

-- ######## email_cases ########
-- =====================================================================
-- Email escalations -> cases, and small helpers used by the app.
-- =====================================================================

-- Creates (or links) one case per AWB from a reviewed email. Runs as one transaction:
-- either every AWB of the email is stored, or none is.
--   p_common: { client_id, client_poc_id, escalation_date, complaint_type, reason, priority, team_remark, assigned_agent }
--   p_rows:   [{ awb, link_case_id?, location, hub, delivery_date, seller_name, reason, product_name,
--                product_value, order_id, remark }]
create or replace function public.create_email_cases(p_email_id uuid, p_common jsonb, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email public.emails%rowtype;
  r jsonb;
  v_awb text;
  v_case uuid;
  v_esc date := nullif(p_common ->> 'escalation_date', '')::date;
  v_client uuid := nullif(p_common ->> 'client_id', '')::uuid;
  v_poc uuid := nullif(p_common ->> 'client_poc_id', '')::uuid;
  v_agent uuid := nullif(p_common ->> 'assigned_agent', '')::uuid;
  v_created int := 0;
  v_linked int := 0;
  v_ids uuid[] := '{}';
begin
  if not public.is_internal() then
    raise exception 'Only the internal team can create cases from email';
  end if;
  select * into v_email from public.emails where id = p_email_id for update;
  if not found then raise exception 'Email not found'; end if;
  if v_esc is null then raise exception 'Escalation date is required'; end if;
  if v_esc > public.app_today() then raise exception 'Escalation date cannot be in the future'; end if;
  if v_poc is not null and not exists (select 1 from public.client_pocs where id = v_poc and client_id = v_client) then
    raise exception 'The selected POC does not belong to the selected client';
  end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) = 0 then
    raise exception 'Add at least one AWB';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    v_awb := upper(regexp_replace(coalesce(r ->> 'awb', ''), '\s', '', 'g'));
    if v_awb = '' then continue; end if;
    v_case := nullif(r ->> 'link_case_id', '')::uuid;

    if v_case is not null then
      -- Same shipment already tracked (e.g. from a Google Sheet): attach the email and fill gaps only.
      update public.cases set
        email_id         = coalesce(email_id, p_email_id),
        email_subject    = coalesce(email_subject, v_email.subject),
        email_thread_id  = coalesce(email_thread_id, v_email.gmail_thread_id),
        email_message_id = coalesce(email_message_id, v_email.gmail_message_id),
        email_sender     = coalesce(email_sender, v_email.sender),
        client_id        = coalesce(client_id, v_client),
        client_poc_id    = coalesce(client_poc_id, v_poc),
        location         = coalesce(location, nullif(r ->> 'location', '')),
        hub              = coalesce(hub, nullif(r ->> 'hub', '')),
        delivery_date    = coalesce(delivery_date, nullif(r ->> 'delivery_date', '')::date),
        seller_name      = coalesce(seller_name, nullif(r ->> 'seller_name', '')),
        complaint_type   = coalesce(complaint_type, nullif(p_common ->> 'complaint_type', '')),
        reason           = coalesce(reason, nullif(r ->> 'reason', ''), nullif(p_common ->> 'reason', '')),
        priority         = coalesce(priority, nullif(p_common ->> 'priority', '')),
        product_name     = coalesce(product_name, nullif(r ->> 'product_name', '')),
        product_value    = coalesce(product_value, nullif(r ->> 'product_value', '')::numeric),
        order_id         = coalesce(order_id, nullif(r ->> 'order_id', '')),
        last_change_source = 'email'
      where id = v_case and awb = v_awb and not is_deleted;
      if not found then raise exception 'Case to link for % was not found', v_awb; end if;
      insert into public.case_updates (case_id, action, note, source, client_visible, user_id)
      values (v_case, 'email_linked', 'Linked to email "' || coalesce(v_email.subject, '(no subject)') || '"', 'email', false, auth.uid());
      v_linked := v_linked + 1;
    else
      insert into public.cases (
        awb, client_id, client_poc_id, escalation_date, location, hub, delivery_date, seller_name,
        complaint_type, reason, priority, product_name, product_value, order_id,
        source_type, email_id, email_subject, email_message_id, email_thread_id, email_sender,
        team_status, status_source, team_remark, assigned_agent, created_by, last_change_source, extra)
      values (
        v_awb, v_client, v_poc, v_esc, nullif(r ->> 'location', ''), nullif(r ->> 'hub', ''),
        nullif(r ->> 'delivery_date', '')::date, nullif(r ->> 'seller_name', ''),
        nullif(p_common ->> 'complaint_type', ''), coalesce(nullif(r ->> 'reason', ''), nullif(p_common ->> 'reason', '')),
        nullif(p_common ->> 'priority', ''), nullif(r ->> 'product_name', ''), nullif(r ->> 'product_value', '')::numeric,
        nullif(r ->> 'order_id', ''),
        'email', p_email_id, v_email.subject, v_email.gmail_message_id, v_email.gmail_thread_id, v_email.sender,
        'pending', 'app', coalesce(nullif(r ->> 'remark', ''), nullif(p_common ->> 'team_remark', '')), v_agent, auth.uid(), 'email',
        jsonb_strip_nulls(jsonb_build_object('email_extraction_confidence', p_common -> 'confidence')))
      returning id into v_case;
      v_created := v_created + 1;
    end if;

    insert into public.source_records (source_type, email_id, source_key, record_hash, raw, case_id)
    values ('email', p_email_id, v_email.gmail_thread_id || ':' || v_awb, md5(r::text), r, v_case)
    on conflict (source_type, source_key) do update
      set raw = excluded.raw, record_hash = excluded.record_hash, case_id = excluded.case_id,
          last_seen_at = now(), last_changed_at = now();
    v_ids := v_ids || v_case;
  end loop;

  update public.emails
     set status = 'processed', processed_by = auth.uid(), processed_at = now(),
         client_id = coalesce(v_client, client_id)
   where id = p_email_id;

  return jsonb_build_object('created', v_created, 'linked', v_linked, 'case_ids', to_jsonb(v_ids));
end $$;

revoke execute on function public.create_email_cases(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.create_email_cases(uuid, jsonb, jsonb) to authenticated;

-- Server-side jobs (service role) raise one aggregated admin notification per sync run.
grant execute on function public.notify_admins(text, text, text, uuid, text) to service_role;

-- Open cases that already exist for a list of AWBs — used for duplicate warnings before creating cases.
create or replace function public.find_existing_cases(p_awbs text[])
returns table (id uuid, case_number bigint, awb text, client text, status_label text, escalation_date date,
               source_type public.source_type, status_category public.status_category)
language sql stable security invoker set search_path = public as $$
  select v.id, v.case_number, v.awb, v.client_display_name, v.status_label, v.escalation_date, v.source_type, v.status_category
  from public.v_cases v
  where v.awb = any (select upper(regexp_replace(x, '\s', '', 'g')) from unnest(p_awbs) x)
  order by v.awb, v.escalation_date desc
$$;

-- Setting used to pick the client's message in a thread (our own replies are skipped).
insert into public.app_settings (key, value, description) values
  ('internal_email_domains', '["shadowfax.in"]', 'Email domains of the internal team; their messages are not treated as client escalations')
on conflict (key) do nothing;

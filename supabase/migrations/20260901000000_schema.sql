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

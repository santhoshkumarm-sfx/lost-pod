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
grant execute on function public.import_sheet_rows(uuid, jsonb, uuid) to service_role;

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

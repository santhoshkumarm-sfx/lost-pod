export interface CaseRow {
  id: string;
  case_number: number;
  awb: string;
  client_id: string | null;
  client_name: string | null;
  client_display_name: string | null;
  client_poc_id: string | null;
  poc_name: string | null;
  escalation_date: string;
  escalation_date_estimated: boolean;
  location: string | null;
  hub: string | null;
  delivery_date: string | null;
  seller_name: string | null;
  complaint_type: string | null;
  reason: string | null;
  priority: string | null;
  shipment_status: string | null;
  pod_status: string;
  pod_link: string | null;
  product_name: string | null;
  product_value: number | null;
  order_id: string | null;
  rider_name: string | null;
  rider_id: string | null;
  source_type: 'google_sheet' | 'email' | 'manual';
  source_workbook: string | null;
  source_sheet: string | null;
  source_row: number | null;
  sheet_source_id: string | null;
  email_id: string | null;
  email_subject: string | null;
  email_thread_id: string | null;
  email_sender: string | null;
  team_status: string;
  status_source: 'app' | 'import';
  status_label: string;
  status_category: 'open' | 'lost_pending' | 'lost' | 'closed';
  status_color: string;
  team_remark: string | null;
  client_remark: string | null;
  assigned_agent: string | null;
  agent_display_name: string | null;
  closure_date: string | null;
  final_aging_days: number | null;
  current_aging_days: number;
  aging_days: number;
  aging_bucket: string | null;
  sla_breached: boolean;
  lost_requested_at: string | null;
  lost_approved_at: string | null;
  extra: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface StatusOption {
  code: string;
  label: string;
  category: 'open' | 'lost_pending' | 'lost' | 'closed';
  color: string;
  sort_order: number;
  allow_manual: boolean;
  is_active: boolean;
  is_system: boolean;
}

export interface ClientOption {
  id: string;
  name: string;
}

export const CASE_LIST_COLUMNS =
  'id, case_number, awb, client_id, client_display_name, poc_name, escalation_date, escalation_date_estimated, hub, location, team_status, status_label, status_category, status_color, aging_days, aging_bucket, sla_breached, agent_display_name, source_type, team_remark, pod_status, updated_at, product_value, lost_approved_at, reason';

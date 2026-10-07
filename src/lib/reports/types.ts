export interface ReportSummary {
  total_cases: number;
  total_open: number;
  new_escalations: number;
  pending: number;
  working_on_it: number;
  pod_shared: number;
  shipment_at_dc: number;
  shipment_at_hub: number;
  lost_pending: number;
  lost: number;
  closed: number;
  tat_breached: number;
}

export interface DailyReportData {
  generated_at: string;
  report_date: string;
  summary: ReportSummary;
  client_wise: {
    client: string; total: number; open: number; pending: number; lost_pending: number; lost: number; pod_shared: number;
    aging_0_7: number; aging_8_15: number; aging_16_30: number; aging_30_plus: number;
  }[];
  aging_wise: { label: string; count: number }[];
  top10_aging: { client: string; total: number; by_day: Record<string, number> }[];
  top10_value: { rank: number; awb: string; client: string | null; product_name: string | null; product_value: number; aging_days: number; status: string }[];
  top10_awb_count: { rank: number; client: string; awb_count: number; pending_count: number; lost_count: number; avg_aging: number | null }[];
  lost_cases: { client: string | null; awb: string; escalation_date: string; aging_days: number; hub: string | null; reason: string | null; final_remark: string | null; approved_at: string }[];
  lost_total: number;
  pending_lost: { client: string | null; awb: string; escalation_date: string; aging_days: number; hub: string | null; reason: string | null; requested_at: string; requested_via: string; requested_by: string | null }[];
  pending_lost_total: number;
}

/** One row of the consolidated case list in the attachment / exports. */
export interface CaseExportRow {
  case_number: number;
  awb: string;
  client_display_name: string | null;
  source_type: string;
  source_workbook: string | null;
  source_sheet: string | null;
  email_subject: string | null;
  escalation_date: string;
  escalation_date_estimated: boolean;
  aging_days: number;
  aging_bucket: string | null;
  status_label: string;
  status_category: string;
  hub: string | null;
  location: string | null;
  delivery_date: string | null;
  seller_name: string | null;
  complaint_type: string | null;
  reason: string | null;
  priority: string | null;
  pod_status: string;
  pod_link: string | null;
  team_remark: string | null;
  client_remark: string | null;
  agent_display_name: string | null;
  poc_name: string | null;
  product_name: string | null;
  product_value: number | null;
  closure_date: string | null;
  final_aging_days: number | null;
  lost_approved_at: string | null;
  sla_breached: boolean;
}

export const CASE_EXPORT_COLUMNS =
  'case_number, awb, client_display_name, source_type, source_workbook, source_sheet, email_subject, escalation_date, escalation_date_estimated, aging_days, aging_bucket, status_label, status_category, hub, location, delivery_date, seller_name, complaint_type, reason, priority, pod_status, pod_link, team_remark, client_remark, agent_display_name, poc_name, product_name, product_value, closure_date, final_aging_days, lost_approved_at, sla_breached';

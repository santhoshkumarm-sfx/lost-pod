/** To / CC settings of every email, as shown on the Reports page. */
export const RECIPIENT_KEYS = {
  critical: ['critical_alert_email_to', 'critical_alert_email_cc'],
  daily: ['report_recipients', 'report_cc'],
  weekly: ['weekly_report_recipients', 'weekly_report_cc'],
  lost_request: ['lost_request_email_to', 'lost_request_email_cc'],
  loss_accepted: ['loss_accepted_email_to', 'loss_accepted_email_cc'],
  lost_decision: ['lost_decision_email_to', 'lost_decision_email_cc'],
  pod_request: ['pod_request_to', 'pod_request_cc'],
} as const;
export type RecipientKind = keyof typeof RECIPIENT_KEYS;

export const RECIPIENT_LABELS: Record<RecipientKind, string> = {
  critical: 'Critical alert', daily: 'Daily report', weekly: 'Weekly report',
  lost_request: 'POD lost requested', loss_accepted: 'POD lost accepted', lost_decision: 'POD lost rejected / sent back', pod_request: 'POD request (client)',
};

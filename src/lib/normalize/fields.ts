/** Standard fields a source column can be mapped to. "ignore" keeps the value only in the raw source record. */
export const TARGET_FIELDS = [
  'awb', 'escalation_date', 'client_name', 'poc_name', 'location', 'hub', 'delivery_date', 'seller_name',
  'pod_link', 'pod_status', 'status_raw', 'team_remark', 'client_remark', 'shipment_status', 'priority',
  'complaint_type', 'reason', 'agent_name', 'rider_name', 'rider_id', 'closure_date', 'email_subject',
  'product_name', 'product_value', 'order_id', 'ignore',
] as const;

export type TargetField = (typeof TARGET_FIELDS)[number];

export const FIELD_LABELS: Record<TargetField, string> = {
  awb: 'AWB',
  escalation_date: 'Escalation date',
  client_name: 'Client',
  poc_name: 'Client POC',
  location: 'Location',
  hub: 'Hub',
  delivery_date: 'Delivery date',
  seller_name: 'Seller name',
  pod_link: 'POD link',
  pod_status: 'POD status',
  status_raw: 'Case status',
  team_remark: 'Shadowfax remark',
  client_remark: 'Client remark',
  shipment_status: 'Shipment status',
  priority: 'Priority',
  complaint_type: 'Complaint type',
  reason: 'Reason',
  agent_name: 'Agent',
  rider_name: 'Rider',
  rider_id: 'Rider ID',
  closure_date: 'Closure date',
  email_subject: 'Mail subject',
  product_name: 'Product name',
  product_value: 'Product value',
  order_id: 'Order ID',
  ignore: 'Ignore (keep in source only)',
};

export function isTargetField(v: string): v is TargetField {
  return (TARGET_FIELDS as readonly string[]).includes(v);
}

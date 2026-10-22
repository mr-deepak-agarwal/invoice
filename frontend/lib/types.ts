export type InvoiceStatus =
  | "draft"
  | "sent"
  | "paid"
  | "overdue"
  | "cancelled";

export interface Client {
  name: string;
  email: string | null;
  phone: string | null;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  description: string;
  taxable_value: number;
  total_value: number;
  due_date: string;
  status: InvoiceStatus;
  pdf_url: string | null;
  created_at: string;
  clients: Client | null;
}

export interface ParsedInvoiceData {
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  company_address: string | null;
  taxable_value: number | null;
  due_date: string | null;
  missing_fields: string[];
  matched_existing_client: boolean;
  matched_client_id: string | null;
}

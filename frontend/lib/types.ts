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

/** What the reader (regex + saved client + Gemini) extracts from a message. */
export interface ParsedInvoiceData {
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  company_address: string | null;
  client_gstin: string | null;
  /** GST state code of the place of supply, e.g. "30" for Goa. */
  client_state_code: string | null;
  taxable_value: number | null;
  /** Total GST rate in %, e.g. 18. null = use the default. */
  gst_rate: number | null;
  description: string | null;
  due_date: string | null; // YYYY-MM-DD
  missing_fields: string[];
  matched_existing_client: boolean;
  matched_client_id: string | null;
  /** True when the message says the amount already includes GST. */
  amount_includes_gst: boolean;
  parse_note: string | null; // set when something needs the user's attention
  /** Fields filled from the business's saved defaults, not the message
   * (e.g. "due_date", "client_state"). Shown to the user as "assumed". */
  defaults_applied: string[];
}

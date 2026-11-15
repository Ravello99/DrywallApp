// Types for the project-management features (tasks, materials, manpower, RFIs, change orders,
// progress draws, bids, notifications). Money values arrive in dollars.

export type BudgetStatus = 'no_budget' | 'ok' | 'warning' | 'over';

export interface PMTask {
  id: string;
  title: string;
  description?: string | null;
  site_id: string;
  site_name: string;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  priority: 'high' | 'medium' | 'low';
  task_type: string;
  status: 'todo' | 'in_progress' | 'complete';
  scope?: string | null;
  scope_label?: string | null;
  sequence?: number | null;
  budget_hours?: number | null;
  actual_hours: number;
  budget_status: BudgetStatus;
  hours_remaining?: number | null;
  progress_pct: number;
  labour_cost?: number;
  start_date?: string | null;
  due_date?: string | null;
}

export interface CrewMember {
  user_id: string;
  name: string;
  clock_in: string;
  task_title?: string | null;
  role?: string;
  level?: string | null;
  specialties: string[];
  safety_expired: number;
  safety_expiring_7: number;
  flagged: boolean;
}

export interface Financials {
  revised_contract: number;
  contract?: number;
  approved_changes?: number;
  billed_gross: number;
  paid?: number;
  percent_billed: number | null;
  percent_materials: number | null;
  exposure_points: number | null;
  exposure_alert: boolean;
  labour_cost: number;
  labour_hours?: number;
  material_released?: number;
  material_budget?: number;
  labour_budget?: number;
  costs_to_date: number;
  margin_to_date: number | null;
  projected_margin: number | null;
  projected_profit?: number | null;
  outstanding_receivable: number;
  holdback_held?: number;
  left_to_bill?: number;
  cash_exposure: number;
}

export interface SiteCard {
  id: string;
  name: string;
  address?: string;
  status: 'active' | 'shutdown' | 'completed';
  shutdown_reason?: string | null;
  project_number?: string | null;
  job_type?: string | null;
  general_contractor?: string | null;
  has_location: boolean;
  men_on_site: number;
  crew: CrewMember[];
  progress_pct: number | null;
  outstanding_tasks: number;
  tasks_over_budget: number;
  tasks_near_budget: number;
  crew_safety_problems: number;
  labour_hours?: number;
  budget_hours?: number;
  hours_today?: number;
  labour_budget_status?: BudgetStatus;
  open_rfis?: number;
  pending_material_requests?: number;
  pending_manpower_requests?: number;
  pending_change_orders?: number;
  flagged_clock_records?: number;
  financials?: Financials;
}

export interface ScopeSummary {
  scope: string;
  label: string;
  budget_hours: number;
  actual_hours: number;
  tasks: number;
  complete: number;
  budget_status: BudgetStatus;
}

export interface ProjectSummary extends Omit<SiteCard, 'outstanding_tasks'> {
  tasks: {
    total: number;
    outstanding: any[];
    over_budget: any[];
    near_budget: any[];
    progress_pct: number | null;
    budget_hours: number;
    scopes: ScopeSummary[];
  };
  site?: {
    contract_value?: number | null;
    material_budget?: number | null;
    labour_budget?: number | null;
    start_date?: string | null;
    end_date?: string | null;
    geofence_radius_m?: number;
  };
}

export interface MaterialItem {
  description: string;
  quantity: number;
  unit: string;
  notes?: string | null;
}

export interface MaterialRequest {
  id: string;
  site_id: string;
  site_name: string;
  items: MaterialItem[];
  needed_by?: string | null;
  priority: 'urgent' | 'normal' | 'low';
  notes?: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'released' | 'delivered';
  requested_by_name: string;
  decided_by_name?: string | null;
  decision_notes?: string | null;
  created_at: string;
}

export interface MaterialRelease {
  id: string;
  site_id: string;
  site_name: string;
  amount: number;
  supplier?: string | null;
  po_number?: string | null;
  description?: string | null;
  released_on: string;
  released_by_name: string;
}

export interface ManpowerRequest {
  id: string;
  site_id: string;
  site_name: string;
  kind: 'request' | 'release';
  specialty?: string | null;
  count: number;
  start_date?: string | null;
  end_date?: string | null;
  user_ids: string[];
  user_names?: string[];
  notes?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  requested_by_name: string;
  assigned_user_names?: string[];
  decision_notes?: string | null;
  created_at: string;
}

export interface AvailablePerson {
  id: string;
  name: string;
  role: string;
  level?: string | null;
  specialties: string[];
  matches_specialty: boolean;
  available: boolean;
  busy_at: string[];
  safety_expired: number;
  safety_expiring_7: number;
}

export interface CrewAssignment {
  id: string;
  user_id: string;
  user_name: string;
  site_id: string;
  site_name: string;
  start_date: string;
  end_date?: string | null;
}

export interface RFI {
  id: string;
  number: number;
  site_id: string;
  site_name: string;
  subject: string;
  question: string;
  drawing_ref?: string | null;
  location?: string | null;
  priority: 'urgent' | 'normal' | 'low';
  needed_by?: string | null;
  status: 'open' | 'answered' | 'closed';
  response?: string | null;
  responded_by_name?: string | null;
  sent_to_gc?: boolean;
  gc_reference?: string | null;
  submitted_by_name: string;
  has_photo: boolean;
  overdue: boolean;
  created_at: string;
}

export interface ChangeOrder {
  id: string;
  number: number;
  site_id: string;
  site_name: string;
  title: string;
  description?: string | null;
  amount: number;
  approved_amount?: number | null;
  reason: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  gc_reference?: string | null;
  response_notes?: string | null;
  created_at: string;
}

export interface Draw {
  id: string;
  site_id: string;
  site_name: string;
  number: number;
  invoice_number: string;
  period_end?: string | null;
  description?: string | null;
  gross: number;
  holdback: number;
  net: number;
  tax: number;
  total_due: number;
  holdback_pct: number;
  tax_pct: number;
  percent_complete?: number | null;
  previous_billed: number;
  status: 'draft' | 'submitted' | 'partially_paid' | 'paid';
  balance: number;
  paid_total: number;
  payments: { amount: number; paid_on: string; reference?: string | null }[];
  days_outstanding?: number | null;
}

export type BidStatus = 'invited' | 'reviewing' | 'submitted' | 'won' | 'lost' | 'declined';

export interface Bid {
  id: string;
  project_name: string;
  general_contractor?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  category: string;
  category_label: string;
  location?: string | null;
  due_date?: string | null;
  bid_amount?: number | null;
  status: BidStatus;
  source?: string;
  submitted_at?: string | null;
  follow_up_date?: string | null;
  follow_up_due: boolean;
  days_until_due?: number | null;
  estimator_name?: string | null;
  notes?: string | null;
  scope?: string | null;
  email_subject?: string | null;
  email_from?: string | null;
  email_body?: string | null;
  project_id?: string | null;
  activity?: { at: string; text: string }[];
}

export interface BidStats {
  weekly: { week_start: string; submitted: number; won: number; lost: number }[];
  submitted_this_week: number;
  won: number;
  lost: number;
  win_rate: number | null;
  pipeline_value: number;
  followups_due: number;
  due_this_week: number;
  by_category: Record<string, { submitted: number; won: number; lost: number; open: number; win_rate: number | null }>;
  categories: Record<string, string>;
}

export interface AppNotification {
  id: string;
  title: string;
  body?: string | null;
  kind?: string;
  link?: string | null;
  read: boolean;
  created_at: string;
}

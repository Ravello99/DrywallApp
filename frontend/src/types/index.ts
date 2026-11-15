// User Roles
export type UserRole = 'manager' | 'apprentice' | 'journeyman' | 'lead_hand' | 'foreman';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  assigned_sites: string[];
  created_at: string;
}

export interface Site {
  id: string;
  name: string;
  address: string;
  location?: {
    latitude: number;
    longitude: number;
  };
  status: string;
  created_at: string;
}

export interface ClockRecord {
  id: string;
  user_id: string;
  user_name: string;
  site_id: string;
  site_name: string;
  clock_in: string;
  clock_in_location: {
    latitude: number;
    longitude: number;
  };
  clock_out?: string;
  clock_out_location?: {
    latitude: number;
    longitude: number;
  };
  total_hours?: number;
  status: string;
  synced?: boolean;
}

export interface SafetyDocument {
  id: string;
  user_id: string;
  user_name: string;
  site_id: string;
  site_name: string;
  document_type: string;
  file_data: string;
  file_name: string;
  description?: string;
  expiry_date?: string;
  is_expiring_soon: boolean;
  is_expiring_critical: boolean;
  days_until_expiry?: number;
  created_at: string;
}

export interface Announcement {
  id: string;
  site_id: string;
  site_name: string;
  title: string;
  content: string;
  announcement_type: 'site_instruction' | 'hazard' | 'general';
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at?: string;
}

export interface SharedFile {
  id: string;
  site_id: string;
  site_name: string;
  category: 'drawings' | 'shop_drawings' | 'site_plans' | 'safety_documents' | 'other';
  file_name: string;
  file_data: string;
  description?: string;
  uploaded_by: string;
  uploaded_by_name: string;
  created_at: string;
}

// Task Types
export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskType = 'safety' | 'installation' | 'inspection';
export type TaskStatus = 'todo' | 'in_progress' | 'complete';

export interface Task {
  id: string;
  title: string;
  description?: string;
  site_id: string;
  site_name: string;
  assigned_to: string;
  assigned_to_name: string;
  priority: TaskPriority;
  task_type: TaskType;
  status: TaskStatus;
  due_date?: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at?: string;
}

// Custom Form Types
export type FormFieldType = 'text' | 'yesno' | 'multiple_choice' | 'date' | 'photo' | 'signature';

export interface FormField {
  field_id: string;
  field_type: FormFieldType;
  label: string;
  required: boolean;
  options?: string[];
}

export interface FormTemplate {
  id: string;
  title: string;
  description?: string;
  fields: FormField[];
  site_id?: string;
  site_name?: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
}

export interface FormAssignment {
  assignment_id: string;
  form_id: string;
  form_title: string;
  form_description?: string;
  due_date?: string;
  assigned_at: string;
}

export interface FormSubmission {
  id: string;
  form_id: string;
  form_title: string;
  user_id: string;
  user_name: string;
  responses: Record<string, any>;
  submitted_at: string;
}

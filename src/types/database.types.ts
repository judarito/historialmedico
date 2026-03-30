// ============================================================
// Tipos TypeScript — Schema real de Supabase
// Refleja exactamente las columnas existentes en la DB
// ============================================================

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

// ENUMs reales del schema
export type TenantUserRole         = "owner" | "admin" | "member" | "viewer";
export type RelationshipType       = "self" | "spouse" | "son" | "daughter" | "father" | "mother" | "brother" | "sister" | "grandfather" | "grandmother" | "guardian" | "other";
export type DocumentProcessingStatus = "pending" | "processing" | "processed" | "verified" | "failed";
export type DocumentType           = "formula" | "medical_order" | "lab_order" | "lab_result" | "imaging_result" | "incapacity" | "clinical_note" | "vaccination_card" | "voice_note" | "other";
export type MedicationRoute        = "oral" | "nasal" | "topical" | "ophthalmic" | "otic" | "inhaled" | "nebulized" | "intramuscular" | "intravenous" | "subcutaneous" | "rectal" | "other";
export type PrescriptionStatus     = "active" | "completed" | "paused" | "cancelled";
export type ScheduleStatus         = "pending" | "taken" | "skipped" | "late" | "cancelled";
export type TestStatus             = "pending" | "scheduled" | "completed" | "result_uploaded" | "cancelled";
export type VisitStatus            = "draft" | "completed" | "cancelled";
export type ReminderType           = "medication_dose" | "dose_overdue" | "treatment_ending" | "medical_test" | "appointment" | "custom";
export type ReminderStatus         = "pending" | "sent" | "read" | "dismissed" | "failed";

export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: {
          id:          string;
          name:        string;
          slug:        string;
          plan:        string;
          is_active:   boolean;
          settings:    Json;
          created_at:  string;
          updated_at:  string;
        };
        Insert: Omit<Database["public"]["Tables"]["tenants"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["tenants"]["Insert"]>;
      };

      profiles: {
        Row: {
          id:          string;
          tenant_id:   string | null;    // agregado en migration 006
          full_name:   string | null;
          email:       string | null;
          phone:       string | null;
          avatar_url:  string | null;    // agregado en migration 006
          locale:      string | null;    // agregado en migration 006
          push_token:  string | null;    // agregado en migration 006
          created_at:  string;
          updated_at:  string;
        };
        Insert: Omit<Database["public"]["Tables"]["profiles"]["Row"], "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
      };

      tenant_users: {
        Row: {
          id:          string;
          tenant_id:   string;
          user_id:     string;
          role:        TenantUserRole;
          is_active:   boolean;
          invited_by:  string | null;    // agregado en migration 006
          joined_at:   string | null;    // agregado en migration 006
          created_at:  string;
          updated_at:  string;
        };
        Insert: Omit<Database["public"]["Tables"]["tenant_users"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["tenant_users"]["Insert"]>;
      };

      families: {
        Row: {
          id:          string;
          tenant_id:   string;
          name:        string;
          description: string | null;
          avatar_url:  string | null;    // agregado en migration 006
          is_active:   boolean;
          created_by:  string;
          created_at:  string;
          updated_at:  string;
        };
        Insert: Omit<Database["public"]["Tables"]["families"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["families"]["Insert"]>;
      };

      family_members: {
        Row: {
          id:                       string;
          tenant_id:                string;
          family_id:                string;
          first_name:               string;           // columna real
          last_name:                string | null;    // columna real
          relationship:             RelationshipType;
          birth_date:               string | null;    // columna real (no date_of_birth)
          sex:                      string | null;
          blood_type:               string | null;
          allergies:                string | null;    // TEXT (no array)
          chronic_conditions:       string | null;    // TEXT (no array)
          eps_name:                 string | null;    // columna real (no eps)
          emergency_contact_name:   string | null;
          emergency_contact_phone:  string | null;
          notes:                    string | null;
          avatar_url:               string | null;
          is_active:                boolean;
          created_by:               string;
          created_at:               string;
          updated_at:               string;
        };
        Insert: Omit<Database["public"]["Tables"]["family_members"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["family_members"]["Insert"]>;
      };

      medical_visits: {
        Row: {
          id:                string;
          tenant_id:         string;
          family_id:         string;
          family_member_id:  string;
          visit_date:        string;       // TIMESTAMPTZ (no date)
          doctor_name:       string | null;
          specialty:         string | null;
          institution_name:  string | null;  // columna real (no institution)
          reason_for_visit:  string | null;  // columna real (no reason)
          diagnosis:         string | null;
          notes:             string | null;  // columna real (no observations)
          weight_kg:         number | null;  // vitales separados (no JSONB)
          height_cm:         number | null;
          temperature_c:     number | null;
          blood_pressure:    string | null;
          heart_rate:        number | null;
          voice_note_url:    string | null;
          voice_note_text:   string | null;
          status:            VisitStatus;
          created_by:        string;
          created_at:        string;
          updated_at:        string;
        };
        Insert: Omit<Database["public"]["Tables"]["medical_visits"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["medical_visits"]["Insert"]>;
      };

      medical_documents: {
        Row: {
          id:                string;
          tenant_id:         string;
          family_id:         string;
          family_member_id:  string;
          medical_visit_id:  string | null;  // columna real (no visit_id)
          document_type:     DocumentType;
          title:             string | null;
          file_path:         string;          // columna real (no storage_path)
          file_url:          string | null;
          mime_type:         string | null;
          file_size_bytes:   number | null;
          captured_at:       string | null;
          extracted_text:    string | null;
          parsed_json:       Json | null;     // resultado del LLM
          ai_model:          string | null;
          processing_status: DocumentProcessingStatus;
          verified_by_user:  boolean;
          verified_at:       string | null;
          processing_error:  string | null;
          created_by:        string;
          created_at:        string;
          updated_at:        string;
        };
        Insert: Omit<Database["public"]["Tables"]["medical_documents"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["medical_documents"]["Insert"]>;
      };

      // prescriptions = medicamentos individuales (ligados a medical_documents)
      prescriptions: {
        Row: {
          id:                  string;
          tenant_id:           string;
          family_id:           string;
          family_member_id:    string;
          medical_visit_id:    string | null;
          medical_document_id: string | null;
          medication_name:     string;        // columna real (no name)
          presentation:        string | null;
          dose_amount:         number | null;
          dose_unit:           string | null;
          frequency_text:      string | null;
          interval_hours:      number | null;
          times_per_day:       number | null;
          duration_days:       number | null;
          route:               MedicationRoute | null;
          instructions:        string | null;
          start_at:            string | null;  // columna real (no start_date)
          end_at:              string | null;  // columna real (no end_date)
          is_as_needed:        boolean;
          max_daily_doses:     number | null;
          status:              PrescriptionStatus;
          created_by:          string;
          created_at:          string;
          updated_at:          string;
        };
        Insert: Omit<Database["public"]["Tables"]["prescriptions"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["prescriptions"]["Insert"]>;
      };

      medication_schedules: {
        Row: {
          id:              string;
          tenant_id:       string;
          family_id:       string;
          family_member_id: string;
          prescription_id: string;       // columna real (no medication_id)
          scheduled_at:    string;
          dose_number:     number | null;  // agregado en migration 006
          dose_label:      string | null;  // agregado en migration 006
          status:          ScheduleStatus;
          taken_at:        string | null;
          skipped_at:      string | null;  // columna real (separada de taken_at)
          marked_by:       string | null;  // columna real (no taken_by)
          notes:           string | null;
          created_at:      string;
          updated_at:      string;
        };
        Insert: Omit<Database["public"]["Tables"]["medication_schedules"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["medication_schedules"]["Insert"]>;
      };

      medical_tests: {
        Row: {
          id:                  string;
          tenant_id:           string;
          family_id:           string;
          family_member_id:    string;
          medical_visit_id:    string | null;
          medical_document_id: string | null;
          test_name:           string;         // columna real (no name)
          category:            string | null;
          ordered_at:          string | null;
          scheduled_at:        string | null;
          completed_at:        string | null;
          due_at:              string | null;
          status:              TestStatus;
          result_document_id:  string | null;
          notes:               string | null;
          created_by:          string;
          created_at:          string;
          updated_at:          string;
        };
        Insert: Omit<Database["public"]["Tables"]["medical_tests"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["medical_tests"]["Insert"]>;
      };

      reminders: {
        Row: {
          id:                     string;
          tenant_id:              string;
          family_id:              string;
          family_member_id:       string;
          prescription_id:        string | null;
          medication_schedule_id: string | null;  // columna real (no schedule_id)
          medical_test_id:        string | null;
          medical_visit_id:       string | null;
          reminder_type:          ReminderType;
          title:                  string;
          message:                string | null;   // columna real (no body)
          remind_at:              string;
          status:                 ReminderStatus;  // enum (no is_sent boolean)
          sent_at:                string | null;
          read_at:                string | null;
          push_receipt:           Json | null;     // agregado en migration 006
          created_at:             string;
          updated_at:             string;
        };
        Insert: Omit<Database["public"]["Tables"]["reminders"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["reminders"]["Insert"]>;
      };

      audit_logs: {
        Row: {
          id:          string;
          tenant_id:   string;
          user_id:     string | null;
          entity_name: string;    // columna real (no table_name)
          entity_id:   string | null;  // columna real (no record_id)
          action:      string;
          details:     Json | null;    // columna real (no old_data/new_data separados)
          created_at:  string;
          updated_at:  string;
        };
        Insert: never;
        Update: never;
      };
    };

    Functions: {
      create_tenant_with_owner: {
        Args: { p_name: string; p_slug: string };
        Returns: Json;
      };
      generate_medication_schedule: {
        Args: { p_prescription_id: string };
        Returns: number;
      };
      mark_dose: {
        Args: { p_schedule_id: string; p_status: ScheduleStatus; p_notes?: string };
        Returns: boolean;
      };
      get_pending_doses_today: {
        Args: { p_family_member_id: string };
        Returns: Array<{
          schedule_id:      string;
          prescription_id:  string;
          medication_name:  string;
          dose_amount:      number;
          dose_unit:        string;
          route:            MedicationRoute;
          scheduled_at:     string;
          dose_label:       string;
          status:           ScheduleStatus;
        }>;
      };
      get_active_medications: {
        Args: { p_family_member_id: string };
        Returns: Array<{
          prescription_id:     string;
          medication_name:     string;
          presentation:        string;
          dose_amount:         number;
          dose_unit:           string;
          frequency_text:      string;
          route:               MedicationRoute;
          start_at:            string;
          end_at:              string;
          is_as_needed:        boolean;
          pending_doses_today: number;
        }>;
      };
      get_pending_tests: {
        Args: { p_family_member_id: string };
        Returns: Array<{
          test_id:       string;
          test_name:     string;
          category:      string;
          status:        TestStatus;
          ordered_at:    string;
          due_at:        string;
          scheduled_at:  string;
          document_id:   string;
        }>;
      };
      search_medical_history: {
        Args: { p_family_member_id: string; p_query: string };
        Returns: Array<{
          result_type: string;
          result_id:   string;
          title:       string;
          subtitle:    string;
          date_ref:    string;
        }>;
      };
      confirm_document_and_create_records: {
        Args: {
          p_document_id: string;
          p_medications: Json;
          p_tests:       Json;
        };
        Returns: Json;
      };
      user_belongs_to_tenant: {
        Args: { p_tenant_id: string };
        Returns: boolean;
      };
      is_tenant_admin: {
        Args: { p_tenant_id: string };
        Returns: boolean;
      };
    };
  };
}

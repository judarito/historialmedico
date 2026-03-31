// ============================================================
// Tipos TypeScript — Schema real de Supabase
// Refleja exactamente las columnas existentes en la DB
// ============================================================

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

// ENUMs reales del schema
export type TenantPlan             = "free" | "pro" | "family";
export type TenantUserRole         = "owner" | "admin" | "member" | "viewer";
export type TenantInvitationStatus = "pending" | "accepted" | "cancelled" | "expired";
export type RelationshipType       = "self" | "spouse" | "son" | "daughter" | "father" | "mother" | "brother" | "sister" | "grandfather" | "grandmother" | "guardian" | "other";
export type DocumentProcessingStatus = "pending" | "processing" | "processed" | "verified" | "failed";
export type DocumentType           = "formula" | "medical_order" | "lab_order" | "lab_result" | "imaging_result" | "incapacity" | "clinical_note" | "vaccination_card" | "voice_note" | "other";
export type MedicationRoute        = "oral" | "nasal" | "topical" | "ophthalmic" | "otic" | "inhaled" | "nebulized" | "intramuscular" | "intravenous" | "subcutaneous" | "rectal" | "other";
export type PrescriptionStatus     = "active" | "completed" | "paused" | "cancelled";
export type ScheduleStatus         = "pending" | "taken" | "skipped" | "late" | "cancelled";
export type TestStatus             = "pending" | "scheduled" | "completed" | "result_uploaded" | "cancelled";
export type VisitStatus            = "draft" | "scheduled" | "completed" | "cancelled";
export type ReminderType           = "medication_dose" | "dose_overdue" | "treatment_ending" | "medical_test" | "appointment" | "custom";
export type ReminderStatus         = "pending" | "sent" | "read" | "dismissed" | "failed";
export type MedicalDirectorySearchMode = "city" | "nearby" | "text";
export type MedicalDirectoryCacheState = "refreshing" | "ready" | "failed";

export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: {
          id:          string;
          name:        string;
          slug:        string;
          plan:        TenantPlan;
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

      tenant_invitations: {
        Row: {
          id:          string;
          tenant_id:   string;
          email:       string;
          role:        TenantUserRole;
          status:      TenantInvitationStatus;
          invited_by:  string | null;
          accepted_by: string | null;
          accepted_at: string | null;
          created_at:  string;
          updated_at:  string;
        };
        Insert: Omit<Database["public"]["Tables"]["tenant_invitations"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["tenant_invitations"]["Insert"]>;
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
          deleted_at:        string | null;
          deleted_by:        string | null;
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

      notification_reads: {
        Row: {
          id:          string;
          reminder_id: string;
          user_id:     string;
          read_at:     string;
          created_at:  string;
          updated_at:  string;
        };
        Insert: Omit<Database["public"]["Tables"]["notification_reads"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["notification_reads"]["Insert"]>;
      };

      medical_directory_cities: {
        Row: {
          id: string;
          slug: string;
          name: string;
          department: string | null;
          country_code: string;
          centroid_lat: number;
          centroid_lng: number;
          search_aliases: string[];
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["medical_directory_cities"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["medical_directory_cities"]["Insert"]>;
      };

      medical_directory_specialties: {
        Row: {
          id: string;
          slug: string;
          display_name: string;
          search_aliases: string[];
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["medical_directory_specialties"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["medical_directory_specialties"]["Insert"]>;
      };

      medical_directory_places: {
        Row: {
          id: string;
          google_place_id: string;
          display_name: string;
          formatted_address: string | null;
          national_phone: string | null;
          latitude: number | null;
          longitude: number | null;
          primary_type: string | null;
          types: string[];
          rating: number | null;
          user_rating_count: number | null;
          google_maps_uri: string | null;
          business_status: string | null;
          city_slug: string | null;
          international_phone: string | null;
          website_uri: string | null;
          current_opening_hours: Json | null;
          regular_opening_hours: Json | null;
          source: string;
          metadata: Json;
          first_seen_at: string;
          last_google_sync_at: string | null;
          expires_at: string | null;
          detail_last_google_sync_at: string | null;
          detail_expires_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["medical_directory_places"]["Row"], "id" | "first_seen_at" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["medical_directory_places"]["Insert"]>;
      };

      medical_directory_place_specialties: {
        Row: {
          id: string;
          place_id: string;
          specialty_id: string;
          source: string;
          confidence: number;
          is_primary: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["medical_directory_place_specialties"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["medical_directory_place_specialties"]["Insert"]>;
      };

      medical_directory_search_cache: {
        Row: {
          id: string;
          cache_key: string;
          query_raw_example: string | null;
          query_normalized: string;
          city_slug: string | null;
          specialty_slug: string | null;
          search_mode: MedicalDirectorySearchMode;
          page: number;
          page_size: number;
          page_token_seed: string | null;
          filters: Json;
          status: MedicalDirectoryCacheState;
          hit_count: number;
          result_count: number;
          google_next_page_token: string | null;
          google_called_count: number;
          last_google_sync_at: string | null;
          expires_at: string | null;
          refresh_started_at: string | null;
          refresh_token: string | null;
          last_error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["medical_directory_search_cache"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["medical_directory_search_cache"]["Insert"]>;
      };

      medical_directory_search_cache_results: {
        Row: {
          id: string;
          cache_id: string;
          place_id: string;
          result_rank: number;
          source_rank: number | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["medical_directory_search_cache_results"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["medical_directory_search_cache_results"]["Insert"]>;
      };

      medical_directory_search_events: {
        Row: {
          id: string;
          user_id: string | null;
          cache_key: string | null;
          query_raw: string;
          query_normalized: string;
          city_slug: string | null;
          specialty_slug: string | null;
          search_mode: string;
          page: number;
          cache_status: string;
          google_called: boolean;
          result_count: number;
          latency_ms: number | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["medical_directory_search_events"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["medical_directory_search_events"]["Insert"]>;
      };

      medical_directory_favorites: {
        Row: {
          id: string;
          user_id: string;
          place_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["medical_directory_favorites"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["medical_directory_favorites"]["Insert"]>;
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
        Args: { p_name: string; p_slug: string; p_plan?: TenantPlan };
        Returns: Json;
      };
      invite_user_to_tenant: {
        Args: { p_tenant_id: string; p_email: string; p_role?: TenantUserRole };
        Returns: Json;
      };
      claim_pending_tenant_invitations: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      check_auth_email_status: {
        Args: { p_email: string };
        Returns: Json;
      };
      get_tenant_access_members: {
        Args: { p_tenant_id: string };
        Returns: Array<{
          user_id: string;
          full_name: string | null;
          email: string | null;
          role: TenantUserRole;
          is_active: boolean;
          joined_at: string | null;
          is_current_user: boolean;
        }>;
      };
      get_tenant_pending_invitations: {
        Args: { p_tenant_id: string };
        Returns: Array<{
          invitation_id: string;
          email: string;
          role: TenantUserRole;
          status: TenantInvitationStatus;
          invited_at: string;
        }>;
      };
      update_tenant_user_role: {
        Args: { p_tenant_id: string; p_user_id: string; p_role: TenantUserRole };
        Returns: Json;
      };
      update_tenant_invitation_role: {
        Args: { p_invitation_id: string; p_role: TenantUserRole };
        Returns: Json;
      };
      revoke_tenant_user_access: {
        Args: { p_tenant_id: string; p_user_id: string };
        Returns: Json;
      };
      cancel_tenant_invitation: {
        Args: { p_invitation_id: string };
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
      get_notification_feed: {
        Args: { p_tenant_id: string; p_limit?: number };
        Returns: Array<{
          reminder_id: string;
          reminder_type: ReminderType;
          title: string;
          message: string | null;
          remind_at: string;
          status: ReminderStatus;
          family_member_id: string;
          family_member_name: string | null;
          medical_visit_id: string | null;
          medical_test_id: string | null;
          prescription_id: string | null;
          medication_schedule_id: string | null;
          is_read: boolean;
          read_at: string | null;
        }>;
      };
      get_unread_notification_count: {
        Args: { p_tenant_id: string };
        Returns: number;
      };
      mark_notification_as_read: {
        Args: { p_reminder_id: string };
        Returns: boolean;
      };
      mark_all_notifications_as_read: {
        Args: { p_tenant_id: string };
        Returns: number;
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
      soft_delete_medical_visit: {
        Args: { p_visit_id: string };
        Returns: boolean;
      };
      delete_medical_document_attachment: {
        Args: { p_document_id: string };
        Returns: Json;
      };
      delete_medical_document_with_dependencies: {
        Args: { p_document_id: string };
        Returns: Json;
      };
      delete_medical_visit_cascade: {
        Args: { p_visit_id: string };
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
      claim_medical_directory_cache_refresh: {
        Args: {
          p_cache_key: string;
          p_query_raw_example: string;
          p_query_normalized: string;
          p_city_slug?: string | null;
          p_specialty_slug?: string | null;
          p_search_mode?: MedicalDirectorySearchMode;
          p_page?: number;
          p_page_size?: number;
          p_page_token_seed?: string | null;
          p_filters?: Json;
          p_lock_ttl_seconds?: number;
        };
        Returns: Array<{
          cache_id: string;
          refresh_token: string;
          acquired: boolean;
        }>;
      };
    };
  };
}

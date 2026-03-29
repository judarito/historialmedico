# Family Health Tracker — Checklist Final (schema real)

## Checklist de Tablas

| Tabla | tenant_id | RLS Enabled | SELECT | INSERT | UPDATE | DELETE | Notas |
|-------|-----------|-------------|--------|--------|--------|--------|-------|
| `tenants` | ✅ (es el id) | ✅ | ✅ | ✅ | ✅ admin | ✅ owner | — |
| `profiles` | ✅ (agregado 006) | ✅ | ✅ | ✅ self | ✅ self | ❌ bloq | tenant_id era NULL en schema original |
| `tenant_users` | ✅ | ✅ | ✅ | ✅ | ✅ admin | ✅ owner | — |
| `families` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ admin | — |
| `family_members` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ admin | allergies/conditions son TEXT no array |
| `medical_visits` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ admin | vitales en columnas separadas |
| `medical_documents` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ admin | AI output en parsed_json |
| `prescriptions` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ admin | ES la tabla de medicamentos individuales |
| `medication_schedules` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ admin | FK a prescriptions (no medication_id) |
| `medical_tests` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ admin | Nombre real del schema (no prescription_tests) |
| `reminders` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | status enum (no is_sent bool) |
| `audit_logs` | ✅ | ✅ | ✅ admin | ❌ bloq | ❌ bloq | ❌ bloq | entity_name/entity_id/details |

**Total: 12/12 tablas con RLS ✅ | 12/12 con 4 policies ✅**

---

## Diferencias Schema Real vs Diseño Original

| Campo diseño | Campo real | Tabla | Impacto |
|---|---|---|---|
| `full_name` | `first_name` + `last_name` | `family_members` | Concatenar en UI |
| `date_of_birth` | `birth_date` | `family_members` | Renombrar en queries |
| `eps` | `eps_name` | `family_members` | Renombrar en queries |
| `allergies: text[]` | `allergies: text` | `family_members` | No usar operadores de array |
| `storage_path` | `file_path` | `medical_documents` | Renombrar en upload service |
| `visit_id` | `medical_visit_id` | docs/prescriptions/tests | Renombrar en queries |
| `name` | `medication_name` | `prescriptions` | Renombrar en queries |
| `start_date` | `start_at` | `prescriptions` | Timestamptz no date |
| `end_date` | `end_at` | `prescriptions` | Timestamptz no date |
| `medication_id` | `prescription_id` | `medication_schedules` | FK diferente |
| `taken_by` | `marked_by` | `medication_schedules` | Renombrar |
| `body` | `message` | `reminders` | Renombrar |
| `is_sent: bool` | `status: reminder_status` | `reminders` | Usar enum |
| `table_name` | `entity_name` | `audit_logs` | Renombrar |
| `record_id` | `entity_id` | `audit_logs` | Renombrar |
| `old_data`/`new_data` | `details: jsonb` | `audit_logs` | Unificado |
| `prescription_medications` | `prescriptions` | — | Tabla ya existía con otro propósito |
| `prescription_tests` | `medical_tests` | — | Tabla ya existía con nombre diferente |

---

## Migraciones a Ejecutar (en orden)

| Migración | Descripción | Impacto |
|---|---|---|
| `006_adapt_schema.sql` | ADD COLUMN IF NOT EXISTS | Seguro, no destructivo |
| `007_rls_real.sql` | DROP+CREATE policies con schema real | Habilita seguridad |
| `008_functions_real.sql` | Helper RPCs con columnas reales | Lógica de negocio |

**Las migraciones 001-005 del diseño original NO ejecutar** — ya hay tablas existentes con schema diferente.

---

## Checklist de Columnas Agregadas (migration 006)

| Columna | Tabla | Por qué |
|---|---|---|
| `tenant_id` | `profiles` | Crítico para RLS multi-tenant |
| `avatar_url` | `profiles` | Foto de perfil del usuario |
| `locale` | `profiles` | Idioma para notificaciones |
| `push_token` | `profiles` | Expo push token para notificaciones |
| `invited_by` | `tenant_users` | Trazabilidad de invitaciones |
| `joined_at` | `tenant_users` | Cuándo aceptó la invitación |
| `avatar_url` | `families` | Imagen de la familia |
| `dose_number` | `medication_schedules` | "Dosis 3 de 14" en UI |
| `dose_label` | `medication_schedules` | Texto descriptivo de la dosis |
| `push_receipt` | `reminders` | Receipt de Expo para tracking |

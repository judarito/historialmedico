# Family Health Tracker — Contexto para Claude Code

## ¿Qué es este proyecto?
App móvil de historial médico familiar con IA. Permite registrar visitas, medicamentos, exámenes y adjuntar fórmulas médicas (foto o voz). Multi-tenant: cada familia tiene su propio espacio aislado.

**Stack:** React Native · Expo SDK 54 · expo-router v6 · Supabase · OpenAI (visión) · DeepSeek (texto)
**Target:** Android/iOS · Colombia (idioma español, locale es-CO)

---

## Reglas obligatorias

1. **Todo cambio de base de datos genera un archivo** `supabase/migrations/NNN_descripcion.sql` idempotente (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, `CREATE OR REPLACE`).
2. **Al terminar cada tarea**, incluir tabla de acciones pendientes con archivo y comando exacto.
3. **Nunca exponer** `SUPABASE_SERVICE_ROLE_KEY` en el cliente móvil ni en edge functions que usen JWT de usuario. Usar `SUPABASE_ANON_KEY` + `Authorization: Bearer <jwt>`.
4. **Siempre respetar multi-tenancy**: todas las queries filtran por `tenant_id`. Nunca omitir este campo en inserts.
5. **Migraciones numeradas**: el próximo número es **015**.
6. **Edge Functions desplegadas desde Dashboard deben ser autocontenidas**: evitar imports locales tipo `../_shared/*` porque el bundler web puede subir solo `source/index.ts` y romper con `Module not found`.

---

## Arquitectura de datos

```
tenants
  └── tenant_users (user_id → tenant_id)
  └── families
        └── family_members
              ├── medical_visits          (+ voice_note_text; audio original se adjunta como documento)
              │     └── medical_documents (medical_visit_id FK, guarda imagen/audio original + parsed_json)
              ├── prescriptions           (medicamentos confirmados)
              └── medical_tests           (exámenes)
```

**Tablas principales:** `tenants`, `tenant_users`, `families`, `family_members`, `medical_visits`, `medical_documents`, `prescriptions`, `medical_tests`, `profiles`

**RLS:** todas las tablas usan `tenant_id` + policies que llaman `user_belongs_to_tenant(uuid)`.
**Función clave:** `search_global(p_query, p_limit)` — RPC de búsqueda full-text (ver migración 013).

---

## Variables de entorno (.env)

```
EXPO_PUBLIC_SUPABASE_URL=https://lrjuwkkugqijahqjgcmb.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
DEEPSEEK_API_KEY=<deepseek key>          # solo para desarrollo local
OPENAI_API_KEY=<openai key>              # solo para desarrollo local
EXPO_PUBLIC_PROJECT_ID=d2e708b8-fceb-4239-8a1d-df5ce8d3d5d2
```

**Secrets en Supabase Edge Functions** (configurados en Dashboard → Settings → Secrets):
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL`
- `DEEPSEEK_API_KEY`
- `OPENAI_API_KEY`

---

## Estructura de pantallas (expo-router)

```
src/app/
├── index.tsx                    # Redirect a login o app según sesión
├── login.tsx                    # Login con email/password
├── register.tsx                 # Registro de usuario
├── _layout.tsx                  # Root layout — ErrorBoundary + SafeAreaProvider
│
├── onboarding/
│   ├── index.tsx                # Crear familia (nombre del grupo)
│   └── member.tsx               # Agregar primer miembro familiar
│
└── (app)/                       # Requiere sesión activa
    ├── _layout.tsx              # Verifica auth, carga tenant
    ├── search.tsx               # Búsqueda IA global (DeepSeek + search_global RPC)
    ├── add-visit.tsx            # Formulario nueva visita + botón voz en header
    ├── confirm-scan.tsx         # Revisión y confirmación de fórmula procesada por IA
    ├── edit-member.tsx          # Editar datos de un miembro
    ├── history.tsx              # Historial general
    ├── member/[id].tsx          # Detalle de miembro (visitas, medicamentos)
    ├── visit/[id].tsx           # Detalle de visita (datos, vitales, documentos adjuntos + preview imagen/audio original)
    │
    └── (tabs)/                  # Tab bar principal
        ├── index.tsx            # Dashboard — saludo + stats + familia + barra búsqueda IA
        ├── family.tsx           # Lista de miembros familiares
        ├── scan.tsx             # Adjuntar evidencia (foto / galería / voz) — 4 pasos
        ├── medications.tsx      # Medicamentos activos
        └── profile.tsx          # Perfil y configuración
```

---

## Flujo de captura de evidencia (scan.tsx) — 4 pasos

```
1. member    → seleccionar miembro de la familia
2. visit     → seleccionar visita existente O crear nueva inline
3. capture   → elegir: Cámara | Galería | Voz
4. voice_confirm (solo si eligió voz) → preview de transcripción + datos IA → guardar
```

**Parámetros de navegación:**
- `?memberId=X` → salta al paso 2 (visit)
- `?memberId=X&visitId=Y` → salta al paso 3 (capture)

**Flujo foto:**
1. Upload a Storage bucket `medical-documents`
2. INSERT `medical_documents` con `medical_visit_id`, `file_path`, `mime_type`, `file_size_bytes`, `captured_at`
3. Invoke Edge Function `process-prescription` vía `supabase.functions.invoke()`
4. OpenAI procesa la imagen y guarda `parsed_json` / `extracted_text` / `ai_model`
5. Navegar a `confirm-scan` (polling + edición + confirmación)
6. Si la extracción falla, `confirm-scan` muestra `processing_error` o el mensaje real del backend y permite completar manualmente

**Flujo voz:**
1. `VoiceRecordButton` → captura doble: STT on-device (`expo-speech-recognition`, idioma `es-CO`) + grabación del audio original (`expo-av`)
2. Transcripción → Invoke Edge Function `voice-to-data` con `{ transcription, context: 'visit' }`
3. DeepSeek extrae campos estructurados
4. Paso `voice_confirm`: mostrar transcripción + campos detectados
5. Guardar: upload del audio original a Storage + UPDATE `medical_visits.voice_note_text` + INSERT `medical_documents` (`document_type: 'voice_note'`, `file_path`, `extracted_text`, `parsed_json`)

**Visualización posterior de adjuntos:**
- En `visit/[id].tsx`, tocar un documento abre el archivo original con `createSignedUrl(...)`
- Si es imagen: preview full-screen/modal
- Si es audio: reproductor con play/pause + transcripción guardada

---

## Edge Functions

| Función | Entrada | Descripción |
|---|---|---|
| `process-prescription` | `{ document_id }` | OpenAI Vision analiza imagen → extrae meds/exámenes → guarda en `parsed_json` |
| `search-ai` | `{ query, limit }` | DeepSeek expande términos → llama `search_global` RPC por cada término → merge con score |
| `voice-to-data` | `{ transcription, context }` | DeepSeek extrae datos estructurados de visita médica (solo si context='visit') |
| `send-notifications` | — | Cron: envía recordatorios de medicamentos |

**Importante:** `search-ai` usa `SUPABASE_ANON_KEY` + JWT del usuario (no service role key) para que `auth.uid()` funcione dentro del RPC `search_global`.
**Importante:** `process-prescription` se sigue invocando desde el cliente con `supabase.functions.invoke()`. Antes de invocarla, `scan.tsx` fuerza `supabase.auth.refreshSession()` y el frontend inspecciona `FunctionsHttpError.context` / `FunctionsRelayError.context` para mostrar el mensaje real cuando falla.
**Importante:** por compatibilidad con el deploy desde Dashboard, las Edge Functions permanecen autocontenidas; no usar módulos locales compartidos entre funciones.

---

## Componentes UI clave

| Componente | Ruta | Descripción |
|---|---|---|
| `DatePickerField` | `components/ui/DatePickerField.tsx` | Date/datetime picker nativo. Props: `label`, `value` (ISO), `onChange`, `withTime`, `maximumDate` |
| `VoiceRecordButton` | `components/ui/VoiceRecordButton.tsx` | Botón mic con STT nativo + grabación de audio original (`expo-av`). Soporta `onTranscription(text)` y `onCapture({ transcription, audioUri })` |
| `ErrorBoundary` | `components/ErrorBoundary.tsx` | Captura errores React + ErrorUtils global. Muestra error + botón copiar |
| `Avatar` | `components/ui/Avatar` | Avatar con iniciales o imagen |
| `StatCard` | `components/ui/StatCard` | Tarjeta de estadística para dashboard |

---

## Stores (Zustand)

| Store | Archivo | Estado |
|---|---|---|
| `useAuthStore` | `store/authStore.ts` | `user`, `session`, `initialized` → `init()`, `signIn()`, `signOut()` |
| `useFamilyStore` | `store/familyStore.ts` | `tenant`, `family`, `members` → `fetchTenantAndFamily()`, `fetchMembers()` |
| `useMedicationStore` | `store/medicationStore.ts` | `medications` → `fetchMedications()` |

---

## Migraciones SQL (en orden)

| Archivo | Descripción |
|---|---|
| `001_schema.sql` | Tablas, tipos enum, triggers, FTS |
| `002_rls_policies.sql` | RLS + 4 policies por tabla |
| `003_storage.sql` | Buckets (`medical-documents` privado, `avatars` público) + policies |
| `004_helper_functions.sql` | RPCs y helpers (`user_belongs_to_tenant`, `confirm_document_and_create_records`) |
| `005_cron.sql` | pg_cron para notificaciones y limpieza |
| `006_adapt_schema.sql` | Adaptaciones al schema inicial |
| `007_rls_real.sql` | RLS real (reemplaza policies de prueba) |
| `008_functions_real.sql` | Funciones reales de negocio |
| `009_medical_documents_visit_link.sql` | FK `medical_documents.medical_visit_id` |
| `010_search_global.sql` | RPC `search_global` inicial |
| `011_search_global_fix.sql` | Fix: tenant lookup via `tenant_users` (no `profiles`) |
| `012_voice_notes.sql` | Columnas `voice_note_url`, `voice_note_text` en `medical_visits` |
| `013_search_global_v2.sql` | Búsqueda ampliada: voz + documentos (`parsed_json`) |
| `014_storage_buckets_ensure.sql` | Garantiza existencia de buckets con `ON CONFLICT DO NOTHING` |

**Próxima migración:** `015_...sql`

---

## Polyfills y fixes importantes

- **`index.ts`** (entry point): polyfill de `WeakRef` para Hermes antiguo en Android. Requerido por `@supabase/realtime-js`.
- **`package.json`**: se agregó `expo-av` para grabar y reproducir el audio original de las notas de voz.
- **`app.json`**: plugin `expo-speech-recognition` con permisos de micrófono para iOS y Android (`RECORD_AUDIO`, `NSSpeechRecognitionUsageDescription`, `NSMicrophoneUsageDescription`).
- **`eas.json`**: quedaron definidos perfiles `development`, `preview` y `production`.
- **`(tabs)/_layout.tsx`**: `useSafeAreaInsets()` para calcular altura dinámica del tab bar en Android (evita superposición con barra de gestos). El tab central usa ícono `sparkles` para reflejar el flujo IA.
- **`_layout.tsx`**: `ErrorBoundary` wrapping todo + `ErrorUtils.setGlobalHandler` para capturar errores no capturados en release.

---

## Comandos frecuentes

```bash
# Desarrollo
npx expo run:android          # Build y correr en Android (requiere SDK configurado)
npx expo start --dev-client   # Dev server para dispositivo con dev client instalado

# Base de datos
supabase db push              # Aplicar migraciones pendientes

# Edge Functions
supabase secrets set OPENAI_API_KEY=sk-...
supabase functions deploy search-ai
supabase functions deploy voice-to-data
supabase functions deploy process-prescription
supabase functions deploy send-notifications

# Build APK
eas build --platform android --profile preview    # APK interno (más rápido)
eas build --platform android --profile production # AAB para Play Store

# Android SDK (agregar a ~/.bashrc)
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools
```

---

## Búsqueda IA — arquitectura

```
Usuario escribe query
        ↓
search-ai (Edge Function)
        ↓
DeepSeek: "presión alta" → ["presión alta", "hipertensión", "HTA", "antihipertensivo"]
        ↓
search_global RPC × cada término (paralelo)
        ↓
Merge: deduplicar por (result_type + result_id), sumar match_score
        ↓
Ordenar: match_score DESC → date_ref DESC
        ↓
{ results, expansion: { terms, category, intent } }
```

**`search_global` busca en:** miembros · medicamentos confirmados · visitas (diagnóstico, motivo, notas, voz, institución) · médico · especialidad · exámenes · documentos (parsed_json de fotos)

---

## Estado real tras cambios recientes

- `process-prescription` ya no usa DeepSeek para imágenes. La extracción OCR/visión de fotos está migrada a OpenAI (`gpt-4.1-mini`).
- `voice-to-data` y `search-ai` permanecen en DeepSeek.
- Se intentó centralizar la capa de IA en `supabase/functions/_shared/ai.ts`, pero se revirtió porque el bundler del Dashboard de Supabase no resolvía imports locales; hoy las tres Edge Functions son autocontenidas.
- Las imágenes originales se conservan en Storage y su metadata queda en `medical_documents`.
- Las notas de voz nuevas ahora conservan el audio original en Storage y también crean un `medical_documents` asociado a la visita.
- En `visit/[id].tsx` ya existe preview del archivo original de imagen o audio usando signed URLs.
- `confirm-scan.tsx` ahora puede mostrar el error real del procesamiento y dejar continuar en modo manual aunque la IA no haya extraído datos.
- Las notas de voz antiguas pueden no tener audio original reproducible porque antes solo se guardaba la transcripción.
- `medical_visits.voice_note_url` existe en schema/migraciones, pero el flujo actual consulta el audio original desde `medical_documents.file_path` del adjunto `voice_note`.
- Sigue abierta una incidencia de runtime: en algunos intentos `process-prescription` responde `401 Invalid JWT` aun usando `supabase.functions.invoke()` + `refreshSession()`. Si reaparece, revisar sesión del dispositivo y la configuración auth/JWT de la función en Supabase.

---

## Cambios de hoy (2026-03-29)

- **IA / backend:** `supabase/functions/process-prescription/index.ts` migró a OpenAI Vision; `supabase/functions/voice-to-data/index.ts` y `supabase/functions/search-ai/index.ts` siguen en DeepSeek.
- **Compatibilidad de deploy:** se descartó el helper compartido `_shared/ai.ts` y se dejó cada Edge Function autocontenida para que el deploy desde Dashboard no falle con `Module not found`.
- **Captura por foto:** `src/app/(app)/(tabs)/scan.tsx` ahora refresca sesión antes de invocar `process-prescription`, intenta mostrar errores reales del backend y manda a confirmación manual cuando no hay extracción útil.
- **Confirmación manual:** `src/app/(app)/confirm-scan.tsx` ahora hace polling de `processing_status`, muestra `processing_error` y permite guardar aunque no haya meds/exámenes detectados.
- **Captura por voz:** `src/components/ui/VoiceRecordButton.tsx` ahora hace STT + grabación del audio original; `src/app/(app)/(tabs)/scan.tsx` sube ese audio a Storage y crea un `medical_documents` tipo `voice_note`.
- **Visualización de adjuntos:** `src/app/(app)/visit/[id].tsx` ya puede abrir la imagen original y reproducir el audio original de una nota de voz con signed URLs.
- **UI:** `src/app/(app)/(tabs)/_layout.tsx` cambió el ícono central de cámara a `sparkles` para representar IA.
- **Tipos y config:** `src/types/database.types.ts`, `.env.example`, `package.json`, `app.json` y `eas.json` quedaron actualizados para soportar `voice_note`, `OPENAI_API_KEY`, `expo-av` y los builds actuales.

---

## Pendiente / Próximas features sugeridas

- [ ] Búsqueda con fallback directo al RPC si el edge function falla
- [ ] Pantalla de detalle de medicamento con historial de tomas
- [ ] Recordatorios push por dosis (base en `send-notifications` ya existe)
- [ ] Export de historial a PDF
- [ ] Búsqueda por rango de fechas

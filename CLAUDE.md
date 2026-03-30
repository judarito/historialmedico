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
5. **Migraciones numeradas**: el próximo número es **020**.
6. **Edge Functions desplegadas desde Dashboard deben ser autocontenidas**: evitar imports locales tipo `../_shared/*` porque el bundler web puede subir solo `source/index.ts` y romper con `Module not found`.
7. **`.env.example` solo puede contener placeholders**. Nunca dejar API keys reales en archivos versionados, ejemplos, docs o comandos.

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

**Nota:** `.env.example` debe quedarse siempre sanitizado con placeholders (`tu_*_aqui`), nunca con secretos reales.

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
├── _layout.tsx                  # Root layout — ErrorBoundary + SafeAreaProvider + runtime diagnostics
│
├── onboarding/
│   ├── index.tsx                # Crear familia (nombre del grupo)
│   └── member.tsx               # Agregar primer miembro familiar
│
└── (app)/                       # Requiere sesión activa
    ├── _layout.tsx              # Verifica auth, carga tenant
    ├── search.tsx               # Búsqueda global híbrida: fallback local + search-ai + fallback RPC
    ├── add-visit.tsx            # Formulario nueva visita + botón voz en header
    ├── confirm-scan.tsx         # Revisión y confirmación de fórmula procesada por IA
    ├── edit-member.tsx          # Editar datos de un miembro
    ├── history.tsx              # Historial por miembro: fallback local + RPC + expansión IA
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
| `search-ai` | `{ query, limit, memberContext? }` | DeepSeek expande términos; en historial puede usar contexto del paciente para afinar la expansión |
| `voice-to-data` | `{ transcription, context }` | DeepSeek extrae datos estructurados de visita médica (solo si context='visit') |
| `send-notifications` | — | Cron: envía recordatorios de medicamentos |

**Importante:** `search-ai` usa `SUPABASE_ANON_KEY` + JWT del usuario (no service role key) para que `auth.uid()` funcione dentro del RPC `search_global`.
**Importante:** la app ya no depende por completo del edge search para devolver resultados; ahora existe una capa de fallback en cliente (`src/services/searchFallback.ts`) para búsqueda global y búsqueda en historial.
**Importante:** `process-prescription` se sigue invocando desde el cliente con `supabase.functions.invoke()`. Antes de invocarla, `scan.tsx` fuerza `supabase.auth.refreshSession()` y el frontend inspecciona `FunctionsHttpError.context` / `FunctionsRelayError.context` para mostrar el mensaje real cuando falla.
**Importante:** por compatibilidad con el deploy desde Dashboard, las Edge Functions permanecen autocontenidas; no usar módulos locales compartidos entre funciones.

---

## Componentes UI clave

| Componente | Ruta | Descripción |
|---|---|---|
| `DatePickerField` | `components/ui/DatePickerField.tsx` | Date/datetime picker nativo. Props: `label`, `value` (ISO), `onChange`, `withTime`, `maximumDate` |
| `VoiceRecordButton` | `components/ui/VoiceRecordButton.tsx` | Botón mic con STT nativo + grabación de audio original (`expo-av`). Soporta `onTranscription(text)` y `onCapture({ transcription, audioUri })` |
| `ErrorBoundary` | `components/ErrorBoundary.tsx` | Captura errores React y delega la UI de fallo a `RuntimeDiagnosticsScreen` |
| `RuntimeDiagnosticsScreen` | `components/RuntimeDiagnosticsScreen.tsx` | Pantalla compartible de diagnóstico: muestra último error real, stack y metadata del arranque |
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
| `015_confirm_document_historical.sql` | `confirm_document_and_create_records` con soporte histórico: `start_at` desde fecha de visita, `status=completed` si el tratamiento ya terminó, sin horarios para tratamientos pasados |
| `016_search_medical_history_visits.sql` | `search_medical_history` orientado a visitas: busca en todos los criterios y devuelve las visitas que coinciden (deduplicadas por visit_id, con motivo del match en subtitle) |
| `017_search_history_unlinked.sql` | Fix: incluye medicamentos y exámenes sin `medical_visit_id`; devuelve `result_type='medication'/'test'` para registros sin visita vinculada |
| `018_search_global_tenant_fix.sql` | Fix: `search_global` usa `fm.tenant_id` como fuente de verdad (no `rx.tenant_id`) para cubrir registros con tenant_id incorrecto; también corrige cast `document_type::TEXT` en todos los bloques |
| `019_soft_delete_visits_and_delete_attachments.sql` | Soft delete de visitas (`deleted_at`, `deleted_by`), RPC `soft_delete_medical_visit`, RPC `delete_medical_document_attachment` y exclusión de visitas borradas en búsquedas |

**Próxima migración:** `020_...sql`

---

## Polyfills y fixes importantes

- **`index.ts`** (entry point): polyfill de `WeakRef` para Hermes antiguo en Android. Requerido por `@supabase/realtime-js`.
- **`package.json`**: se agregó `expo-av` para grabar y reproducir el audio original de las notas de voz.
- **`package.json`**: `react-dom` queda fijado a `19.1.0` para alinear los peers web de `expo-router` con `react@19.1.0`.
- **`app.json`**: plugin `expo-speech-recognition` con permisos de micrófono para iOS y Android (`RECORD_AUDIO`, `NSSpeechRecognitionUsageDescription`, `NSMicrophoneUsageDescription`).
- **`eas.json`**: quedaron definidos perfiles `development`, `preview` y `production`.
- **`.gitignore`**: ignora `node_modules`, `.expo`, `.env`, `expo-env.d.ts` y archivos locales de tooling para no volver a versionar artefactos pesados ni secretos.
- **`android/settings.gradle`**: el autolinking de Expo/React Native usa `includeBuild(...)` directo desde `node_modules` en vez de `require.resolve(...)`, porque esa resolución fue frágil durante el build local.
- **`android/app/build.gradle`**: permite `NODE_BINARY` y ejecuta Node desde el root real del proyecto al resolver entrypoint/CLI/codegen.
- **`android/local.properties`**: puede usarse localmente para `sdk.dir=/home/juan/Android/Sdk`; este archivo está ignorado y no debe commitearse.
- **`(tabs)/_layout.tsx`**: `useSafeAreaInsets()` para calcular altura dinámica del tab bar en Android (evita superposición con barra de gestos). El tab central usa ícono `sparkles` para reflejar el flujo IA.
- **`src/services/runtimeDiagnostics.ts`**: persiste sesiones de arranque y errores en AsyncStorage (`@runtime_diagnostics/*`) para poder reconstruir fallos después de un crash o cierre temprano.
- **`_layout.tsx`**: `ErrorBoundary` wrapping todo + `ErrorUtils.setGlobalHandler` + captura de `onunhandledrejection`; si algo falla en bootstrap, muestra `RuntimeDiagnosticsScreen`.
- **`src/services/supabase.ts`**: las vars públicas se leen con referencias directas a `process.env.EXPO_PUBLIC_SUPABASE_URL` y `process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY` para que Expo las inyecte correctamente en el bundle. Si faltan, se registra un diagnóstico de arranque en lugar de romper silenciosamente.
- **`src/services/notifications.ts`**: en web no intenta registrar push ni programar locales con `expo-notifications`; Expo no soporta push web en este setup y antes eso estaba bloqueando el arranque.

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
NODE_BINARY="$(which node)" ./gradlew clean assembleRelease --no-daemon -PreactNativeArchitectures=arm64-v8a -PnewArchEnabled=false

# Android SDK (agregar a ~/.bashrc)
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools
```

**Si `gradlew` falla por SDK local:** crear `android/local.properties` con `sdk.dir=/home/juan/Android/Sdk` o exportar `ANDROID_HOME`.
**Si `npm ci` falla por peers web:** usar `npm install` para regenerar `package-lock.json` después de cambios de `react` / `react-dom`.

---

## Búsqueda IA — arquitectura

```
search.tsx (búsqueda global)
Usuario escribe query
        ↓
searchGlobalFallback() en cliente
        ↓ si no hay resultados
search-ai (Edge Function)
        ↓ si la edge function falla
search_global RPC
        ↓
UI de resultados
```

```
history.tsx (historial por miembro)
Usuario escribe query
        ↓
searchMemberHistoryLocal() sobre visits/prescriptions/tests ya cargados
        ↓ si no hay resultados
search_medical_history RPC
        ↓ si tampoco hay resultados
search-ai con memberContext
        ↓
search_medical_history RPC × términos expandidos
        ↓
UI de resultados
```

**`searchGlobalFallback()` busca en:** `family_members` · `medical_visits` · `prescriptions` · `medical_tests` · `medical_documents`
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
- La búsqueda del home ya tiene fallback local en cliente para no depender únicamente de `search-ai` / `search_global`.
- La búsqueda del historial ya tiene fallback local usando `visits`, `prescriptions` y `medical_tests` cargados del miembro antes de llamar RPCs o IA.
- Las notas de voz antiguas pueden no tener audio original reproducible porque antes solo se guardaba la transcripción.
- `medical_visits.voice_note_url` existe en schema/migraciones, pero el flujo actual consulta el audio original desde `medical_documents.file_path` del adjunto `voice_note`.
- Sigue abierta una incidencia de runtime: en algunos intentos `process-prescription` responde `401 Invalid JWT` aun usando `supabase.functions.invoke()` + `refreshSession()`. Si reaparece, revisar sesión del dispositivo y la configuración auth/JWT de la función en Supabase.
- El arranque ahora tiene una capa de diagnóstico persistente: si la app no abre, `RuntimeDiagnosticsScreen` debe mostrar el último error real en vez del último checkpoint de boot.
- En pruebas web, `expo-notifications` no debe usarse para push: el servicio ahora hace no-op en `Platform.OS === 'web'` para evitar el error de `notification.vapidPublicKey`.
- El build Android local depende de tener `node`, JDK 17 y Android SDK válidos en la máquina; hoy el proyecto tolera mejor `NODE_BINARY` y `local.properties`, pero sigue requiriendo un entorno nativo sano.

---

## Cambios de hoy (2026-03-30)

- **Búsqueda global:** `src/services/searchFallback.ts` agrega un fallback determinístico desde cliente sobre `family_members`, `medical_visits`, `prescriptions`, `medical_tests` y `medical_documents`.
- **Búsqueda home:** `src/app/(app)/search.tsx` intenta primero el fallback local, luego `search-ai` y, si la edge function falla, cae a `search_global`.
- **Búsqueda historial:** `src/app/(app)/history.tsx` intenta primero buscar en memoria sobre los datos ya cargados del miembro y solo después usa `search_medical_history` / `search-ai`.
- **Navegación de resultados:** la búsqueda global ahora soporta `navigation_id` para que un resultado tipo `document` pueda abrir la visita asociada cuando exista.

## Cambios previos (2026-03-29)

- **IA / backend:** `supabase/functions/process-prescription/index.ts` migró a OpenAI Vision; `supabase/functions/voice-to-data/index.ts` y `supabase/functions/search-ai/index.ts` siguen en DeepSeek.
- **Compatibilidad de deploy:** se descartó el helper compartido `_shared/ai.ts` y se dejó cada Edge Function autocontenida para que el deploy desde Dashboard no falle con `Module not found`.
- **Captura por foto:** `src/app/(app)/(tabs)/scan.tsx` ahora refresca sesión antes de invocar `process-prescription`, intenta mostrar errores reales del backend y manda a confirmación manual cuando no hay extracción útil.
- **Confirmación manual:** `src/app/(app)/confirm-scan.tsx` ahora hace polling de `processing_status`, muestra `processing_error` y permite guardar aunque no haya meds/exámenes detectados.
- **Captura por voz:** `src/components/ui/VoiceRecordButton.tsx` ahora hace STT + grabación del audio original; `src/app/(app)/(tabs)/scan.tsx` sube ese audio a Storage y crea un `medical_documents` tipo `voice_note`.
- **Visualización de adjuntos:** `src/app/(app)/visit/[id].tsx` ya puede abrir la imagen original y reproducir el audio original de una nota de voz con signed URLs.
- **UI:** `src/app/(app)/(tabs)/_layout.tsx` cambió el ícono central de cámara a `sparkles` para representar IA.
- **Tipos y config:** `src/types/database.types.ts`, `.env.example`, `package.json`, `app.json` y `eas.json` quedaron actualizados para soportar `voice_note`, `OPENAI_API_KEY`, `expo-av` y los builds actuales.
- **Build Android:** `android/settings.gradle` y `android/app/build.gradle` se endurecieron para resolver autolinking/Node desde el proyecto local; `android/local.properties` puede apuntar al SDK local sin commitearse.
- **Dependencias:** `package.json` fija `react-dom@19.1.0` para evitar conflictos de peers con `expo-router`.
- **Seguridad/higiene:** `.env.example` quedó sanitizado sin keys reales de DeepSeek y `.gitignore` ahora bloquea artefactos locales/generados.
- **Diagnóstico runtime:** `src/services/runtimeDiagnostics.ts`, `src/components/RuntimeDiagnosticsScreen.tsx`, `src/components/ErrorBoundary.tsx` y `src/app/_layout.tsx` ahora registran pasos de boot, errores globales, promesas rechazadas y muestran el último error real en pantalla.
- **Bootstrap Supabase:** `src/services/supabase.ts` evita fallar en import-time cuando faltan `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`; el problema queda visible en la UI de diagnóstico.
- **Notificaciones web:** `src/services/notifications.ts` omite el registro push y las notificaciones locales en web para no disparar el error de `notification.vapidPublicKey`.

---

## Política de borrado implementada

- **Adjuntos de una visita (`medical_documents`)**: sí se pueden eliminar individualmente desde `visit/[id].tsx`.
- **Adjuntos con datos derivados**: `delete_medical_document_attachment(p_document_id)` bloquea el borrado si el documento ya está referenciado por `prescriptions` o `medical_tests`.
- **Visitas médicas**: usan soft delete mediante `soft_delete_medical_visit(p_visit_id)`.
- **Persistencia del borrado lógico**: la visita conserva la fila, pero queda marcada con `deleted_at` y `deleted_by`.
- **Listados y búsquedas**: las visitas soft-deleted ya no aparecen en historial, selección de visitas, búsquedas SQL ni fallback local del cliente.
- **Storage**: al borrar un adjunto, el cliente intenta limpiar también el archivo del bucket privado `medical-documents`.

---

## Pendiente / Próximas features sugeridas

- [ ] Restaurar visitas soft-deleted desde UI administrativa o auditoría
- [ ] Pantalla de detalle de medicamento con historial de tomas
- [ ] Recordatorios push por dosis (base en `send-notifications` ya existe)
- [ ] Export de historial a PDF
- [ ] Búsqueda por rango de fechas

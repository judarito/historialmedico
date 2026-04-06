# Family Health Tracker — Arquitectura General

## Stack Tecnológico

| Capa | Tecnología | Justificación |
|------|-----------|---------------|
| Mobile | React Native + Expo SDK 54 | Cross-platform iOS/Android, acceso nativo a cámara y notificaciones |
| Backend | Supabase (BaaS) | Auth, DB, Storage, Edge Functions en un solo servicio |
| Base de datos | PostgreSQL 15 (Supabase) | RDBMS robusto, RLS nativo, soporte JSONB para datos IA |
| Storage | Supabase Storage | Almacenamiento de imágenes y documentos médicos |
| Auth | Supabase Auth | JWT con RLS integrado, soporte OAuth |
| Functions | Supabase Edge Functions (Deno) | Procesamiento IA, webhooks, lógica de negocio |
| OCR imágenes | OpenAI Vision | Extracción estructurada de fórmulas médicas desde imagen |
| LLM texto | DeepSeek API | Expansión de búsqueda y estructuración de notas de voz |
| Notificaciones | Expo Notifications + FCM | Push notifications locales y remotas |
| Estado global | Zustand | Liviano, compatible con React Native |
| HTTP Client | Supabase JS Client v2 | Realtime, auth automático, RLS transparente |

---

## Diagrama de Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│                  REACT NATIVE APP (Expo)                │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │ Auth     │  │ Familia  │  │ Fórmulas │  │Alertas │  │
│  │ Screen   │  │ Screen   │  │ Screen   │  │Screen  │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘  │
│       │              │              │             │       │
│  ┌────▼──────────────▼──────────────▼─────────────▼───┐  │
│  │              Supabase JS Client v2                  │  │
│  │         (Auth + Realtime + Storage)                 │  │
│  └────────────────────────┬────────────────────────────┘  │
└───────────────────────────┼─────────────────────────────┘
                            │ HTTPS / WSS
┌───────────────────────────▼─────────────────────────────┐
│                      SUPABASE                           │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ Supabase    │  │ PostgreSQL  │  │ Supabase        │  │
│  │ Auth (JWT)  │  │ + RLS       │  │ Storage         │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │           Edge Functions (Deno)                  │   │
│  │  ┌──────────────┐    ┌───────────────────────┐   │   │
│  │  │process-      │    │ generate-schedule      │   │   │
│  │  │prescription  │    │ send-notifications     │   │   │
│  │  └──────┬───────┘    └───────────────────────┘   │   │
│  └─────────┼────────────────────────────────────────┘   │
└────────────┼────────────────────────────────────────────┘
             │ HTTPS
┌────────────▼────────────────────────────────────────────┐
│                   DeepSeek API                          │
│         OCR + LLM para fórmulas médicas                 │
└─────────────────────────────────────────────────────────┘
```

---

## Modelo Multi-Tenant

```
tenant (cuenta/organización)
  └── tenant_users (usuarios del tenant)
        └── profiles (datos del usuario)
  └── families (familias dentro del tenant)
        └── family_members (miembros de la familia)
              └── medical_visits (visitas médicas)
                    └── medical_documents (documentos adjuntos)
                    └── prescriptions (fórmulas médicas)
                          └── prescription_medications (medicamentos)
                          └── prescription_tests (exámenes)
              └── medication_schedules (horarios de medicamentos)
                    └── dose_logs (registro de tomas)
              └── medical_tests (exámenes médicos)
              └── reminders (recordatorios)
  └── audit_logs (auditoría del tenant)
```

### Regla de aislamiento
- Cada fila de negocio tiene `tenant_id`
- RLS valida `tenant_id` usando `auth.uid()` via función helper
- Ningún query puede cruzar datos entre tenants
- Supabase Storage usa buckets con paths segmentados por `tenant_id`

---

## Flujo de Autenticación y Tenant

```
1. Usuario se registra → Supabase Auth crea auth.users record
2. Trigger DB crea profiles record automáticamente
3. Usuario crea tenant → INSERT tenants → INSERT tenant_users (role=owner)
4. O usuario es invitado → INSERT tenant_users (role=member/viewer)
5. JWT del usuario incluye claims → RLS evalúa pertenencia al tenant
6. Todas las queries filtran por tenant_id automáticamente via RLS
```

### Resolución de onboarding actual
- Si el usuario no tiene tenant/familia activa, entra a `onboarding/index`.
- Si ya tiene familia pero todavía no existe el primer miembro, entra a `onboarding/member`.
- Si ya tiene familia y miembros pero `profiles.phone` está vacío, entra a `onboarding/contact`.
- Solo cuando tenant, familia, primer miembro y celular existen, la app entra a `/(app)/(tabs)`.

---

## Búsqueda Híbrida

### Búsqueda global (`src/app/(app)/search.tsx`)
- Primer intento: `searchGlobalFallback()` en cliente
- Si no hay resultados: `search-ai`
- Si la edge function falla: `search_global`
- El agente RAG del historial ya no se dispara automáticamente mientras el usuario escribe.
- La pantalla separa dos carriles: búsqueda general reactiva y consulta explícita al asistente.
- `looksLikeHealthAgentQuestion()` ahora solo se usa como sugerencia de UI para mostrar la CTA `Preguntar al asistente`.
- La respuesta del asistente y los resultados navegables mantienen estados de carga/cancelación independientes.

### Búsqueda en historial (`src/app/(app)/history.tsx`)
- Primer intento: `searchMemberHistoryLocal()` con datos ya cargados del miembro
- Segundo intento: `search_medical_history`
- Tercer intento: `search-ai` con `memberContext` y reintento de `search_medical_history`

Esto reduce la dependencia de una sola capa y deja la UX más resiliente cuando una RPC o edge function falla.

### Directorio médico externo (`src/app/(app)/doctor-directory.tsx`)
- La búsqueda de especialistas usa `search-medical-places` con REPS como fuente primaria para búsquedas por ciudad.
- Si REPS no aplica, falla o no llena suficientes resultados para la página actual, la edge function complementa con Google Places.
- El cache compartido vive en `medical_directory_search_cache`; un cache REPS fresco pero incompleto no debe bloquear el complemento con Google.
- Cada resultado conserva `source` (`reps`, `google_places`, `manual`) para que la UI pueda mostrar badges y para que `get-medical-place-details` evite refrescar con Google un registro REPS.

### Mensajería externa (`send-twilio-message`)
- El número destino de pruebas WhatsApp/SMS se toma de `profiles.phone` del usuario autenticado.
- El onboarding ahora exige capturar ese celular antes de dejar pasar a la app principal.
- La Edge Function devuelve tanto el `status` inicial de Twilio como un `deliveryStatus` consultado segundos después del envío.
- Si el canal sigue en sandbox (`TWILIO_WHATSAPP_FROM=whatsapp:+14155238886`), el número debe haberse unido al sandbox de Twilio.
- Para iniciar conversaciones por WhatsApp fuera de la ventana de 24 horas, se requiere una plantilla con `ContentSid` (`HX...`) aprobada para `WhatsApp business initiated`; un `body` libre produce `63016`.

---

## Política de Borrado Implementada

- Las visitas usan soft delete con `deleted_at` y `deleted_by`.
- Los adjuntos de una visita sí se pueden eliminar individualmente.
- Si un adjunto ya originó medicamentos o exámenes confirmados, la RPC bloquea su borrado.
- Las búsquedas y listados normales excluyen visitas soft-deleted.
- No existe hard delete de visitas desde la app.

---

## Estructura de Carpetas React Native

```
src/
├── app/                    # Expo Router (file-based routing)
│   ├── (auth)/
│   │   ├── login.tsx
│   │   └── register.tsx
│   ├── (app)/
│   │   ├── _layout.tsx     # Tab navigator
│   │   ├── dashboard.tsx
│   │   ├── family/
│   │   │   ├── index.tsx   # Lista familias
│   │   │   ├── [id].tsx    # Detalle familia
│   │   │   └── member/
│   │   │       ├── [id].tsx # Perfil familiar
│   │   │       └── new.tsx
│   │   ├── visits/
│   │   │   ├── new.tsx
│   │   │   └── [id].tsx
│   │   ├── prescriptions/
│   │   │   ├── scan.tsx    # Cámara + IA
│   │   │   ├── review.tsx  # Confirmación datos IA
│   │   │   └── [id].tsx
│   │   ├── medications/
│   │   │   ├── active.tsx
│   │   │   └── schedule.tsx
│   │   ├── tests/
│   │   │   └── index.tsx
│   │   ├── alerts/
│   │   │   └── index.tsx
│   │   └── search/
│   │       └── index.tsx
├── components/
│   ├── ui/                 # Componentes base
│   ├── medical/            # Componentes del dominio
│   └── ai/                 # Componentes del flujo IA
├── hooks/
│   ├── useAuth.ts
│   ├── useTenant.ts
│   ├── useFamily.ts
│   └── usePrescriptionAI.ts
├── services/
│   ├── supabase.ts         # Cliente Supabase configurado
│   ├── prescriptionAI.ts   # Llamadas a Edge Function IA
│   ├── notifications.ts    # Expo Notifications
│   └── storage.ts          # Upload de imágenes
├── store/
│   ├── authStore.ts
│   ├── tenantStore.ts
│   └── familyStore.ts
└── types/
    ├── database.types.ts   # Generado por Supabase CLI
    └── medical.types.ts
```

# Family Health Tracker — Arquitectura General

## Stack Tecnológico

| Capa | Tecnología | Justificación |
|------|-----------|---------------|
| Mobile | React Native + Expo SDK 51 | Cross-platform iOS/Android, acceso nativo a cámara y notificaciones |
| Backend | Supabase (BaaS) | Auth, DB, Storage, Edge Functions en un solo servicio |
| Base de datos | PostgreSQL 15 (Supabase) | RDBMS robusto, RLS nativo, soporte JSONB para datos IA |
| Storage | Supabase Storage | Almacenamiento de imágenes y documentos médicos |
| Auth | Supabase Auth | JWT con RLS integrado, soporte OAuth |
| Functions | Supabase Edge Functions (Deno) | Procesamiento IA, webhooks, lógica de negocio |
| OCR + LLM | DeepSeek API | OCR integrado + LLM para estructurar fórmulas médicas |
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

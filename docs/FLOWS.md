# Family Health Tracker — Flujos Detallados

## Flujo 1: Crear Tenant y Familia Inicial

```
App                         Supabase Auth           PostgreSQL
 |                                |                      |
 |-- register(email,pass) ------> |                      |
 |                                |-- INSERT auth.users  |
 |                                |-- TRIGGER ---------->|
 |                                |              INSERT profiles (sin tenant_id)
 |<-- session + JWT ------------- |                      |
 |                                |                      |
 |-- createTenant(name,slug,plan) ------ RPC ---------> |
 |                                        create_tenant_with_owner():
 |                                        1. valida que la cuenta no pertenezca ya a otra familia
 |                                        2. INSERT tenants (con plan)
 |                                        3. INSERT tenant_users (owner)
 |                                        4. UPDATE profiles.tenant_id
 |                                        5. INSERT families (familia inicial)
 |<-- { tenant_id, family_id, plan } ----------------- |
```

**Código React Native:**
```typescript
const { data } = await supabase.rpc("create_tenant_with_owner", {
  p_name: "Familia García",
  p_slug: "familia-garcia",
  p_plan: "free"
});
// data.tenant_id y data.family_id disponibles
```

**Notas actuales:**
- La selección de plan ocurre en onboarding al crear la familia, no en `register`.
- Si el usuario ya fue invitado a una familia existente, no debería pasar por este flujo.
- Si existía un tenant previo sin familia por un fallo antiguo, la misma RPC ahora completa esa familia faltante en vez de crear otro tenant.
- Antes de `signUp`, la app consulta `check_auth_email_status` para no dejar pasar correos ya registrados en Supabase Auth.

---

## Flujo 2: Invitar Cuidador a la Familia

### Caso A: el correo ya tiene cuenta

```
Admin / Owner            Supabase
    |                       |
    |-- inviteUser(email) ->|-- lookup profiles by email
    |                       |-- INSERT/UPDATE tenant_users
    |                       |-- UPDATE profiles.tenant_id
    |<-- acceso inmediato --|
```

### Caso B: el correo aún no tiene cuenta

```
Admin / Owner            Supabase                  Cuidador invitado
    |                       |                              |
    |-- inviteUser(email) ->|-- INSERT tenant_invitations |
    |<-- pending invite ----|                              |
    |                       |                              |-- register(email, pass)
    |                       |                              |-- confirm email
    |                       |<----- login -----------------|
    |                       |-- claim_pending_tenant_invitations()
    |                       |-- INSERT tenant_users
    |                       |-- UPDATE profiles.tenant_id
    |<-- acceso activo -----|                              |
```

**Notas actuales:**
- La invitación se identifica por el correo exacto.
- El cuidador debe registrarse con ese mismo correo para reclamar la invitación.
- Hoy la app asume una sola familia activa por cuenta.
- El reclamo automático corre al iniciar sesión/cargar la app desde `useFamilyStore.fetchTenantAndFamily()`.
- `profile.tsx` muestra tanto los usuarios con acceso como las invitaciones pendientes.
- El owner puede invitar como `admin`, `member` o `viewer`; un admin solo puede invitar y gestionar `member` o `viewer`.
- La misma pantalla ya permite cambiar rol, cancelar invitaciones pendientes y revocar accesos activos.
- Si la invitación se reclama correctamente, el cuidador entra directo a la app y no pasa por la selección de plan.

---

## Flujo 2B: Recuperar Contraseña

```
Usuario                  App móvil                 Supabase Auth
   |                        |                            |
   |-- "Olvidé..." -------> |                            |
   |                        |-- resetPasswordForEmail -->|
   |                        |<-- email recovery ---------|
   |<----- abre deep link familyhealth://reset-password --|
   |                        |-- setSession(access,refresh)
   |                        |-- updateUser(password) ---->|
   |                        |<-- ok ----------------------|
   |<-- entra a onboarding/app según tenant -------------|
```

**Notas actuales:**
- El cliente React Native parsea manualmente el deep link de recovery y hace `supabase.auth.setSession()`.
- Después de guardar la nueva contraseña, la app vuelve a resolver onboarding/app como si fuera un login normal.

---

## Flujo 3: Crear Familia y Familiar

```typescript
// Crear familia
const { data: family } = await supabase
  .from("families")
  .insert({ tenant_id, name: "Familia Principal", created_by: user.id })
  .select().single();

// Crear familiar (hijo)
const { data: member } = await supabase
  .from("family_members")
  .insert({
    tenant_id,
    family_id: family.id,
    full_name: "Juan Pablo García",
    date_of_birth: "2018-05-15",
    relationship: "child",
    sex: "male",
    blood_type: "O+",
    allergies: ["penicilina"],
    chronic_conditions: [],
    eps: "Compensar",
    created_by: user.id
  })
  .select().single();
```

---

## Flujo 4: Crear Visita Médica

```typescript
const { data: visit } = await supabase
  .from("medical_visits")
  .insert({
    tenant_id,
    family_id: family.id,
    family_member_id: member.id,
    visit_date: "2025-03-15",
    doctor_name: "Dr. Carlos Méndez",
    specialty: "Pediatría",
    institution: "Clínica del Country",
    reason: "Tos persistente y fiebre",
    diagnosis: "Faringoamigdalitis bacteriana",
    vitals: { weight_kg: 28.5, temp_c: 38.2 },
    created_by: user.id
  })
  .select().single();
```

**Notas actuales:**
- Si `visit_date` queda en el futuro, la app la guarda con `status='scheduled'`.
- Si la fecha ya paso o es inmediata, se guarda como `status='completed'`.
- Las citas futuras generan un reminder automatico en `reminders` y lo veras luego en la campanita.

---

## Flujo 4B: Cita Futura y Notificaciones

```
Usuario                    App movil                 PostgreSQL / Supabase
   |                           |                              |
   |-- crea visita futura ---> |-- INSERT medical_visits ---->|
   |                           |                              |-- trigger sync_medical_visit_appointment_reminder()
   |                           |                              |-- UPSERT reminders(reminder_type='appointment')
   |                           |                              |
   |<-- ve cita en perfil -----|                              |
   |                           |<== Realtime reminders =======|
   |                           |-- badge campanita / inbox -->|
   |                           |                              |
   |                           |<-- pg_cron + send-notifications() -- when due
   |<-- push en celular -------|                              |
   |-- toca push ------------> |-- abre visita o inbox ------>|
```

**Notas actuales:**
- El reminder de cita se calcula automaticamente segun cercania de la cita: 24h, 2h, 15m o al momento de la cita.
- `notification_reads` guarda el estado de lectura por usuario para que la campanita no sea compartida entre cuidadores.
- El inbox usa RPC `get_notification_feed` y `get_unread_notification_count`, y se refresca por Realtime sobre `reminders` y `notification_reads`.
- Desde `visit/[id]` la cita programada se puede marcar como realizada o cancelada.

---

## Flujo 5: Subir y Procesar Fórmula con IA

```
Usuario                App RN                 Supabase Storage      Edge Function       DeepSeek API
  |                      |                           |                     |                   |
  |-- foto fórmula ----> |                           |                     |                   |
  |                      |-- optimizeImage()         |                     |                   |
  |                      |-- uploadToStorage() ----> |                     |                   |
  |                      |   path: tenant/member/ts/ |                     |                   |
  |                      |<-- { storagePath } ------ |                     |                   |
  |                      |-- INSERT medical_documents|                     |                   |
  |                      |                           |                     |                   |
  |-- "Procesar IA" ----> |                           |                     |                   |
  |                      |-- POST /process-prescription -----------------> |                   |
  |                      |                           |                     |-- createSignedUrl  |
  |                      |                           |<-- signed URL ------ |                   |
  |                      |                           |                     |-- fetch image ---> |
  |                      |                           |                     |<-- base64 -------- |
  |                      |                           |                     |                   |
  |                      |                           |                     |-- POST DeepSeek -> |
  |                      |                           |                     |   (image+prompt)  |
  |                      |                           |                     |<-- JSON result --- |
  |                      |                           |                     |                   |
  |                      |                           |                     |-- INSERT prescription
  |                      |                           |                     |-- INSERT medications
  |                      |                           |                     |-- INSERT tests
  |                      |                           |                     |-- UPDATE document.is_processed=true
  |                      |<-- { prescription_id, extracted } ------------ |                   |
  |                      |                           |                     |                   |
  |<-- Pantalla Review -- |                           |                     |                   |
```

---

## Flujo 6: Confirmar Datos IA y Generar Horarios

```typescript
// 1. Usuario revisa los datos extraídos en pantalla Review
// 2. Puede editar medicamentos antes de confirmar

// Confirmar prescripción
await PrescriptionAIService.confirmPrescription(prescriptionId);

// 3. Generar horarios automáticos para cada medicamento
const schedules = await PrescriptionAIService.generateSchedulesForPrescription(prescriptionId);
// Ejemplo: amoxicilina 500mg cada 8h por 7 días → genera 21 entradas en medication_schedules

// 4. Crear recordatorios para cada dosis
for (const schedule of allSchedules) {
  await NotificationService.createDoseReminder({
    tenantId,
    familyMemberId,
    scheduleId: schedule.id,
    medicationName: "Amoxicilina",
    doseLabel: schedule.dose_label,
    scheduledAt: new Date(schedule.scheduled_at),
    minutesBefore: 10
  });
}
```

---

## Flujo 7: Registrar Toma de Dosis

```typescript
// El usuario ve las dosis pendientes del día
const { data: doses } = await supabase.rpc("get_pending_doses_today", {
  p_family_member_id: memberId
});

// Marca una dosis como tomada
await supabase.rpc("mark_dose", {
  p_schedule_id: doseId,
  p_status: "taken",
  p_notes: null
});

// O si se olvidó y la tomó tarde:
await supabase.rpc("mark_dose", {
  p_schedule_id: doseId,
  p_status: "late",
  p_notes: "Se tomó 2 horas después"
});
```

---

## Flujo 8: Búsqueda en Historial

```typescript
// 1. Intentar primero búsqueda local con los datos ya cargados del miembro
const localResults = searchMemberHistoryLocal({
  query: "amoxicilina",
  visits,
  prescriptions,
  tests
});

// 2. Si no hay resultados, usar RPC determinística
const { data: directData } = await supabase.rpc("search_medical_history", {
  p_family_member_id: memberId,
  p_query: "amoxicilina"
});

// 3. Si tampoco hay resultados, expandir con IA usando contexto del paciente
const { data: aiData } = await supabase.functions.invoke("search-ai", {
  body: {
    query: "amoxicilina",
    limit: 20,
    memberContext: buildMemberContext()
  }
});
```

**Orden actual del historial:** fallback local → `search_medical_history` → `search-ai` + reintento por términos expandidos

---

## Flujo 9: Búsqueda Global (Home)

```typescript
// 1. Intentar primero fallback local desde cliente
const fallbackResults = await searchGlobalFallback("amoxicilina", 40);

// 2. Si no hubo resultados, usar expansión IA
const { data: aiData } = await supabase.functions.invoke("search-ai", {
  body: { query: "amoxicilina", limit: 40 }
});

// 3. Si la edge function falla, fallback a RPC
const { data: rpcData } = await supabase.rpc("search_global", {
  p_query: "amoxicilina",
  p_limit: 40
});
```

---

## Flujo 10: Subir Resultado de Examen

```typescript
// 1. Subir imagen/PDF del resultado
const { storagePath, documentId } = await PrescriptionAIService.uploadPrescriptionImage(
  fileUri, tenantId, memberId
);
// storagePath: tenant_id/member_id/timestamp/resultado.pdf

// 2. Actualizar el examen con el resultado
await supabase
  .from("prescription_tests")
  .update({
    status: "completed",
    completed_date: new Date().toISOString().split("T")[0],
    result_document_id: documentId,
    result_summary: "Hemograma normal. Ver documento adjunto."
  })
  .eq("id", testId);
```

---

## Flujo 11: Borrado implementado

### 11A. Eliminar adjunto de visita

```
Usuario abre visit/[id]
        ↓
Selecciona adjunto
        ↓
"Eliminar adjunto"
        ↓
RPC `delete_medical_document_attachment(p_document_id)`
        ↓
Si no tiene derivados:
  delete medical_documents row
  ↓
  remove() del archivo en Storage
Si tiene derivados confirmados:
  la RPC bloquea el borrado
```

### 11B. Eliminar visita

```
Usuario abre visit/[id]
        ↓
"Eliminar visita"
        ↓
RPC `soft_delete_medical_visit(p_visit_id)`
        ↓
UPDATE logical:
  status='cancelled'
  deleted_at=NOW()
  deleted_by=auth.uid()
        ↓
La visita deja de salir en listados, historial y búsquedas normales
```

**Nota:** en la política actual no hay hard delete de visitas desde la UI.

---

## Diagrama de Pantallas React Native

```
┌─────────────────────────────────────────────────────┐
│                   Tab Navigation                    │
│  [Dashboard] [Familia] [Medicamentos] [Alertas]     │
└─────────────────────────────────────────────────────┘

(auth)
├── login.tsx          → Email/Google login
└── register.tsx       → Registro + crear tenant

(app)
├── dashboard.tsx
│     • Familiares activos
│     • Dosis de hoy (todas las familias)
│     • Exámenes próximos
│     • Último acceso por familiar
│
├── family/
│   ├── index.tsx      → Lista de familias del tenant
│   ├── [id].tsx       → Detalle familia + miembros
│   ├── new.tsx        → Crear familia
│   └── member/
│       ├── [id].tsx   → Perfil familiar
│       │   • Datos personales
│       │   • Alergias y condiciones
│       │   • Historial de visitas
│       │   • Medicamentos activos
│       │   • Exámenes pendientes
│       └── new.tsx    → Agregar familiar
│
├── visits/
│   ├── new.tsx        → Nueva visita médica
│   │   • Seleccionar familiar
│   │   • Datos del médico
│   │   • Diagnóstico y observaciones
│   │   • Adjuntar fórmula (cámara/galería)
│   └── [id].tsx       → Detalle visita
│
├── prescriptions/
│   ├── scan.tsx       → Escaneo de fórmula
│   │   • Cámara con guías de encuadre
│   │   • Botón de galería
│   │   • Preview de imagen
│   │   • Botón "Procesar con IA"
│   │   • Progress indicator
│   ├── review.tsx     → Revisión datos IA
│   │   • Confidence score visual
│   │   • Lista de medicamentos editables
│   │   • Lista de exámenes editables
│   │   • Botón confirmar / rechazar
│   └── [id].tsx       → Detalle prescripción
│
├── medications/
│   ├── active.tsx     → Medicamentos activos por familiar
│   └── schedule.tsx   → Vista calendario de dosis
│       • Hoy / Próximos 7 días
│       • Por familiar
│       • Marcar tomado/omitido
│
├── tests/
│   └── index.tsx      → Exámenes pendientes
│       • Filtro por estado
│       • Marcar como agendado
│       • Subir resultado
│
├── alerts/
│   └── index.tsx      → Centro de alertas
│       • Dosis próximas (2h)
│       • Dosis atrasadas
│       • Exámenes vencidos
│       • Citas de seguimiento
│
└── search/
    └── index.tsx      → Búsqueda global
        • Barra de búsqueda
        • Filtros: medicamento / diagnóstico / médico
        • Resultados agrupados por tipo
        • Tap → navega al detalle
```

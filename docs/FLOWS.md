# Family Health Tracker — Flujos Detallados

## Flujo 1: Crear Tenant

```
App                     Supabase Auth           PostgreSQL
 |                            |                      |
 |-- register(email,pass) --> |                      |
 |                            |-- INSERT auth.users  |
 |                            |-- TRIGGER ---------->|
 |                            |              INSERT profiles (sin tenant_id)
 |<-- session + JWT --------- |                      |
 |                            |                      |
 |-- createTenant(name,slug) -------- RPC ---------->|
 |                                    create_tenant_with_owner():
 |                                    1. INSERT tenants
 |                                    2. INSERT tenant_users (owner)
 |                                    3. UPDATE profiles.tenant_id
 |<-- { tenant_id } -------------------------------- |
```

**Código React Native:**
```typescript
const { data } = await supabase.rpc("create_tenant_with_owner", {
  p_name: "Familia García",
  p_slug: "familia-garcia"
});
// data.tenant_id disponible
```

---

## Flujo 2: Asociar Usuario al Tenant

```
Owner                   Supabase                  Nuevo Usuario
  |                        |                            |
  |-- inviteUser(email) -> |-- INSERT tenant_users      |
  |                        |   (is_active=false)        |
  |                        |-- send email invite -----> |
  |                        |                            |-- click link
  |                        |<-- accept_invite() ------- |
  |                        |-- UPDATE tenant_users      |
  |                        |   (is_active=true,         |
  |                        |    joined_at=NOW())        |
```

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
// Buscar "amoxicilina" en historial de Juan Pablo
const { data: results } = await supabase.rpc("search_medical_history", {
  p_family_member_id: memberId,
  p_query: "amoxicilina"
});

// Retorna: [
//   { result_type: "medication", title: "Amoxicilina", subtitle: "Cápsulas 500mg", date_ref: "2025-03-15" }
// ]

// Buscar "exámenes pendientes"
const { data: tests } = await supabase.rpc("get_pending_tests", {
  p_family_member_id: memberId
});
```

---

## Flujo 9: Subir Resultado de Examen

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

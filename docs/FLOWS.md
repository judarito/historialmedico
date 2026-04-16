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
- Después de crear familia y primer miembro, la app todavía puede exigir un paso adicional: capturar `profiles.phone` en `onboarding/contact` antes de entrar a tabs.

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

## Flujo 3B: Capturar celular del usuario para WhatsApp / SMS

```
Usuario autenticado         App móvil                    Supabase
      |                        |                            |
      |-- termina familia ---->|                            |
      |-- termina primer miembro                           |
      |                        |-- revisa profiles.phone -->|
      |                        |<-- null / vacío ---------- |
      |<-- abre onboarding/contact                         |
      |-- guarda +573001112233 -->|                        |
      |                        |-- UPDATE profiles.phone -->|
      |                        |<-- ok ---------------------|
      |<-- entra a tabs/app ---|                            |
```

**Notas actuales:**
- El número no se pide en `register`; se captura después del alta básica de la familia.
- Si el usuario ya tenía familia y miembros pero aún no tenía celular guardado, `resolveAuthenticatedRoute()` también lo redirige a `onboarding/contact`.
- La pantalla acepta móviles colombianos como `3001112233` y los normaliza a `+573001112233`.
- El mismo `profiles.phone` se usa luego para pruebas de WhatsApp/SMS desde Perfil.

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
- `add-visit` también soporta modo express para citas futuras: propone una fecha futura por defecto y deja diagnóstico/observaciones/signos vitales como detalles opcionales.
- Las citas futuras generan un reminder automatico en `reminders` y lo veras luego en la campanita.
- Desde el perfil del miembro, la acción `Dosis hoy` y el enlace `Ver todas las dosis` abren la pestaña de medicamentos enfocada en ese mismo familiar, no en el primero de la familia.
- Las dosis pendientes tambien generan `reminders` de tipo `medication_dose`; cuando llega la hora, salen en la campanita y como push del celular.
- En `Detalle de visita`, si esa visita tiene medicamentos o exámenes vinculados, ya se muestran ahí mismo y puedes completar un tratamiento o marcar un examen como realizado sin salir de la visita.
- En `Detalle de visita`, las citas futuras se pueden reprogramar; el mismo modal también deja editar motivo de consulta y síntomas/observaciones.
- En visitas actuales o pasadas, el diagnóstico se puede editar manualmente o inferir con IA desde ese modal, usando motivo, síntomas, medicamentos y exámenes como contexto.
- Cuando la IA sugiere un diagnóstico en una visita o al procesar evidencia, intenta dejarlo como `Diagnóstico técnico (explicación sencilla)` para que el historial sea útil también para cuidadores.

## Flujo 4D: Limpiar informacion clinica de un familiar sin borrar su ficha

```sql
select id, first_name, last_name
from family_members
where is_active = true
order by created_at;

select public.clear_family_members_medical_data(
  array[
    'uuid-del-familiar-1',
    'uuid-del-familiar-2'
  ]::uuid[]
);
```

**Notas actuales:**
- La limpieza conserva `family_members`; solo borra visitas, adjuntos, medicamentos, horarios, exámenes y recordatorios asociados.
- La RPC devuelve conteos y `file_paths` para que, si hace falta, luego puedas limpiar archivos en Storage.
- Esta operación es destructiva y no pasa por soft delete.
- Si la corres desde SQL Editor, asegúrate de haber aplicado también `037_clear_family_members_medical_data_sql_editor_fix.sql`, porque ahí se habilita el caso `auth.uid() IS NULL`.

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
- El reminder de medicamento se calcula segun cercania de la dosis: 30m, 10m o a la hora exacta si ya esta muy cerca.
- `notification_reads` guarda el estado de lectura por usuario para que la campanita no sea compartida entre cuidadores.
- El inbox usa RPC `get_notification_feed` y `get_unread_notification_count`, y se refresca por Realtime sobre `reminders` y `notification_reads`.
- `reminders` y `notification_reads` deben estar publicados en `supabase_realtime`; si no, abrir la campanita refresca por RPC pero el badge no sube solo.
- Desde `visit/[id]` la cita programada se puede marcar como realizada o cancelada.
- Desde `visit/[id]` ahora tambien existen dos niveles de borrado: `Solo ocultar` para soft delete o `Eliminar todo` para limpiar visita, adjuntos y datos derivados.
- Al tocar una notificación de medicamento, la app abre la pestaña `Medicamentos` filtrada al familiar correcto.
- Desde `Inicio`, el usuario ahora tiene `Agendar cita express` y `Ver agenda`, y `appointments.tsx` deja revisar citas futuras agrupadas por día como scheduler.

---

## Flujo 4C: Buscar Especialistas en Colombia (REPS + Google Places + Cache)

```
Usuario                   App movil               Edge Function                PostgreSQL / Supabase            REPS API               Google Places
   |                          |                          |                                 |                           |                         |
   |-- "pediatra Medellin" -> |-- invoke search -------> |                                 |                           |                         |
   |                          |                          |-- normaliza ciudad/especialidad |                           |                         |
   |                          |                          |-- busca cache_key ------------> |                           |                         |
   |                          |                          |<-- hit fresco completo ------- |                           |                         |
   |<-- resultados rapidos ---|                          |                                 |                           |                         |
   |                          |                          |                                 |                           |                         |
   |                          |                          |-- miss/cache incompleto + lock> |                           |                         |
   |                          |                          |<-- lock adquirido / no -------- |                           |                         |
   |                          |                          |-- GET datos.gov.co -------------------------------------------> |                         |
   |                          |                          |<--------------------------------------------------------------- |                         |
   |                          |                          |-- si REPS no llena pageSize -----------------------------------------------> |
   |                          |                          |<-------------------------------------------------------------------------------- |
   |                          |                          |-- mezcla REPS + Google, upsert y cache ----------------------> |                         |
   |<-- resultados -----------|                          |                                 |                           |                         |
```

**Notas actuales:**
- La Edge Function nueva es `search-medical-places`.
- La key de Google nunca vive en React Native; solo en secrets de Supabase.
- REPS es la fuente primaria para búsquedas por ciudad con `reps_municipality_name`; si REPS devuelve menos resultados que `pageSize`, la respuesta se complementa con Google Places.
- El cache se comparte entre usuarios por `cache_key`, por ejemplo `country:co|mode:city|city:cartagena|specialty:pediatria|page:1`.
- Las busquedas frescas se sirven desde `medical_directory_search_cache`; si el cache esta vencido pero usable, la app puede recibir resultado `stale`.
- Si una busqueda es elegible para REPS pero el cache solo tiene Google o tiene un set REPS incompleto sin complemento Google, la function ignora ese cache y rehace la mezcla.
- El lock suave `claim_medical_directory_cache_refresh()` evita que varias busquedas identicas disparen varias llamadas simultaneas a REPS/Google.
- `medical_directory_cities` y `medical_directory_specialties` quedan expuestas en solo lectura para usuarios autenticados, para usarlas como filtros o sugerencias.
- El diseño actual esta optimizado para pedir solo campos de lista en Google; telefono/rating quedan como opcion de costo mas alto (`includeRichFields`).
- Los registros REPS se guardan con `source='reps'` y una clave sintética por sede para no colisionar varias sedes del mismo prestador.
- Cuando el usuario abre una ficha puntual, la app llama `get-medical-place-details` y usa un cache separado de 7 dias (`detail_*`) para telefono, web y horarios; si la ficha viene de REPS, no intenta refrescarla con Google.
- La pantalla `doctor-place/[id].tsx` es la ficha de detalle y permite llamar, abrir web o abrir Google Maps sin volver a encarecer la lista completa.
- La lista ahora agrega ranking local (`local_score`) y badges utiles (`Especialista`, `Consultorio`, `Clínica`, `Hospital`, `Favorito`, `REPS`, `Google`) para mejorar orden y lectura.
- Los favoritos viven en `medical_directory_favorites`; se pueden marcar desde la lista o la ficha y luego filtrar con `Solo favoritos`.
- `medical_directory_places` y `medical_directory_place_specialties` deben estar expuestas en lectura a usuarios autenticados; si no, el contador de guardados puede subir pero la lista aparecer vacia.
- Inicio y Perfil ya pueden abrir `doctor-directory` directamente en modo guardados (`?favorites=1`) para no depender de una busqueda previa.
- Desde la lista o la ficha del directorio ya se puede tocar `Crear visita`; eso abre `add-visit` con medico/especialidad/institucion precargados, y si no venia un familiar fijo permite escogerlo antes de guardar.
- `doctor-directory` precarga la ciudad preferida del perfil del usuario usando `get_preferred_city`.
- Cuando `Solo favoritos` está activo, la busqueda se resuelve localmente sobre los guardados del usuario y no dispara Google Places.

---

## Flujo 4E: Búsqueda global + agente del historial desacoplados

```
Usuario                   SearchScreen
   |                           |
   |-- escribe query --------> |-- debounce 500ms
   |                           |-- searchGlobalFallback()
   |                           |-- si no hay resultados -> search-ai
   |                           |-- si falla -> search_global
   |<-- resultados navegables -|
   |                           |
   |-- consulta parece pregunta|
   |<-- CTA "Preguntar al asistente"
   |-- toca CTA -------------> |-- ask-health-agent
   |<-- respuesta del agente --|
```

**Notas actuales:**
- El agente RAG ya no se ejecuta por cada caracter digitado.
- `looksLikeHealthAgentQuestion()` solo sugiere mostrar la CTA, pero no dispara la consulta automáticamente.
- La búsqueda general y el asistente tienen estados separados (`loading`, errores y cancelación) para que no se pisen entre sí.
- Al limpiar o editar el query, la respuesta previa del asistente se descarta para evitar mezclar resultados viejos con la búsqueda actual.

---

## Flujo 4F: Prueba de WhatsApp con Twilio

```
Usuario                 App móvil                 Edge Function                Twilio
   |                        |                            |                        |
   |-- toca "Enviar..." --->|-- sendWhatsAppTestToMyPhone()                      |
   |                        |-- invoke send-twilio-message ---------------------> |
   |                        |                            |-- POST Messages ------>|
   |                        |                            |<-- sid + queued -------|
   |                        |                            |-- GET Message SID ---->|
   |                        |                            |<-- delivery status ----|
   |<-- estado real --------|                            |                        |
```

**Notas actuales:**
- El destinatario sale de `profiles.phone` del usuario autenticado; la app normal no permite mandar pruebas a otro número.
- La función devuelve `status` y `deliveryStatus`; `status='queued'` no significa entrega exitosa.
- Si `sandbox=true`, el sender sigue siendo `whatsapp:+14155238886` y el número debe haberse unido al sandbox.
- Si `deliveryStatus='undelivered'` con `errorCode=63016`, Twilio está rechazando el mensaje por intentar iniciar conversación fuera de la ventana permitida sin una plantilla válida.
- Para ese caso hace falta configurar `TWILIO_DEFAULT_WHATSAPP_CONTENT_SID` con un `HX...` aprobado para `WhatsApp business initiated`.

---

## Flujo 4G: Agenda rápida de citas futuras

```
Usuario                    Dashboard / Agenda                 Supabase
   |                              |                              |
   |-- toca "Agendar..." -------> |-- abre add-visit -----------|
   |                              |   mode='schedule'           |
   |                              |   fecha futura sugerida     |
   |-- confirma datos ----------> |-- INSERT medical_visits --->|
   |                              |   status='scheduled'        |
   |                              |<-- ok ----------------------|
   |<-- vuelve a agenda ----------|                              |
   |-- toca "Ver agenda" -------> |-- appointments.tsx -------->|
   |                              |-- SELECT citas futuras ---->|
   |<-- ve scheduler por día -----|                              |
```

**Notas actuales:**
- `appointments.tsx` consulta solo visitas futuras (`status='scheduled'`, `visit_date > now()`) y las agrupa por día.
- La agenda permite abrir el detalle de cada cita para reprogramarla, marcarla como realizada o cancelarla.
- `DashboardScreen` ahora expone dos accesos rápidos: `Agendar cita express` y `Ver agenda`.
- El formulario express está pensado para velocidad: motivo + médico/especialidad/institución + fecha/hora; el resto queda detrás de `Detalles opcionales`.
- En web, `DatePickerField` usa un input `datetime-local` visible y editable para evitar pickers invisibles en navegador.
- Al guardar una cita futura desde el flujo express, `add-visit.tsx` limpia el formulario y redirige directamente a `appointments`.
- Dentro de `add-visit`, el campo de médico ya muestra coincidencias de `medical_directory_favorites` mientras el usuario escribe, y si el especialista no está ahí se puede abrir el directorio completo sin perder los demás datos de la cita.

---

## Flujo 4H: Cerrar sesión desde Perfil en web y móvil

```
Usuario                    ProfileTab                  AuthStore / Router
   |                           |                                |
   |-- toca "Cerrar sesión" -->|-- web: confirm()              |
   |                           |-- móvil: Alert.alert()        |
   |-- confirma -------------->|-- signOut(scope='local') ---->|
   |                           |-- reset stores -------------->|
   |<-- va a /login -----------|                                |
```

**Notas actuales:**
- El botón de logout ahora usa una confirmación compatible con web y móvil.
- Además de cerrar auth, se limpian stores auxiliares como familia y notificaciones para evitar estados colgados después del logout.

---

## Flujo 4I: Tab Medicamentos enfocado por familiar sin loop

**Notas actuales:**
- `medications.tsx` ya no mantiene un estado intermedio de miembro preferido separado del `memberId` de la ruta.
- La selección inicial del familiar ahora se estabiliza antes de recargar dosis.
- El refresh al volver al foco solo vuelve a cargar el familiar ya seleccionado, evitando loops al entrar con el primer miembro por defecto.

---

## Flujo 4J: Dictado del médico dentro de la visita

```
Usuario                 Detalle de visita               voice-to-data / Supabase
  |                            |                                  |
  |-- toca micrófono --------->|-- VoiceRecordButton ------------>|
  |                            |-- STT nativo + audio original -->|
  |-- termina consulta ------->|-- invoke voice-to-data --------->|
  |                            |<-- JSON estructurado ------------|
  |-- revisa extracción ------>|                                  |
  |-- guarda ----------------->|-- UPDATE medical_visits -------->|
  |                            |-- INSERT medical_documents ----->|
  |                            |-- RPC confirm_document... ------>|
  |<-- ve meds/exámenes -------|                                  |
```

**Notas actuales:**
- `visit/[id].tsx` incluye una sección `Consulta por voz` para capturar lo que dice el médico sin salir del detalle.
- La transcripción completa se guarda en `medical_visits.voice_note_text` y además se crea un `medical_document` tipo `voice_note` ligado a la visita.
- Los medicamentos y exámenes detectados se crean como registros estructurados usando `confirm_document_and_create_records`.
- Las terapias y recomendaciones se conservan en `parsed_json` y se resumen dentro de `notes` / observaciones porque aún no existe una tabla dedicada para terapias.

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

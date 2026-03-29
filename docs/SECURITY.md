# Family Health Tracker — Seguridad y Riesgos

## Modelo de Amenazas

### Datos que se protegen
- Datos médicos de menores de edad (máxima sensibilidad)
- Diagnósticos, medicamentos, exámenes
- Imágenes de fórmulas médicas
- Datos personales (nombre, fecha de nacimiento, EPS)

---

## Riesgos y Mitigaciones

### RIESGO 1: Fuga de datos entre tenants
**Probabilidad:** Alta sin RLS | **Impacto:** Crítico

**Mitigación:**
- RLS habilitado en TODAS las tablas sin excepción
- Función `user_belongs_to_tenant()` como gatekeeping central
- NUNCA se hacen queries sin el filtro de `tenant_id`
- Los join entre tablas siempre incluyen `tenant_id` del lado del padre

**Verificación:**
```sql
-- Verificar que todas las tablas tienen RLS
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = FALSE;  -- debe retornar 0 filas
```

---

### RIESGO 2: Bypass de RLS via Supabase service_role
**Probabilidad:** Media | **Impacto:** Crítico

**Mitigación:**
- La `SUPABASE_SERVICE_ROLE_KEY` NUNCA se incluye en la app mobile
- Solo se usa en Edge Functions (backend)
- Las Edge Functions validan el JWT del usuario antes de operar
- Todas las operaciones de sistema se registran en `audit_logs`

**Regla:**
```
❌ NUNCA: EXPO_PUBLIC_SUPABASE_SERVICE_KEY (expone en bundle)
✅ SIEMPRE: EXPO_PUBLIC_SUPABASE_ANON_KEY (respeta RLS)
```

---

### RIESGO 3: Acceso no autorizado a documentos médicos en Storage
**Probabilidad:** Media | **Impacto:** Alto

**Mitigación:**
- Bucket `medical-documents` configurado como PRIVADO
- Acceso solo via `createSignedUrl()` con expiración máxima de 1 hora
- Policy de Storage valida `tenant_id` en el path
- NUNCA usar `getPublicUrl()` para documentos médicos
- URLs firmadas se generan bajo demanda, no se almacenan

```typescript
// ✅ CORRECTO
const { data } = await supabase.storage
  .from('medical-documents')
  .createSignedUrl(path, 3600); // expira en 1h

// ❌ INCORRECTO
const { data } = await supabase.storage
  .from('medical-documents')
  .getPublicUrl(path); // nunca para datos médicos
```

---

### RIESGO 4: Inyección en búsquedas de texto libre
**Probabilidad:** Media | **Impacto:** Medio

**Mitigación:**
- Búsquedas usando `to_tsvector` + `plainto_tsquery` (escapa automáticamente)
- Búsqueda ILIKE con parámetros bind (`$1`), nunca concatenación de strings
- El cliente Supabase usa parámetros preparados automáticamente
- La función `search_medical_history` es `SECURITY DEFINER` y valida tenant antes de ejecutar

---

### RIESGO 5: SECURITY DEFINER functions
**Probabilidad:** Baja | **Impacto:** Alto si mal usadas

Las siguientes funciones usan `SECURITY DEFINER` con justificación:

| Función | Por qué SECURITY DEFINER | Mitigación |
|---------|--------------------------|------------|
| `handle_new_user()` | Necesita escribir en `profiles` desde trigger de `auth.users` | Solo hace INSERT controlado, no expone datos |
| `user_belongs_to_tenant()` | Necesita leer `tenant_users` en el contexto de RLS | Solo retorna boolean, no expone filas |
| `my_tenant_ids()` | Necesita agregar UUIDs para usar en políticas | Solo retorna array propio del usuario |
| `log_audit_event()` | Necesita escribir en `audit_logs` sin permiso directo del usuario | Solo inserta la fila correspondiente a la acción actual |
| `create_tenant_with_owner()` | Operación atómica que requiere múltiples INSERTs | Valida `auth.uid()` antes de operar |

**Regla para nuevas funciones SECURITY DEFINER:**
1. Siempre validar `auth.uid()` al inicio
2. Siempre filtrar por `tenant_id` antes de cualquier operación
3. No retornar datos de otros usuarios/tenants
4. Documentar la justificación en comentario del código

---

### RIESGO 6: Exposición de datos médicos en logs
**Probabilidad:** Alta si no se controla | **Impacto:** Alto

**Mitigación:**
- `audit_logs` contiene datos mínimos (no el contenido médico completo)
- `old_data` y `new_data` en audit_logs solo para cambios de estado críticos
- Los diagnósticos y medicamentos NO se loguean en `new_data` por defecto
- Solo admins y owners pueden ver `audit_logs` via RLS

---

### RIESGO 7: DeepSeek API — datos médicos enviados externamente
**Probabilidad:** Certeza (es el flujo diseñado) | **Impacto:** Depende de política de privacidad

**Mitigación:**
- La imagen se envía a DeepSeek para OCR/extracción: incluir en política de privacidad
- Considerar anonimización del nombre del paciente antes de enviar si DeepSeek no tiene BAA
- Usar `deepseek-chat` (modelo no retiene datos para entrenamiento según sus políticas)
- El `ai_raw_output` guardado en DB nunca incluye datos de identificación del médico
- Alternativa on-premise: EasyOCR (Python) + Ollama con LLaMA local si privacidad es crítica

---

### RIESGO 8: Tokens de push notification en DB
**Probabilidad:** Media | **Impacto:** Medio (spam notifications)

**Mitigación:**
- `push_token` en `profiles` solo accesible por el propio usuario via RLS
- La Edge Function `send-notifications` usa `service_role` pero no expone tokens
- Rotar tokens cuando el usuario hace logout: `UPDATE profiles SET push_token = NULL`

---

## Checklist de Seguridad en Producción

### Supabase Dashboard
- [ ] Deshabilitar `email confirmations` bypass en auth
- [ ] Configurar JWT expiry a 1 hora (refresh token: 7 días)
- [ ] Habilitar `Leaked password protection`
- [ ] Configurar `allowed email domains` si es app B2B
- [ ] Deshabilitar sign-ups públicos si es invite-only

### Storage
- [ ] Confirmar que bucket `medical-documents` es PRIVATE
- [ ] Configurar CORS: solo origen de la app
- [ ] Límite de tamaño: 10MB para documentos médicos
- [ ] Límite de tipos MIME: solo image/jpeg, image/png, image/webp, application/pdf

### Edge Functions
- [ ] `DEEPSEEK_API_KEY` en Supabase Secrets (no en código)
- [ ] `INTERNAL_SECRET` para proteger el endpoint `send-notifications`
- [ ] Rate limiting en `process-prescription` (max 10 req/min por usuario)
- [ ] Timeout de 30s en llamadas a DeepSeek API

### RLS
- [ ] Ejecutar query de verificación post-deploy:
```sql
-- Verificar RLS habilitado en todas las tablas
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = FALSE;
-- Debe retornar 0 filas

-- Verificar policies en todas las tablas
SELECT tablename, count(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY policy_count;
-- Cada tabla debe tener al menos 4 policies (SELECT/INSERT/UPDATE/DELETE)
```

### App React Native
- [ ] No hardcodear credentials (usar `.env` con `EXPO_PUBLIC_*`)
- [ ] Certificado SSL pinning para llamadas a Supabase
- [ ] Biometric lock para abrir la app (sensibilidad de datos médicos)
- [ ] Session timeout: cerrar sesión automáticamente tras 30min inactividad
- [ ] No hacer cache de imágenes de fórmulas médicas en disco local

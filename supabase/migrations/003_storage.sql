-- ============================================================
-- Family Health Tracker — Supabase Storage
-- Migration: 003_storage.sql
-- Configuración de buckets y políticas de Storage
-- ============================================================

-- ============================================================
-- BUCKETS
-- ============================================================

-- Bucket para documentos médicos (fórmulas, resultados, etc.)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'medical-documents',
    'medical-documents',
    FALSE,    -- PRIVADO: nunca público
    10485760, -- 10 MB máximo por archivo
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
);

-- Bucket para avatares de familiares y perfiles
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'avatars',
    'avatars',
    TRUE,     -- Público: solo imágenes de perfil sin datos médicos
    2097152,  -- 2 MB máximo
    ARRAY['image/jpeg', 'image/png', 'image/webp']
);

-- ============================================================
-- ESTRATEGIA DE PATHS EN STORAGE
--
-- medical-documents/{tenant_id}/{family_member_id}/{document_id}/{filename}
-- avatars/{user_id}/{filename}
-- avatars/members/{family_member_id}/{filename}
--
-- El tenant_id en el path es el primer nivel de seguridad.
-- La policy RLS valida que el usuario pertenezca al tenant
-- antes de permitir cualquier operación.
-- ============================================================

-- ============================================================
-- POLICIES: medical-documents bucket (PRIVADO)
-- ============================================================

-- SELECT: solo miembros del tenant pueden ver documentos
CREATE POLICY "medical_documents_storage_select"
ON storage.objects FOR SELECT TO authenticated
USING (
    bucket_id = 'medical-documents'
    AND user_belongs_to_tenant(
        -- extraer tenant_id del path: {tenant_id}/...
        (string_to_array(name, '/'))[1]::UUID
    )
);

-- INSERT: miembros del tenant pueden subir al path de su tenant
CREATE POLICY "medical_documents_storage_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'medical-documents'
    AND user_belongs_to_tenant(
        (string_to_array(name, '/'))[1]::UUID
    )
    -- el path debe tener al menos 4 segmentos: tenant/member/doc/file
    AND array_length(string_to_array(name, '/'), 1) >= 4
);

-- UPDATE: miembros del tenant pueden actualizar sus documentos
CREATE POLICY "medical_documents_storage_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
    bucket_id = 'medical-documents'
    AND user_belongs_to_tenant(
        (string_to_array(name, '/'))[1]::UUID
    )
);

-- DELETE: solo admins pueden eliminar documentos médicos
CREATE POLICY "medical_documents_storage_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'medical-documents'
    AND is_tenant_admin(
        (string_to_array(name, '/'))[1]::UUID
    )
);

-- ============================================================
-- POLICIES: avatars bucket (PÚBLICO para lectura)
-- ============================================================

-- SELECT: público (el bucket es público para imágenes de perfil)
CREATE POLICY "avatars_storage_select"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'avatars');

-- INSERT: usuarios autenticados pueden subir su propio avatar
CREATE POLICY "avatars_storage_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'avatars'
    AND (
        -- avatar de usuario: avatars/{user_id}/...
        (string_to_array(name, '/'))[1] = auth.uid()::TEXT
        -- avatar de familiar: avatars/members/{member_id}/...
        OR (string_to_array(name, '/'))[1] = 'members'
    )
);

-- UPDATE: solo el propio usuario
CREATE POLICY "avatars_storage_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
    bucket_id = 'avatars'
    AND (string_to_array(name, '/'))[1] = auth.uid()::TEXT
);

-- DELETE: solo el propio usuario
CREATE POLICY "avatars_storage_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
    bucket_id = 'avatars'
    AND (string_to_array(name, '/'))[1] = auth.uid()::TEXT
);

-- ============================================================
-- NOTAS DE SEGURIDAD PARA STORAGE
-- ============================================================
-- 1. El bucket medical-documents es PRIVADO. Las URLs firmadas
--    (createSignedUrl) expiran en máximo 3600 segundos (1h).
--    Nunca usar getPublicUrl() en documentos médicos.
--
-- 2. Para mostrar fórmulas o documentos en la app:
--    const { data } = await supabase.storage
--      .from('medical-documents')
--      .createSignedUrl(path, 3600); // 1 hora
--
-- 3. El path incluye tenant_id como primera parte, lo que hace
--    que incluso si alguien adivina un path, la policy RLS
--    del bucket lo bloquea si no pertenece al tenant.
--
-- 4. CORS: configurar en Supabase Dashboard para solo permitir
--    el dominio/origen de la app.
--
-- 5. Considerar cifrado at-rest adicional para fórmulas médicas
--    usando pgcrypto si los datos son especialmente sensibles.

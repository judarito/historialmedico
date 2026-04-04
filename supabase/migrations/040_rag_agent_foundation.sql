-- ============================================================
-- 040 — Fundacion RAG para agente de historial medico
--
-- Nota:
-- DeepSeek no expone embeddings oficiales en la API documentada
-- usada hoy por este proyecto. Este MVP deja la capa vectorial en
-- pgvector y permite poblarla con embeddings ligeros generados en
-- el backend, combinados con FTS y filtros estructurados.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.rag_chunks (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chunk_key         TEXT NOT NULL UNIQUE,
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  family_id         UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  family_member_id  UUID NULL REFERENCES public.family_members(id) ON DELETE CASCADE,
  visit_id          UUID NULL REFERENCES public.medical_visits(id) ON DELETE CASCADE,
  source_type       TEXT NOT NULL,
  source_table      TEXT NOT NULL,
  source_record_id  UUID NOT NULL,
  title             TEXT NOT NULL,
  content           TEXT NOT NULL,
  content_tsv       TSVECTOR,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding         extensions.vector(256),
  embedding_version TEXT NOT NULL DEFAULT 'hash-v1',
  source_updated_at TIMESTAMPTZ NULL,
  is_deleted        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_tenant_member_visit
  ON public.rag_chunks(tenant_id, family_member_id, visit_id, is_deleted);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_source_lookup
  ON public.rag_chunks(source_table, source_record_id);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_content_tsv
  ON public.rag_chunks USING GIN(content_tsv);

CREATE TABLE IF NOT EXISTS public.rag_reindex_queue (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  family_id         UUID NULL REFERENCES public.families(id) ON DELETE CASCADE,
  family_member_id  UUID NULL REFERENCES public.family_members(id) ON DELETE SET NULL,
  visit_id          UUID NULL REFERENCES public.medical_visits(id) ON DELETE SET NULL,
  source_table      TEXT NOT NULL,
  source_record_id  UUID NOT NULL,
  operation         TEXT NOT NULL DEFAULT 'upsert'
                    CHECK (operation IN ('upsert', 'delete')),
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed', 'error')),
  attempts          INTEGER NOT NULL DEFAULT 0,
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  available_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at         TIMESTAMPTZ NULL,
  last_processed_at TIMESTAMPTZ NULL,
  last_error        TEXT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_table, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_rag_reindex_queue_status
  ON public.rag_reindex_queue(status, available_at, tenant_id);

CREATE TABLE IF NOT EXISTS public.rag_queries_log (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  family_member_id   UUID NULL REFERENCES public.family_members(id) ON DELETE SET NULL,
  question           TEXT NOT NULL,
  detected_intent    TEXT NULL,
  detected_member    TEXT NULL,
  chunk_ids          UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  visit_ids          UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  warnings           JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence         NUMERIC(4,3) NULL,
  latency_ms         INTEGER NULL,
  status             TEXT NOT NULL DEFAULT 'ok'
                     CHECK (status IN ('ok', 'error')),
  error_code         TEXT NULL,
  answer_preview     TEXT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rag_queries_log_tenant_created
  ON public.rag_queries_log(tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.update_rag_chunk_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.content_tsv :=
    setweight(to_tsvector('spanish', public.unaccent(COALESCE(NEW.title, ''))), 'A') ||
    setweight(to_tsvector('spanish', public.unaccent(COALESCE(NEW.content, ''))), 'B');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rag_chunks_search_vector ON public.rag_chunks;
CREATE TRIGGER trg_rag_chunks_search_vector
BEFORE INSERT OR UPDATE OF title, content
ON public.rag_chunks
FOR EACH ROW
EXECUTE FUNCTION public.update_rag_chunk_search_vector();

DROP TRIGGER IF EXISTS trg_rag_chunks_updated_at ON public.rag_chunks;
CREATE TRIGGER trg_rag_chunks_updated_at
BEFORE UPDATE ON public.rag_chunks
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_rag_reindex_queue_updated_at ON public.rag_reindex_queue;
CREATE TRIGGER trg_rag_reindex_queue_updated_at
BEFORE UPDATE ON public.rag_reindex_queue
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_rag_queries_log_updated_at ON public.rag_queries_log;
CREATE TRIGGER trg_rag_queries_log_updated_at
BEFORE UPDATE ON public.rag_queries_log
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.enqueue_rag_reindex_job(
  p_tenant_id UUID,
  p_family_id UUID,
  p_family_member_id UUID,
  p_visit_id UUID,
  p_source_table TEXT,
  p_source_record_id UUID,
  p_operation TEXT DEFAULT 'upsert',
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID AS $$
BEGIN
  IF p_tenant_id IS NULL OR p_source_record_id IS NULL OR p_source_table IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.rag_reindex_queue (
    tenant_id,
    family_id,
    family_member_id,
    visit_id,
    source_table,
    source_record_id,
    operation,
    status,
    attempts,
    payload,
    available_at,
    locked_at,
    last_error
  )
  VALUES (
    p_tenant_id,
    p_family_id,
    p_family_member_id,
    p_visit_id,
    p_source_table,
    p_source_record_id,
    CASE WHEN p_operation = 'delete' THEN 'delete' ELSE 'upsert' END,
    'pending',
    0,
    COALESCE(p_payload, '{}'::jsonb),
    NOW(),
    NULL,
    NULL
  )
  ON CONFLICT (source_table, source_record_id)
  DO UPDATE SET
    tenant_id        = EXCLUDED.tenant_id,
    family_id        = COALESCE(EXCLUDED.family_id, public.rag_reindex_queue.family_id),
    family_member_id = COALESCE(EXCLUDED.family_member_id, public.rag_reindex_queue.family_member_id),
    visit_id         = COALESCE(EXCLUDED.visit_id, public.rag_reindex_queue.visit_id),
    operation        = EXCLUDED.operation,
    status           = 'pending',
    attempts         = 0,
    payload          = EXCLUDED.payload,
    available_at     = NOW(),
    locked_at        = NULL,
    last_error       = NULL,
    updated_at       = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.enqueue_rag_source_change()
RETURNS TRIGGER AS $$
DECLARE
  v_row              JSONB;
  v_source_record_id UUID;
  v_tenant_id        UUID;
  v_family_id        UUID;
  v_family_member_id UUID;
  v_visit_id         UUID;
BEGIN
  v_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;

  v_source_record_id := NULLIF(v_row->>'id', '')::UUID;
  v_tenant_id        := NULLIF(v_row->>'tenant_id', '')::UUID;
  v_family_id        := NULLIF(v_row->>'family_id', '')::UUID;
  v_family_member_id := NULLIF(v_row->>'family_member_id', '')::UUID;
  v_visit_id         := NULLIF(v_row->>'medical_visit_id', '')::UUID;

  IF TG_TABLE_NAME = 'medical_visits' THEN
    v_visit_id := v_source_record_id;
  END IF;

  PERFORM public.enqueue_rag_reindex_job(
    v_tenant_id,
    v_family_id,
    v_family_member_id,
    v_visit_id,
    TG_TABLE_NAME,
    v_source_record_id,
    CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
    jsonb_build_object(
      'trigger_operation', TG_OP,
      'source_updated_at', COALESCE(v_row->>'updated_at', v_row->>'created_at')
    )
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_rag_family_members_queue ON public.family_members;
CREATE TRIGGER trg_rag_family_members_queue
AFTER INSERT OR UPDATE OR DELETE
ON public.family_members
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_rag_source_change();

DROP TRIGGER IF EXISTS trg_rag_medical_visits_queue ON public.medical_visits;
CREATE TRIGGER trg_rag_medical_visits_queue
AFTER INSERT OR UPDATE OR DELETE
ON public.medical_visits
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_rag_source_change();

DROP TRIGGER IF EXISTS trg_rag_medical_documents_queue ON public.medical_documents;
CREATE TRIGGER trg_rag_medical_documents_queue
AFTER INSERT OR UPDATE OR DELETE
ON public.medical_documents
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_rag_source_change();

DROP TRIGGER IF EXISTS trg_rag_prescriptions_queue ON public.prescriptions;
CREATE TRIGGER trg_rag_prescriptions_queue
AFTER INSERT OR UPDATE OR DELETE
ON public.prescriptions
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_rag_source_change();

DROP TRIGGER IF EXISTS trg_rag_medication_schedules_queue ON public.medication_schedules;
CREATE TRIGGER trg_rag_medication_schedules_queue
AFTER INSERT OR UPDATE OR DELETE
ON public.medication_schedules
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_rag_source_change();

DROP TRIGGER IF EXISTS trg_rag_medical_tests_queue ON public.medical_tests;
CREATE TRIGGER trg_rag_medical_tests_queue
AFTER INSERT OR UPDATE OR DELETE
ON public.medical_tests
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_rag_source_change();

CREATE OR REPLACE FUNCTION public.delete_rag_chunks_for_source(
  p_source_table TEXT,
  p_source_record_id UUID
)
RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER := 0;
BEGIN
  DELETE FROM public.rag_chunks
  WHERE source_table = p_source_table
    AND source_record_id = p_source_record_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.upsert_rag_chunk(
  p_chunk_key TEXT,
  p_tenant_id UUID,
  p_family_id UUID,
  p_family_member_id UUID,
  p_visit_id UUID,
  p_source_type TEXT,
  p_source_table TEXT,
  p_source_record_id UUID,
  p_title TEXT,
  p_content TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_embedding_text TEXT DEFAULT NULL,
  p_source_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_is_deleted BOOLEAN DEFAULT FALSE
)
RETURNS UUID AS $$
DECLARE
  v_chunk_id UUID;
BEGIN
  INSERT INTO public.rag_chunks (
    chunk_key,
    tenant_id,
    family_id,
    family_member_id,
    visit_id,
    source_type,
    source_table,
    source_record_id,
    title,
    content,
    metadata,
    embedding,
    source_updated_at,
    is_deleted
  )
  VALUES (
    p_chunk_key,
    p_tenant_id,
    p_family_id,
    p_family_member_id,
    p_visit_id,
    p_source_type,
    p_source_table,
    p_source_record_id,
    p_title,
    p_content,
    COALESCE(p_metadata, '{}'::jsonb),
    CASE
      WHEN p_embedding_text IS NULL OR btrim(p_embedding_text) = '' THEN NULL
      ELSE p_embedding_text::extensions.vector(256)
    END,
    p_source_updated_at,
    COALESCE(p_is_deleted, FALSE)
  )
  ON CONFLICT (chunk_key)
  DO UPDATE SET
    tenant_id         = EXCLUDED.tenant_id,
    family_id         = EXCLUDED.family_id,
    family_member_id  = EXCLUDED.family_member_id,
    visit_id          = EXCLUDED.visit_id,
    source_type       = EXCLUDED.source_type,
    source_table      = EXCLUDED.source_table,
    source_record_id  = EXCLUDED.source_record_id,
    title             = EXCLUDED.title,
    content           = EXCLUDED.content,
    metadata          = EXCLUDED.metadata,
    embedding         = EXCLUDED.embedding,
    source_updated_at = EXCLUDED.source_updated_at,
    is_deleted        = EXCLUDED.is_deleted,
    updated_at        = NOW()
  RETURNING id INTO v_chunk_id;

  RETURN v_chunk_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.match_rag_chunks(
  p_query TEXT,
  p_query_embedding_text TEXT,
  p_family_member_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 12
)
RETURNS TABLE (
  id UUID,
  source_type TEXT,
  source_table TEXT,
  source_record_id UUID,
  family_member_id UUID,
  visit_id UUID,
  title TEXT,
  content TEXT,
  metadata JSONB,
  lexical_rank REAL,
  vector_distance REAL,
  score REAL
) AS $$
DECLARE
  v_tenant_id UUID;
  v_query_embedding extensions.vector(256);
  v_tsquery TSQUERY;
  v_trimmed_query TEXT := btrim(COALESCE(p_query, ''));
BEGIN
  SELECT tenant_id
  INTO v_tenant_id
  FROM public.tenant_users
  WHERE user_id = auth.uid()
    AND is_active = TRUE
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuario sin tenant asignado';
  END IF;

  IF v_trimmed_query <> '' THEN
    v_tsquery := websearch_to_tsquery('spanish', public.unaccent(v_trimmed_query));
  END IF;

  IF p_query_embedding_text IS NOT NULL AND btrim(p_query_embedding_text) <> '' THEN
    v_query_embedding := p_query_embedding_text::extensions.vector(256);
  END IF;

  RETURN QUERY
  WITH ranked AS (
    SELECT
      rc.id,
      rc.source_type,
      rc.source_table,
      rc.source_record_id,
      rc.family_member_id,
      rc.visit_id,
      rc.title,
      rc.content,
      rc.metadata,
      CASE
        WHEN v_tsquery IS NULL THEN 0::REAL
        ELSE ts_rank_cd(rc.content_tsv, v_tsquery)::REAL
      END AS lexical_rank,
      CASE
        WHEN v_query_embedding IS NULL OR rc.embedding IS NULL THEN NULL
        ELSE (rc.embedding <=> v_query_embedding)::REAL
      END AS vector_distance,
      (
        CASE
          WHEN v_tsquery IS NULL THEN 0::REAL
          ELSE (ts_rank_cd(rc.content_tsv, v_tsquery)::REAL * 0.68)
        END
        +
        CASE
          WHEN v_query_embedding IS NULL OR rc.embedding IS NULL THEN 0::REAL
          ELSE (GREATEST(0::REAL, 1 - (rc.embedding <=> v_query_embedding)::REAL) * 0.32)
        END
        +
        CASE
          WHEN p_family_member_id IS NOT NULL AND rc.family_member_id = p_family_member_id THEN 0.08::REAL
          ELSE 0::REAL
        END
        +
        CASE
          WHEN rc.visit_id IS NOT NULL THEN 0.03::REAL
          ELSE 0::REAL
        END
      ) AS score
    FROM public.rag_chunks rc
    WHERE rc.tenant_id = v_tenant_id
      AND rc.is_deleted = FALSE
      AND (p_family_member_id IS NULL OR rc.family_member_id = p_family_member_id)
      AND (
        (v_tsquery IS NOT NULL AND rc.content_tsv @@ v_tsquery)
        OR (v_query_embedding IS NOT NULL AND rc.embedding IS NOT NULL)
      )
  )
  SELECT
    ranked.id,
    ranked.source_type,
    ranked.source_table,
    ranked.source_record_id,
    ranked.family_member_id,
    ranked.visit_id,
    ranked.title,
    ranked.content,
    ranked.metadata,
    ranked.lexical_rank,
    ranked.vector_distance,
    ranked.score
  FROM ranked
  ORDER BY ranked.score DESC, ranked.vector_distance ASC NULLS LAST
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 12), 20));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

ALTER TABLE public.rag_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rag_reindex_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rag_queries_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rag_chunks_select ON public.rag_chunks;
CREATE POLICY rag_chunks_select
  ON public.rag_chunks
  FOR SELECT
  TO authenticated
  USING (public.user_belongs_to_tenant(tenant_id));

GRANT SELECT ON public.rag_chunks TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_rag_chunks(TEXT, TEXT, UUID, INTEGER) TO authenticated;

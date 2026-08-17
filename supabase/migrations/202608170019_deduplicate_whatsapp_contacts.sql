-- Consolida contatos que representam o mesmo telefone, mas foram gravados em
-- formatos diferentes (por exemplo `5562...` e `whatsapp:+5562...`).
--
-- A falha criava um contact_id para a conversa iniciada pelo painel e outro para
-- a resposta recebida pelo WhatsApp. Como o bloqueio de concorrência usa
-- contact_id, os dois registros podiam manter chamados abertos ao mesmo tempo.
--
-- A migração preserva o chamado aberto mais antigo, move para ele as mensagens
-- dos chamados duplicados e encerra os protocolos redundantes com uma razão
-- auditável. Conversas históricas continuam existindo e passam a apontar para o
-- contato consolidado.
BEGIN;

DO $$
DECLARE
  duplicate_group RECORD;
  keeper_contact_id TEXT;
  keeper_conversation_id TEXT;
  duplicate_contact_ids TEXT[];
  losing_open_conversation_ids TEXT[];
  canonical_phone TEXT;
BEGIN
  FOR duplicate_group IN
    SELECT organization_id,
           regexp_replace(phone_number, '\D', '', 'g') AS phone_digits
      FROM contacts
     WHERE length(regexp_replace(phone_number, '\D', '', 'g')) BETWEEN 10 AND 15
     GROUP BY organization_id, regexp_replace(phone_number, '\D', '', 'g')
    HAVING COUNT(*) > 1
  LOOP
    canonical_phone := 'whatsapp:+' || duplicate_group.phone_digits;

    -- Evita que um webhook concorrente altere a mesma identidade enquanto a
    -- consolidação está em andamento.
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        duplicate_group.organization_id || ':' || duplicate_group.phone_digits,
        0
      )
    );

    -- Preserva o contato dono do chamado aberto original. Sem chamado aberto,
    -- prefere o formato canônico e, depois, o contato mais antigo.
    SELECT contact.id
      INTO keeper_contact_id
      FROM contacts AS contact
      LEFT JOIN LATERAL (
        SELECT MIN(conversation.created_at) AS active_since
          FROM conversations AS conversation
         WHERE conversation.organization_id = contact.organization_id
           AND conversation.contact_id = contact.id
           AND conversation.status IN (
             'aguardando',
             'em_atendimento',
             'pendente_cliente'
           )
      ) AS active ON true
     WHERE contact.organization_id = duplicate_group.organization_id
       AND regexp_replace(contact.phone_number, '\D', '', 'g') =
           duplicate_group.phone_digits
     ORDER BY active.active_since ASC NULLS LAST,
              CASE WHEN contact.phone_number = canonical_phone THEN 0 ELSE 1 END,
              contact.created_at ASC,
              contact.id ASC
     LIMIT 1;

    IF keeper_contact_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Bloqueia todos os contatos do grupo numa ordem estável.
    PERFORM 1
      FROM contacts AS contact
     WHERE contact.organization_id = duplicate_group.organization_id
       AND regexp_replace(contact.phone_number, '\D', '', 'g') =
           duplicate_group.phone_digits
     ORDER BY contact.id
     FOR UPDATE;

    SELECT COALESCE(array_agg(contact.id ORDER BY contact.created_at, contact.id), ARRAY[]::TEXT[])
      INTO duplicate_contact_ids
      FROM contacts AS contact
     WHERE contact.organization_id = duplicate_group.organization_id
       AND contact.id <> keeper_contact_id
       AND regexp_replace(contact.phone_number, '\D', '', 'g') =
           duplicate_group.phone_digits;

    IF cardinality(duplicate_contact_ids) = 0 THEN
      CONTINUE;
    END IF;

    SELECT conversation.id
      INTO keeper_conversation_id
      FROM conversations AS conversation
     WHERE conversation.organization_id = duplicate_group.organization_id
       AND conversation.contact_id = ANY(
         array_prepend(keeper_contact_id, duplicate_contact_ids)
       )
       AND conversation.status IN (
         'aguardando',
         'em_atendimento',
         'pendente_cliente'
       )
     ORDER BY conversation.created_at ASC, conversation.id ASC
     LIMIT 1
     FOR UPDATE;

    IF keeper_conversation_id IS NOT NULL THEN
      SELECT COALESCE(array_agg(conversation.id ORDER BY conversation.created_at, conversation.id), ARRAY[]::TEXT[])
        INTO losing_open_conversation_ids
        FROM conversations AS conversation
       WHERE conversation.organization_id = duplicate_group.organization_id
         AND conversation.contact_id = ANY(
           array_prepend(keeper_contact_id, duplicate_contact_ids)
         )
         AND conversation.status IN (
           'aguardando',
           'em_atendimento',
           'pendente_cliente'
         )
         AND conversation.id <> keeper_conversation_id;

      IF cardinality(losing_open_conversation_ids) > 0 THEN
        -- Se o mesmo evento chegou pelos dois caminhos, conserva uma única cópia
        -- antes de juntar os históricos.
        DELETE FROM messages AS duplicate_message
         USING messages AS kept_message
         WHERE duplicate_message.organization_id = duplicate_group.organization_id
           AND duplicate_message.conversation_id = ANY(losing_open_conversation_ids)
           AND duplicate_message.external_id IS NOT NULL
           AND kept_message.organization_id = duplicate_message.organization_id
           AND kept_message.conversation_id = keeper_conversation_id
           AND kept_message.external_id = duplicate_message.external_id;

        -- O ticket original mantém fila, responsável e o primeiro atendimento
        -- mais antigo disponível entre os chamados que serão consolidados.
        UPDATE tickets AS keeper_ticket
           SET queue_id = COALESCE(
                 keeper_ticket.queue_id,
                 (
                   SELECT candidate.queue_id
                     FROM tickets AS candidate
                    WHERE candidate.organization_id = duplicate_group.organization_id
                      AND candidate.conversation_id = ANY(losing_open_conversation_ids)
                      AND candidate.queue_id IS NOT NULL
                    ORDER BY candidate.updated_at DESC, candidate.id
                    LIMIT 1
                 )
               ),
               assignee_id = COALESCE(
                 keeper_ticket.assignee_id,
                 (
                   SELECT candidate.assignee_id
                     FROM tickets AS candidate
                    WHERE candidate.organization_id = duplicate_group.organization_id
                      AND candidate.conversation_id = ANY(losing_open_conversation_ids)
                      AND candidate.assignee_id IS NOT NULL
                    ORDER BY candidate.updated_at DESC, candidate.id
                    LIMIT 1
                 )
               ),
               first_response_at = COALESCE(
                 (
                   SELECT MIN(candidate.first_response_at)
                     FROM tickets AS candidate
                    WHERE candidate.organization_id = duplicate_group.organization_id
                      AND candidate.conversation_id = ANY(
                        array_prepend(
                          keeper_conversation_id,
                          losing_open_conversation_ids
                        )
                      )
                 ),
                 keeper_ticket.first_response_at
               ),
               first_response_due_at = COALESCE(
                 (
                   SELECT MIN(candidate.first_response_due_at)
                     FROM tickets AS candidate
                    WHERE candidate.organization_id = duplicate_group.organization_id
                      AND candidate.conversation_id = ANY(
                        array_prepend(
                          keeper_conversation_id,
                          losing_open_conversation_ids
                        )
                      )
                 ),
                 keeper_ticket.first_response_due_at
               ),
               updated_at = now()
         WHERE keeper_ticket.organization_id = duplicate_group.organization_id
           AND keeper_ticket.conversation_id = keeper_conversation_id;

        -- Une as mensagens no chamado original sem alterar a ordem temporal.
        UPDATE messages
           SET conversation_id = keeper_conversation_id
         WHERE organization_id = duplicate_group.organization_id
           AND conversation_id = ANY(losing_open_conversation_ids);

        UPDATE orders
           SET conversation_id = keeper_conversation_id,
               updated_at = now()
         WHERE organization_id = duplicate_group.organization_id
           AND conversation_id = ANY(losing_open_conversation_ids);

        UPDATE conversations AS keeper
           SET status = CASE
                 WHEN EXISTS (
                   SELECT 1
                     FROM conversations AS candidate
                    WHERE candidate.organization_id = duplicate_group.organization_id
                      AND candidate.id = ANY(
                        array_prepend(
                          keeper_conversation_id,
                          losing_open_conversation_ids
                        )
                      )
                      AND candidate.status = 'em_atendimento'
                 ) THEN 'em_atendimento'::conversation_status
                 WHEN EXISTS (
                   SELECT 1
                     FROM conversations AS candidate
                    WHERE candidate.organization_id = duplicate_group.organization_id
                      AND candidate.id = ANY(
                        array_prepend(
                          keeper_conversation_id,
                          losing_open_conversation_ids
                        )
                      )
                      AND candidate.status = 'pendente_cliente'
                 ) THEN 'pendente_cliente'::conversation_status
                 ELSE 'aguardando'::conversation_status
               END,
               queue_id = COALESCE(
                 keeper.queue_id,
                 (
                   SELECT candidate.queue_id
                     FROM conversations AS candidate
                    WHERE candidate.organization_id = duplicate_group.organization_id
                      AND candidate.id = ANY(losing_open_conversation_ids)
                      AND candidate.queue_id IS NOT NULL
                    ORDER BY candidate.updated_at DESC, candidate.id
                    LIMIT 1
                 )
               ),
               triage_completed = (
                 SELECT BOOL_OR(candidate.triage_completed)
                   FROM conversations AS candidate
                  WHERE candidate.organization_id = duplicate_group.organization_id
                    AND candidate.id = ANY(
                      array_prepend(
                        keeper_conversation_id,
                        losing_open_conversation_ids
                      )
                    )
               ),
               menu_attempts = (
                 SELECT MAX(candidate.menu_attempts)
                   FROM conversations AS candidate
                  WHERE candidate.organization_id = duplicate_group.organization_id
                    AND candidate.id = ANY(
                      array_prepend(
                        keeper_conversation_id,
                        losing_open_conversation_ids
                      )
                    )
               ),
               updated_at = (
                 SELECT MAX(candidate.updated_at)
                   FROM conversations AS candidate
                  WHERE candidate.organization_id = duplicate_group.organization_id
                    AND candidate.id = ANY(
                      array_prepend(
                        keeper_conversation_id,
                        losing_open_conversation_ids
                      )
                    )
               ),
               contact_phone = canonical_phone
         WHERE keeper.organization_id = duplicate_group.organization_id
           AND keeper.id = keeper_conversation_id;

        UPDATE conversations
           SET status = 'encerrado',
               closed_at = COALESCE(closed_at, now()),
               updated_at = now()
         WHERE organization_id = duplicate_group.organization_id
           AND id = ANY(losing_open_conversation_ids);

        UPDATE tickets
           SET close_reason =
                 'Chamado duplicado consolidado automaticamente em #' ||
                 upper(left(keeper_conversation_id, 8)),
               closed_at = COALESCE(closed_at, now()),
               updated_at = now()
         WHERE organization_id = duplicate_group.organization_id
           AND conversation_id = ANY(losing_open_conversation_ids);
      END IF;
    END IF;

    -- Mantém dados operacionais relevantes antes de remover os contatos legados.
    UPDATE contacts AS keeper
       SET name = CASE
             WHEN lower(trim(keeper.name)) IN ('', 'contato', 'cliente') THEN
               COALESCE(
                 (
                   SELECT candidate.name
                     FROM contacts AS candidate
                    WHERE candidate.organization_id = duplicate_group.organization_id
                      AND candidate.id = ANY(duplicate_contact_ids)
                      AND lower(trim(candidate.name)) NOT IN ('', 'contato', 'cliente')
                    ORDER BY candidate.updated_at DESC, candidate.id
                    LIMIT 1
                 ),
                 keeper.name
               )
             ELSE keeper.name
           END,
           avatar_url = COALESCE(
             keeper.avatar_url,
             (
               SELECT candidate.avatar_url
                 FROM contacts AS candidate
                WHERE candidate.organization_id = duplicate_group.organization_id
                  AND candidate.id = ANY(duplicate_contact_ids)
                  AND candidate.avatar_url IS NOT NULL
                ORDER BY candidate.updated_at DESC, candidate.id
                LIMIT 1
             )
           ),
           internal_note = COALESCE(
             keeper.internal_note,
             (
               SELECT candidate.internal_note
                 FROM contacts AS candidate
                WHERE candidate.organization_id = duplicate_group.organization_id
                  AND candidate.id = ANY(duplicate_contact_ids)
                  AND candidate.internal_note IS NOT NULL
                ORDER BY candidate.updated_at DESC, candidate.id
                LIMIT 1
             )
           ),
           blocked = keeper.blocked OR EXISTS (
             SELECT 1
               FROM contacts AS candidate
              WHERE candidate.organization_id = duplicate_group.organization_id
                AND candidate.id = ANY(duplicate_contact_ids)
                AND candidate.blocked
           ),
           origin = CASE
             WHEN keeper.origin IS DISTINCT FROM 'whatsapp_import'
               OR EXISTS (
                 SELECT 1
                   FROM contacts AS candidate
                  WHERE candidate.organization_id = duplicate_group.organization_id
                    AND candidate.id = ANY(duplicate_contact_ids)
                    AND candidate.origin IS DISTINCT FROM 'whatsapp_import'
               )
             THEN NULL
             ELSE 'whatsapp_import'
           END,
           updated_at = now()
     WHERE keeper.organization_id = duplicate_group.organization_id
       AND keeper.id = keeper_contact_id;

    UPDATE conversations
       SET contact_id = keeper_contact_id,
           contact_phone = canonical_phone
     WHERE organization_id = duplicate_group.organization_id
       AND contact_id = ANY(duplicate_contact_ids);

    UPDATE orders
       SET contact_id = keeper_contact_id,
           updated_at = now()
     WHERE organization_id = duplicate_group.organization_id
       AND contact_id = ANY(duplicate_contact_ids);

    DELETE FROM contacts
     WHERE organization_id = duplicate_group.organization_id
       AND id = ANY(duplicate_contact_ids);

    UPDATE contacts
       SET phone_number = canonical_phone,
           updated_at = now()
     WHERE organization_id = duplicate_group.organization_id
       AND id = keeper_contact_id;
  END LOOP;
END
$$;

-- A regra passa a existir também no banco: prefixos diferentes não podem gerar
-- novamente dois contact_id para a mesma sequência de dígitos.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_org_phone_digits
  ON contacts (
    organization_id,
    (regexp_replace(phone_number, '\D', '', 'g'))
  )
  WHERE length(regexp_replace(phone_number, '\D', '', 'g')) BETWEEN 10 AND 15;

COMMIT;

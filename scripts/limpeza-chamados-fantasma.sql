-- ============================================================================
-- Limpeza dos chamados fantasma criados pelo eco das mensagens de encerramento
--
-- POR QUE ESTE ARQUIVO NAO E UMA MIGRATION
-- A correcao de codigo impede que novos fantasmas nascam, mas nao apaga os que
-- ja estao no banco. Limpar isso e uma decisao operacional sobre dados de
-- cliente, tomada uma vez, olhando o resultado antes — nao algo que deva rodar
-- sozinho a cada deploy. Por isso fica em scripts/ e nao em supabase/migrations/.
--
-- O QUE E UM FANTASMA AQUI
-- Uma conversa aberta que existe apenas para hospedar a despedida do proprio
-- sistema: nasceu do eco do aviso de encerramento (ou do agradecimento pela
-- avaliacao), nunca recebeu mensagem do cliente e nunca foi respondida por uma
-- pessoa.
--
-- Os tres criterios juntos sao o que torna a identificacao segura:
--   1. nenhuma mensagem `inbound`  -> o cliente nunca escreveu nesse chamado;
--   2. so mensagens `outbound` que casam com os textos de despedida;
--   3. pelo menos uma mensagem     -> conversa vazia e outro fenomeno, nao mexer.
--
-- COMO USAR
--   1. Rode o bloco 1 (SELECT) e confira o resultado.
--   2. Rode o bloco 2 (conferencia por amostragem) em alguns ids da lista.
--   3. So entao rode o bloco 3 (UPDATE), dentro da transacao, e confira o
--      numero de linhas antes do COMMIT.
--
-- Faca backup do Supabase antes do bloco 3.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- BLOCO 1 - DIAGNOSTICO (somente leitura)
-- Lista os candidatos. Rode primeiro e leia o resultado.
-- ---------------------------------------------------------------------------
WITH candidatas AS (
  SELECT
    c.id,
    c.organization_id,
    c.contact_id,
    c.status,
    c.created_at,
    count(m.id)                                        AS total_mensagens,
    count(*) FILTER (WHERE m.direction = 'inbound')     AS recebidas,
    count(*) FILTER (WHERE m.direction = 'outbound')    AS enviadas,
    count(*) FILTER (
      WHERE m.direction = 'outbound'
        AND (
          m.content LIKE 'Seu atendimento com%foi finalizado%'
          OR m.content LIKE 'Obrigado pela sua avaliação!%'
        )
    )                                                   AS despedidas
  FROM conversations c
  JOIN messages m
    ON m.conversation_id = c.id
   AND m.organization_id = c.organization_id
  WHERE c.status <> 'encerrado'
  GROUP BY c.id, c.organization_id, c.contact_id, c.status, c.created_at
)
SELECT
  candidatas.*,
  ct.name  AS contato,
  ct.phone_number AS telefone
FROM candidatas
JOIN contacts ct ON ct.id = candidatas.contact_id
WHERE recebidas = 0            -- o cliente nunca escreveu aqui
  AND total_mensagens > 0      -- conversa vazia e outro caso
  AND enviadas = despedidas    -- tudo que existe e despedida do sistema
ORDER BY created_at DESC;


-- ---------------------------------------------------------------------------
-- BLOCO 2 - CONFERENCIA POR AMOSTRAGEM (somente leitura)
-- Troque o id por um da lista acima e confirme que so ha a despedida.
-- ---------------------------------------------------------------------------
-- SELECT direction, content, created_at
--   FROM messages
--  WHERE conversation_id = 'COLE_UM_ID_DO_BLOCO_1'
--  ORDER BY created_at;


-- ---------------------------------------------------------------------------
-- BLOCO 3 - CORRECAO (escreve)
--
-- Encerra os fantasmas com motivo auditavel, em vez de apagar: o historico da
-- despedida continua existindo e fica claro depois por que aquele registro foi
-- fechado. Apagar destruiria a evidencia do proprio defeito.
--
-- Rode dentro da transacao, confira o numero de linhas e so entao COMMIT.
-- ---------------------------------------------------------------------------
-- BEGIN;
--
-- -- O conjunto e materializado uma vez e reaproveitado pelos dois UPDATEs. Repetir
-- -- a CTE em cada comando abriria espaco para os dois atingirem conjuntos
-- -- diferentes, e o ticket acabaria fechado sem a conversa correspondente.
-- CREATE TEMP TABLE fantasmas ON COMMIT DROP AS
--   SELECT c.id
--     FROM conversations c
--     JOIN messages m
--       ON m.conversation_id = c.id
--      AND m.organization_id = c.organization_id
--    WHERE c.status <> 'encerrado'
--    GROUP BY c.id
--   HAVING count(*) FILTER (WHERE m.direction = 'inbound') = 0
--      AND count(m.id) > 0
--      AND count(*) FILTER (WHERE m.direction = 'outbound')
--        = count(*) FILTER (
--            WHERE m.direction = 'outbound'
--              AND (
--                m.content LIKE 'Seu atendimento com%foi finalizado%'
--                OR m.content LIKE 'Obrigado pela sua avaliação!%'
--              )
--          );
--
-- -- Confira que o numero bate com o do BLOCO 1 antes de seguir.
-- SELECT count(*) AS fantasmas_encontrados FROM fantasmas;
--
-- UPDATE conversations
--    SET status = 'encerrado',
--        closed_at = COALESCE(closed_at, now()),
--        updated_at = now()
--  WHERE id IN (SELECT id FROM fantasmas);
--
-- UPDATE tickets
--    SET close_reason = COALESCE(close_reason, 'limpeza: chamado criado pelo eco da mensagem de encerramento'),
--        closed_at = COALESCE(closed_at, now()),
--        updated_at = now()
--  WHERE conversation_id IN (SELECT id FROM fantasmas);
--
-- -- Confira a contagem antes de confirmar.
-- -- COMMIT;
-- -- ROLLBACK;

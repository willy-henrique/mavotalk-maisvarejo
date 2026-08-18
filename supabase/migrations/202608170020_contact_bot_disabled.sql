-- Permite silenciar somente as respostas automáticas para um contato.
-- Diferente de `blocked`, as mensagens recebidas continuam entrando no Inbox e
-- os atendentes ainda podem responder manualmente.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS bot_disabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN contacts.bot_disabled IS
  'Quando true, impede respostas automáticas sem bloquear mensagens ou atendimento humano.';

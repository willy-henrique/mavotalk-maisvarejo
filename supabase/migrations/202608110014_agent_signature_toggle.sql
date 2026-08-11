-- A assinatura do atendente ("Nome:" antes da mensagem) era fixa no código.
-- Passa a ser configurável por organização, mantendo o comportamento atual como padrão.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS agent_signature_enabled BOOLEAN NOT NULL DEFAULT TRUE;

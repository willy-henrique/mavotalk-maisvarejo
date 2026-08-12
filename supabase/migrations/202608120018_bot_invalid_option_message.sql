-- Mensagem exibida quando o cliente escolhe algo que nao existe no menu.
-- Antes o bot apenas reenviava o menu com a saudacao, o que parecia recomeco de
-- conversa e nao avisava que a opcao era invalida.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS bot_invalid_option_message TEXT NULL;

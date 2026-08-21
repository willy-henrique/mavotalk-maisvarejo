-- O balão do painel imprimia "Nome do atendente:" em toda mensagem enviada, sem olhar
-- o botão de assinatura do compositor: desligar a assinatura tirava o nome do WhatsApp
-- do cliente, mas o painel continuava mostrando. Cada mensagem passa a guardar se foi
-- assinada, que é o que o painel precisa para repetir exatamente o que o cliente viu.
--
-- TRUE como padrão porque assinar era o comportamento fixo até aqui: as mensagens que
-- já existem foram mesmo enviadas com o nome na frente.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS with_signature BOOLEAN NOT NULL DEFAULT TRUE;

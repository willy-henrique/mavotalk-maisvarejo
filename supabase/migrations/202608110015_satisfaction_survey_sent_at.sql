-- Sem saber que a pesquisa foi enviada nao da para distinguir uma nota de 1 a 5 de
-- uma escolha do menu (1, 2 e 3 sao opcoes validas). O carimbo delimita a janela em
-- que uma resposta numerica deve ser lida como avaliacao.
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS satisfaction_survey_sent_at TIMESTAMPTZ NULL;

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderQuickReplyPreview } from '../../frontend/services/quickReplyPreview';

test('prévia de resposta rápida substitui somente as variáveis documentadas', () => {
  const preview = renderQuickReplyPreview(
    '{saudacao}, {primeiro_nome}! {cliente} será atendida por {user} no {ticket}, às {hora} de {data}. {desconhecida}',
    new Date('2026-07-27T15:30:00.000Z'),
  );

  assert.equal(
    preview,
    'Boa tarde, Maria! Maria Silva será atendida por Ana, da equipe Mavo no #1234, às 12:30 de 27/07/2026. {desconhecida}',
  );
});

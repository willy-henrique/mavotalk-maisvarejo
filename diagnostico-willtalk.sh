#!/bin/bash
echo "========================================"
echo "DIAGNÓSTICO WILLTALK - WhatsApp não chega em Aguardando"
echo "========================================"
echo ""
echo "1. VERIFICANDO SERVIDOR WILLTALK..."
echo "----------------------------------------"
ps aux | grep -E "(node|next|willtalk)" | grep -v grep
if [ $? -eq 0 ]; then
    echo "✅ WillTalk está rodando"
else
    echo "❌ WillTalk NÃO está rodando"
    echo "   Execute: cd /mnt/c/willydev/willtalk && npm run dev"
fi
echo ""
echo "2. VERIFICANDO PORTA 4002..."
echo "----------------------------------------"
curl -s http://localhost:4002 > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ Porta 4002 respondendo"
else
    echo "❌ Porta 4002 NÃO respondendo"
fi
echo ""
echo "3. VERIFICANDO CONFIGURAÇÃO .env..."
echo "----------------------------------------"
cd /mnt/c/willydev/willtalk
echo "WHATSAPP_PROVIDER: $(grep WHATSAPP_PROVIDER .env)"
echo "WILLTALK_N8N_ONLY: $(grep WILLTALK_N8N_ONLY .env)"
echo "DB_PROVIDER: $(grep DB_PROVIDER .env)"
echo "PORT: $(grep PORT .env)"
echo ""
echo "4. VERIFICANDO WHATSAPP STATUS..."
echo "----------------------------------------"
curl -s http://localhost:4002/api/whatsapp/status 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "❌ Não foi possível verificar status do WhatsApp"
echo ""
echo "5. VERIFICANDO POSTGRESQL..."
echo "----------------------------------------"
psql -U postgres -h localhost -p 5433 -d willtalk -c "SELECT COUNT(*) FROM conversations;" 2>/dev/null
if [ $? -eq 0 ]; then
    echo "✅ PostgreSQL conectado"
else
    echo "❌ PostgreSQL NÃO conectado"
fi
echo ""
echo "6. VERIFICANDO N8N..."
echo "----------------------------------------"
curl -s http://localhost:5678 > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ n8n respondendo na porta 5678"
else
    echo "⚠️  n8n NÃO respondendo (pode ser normal se não estiver usando)"
fi
echo ""
echo "========================================"
echo "RECOMENDAÇÕES:"
echo "========================================"
echo "1. Inicie o WillTalk: npm run dev"
echo "2. Conecte WhatsApp: http://localhost:4002 → Configurações → WhatsApp"
echo "3. Teste com script: ./teste-rapido-windows.bat"
echo "4. Se usar n8n, inicie e configure workflow"
echo "5. Verifique logs do WillTalk para erros"
echo "========================================"
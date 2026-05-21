# 🐕 GoldDog WhatsApp Agent

Agente de IA para atendimento automático via WhatsApp.
Responde em PT, EN, ES, AR e ZH. Qualifica clientes e gera leads no Supabase.

## Deploy no Railway (5 minutos)

### 1. Suba para o GitHub
- Crie um repositório: `golddog-agent`
- Suba os arquivos `index.js` e `package.json`

### 2. Deploy no Railway
- Acesse: railway.app
- "New Project" → "Deploy from GitHub repo"
- Selecione o repositório `golddog-agent`
- Railway detecta Node.js automaticamente

### 3. Configure as variáveis
- No Railway: Settings → Variables → Add All
- Cole os valores do arquivo `.env.example`

### 4. Copie a URL do servidor
- Railway gera uma URL como: `https://golddog-agent-production.up.railway.app`
- Copie essa URL

### 5. Configure o Webhook no Z-API
- Acesse: app.z-api.io → sua instância
- Webhook → URL: `https://SUA-URL.railway.app/webhook`
- Salva

### Pronto! 🎉
Mande uma mensagem para o WhatsApp conectado e o agente responde automaticamente.

## Testar localmente
```bash
npm install
CLAUDE_API_KEY=sk-ant-... node index.js
```

## Estrutura
- `index.js` — servidor principal + webhook + agente IA
- `package.json` — dependências Node.js
- `.env.example` — template de variáveis de ambiente

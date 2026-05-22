const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const CONFIG = {
  claudeKey:   process.env.CLAUDE_API_KEY    || '',
  zapiId:      process.env.ZAPI_INSTANCE_ID  || '',
  zapiToken:   process.env.ZAPI_TOKEN        || '',
  zapiClient:  process.env.ZAPI_CLIENT_TOKEN || '',
  supabaseUrl: process.env.SUPABASE_URL      || '',
  supabaseKey: process.env.SUPABASE_KEY      || '',
  resendKey:   process.env.RESEND_KEY        || '',
  emailGD:     process.env.EMAIL_GOLDDOG     || 'contato@golddog.com.br',
  cnpj:        process.env.CNPJ_GOLDDOG      || '28.791.224/0001-88',
};

const KNOWLEDGE = `
EMPRESA: GoldDog Industries
Site: golddog.com.br | E-mail: contato@golddog.com.br | País: Brasil (Pernambuco)
Especialidade: Equipamentos para mineração, garimpo e recuperação de ouro fino e extrafino.

PRODUTOS E PREÇOS:

CONCENTRADORAS:
- GD2020: R$2.965 — compacta, até 0,7t/h
- GD3030: R$4.950 — alta eficiência, ouro fino e extrafino, até 1,5t/h
- GD3030S: R$6.940 — com Carpete Âncora incluso
- GD3060X: R$12.795 — extra longa, até 4t/h
- GD4540: R$9.945 — industrial, até 4t/h

TROMMEL — PLANTA DE LAVAGEM:
- GDT05: preço sob consulta — mini trommel portátil
- GDT100: R$47.930 — alto desempenho
- GDT100-B: R$58.700 — versão Basic
- GDT100-R: R$79.400 — Reforçado, ouro fino/extrafino, uso intensivo
- GDT300: R$395.800 — industrial, até 30t/h

CARPETES:
- Carpete Âncora 3090C: R$1.350
- Carpete Âncora Vortex 3090V: R$1.385
- Carpete Âncora Draga 3090D: R$1.565
- GoldMoss 1x1m: R$395 | 30cmx1m: R$165 | 50cmx1m Kit: R$245 | 1x12m Rolo: R$3.960
- Carpete Vinílico Resinado 1x1m: R$295
- Kit GoldMoss 30cm + Resinado + Tela: R$195

PAGAMENTO E ENTREGA:
- À vista, 50% entrada + 50% entrega, parcelado
- Entrega para todo o Brasil, prazo 30-90 dias úteis
- Suporte técnico incluso
`;

const SYSTEM_PROMPT = `Você é o assistente virtual da GoldDog Industries, empresa brasileira especializada em equipamentos de mineração e garimpo de ouro.

Seu nome é GoldDog Assistant.

REGRAS:
- Detecte o idioma do cliente e responda SEMPRE no mesmo idioma (PT, EN, ES, AR, ZH)
- Mensagens curtas e diretas — máximo 3 parágrafos
- Use emojis com moderação (1-2 por mensagem)
- Nunca invente preços — use apenas os do knowledge base
- Quando tiver nome + email + telefone + estado + produto de interesse, responda com JSON:
  {"ACTION":"SAVE_LEAD","nome":"...","email":"...","tel":"...","estado":"...","produto":"...","mensagem":"..."}

FLUXO:
1. Cumprimentar e perguntar sobre a operação
2. Entender necessidades (volume, tipo de ouro, ambiente)
3. Recomendar produto adequado
4. Apresentar preço e condições
5. Coletar dados para orçamento formal

CONHECIMENTO:
${KNOWLEDGE}`;

const sessions = new Map();

function getSession(phone) {
  if (!sessions.has(phone)) {
    sessions.set(phone, { history: [], leadSaved: false, createdAt: Date.now() });
  }
  return sessions.get(phone);
}

setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [phone, session] of sessions) {
    if (session.createdAt < cutoff) sessions.delete(phone);
  }
}, 60 * 60 * 1000);

async function askClaude(history, userMsg) {
  const messages = [...history, { role: 'user', content: userMsg }];
  const resp = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages
  }, {
    headers: {
      'x-api-key': CONFIG.claudeKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    }
  });
  return resp.data.content[0].text;
}

async function sendWpp(phone, message) {
  if (!CONFIG.zapiId || !CONFIG.zapiToken) {
    console.log('[WPP MOCK]', phone, message);
    return;
  }

  const cleanPhone = phone.replace(/\D/g, '');
  const url = `https://api.z-api.io/instances/${CONFIG.zapiId}/token/${CONFIG.zapiToken}/send-text`;

  const headers = { 'Content-Type': 'application/json' };
  if (CONFIG.zapiClient) headers['Client-Token'] = CONFIG.zapiClient;

  console.log('[SENDING TO]', url);
  console.log('[PHONE]', cleanPhone);

  const resp = await axios.post(url, { phone: cleanPhone, message }, { headers });
  console.log('[SEND OK]', resp.data);
}

async function saveLead(data) {
  if (!CONFIG.supabaseUrl) return null;
  const num = `GD-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(Math.floor(Math.random()*999)+1).padStart(3,'0')}`;
  try {
    await axios.post(
      `${CONFIG.supabaseUrl}/rest/v1/orcamentos`,
      {
        numero: num, cliente_nome: data.nome, cliente_email: data.email,
        cliente_tel: data.tel, cliente_estado: data.estado,
        produtos: [{ nome: data.produto }], obs: data.mensagem,
        total: 0, status: 'pendente', enviado_wpp: true
      },
      { headers: { 'apikey': CONFIG.supabaseKey, 'Authorization': `Bearer ${CONFIG.supabaseKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' } }
    );
    console.log('[LEAD SAVED]', data.nome, num);
    return num;
  } catch(e) {
    console.error('[SUPABASE ERROR]', e.message);
    return null;
  }
}

async function notifyEmail(data, numOrc) {
  if (!CONFIG.resendKey) return;
  try {
    await axios.post('https://api.resend.com/emails', {
      from: `GoldDog Industries <${CONFIG.emailGD}>`,
      to: [CONFIG.emailGD],
      subject: `🔔 Novo lead WhatsApp — ${data.nome} | ${numOrc}`,
      html: `<h2>Novo Lead via WhatsApp</h2><p><b>Nome:</b> ${data.nome}</p><p><b>WhatsApp:</b> ${data.tel}</p><p><b>Interesse:</b> ${data.produto}</p><p><b>Nº:</b> ${numOrc}</p>`
    }, { headers: { 'Authorization': `Bearer ${CONFIG.resendKey}`, 'Content-Type': 'application/json' } });
  } catch(e) {
    console.error('[EMAIL ERROR]', e.message);
  }
}

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    const fromMe = body.fromMe || body.isFromMe || false;
    const isGroup = body.isGroup || false;
    const phone = body.phone || body.from || '';
    const text = body.text?.message || body.text || body.body || body.message || '';

    if (fromMe || isGroup || !phone || !text || typeof text !== 'string') return;

    console.log(`[MSG] ${phone}: ${text}`);

    const session = getSession(phone);
    const reply = await askClaude(session.history, text);

    session.history.push({ role: 'user', content: text });
    session.history.push({ role: 'assistant', content: reply });
    if (session.history.length > 20) session.history = session.history.slice(-20);

    let finalReply = reply;
    try {
      const jsonMatch = reply.match(/\{"ACTION":"SAVE_LEAD"[\s\S]*?\}/);
      if (jsonMatch && !session.leadSaved) {
        const leadData = JSON.parse(jsonMatch[0]);
        session.leadSaved = true;
        const numOrc = await saveLead(leadData);
        if (numOrc) await notifyEmail(leadData, numOrc);
        finalReply = reply.replace(jsonMatch[0], '').trim();
        if (!finalReply) finalReply = `✅ Orçamento *Nº ${numOrc}* registrado! Nossa equipe entrará em contato em breve. 🐕`;
      }
    } catch(e) { /* not a lead action */ }

    await sendWpp(phone, finalReply);
    console.log(`[REPLY SENT] ${phone}`);

  } catch(e) {
    console.error(`[WEBHOOK ERROR] ${e.message} | ${JSON.stringify(e.response?.data)}`);
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'online', agent: 'GoldDog WhatsApp Agent', version: '1.2.0', sessions: sessions.size, time: new Date().toISOString() });
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🐕 GoldDog Agent v1.2.0 rodando na porta ${PORT}`);
  console.log(`Claude:   ${CONFIG.claudeKey ? '✅' : '❌'}`);
  console.log(`Z-API:    ${CONFIG.zapiId ? '✅' : '❌'}`);
  console.log(`Client-Token: ${CONFIG.zapiClient ? '✅' : '⚠️ não configurado'}`);
  console.log(`Supabase: ${CONFIG.supabaseUrl ? '✅' : '❌'}`);
  console.log(`Resend:   ${CONFIG.resendKey ? '✅' : '❌'}`);
});

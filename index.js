const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());
 
// ════════════════════════════════════════════════════
// CONFIGURAÇÃO — via variáveis de ambiente no Railway
// ════════════════════════════════════════════════════
const CONFIG = {
  claudeKey:   process.env.CLAUDE_API_KEY   || '',
  zapiId:      process.env.ZAPI_INSTANCE_ID  || '',
  zapiToken:   process.env.ZAPI_TOKEN        || '',
  supabaseUrl: process.env.SUPABASE_URL      || '',
  supabaseKey: process.env.SUPABASE_KEY      || '',
  resendKey:   process.env.RESEND_KEY        || '',
  emailGD:     process.env.EMAIL_GOLDDOG     || 'contato@golddog.com.br',
  cnpj:        process.env.CNPJ_GOLDDOG      || '28.791.224/0001-88',
};
 
// ════════════════════════════════════════════════════
// KNOWLEDGE BASE — GoldDog
// ════════════════════════════════════════════════════
const KNOWLEDGE = `
EMPRESA: GoldDog Industries
Site: golddog.com.br | E-mail: contato@golddog.com.br | País: Brasil (Pernambuco)
Especialidade: Equipamentos para mineração, garimpo e recuperação de ouro fino e extrafino.
 
PRODUTOS E PREÇOS:
 
CONCENTRADORAS (Calhas Concentradoras):
- GD2020: R$2.965 — compacta, até 0,7t/h, ideal para testes e pequena produção
- GD3030: R$4.950 — alta eficiência, ouro fino e extrafino, até 1,5t/h
- GD3030S: R$6.940 — com Carpete Âncora incluso, alto desempenho
- GD3060X: R$12.795 — extra longa, alta produção, até 4t/h
- GD4540: R$9.945 — industrial, até 4t/h, produção contínua
 
TROMMEL — PLANTA DE LAVAGEM:
- GDT05: preço sob consulta — mini trommel portátil para testes
- GDT100: R$47.930 — alto desempenho, cascalho aurífero
- GDT100-B: R$58.700 — versão Basic, estrutura robusta
- GDT100-R: R$79.400 — Reforçado, ouro fino/extrafino, uso intensivo
- GDT300: R$395.800 — industrial, até 30t/h, grande escala
 
CARPETES:
- Carpete Âncora 3090C: R$1.350 — para concentradoras
- Carpete Âncora Vortex 3090V: R$1.385 — calhas e sluices
- Carpete Âncora Draga 3090D: R$1.565 — para dragas
- GoldMoss 1m x 1m: R$395
- GoldMoss 30cm x 1m: R$165
- GoldMoss 50cm x 1m (Kit): R$245
- GoldMoss 1m x 12m (Rolo): R$3.960
- Carpete Vinílico Resinado 1m x 1m: R$295
- Kit GoldMoss 30cm + Resinado + Tela: R$195
 
INFORMAÇÕES TÉCNICAS:
- Ouro fino: partículas entre 0,1mm e 0,5mm
- Ouro extrafino: partículas menores que 0,1mm
- Carpete Âncora: retém ouro fino e extrafino por turbulência controlada
- GoldMoss: carpete vazado para fluxo de água em trommel
- Granulometria: tamanho das partículas processadas
- Hopper: alimentador do trommel
- Os modelos GDT150 e acima são fabricados e entregues FOB Matupá, MT
 
PAGAMENTO E ENTREGA:
- Pagamento: à vista, 50% entrada + 50% entrega, parcelado
- Entrega: para todo o Brasil
- Prazo: varia por modelo (30 a 90 dias úteis)
- Suporte técnico incluso
 
PROCESSO DE ORÇAMENTO:
- Cliente pode solicitar orçamento em golddog.com.br/orcamento
- Ou via este WhatsApp
- Orçamentos são aprovados pela equipe GoldDog antes de virar contrato
`;
 
const SYSTEM_PROMPT = `Você é o assistente virtual da GoldDog Industries, empresa brasileira especializada em equipamentos de mineração e garimpo de ouro.
 
Seu nome é "GoldDog Assistant" e sua função é:
1. Atender clientes em QUALQUER idioma (detecte o idioma do cliente e responda no mesmo idioma)
2. Tirar dúvidas sobre produtos, processos e especificações técnicas
3. Qualificar o cliente (tipo de operação, volume de produção, tipo de ouro — fino, extrafino, etc.)
4. Recomendar o produto mais adequado para a necessidade do cliente
5. Quando o cliente demonstrar interesse em comprar, coletar: nome, e-mail, WhatsApp, estado
6. Gerar o orçamento e informar que a equipe GoldDog entrará em contato para confirmar
 
CONHECIMENTO BASE:
${KNOWLEDGE}
 
REGRAS DE COMPORTAMENTO:
- Seja profissional mas acessível — fale como especialista em mineração
- Responda SEMPRE no idioma do cliente (PT, EN, ES, AR, ZH)
- Mensagens curtas e diretas (máximo 3 parágrafos por resposta)
- Use emojis com moderação (1-2 por mensagem)
- Nunca invente preços — use apenas os preços do knowledge base
- Se não souber algo, diga que vai verificar com a equipe
- Quando tiver os dados do cliente (nome + email + tel + estado + produto), responda com um JSON especial:
  {"ACTION":"SAVE_LEAD","nome":"...","email":"...","tel":"...","estado":"...","produto":"...","mensagem":"..."}
- Sempre que mencionar preços em outras moedas, use "aproximadamente" pois os preços são em BRL
 
FLUXO IDEAL:
1. Cumprimentar e perguntar sobre a operação do cliente
2. Entender necessidades (volume, tipo de ouro, ambiente — rio, terra, draga)
3. Recomendar produto adequado
4. Apresentar preço e condições
5. Se interessado, coletar dados para orçamento formal`;
 
// ════════════════════════════════════════════════════
// SESSÕES DE CONVERSA (memória por número)
// ════════════════════════════════════════════════════
const sessions = new Map();
 
function getSession(phone) {
  if (!sessions.has(phone)) {
    sessions.set(phone, { history: [], leadSaved: false, createdAt: Date.now() });
  }
  return sessions.get(phone);
}
 
// Limpa sessões antigas (> 24h)
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [phone, session] of sessions) {
    if (session.createdAt < cutoff) sessions.delete(phone);
  }
}, 60 * 60 * 1000);
 
// ════════════════════════════════════════════════════
// CLAUDE API
// ════════════════════════════════════════════════════
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
 
// ════════════════════════════════════════════════════
// ENVIAR MENSAGEM WHATSAPP (Z-API)
// ════════════════════════════════════════════════════
async function sendWpp(phone, message) {
  if (!CONFIG.zapiId || !CONFIG.zapiToken) {
    console.log('[WPP MOCK]', phone, message);
    return;
  }
  await axios.post(
    `https://api.z-api.io/instances/${CONFIG.zapiId}/token/${CONFIG.zapiToken}/send-text`,
    { phone, message },
    { headers: { 'Content-Type': 'application/json' } }
  );
}
 
// ════════════════════════════════════════════════════
// SALVAR LEAD NO SUPABASE
// ════════════════════════════════════════════════════
async function saveLead(data) {
  if (!CONFIG.supabaseUrl) return;
  const num = `GD-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(Math.floor(Math.random()*999)+1).padStart(3,'0')}`;
  try {
    await axios.post(
      `${CONFIG.supabaseUrl}/rest/v1/orcamentos`,
      {
        numero: num,
        cliente_nome: data.nome,
        cliente_email: data.email,
        cliente_tel: data.tel,
        cliente_estado: data.estado,
        produtos: [{ nome: data.produto }],
        obs: data.mensagem,
        total: 0,
        status: 'pendente',
        enviado_wpp: true
      },
      {
        headers: {
          'apikey': CONFIG.supabaseKey,
          'Authorization': `Bearer ${CONFIG.supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        }
      }
    );
    console.log('[LEAD SAVED]', data.nome, num);
    return num;
  } catch(e) {
    console.error('[SUPABASE ERROR]', e.message);
  }
}
 
// ════════════════════════════════════════════════════
// ENVIAR E-MAIL DE NOTIFICAÇÃO (Resend)
// ════════════════════════════════════════════════════
async function notifyEmail(data, numOrc) {
  if (!CONFIG.resendKey) return;
  try {
    await axios.post('https://api.resend.com/emails', {
      from: `GoldDog Industries <${CONFIG.emailGD}>`,
      to: [CONFIG.emailGD],
      subject: `🔔 Novo lead WhatsApp — ${data.nome} | ${numOrc}`,
      html: `
        <h2>Novo Lead via WhatsApp Agent</h2>
        <p><b>Nome:</b> ${data.nome}</p>
        <p><b>E-mail:</b> ${data.email}</p>
        <p><b>WhatsApp:</b> ${data.tel}</p>
        <p><b>Estado:</b> ${data.estado}</p>
        <p><b>Interesse:</b> ${data.produto}</p>
        <p><b>Observação:</b> ${data.mensagem}</p>
        <p><b>Nº Orçamento:</b> ${numOrc}</p>
        <hr>
        <p>Acesse o <a href="https://golddog-industries.github.io/golddog-orcamento">Painel GoldDog</a> para aprovar.</p>
      `
    }, {
      headers: { 'Authorization': `Bearer ${CONFIG.resendKey}`, 'Content-Type': 'application/json' }
    });
  } catch(e) {
    console.error('[EMAIL ERROR]', e.message);
  }
}
 
// ════════════════════════════════════════════════════
// WEBHOOK — recebe mensagens do Z-API
// ════════════════════════════════════════════════════
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // responde imediatamente ao Z-API
 
  try {
    const body = req.body;
 
    // Ignora mensagens do próprio bot e grupos
    if (body.fromMe || body.isGroup || !body.text || !body.phone) return;
 
    const phone = body.phone;
    const userMsg = body.text.message || body.text;
    if (!userMsg || typeof userMsg !== 'string') return;
 
    console.log(`[MSG] ${phone}: ${userMsg}`);
 
    const session = getSession(phone);
 
    // Pergunta ao Claude
    const reply = await askClaude(session.history, userMsg);
 
    // Atualiza histórico
    session.history.push({ role: 'user', content: userMsg });
    session.history.push({ role: 'assistant', content: reply });
 
    // Mantém histórico em até 20 mensagens
    if (session.history.length > 20) session.history = session.history.slice(-20);
 
    // Verifica se Claude retornou um ACTION de salvar lead
    let finalReply = reply;
    try {
      const jsonMatch = reply.match(/\{"ACTION":"SAVE_LEAD"[^}]+\}/);
      if (jsonMatch && !session.leadSaved) {
        const leadData = JSON.parse(jsonMatch[0]);
        session.leadSaved = true;
        const numOrc = await saveLead(leadData);
        await notifyEmail(leadData, numOrc);
        finalReply = reply.replace(jsonMatch[0], '').trim();
        if (!finalReply) {
          finalReply = `✅ Perfeito! Seu orçamento *Nº ${numOrc}* foi registrado. Nossa equipe entrará em contato em breve para confirmar os detalhes. 🐕`;
        }
      }
    } catch(e) {
      // não era JSON, segue normal
    }
 
    // Envia resposta ao cliente
    await sendWpp(phone, finalReply);
    console.log(`[REPLY] ${phone}: ${finalReply.substring(0, 80)}...`);
 
  } catch(e) {
    console.error('[WEBHOOK ERROR]', e.message);
  }
});
 
// ════════════════════════════════════════════════════
// HEALTH CHECK
// ════════════════════════════════════════════════════
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    agent: 'GoldDog WhatsApp Agent',
    version: '1.0.0',
    sessions: sessions.size,
    time: new Date().toISOString()
  });
});
 
app.get('/health', (req, res) => res.json({ ok: true }));
 
// ════════════════════════════════════════════════════
// START
// ════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🐕 GoldDog Agent rodando na porta ${PORT}`);
  console.log(`Claude: ${CONFIG.claudeKey ? '✅' : '❌ não configurado'}`);
  console.log(`Z-API:  ${CONFIG.zapiId ? '✅' : '❌ não configurado'}`);
  console.log(`Supabase: ${CONFIG.supabaseUrl ? '✅' : '❌ não configurado'}`);
  console.log(`Resend: ${CONFIG.resendKey ? '✅' : '❌ não configurado'}`);
});

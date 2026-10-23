// Sincroniza o monday para a tabela sync_snapshots:
//   'monday' = quadros e tarefas (lerMonday do Painel do COO)
//   'prazos' = histórico compacto de mudanças de prazo/status (aplicarLogs do Painel do COO)
// Quem pode chamar: o pg_cron (cabeçalho x-cron-secret) ou um membro logado da ferramenta (botão "Atualizar").
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import COO from './coo.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function monday(query: string, token: string) {
  const r = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token, 'API-Version': '2024-10' },
    body: JSON.stringify({ query }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors || j.error_message) throw new Error('monday ' + r.status + ': ' + JSON.stringify(j.errors || j.error_message || j).slice(0, 300));
  return j;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  // autorização: cron (segredo gerado e guardado no próprio banco) ou membro logado
  const cronHeader = req.headers.get('x-cron-secret');
  let autorizado = false;
  if (cronHeader) {
    const { data } = await admin.rpc('sync_cron_secret_ok', { s: cronHeader });
    autorizado = data === true;
  }
  if (!autorizado) {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (jwt) {
      const { data } = await admin.auth.getUser(jwt);
      if (data?.user) {
        const { data: membro } = await admin.from('app_members').select('user_id').eq('user_id', data.user.id).maybeSingle();
        autorizado = !!membro;
      }
    }
  }
  if (!autorizado) return json({ erro: 'Não autorizado.' }, 401);

  const token = Deno.env.get('MONDAY_TOKEN');
  if (!token) return json({ erro: 'Falta configurar o segredo MONDAY_TOKEN no Supabase.' }, 500);

  const t0 = Date.now();
  try {
    const m = COO.lerMonday(await monday(COO.QUERY_MONDAY, token));

    // histórico de prazos: incremental desde a última sincronização; quadro novo busca 180 dias
    const { data: snap } = await admin.from('sync_snapshots').select('payload').eq('id', 'prazos').maybeSingle();
    const doc = snap?.payload || { sync: 0, itens: {}, quadros: [] };
    doc.itens = doc.itens || {}; doc.quadros = doc.quadros || [];
    const alvos = m.alvosLog;
    const novos = alvos.filter((a: { board: string }) => !doc.quadros.includes(a.board));
    const velhos = alvos.filter((a: { board: string }) => doc.quadros.includes(a.board));
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19) + 'Z';
    const ler = async (lista: unknown[], desde: number) => {
      const out = [];
      for (const q of COO.queriesLog(lista, iso(desde))) out.push(await monday(q, token));
      return out;
    };
    if (velhos.length && doc.sync) COO.aplicarLogs(doc, await ler(velhos, doc.sync - 36e5), doc.sync, true);
    if (novos.length) COO.aplicarLogs(doc, await ler(novos, Date.now() - 180 * 864e5), 0, !doc.sync);
    if (!doc.sync) doc.sync = Date.now() - 6e4;
    doc.quadros = alvos.map((a: { board: string }) => a.board);
    const vivos = new Set(m.tarefas.map((t: { id: string }) => t.id));
    for (const id of Object.keys(doc.itens)) {
      if (!vivos.has(id)) delete doc.itens[id];
      else if (doc.itens[id].h.length > 20) doc.itens[id].h = doc.itens[id].h.slice(-20);
    }

    const agora = new Date().toISOString();
    const info = { quadros: m.quadros.length, tarefas: m.tarefas.length, historico: Object.keys(doc.itens).length, quadrosNovos: novos.length, ms: Date.now() - t0, em: agora };
    const { error } = await admin.from('sync_snapshots').upsert([
      { id: 'monday', payload: { quadros: m.quadros, tarefas: m.tarefas, usuarios: m.usuarios, alvosLog: m.alvosLog }, info, updated_at: agora },
      { id: 'prazos', payload: doc, info: { itens: info.historico, sync: doc.sync }, updated_at: agora },
    ]);
    if (error) throw new Error('gravar: ' + error.message);
    return json({ ok: true, ...info });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    console.error('sync-monday', msg);
    return json({ erro: msg }, 500);
  }
});

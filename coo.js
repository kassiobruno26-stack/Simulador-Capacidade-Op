/* Regras do Painel do COO (copiadas do painel publicado em 13/10/2026, versão 1791923650-75a0).
   Usado pela ferramenta (navegador) e pela função sync-monday (Supabase).
   Únicas adições, para a aba Indicadores: cada tarefa traz adDias (dias dos adiamentos) e calcular devolve tarefas. */
/* Painel do COO — leitura das fontes e regras. Funções puras (sem DOM). */
const COO = (() => {
  const EXCLUIR = /zanatta|ana loise|membro exclu|institucional@/i;
  const NPS_COLS = { empresa: 'short_textwnueon1s', nota: 'single_selectuoxkd2u', comentario: 'long_textrfui16kz' };
  const PASTAS = [19084295, 19085168];
  const NPS_BOARD = 18435323519;

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const ymd = (d) => { const x = d instanceof Date ? d : new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  const dias = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
  const uteisEntre = (a, b) => { let n = 0; const d = new Date(a + 'T12:00:00'); const f = new Date(b + 'T12:00:00'); while (d < f) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) n += 1; } return n; };
  const feitaTxt = /^(done|feito|conclu|executado)/i;
  const STOP = new Set('para com sem pela pelo pelos pelas como mais entre sobre todos todas cada desta deste dessa desse este esta essa esse that with from into have will next semana hoje amanha'.split(' '));
  const raiz = (s) => [...new Set(norm(s).split(' ').filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.slice(0, 6)))];
  const br = (d) => { if (!d) return '—'; const [y, m, dd] = String(d).slice(0, 10).split('-'); return dd + '/' + m + '/' + y.slice(2); };
  const parse = (x) => (typeof x === 'string' ? (() => { try { return JSON.parse(x); } catch (e) { return x; } })() : x);
  const nomes = (s) => String(s || '').split(/\s*,\s*/).filter((n) => n && !EXCLUIR.test(n));

  /* ---------- monday: quadros, tarefas, usuários, NPS ---------- */
  const QUERY_MONDAY = 'query { users(limit: 200) { id name } nps: boards(ids:[' + NPS_BOARD + ']) { id items_page(limit: 500) { items { id name created_at column_values { id text } } } } folders(ids:[' + PASTAS.join(',') + ']) { name children { id name updated_at columns(types:[status,date,people,dropdown,subtasks]) { id title type settings_str } groups { id title } items_page(limit:500) { items { id name created_at updated_at group { id } column_values(types:[status,date,people,dropdown]) { id text } subitems { id name created_at updated_at column_values(types:[status,date,people]) { id text } } } } } } }';

  function lerMonday(payload) {
    const a = parse(payload);
    if (a && a.errors && a.errors.length) throw new Error(a.errors.map((e) => e.message).join('; '));
    const d = (a && a.data) || a || {};
    const usuarios = {};
    for (const u of d.users || []) usuarios[String(u.id)] = u.name;
    const quadros = [];
    const tarefas = [];
    const alvosLog = [];
    for (const f of d.folders || []) {
      for (const b of f.children || []) {
        if (/^subelementos/i.test(b.name)) continue;
        const [cliente, servico] = b.name.split(/\s*<>\s*/);
        const col = {};
        const colsLog = [];
        let subBoard = null;
        for (const c of b.columns || []) {
          col[c.id] = (c.title || '').toLowerCase();
          if (c.type === 'date' || c.type === 'status') colsLog.push(c.id);
          if (c.type === 'subtasks') { try { subBoard = (JSON.parse(c.settings_str).boardIds || [])[0] || null; } catch (e) { /* sem subitens */ } }
        }
        const grp = {};
        for (const g of b.groups || []) grp[g.id] = g.title;
        const q = { projeto: cliente.trim(), servico: (servico || '').trim(), pasta: f.name, quadro_id: String(b.id), atualizado: b.updated_at || '', url: 'https://aust-capital.monday.com/boards/' + b.id };
        quadros.push(q);
        const subCols = new Set();
        for (const it of (b.items_page && b.items_page.items) || []) {
          const v = { etapa: '', status: '', cronograma: '', resp: [], entrega: '' };
          for (const cv of it.column_values || []) {
            const t = col[cv.id] || '';
            const txt = (cv.text || '').trim();
            if (/etapa/.test(t)) v.etapa = txt;
            else if (/cronograma/.test(t)) v.cronograma = txt;
            else if (/status/.test(t)) v.status = txt;
            else if (/data/.test(t)) v.entrega = v.entrega || txt.slice(0, 10);
            else if (/respons|consultor|gestor|owner/.test(t) && txt) v.resp.push(txt);
          }
          const grupo = grp[it.group && it.group.id] || '';
          const base = { projeto: q.projeto, quadro_id: q.quadro_id, grupo, etapa: v.etapa || grupo, url: q.url + '/pulses/' + it.id };
          const pai = { ...base, tipo: 'tarefa', id: String(it.id), pai_id: '', tarefa: it.name, status: v.status, cronograma: v.cronograma,
            responsavel: [...new Set(v.resp.join(', ').split(/\s*,\s*/).filter(Boolean))].join(', '), entrega: v.entrega, criado: it.created_at || '', atualizado: it.updated_at || '' };
          tarefas.push(pai);
          for (const s of it.subitems || []) {
            const w = { status: '', resp: '', entrega: '' };
            for (const cv of s.column_values || []) {
              const txt = (cv.text || '').trim();
              if (/person|people/.test(cv.id)) w.resp = txt;
              else if (/^date/.test(cv.id)) { w.entrega = txt.slice(0, 10); subCols.add(cv.id); }
              else if (/^status|^color/.test(cv.id)) { w.status = txt; subCols.add(cv.id); }
            }
            tarefas.push({ ...base, tipo: 'subtarefa', id: String(s.id), pai_id: pai.id, pai_nome: it.name, tarefa: s.name, status: w.status, cronograma: '',
              responsavel: w.resp, entrega: w.entrega, criado: s.created_at || '', atualizado: s.updated_at || '' });
          }
        }
        alvosLog.push({ board: String(b.id), cols: colsLog });
        if (subBoard) alvosLog.push({ board: String(subBoard), cols: subCols.size ? [...subCols] : ['date0', 'status'] });
      }
    }
    const nps = [];
    for (const nb of d.nps || []) {
      for (const it of (nb.items_page && nb.items_page.items) || []) {
        const cv = {};
        for (const c of it.column_values || []) cv[c.id] = (c.text || '').trim();
        const nota = Number(cv[NPS_COLS.nota]);
        if (cv[NPS_COLS.nota] === '' || Number.isNaN(nota)) continue;
        nps.push({ id: String(it.id), pessoa: it.name, empresa: cv[NPS_COLS.empresa] || '', nota, comentario: cv[NPS_COLS.comentario] || '', data: (it.created_at || '').slice(0, 10) });
      }
    }
    return { quadros, tarefas, usuarios, nps, alvosLog };
  }

  /* ---------- monday: histórico de prazos (activity logs) ---------- */
  function queriesLog(alvos, desdeIso) {
    const out = [];
    for (let i = 0; i < alvos.length; i += 10) {
      const partes = alvos.slice(i, i + 10).map((a) => 'b' + a.board + ': boards(ids:[' + a.board + ']) { activity_logs(limit: 1000, from: "' + desdeIso + '", column_ids: ' + JSON.stringify(a.cols) + ') { event created_at user_id data } }');
      out.push('query { ' + partes.join(' ') + ' }');
    }
    return out;
  }

  // Estado compacto por tarefa: { h: [[dia-época, data anterior, data nova, id de quem mudou]], c: conclusão (ms) | null }
  function aplicarLogs(estado, payloads, desdeMs, atualizarSync) {
    const limite = desdeMs === undefined ? estado.sync || 0 : desdeMs;
    const ev = [];
    for (const p of payloads) {
      const a = parse(p);
      const d = (a && a.data) || a || {};
      for (const k of Object.keys(d)) {
        for (const b of d[k] || []) {
          for (const x of (b && b.activity_logs) || []) {
            if (x.event !== 'update_column_value') continue;
            const ms = Number(x.created_at) / 1e4;
            if (!(ms > limite)) continue;
            let dd;
            try { dd = JSON.parse(x.data); } catch (e) { continue; }
            ev.push({ ms, u: String(x.user_id || ''), d: dd });
          }
        }
      }
    }
    ev.sort((a, b) => a.ms - b.ms);
    const it = estado.itens || (estado.itens = {});
    let ult = 0;
    for (const { ms, u, d } of ev) {
      const id = String(d.pulse_id || '');
      if (!id) continue;
      const s = it[id] || (it[id] = { h: [], c: null });
      if (d.column_type === 'date') {
        const novo = d.value && d.value.date ? d.value.date : '';
        const velho = d.previous_value && d.previous_value.date ? d.previous_value.date : '';
        if (novo !== velho) s.h.push([Math.floor(ms / 864e5), velho, novo, u]);
      } else if (d.column_type === 'color') {
        const lab = (d.value && d.value.label) || {};
        const pronto = lab.is_done === true || feitaTxt.test(lab.text || '');
        if (pronto) s.c = ms; else if (s.c && !/^(cronograma)$/i.test(lab.text || '')) s.c = null;
      }
      if (ms > ult) ult = ms;
    }
    if (atualizarSync !== false) estado.sync = Math.max(estado.sync || 0, ult);
    return estado;
  }

  /* ---------- agenda ---------- */
  function lerAgenda(payload) {
    const p = parse(payload) || {};
    if (p.error) throw new Error(typeof p.error === 'string' ? p.error : JSON.stringify(p.error));
    return (p.events || []).map((e) => {
      const att = (e.attendees || []).filter((x) => !x.resource);
      const me = att.find((x) => x.self);
      return {
        id: e.id, titulo: e.summary || '', inicio: (e.start && (e.start.dateTime || e.start.date)) || '', fim: (e.end && (e.end.dateTime || e.end.date)) || '',
        dia_inteiro: !!(e.start && e.start.date && !e.start.dateTime), original: (e.originalStartTime && (e.originalStartTime.dateTime || e.originalStartTime.date)) || '',
        participantes: att.length, externos: att.filter((x) => !/@austcapital\.com$/i.test(x.email || '') && !/calendly|noreply|no-reply/i.test(x.email || '')).length,
        resposta: me ? me.responseStatus : (e.organizer && e.organizer.self ? 'accepted' : ''), tipo_evento: e.eventType || 'DEFAULT', status: e.status || '', link: e.htmlLink || '',
      };
    });
  }

  /* ---------- Granola ---------- */
  const dec = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const attr = (tag, name) => { const m = tag.match(new RegExp('\\b' + name + '="([^"]*)"')); return m ? dec(m[1]) : ''; };
  const txtDe = (p) => (typeof p === 'string' ? p : p && p.content ? p.content.map((c) => c.text || '').join('\n') : JSON.stringify(p || ''));

  function lerGranolaLista(payload) {
    const txt = txtDe(payload);
    const out = [];
    const re = /<meeting\b([^>]*)>([\s\S]*?)<\/meeting>/g;
    let m;
    while ((m = re.exec(txt))) {
      const kp = dec((m[2].match(/<known_participants>([\s\S]*?)<\/known_participants>/) || [])[1] || '');
      const emails = kp.match(/[\w.+-]+@[\w.-]+/g) || [];
      out.push({ id: attr(m[1], 'id'), titulo: attr(m[1], 'title'), data: attr(m[1], 'meeting_at') || attr(m[1], 'created_at'), url: attr(m[1], 'url'),
        criador: ((kp.match(/([^,]+?)\s*\(note creator\)/) || [])[1] || '').trim(), externos: emails.filter((e) => !/@austcapital\.com$/i.test(e)).length });
    }
    if (!out.length && !/<meetings_data/.test(txt) && /error|denied|unauthor/i.test(txt)) throw new Error(txt.slice(0, 200));
    return out;
  }

  function lerGranolaResumos(payload) {
    const t = txtDe(payload);
    const out = {};
    const re = /<meeting\b([^>]*)>([\s\S]*?)<\/meeting>/g;
    let k;
    while ((k = re.exec(t))) out[attr(k[1], 'id')] = dec((k[2].match(/<summary>([\s\S]*?)<\/summary>/) || [])[1] || '').trim();
    return out;
  }

  function passosDoResumo(s) {
    const lines = String(s || '').split('\n');
    let start = -1;
    lines.forEach((ln, i) => { if (/^\s*#+\s*.*(pr[oó]ximos passos|next steps)/i.test(ln)) start = i; });
    if (start < 0) return [];
    const sec = [];
    for (let i = start + 1; i < lines.length; i += 1) { if (/^\s*#+\s/.test(lines[i])) break; sec.push(lines[i]); }
    const bold = sec.some((ln) => /^\s*-\s+\*\*/.test(ln));
    const out = [];
    let cur = null;
    for (const ln of sec) {
      const b = ln.match(/^-\s+(.*)$/);
      if (b && (!bold || /^\*\*/.test(b[1]))) {
        let t = b[1];
        let donos = '';
        const own = t.match(/\(([^()]*)\)\s*$/);
        if (own) { donos = own[1].trim(); t = t.slice(0, own.index).trim(); }
        cur = { passo: t.replace(/\*\*/g, '').trim(), detalhe: '', donos };
        out.push(cur);
      } else if (cur && ln.trim() && /^\s+/.test(ln)) cur.detalhe = (cur.detalhe + ' ' + ln.trim()).trim();
      else if (/^\s*-\s+/.test(ln) && bold) cur = null;
    }
    return out;
  }

  /* ---------- regras ---------- */
  function calcular(fontes, agora = new Date()) {
    const hoje = ymd(agora);
    const mes = hoje.slice(0, 7);
    const ha30 = ymd(new Date(agora - 30 * 864e5));
    const ha7 = ymd(new Date(agora - 7 * 864e5));
    const seg = new Date(agora); seg.setDate(seg.getDate() - ((seg.getDay() + 6) % 7));
    const iniSemana = ymd(seg);
    const dom = new Date(seg); dom.setDate(dom.getDate() + 6);
    const fimSemana = ymd(dom);
    const sex = new Date(seg); sex.setDate(sex.getDate() + 4);
    const fimSemanaUtil = ymd(sex);

    const { quadros = [], tarefas = [], usuarios = {}, nps = [] } = fontes.monday || {};
    const hist = (fontes.prazos && fontes.prazos.itens) || {};
    const temHist = !!(fontes.prazos && fontes.prazos.sync);
    const over = fontes.overrides || {};

    // projetos ↔ textos
    const projs = [...new Set(quadros.map((q) => q.projeto))].map((p) => ({ p, k: norm(p).replace(/ /g, ''), w: norm(p).split(' ') }));
    const acharTitulo = (titulo) => {
      const alvo = /<>|\+/.test(titulo) ? titulo.split(/<>|\+/).slice(1).join(' ').replace(/\(.*?\)/g, ' ') : String(titulo).split(':')[0];
      const n = norm(alvo); const k = n.replace(/ /g, '');
      if (k.length < 2) return '';
      const hit = projs.find((x) => x.k === k || (k.length >= 3 && x.k.startsWith(k)) || (x.k.length >= 3 && k.startsWith(x.k))) || projs.find((x) => x.w[0].length >= 4 && n.split(' ')[0] === x.w[0]);
      return hit ? hit.p : '';
    };
    const acharNoTexto = (texto) => {
      const nt = ' ' + norm(texto) + ' ';
      const hit = projs.find((x) => nt.includes(' ' + x.w[0] + ' ') && x.w[0].length >= 2) || projs.find((x) => x.w.slice(1).some((w) => w.length >= 4 && nt.includes(' ' + w + ' ')));
      return hit ? hit.p : '';
    };
    const acharEmpresa = (s) => { const k = norm(s).replace(/ /g, ''); if (!k) return ''; const hit = projs.find((x) => x.k === k || x.k.startsWith(k) || k.startsWith(x.k) || k.includes(x.k)) || projs.find((x) => x.w[0].length >= 4 && norm(s).split(' ').includes(x.w[0])); return hit ? hit.p : ''; };

    const equipe = {};
    for (const t of tarefas) for (const n of nomes(t.responsavel)) equipe[norm(n).split(' ')[0]] = n;
    if (equipe.gustavo) equipe.pinoli = equipe.gustavo;
    const doTime = (nome) => { const f = norm(nome).split(' '); return equipe[f[0]] || (f[1] && equipe[f[1]]) || ''; };
    const pessoasTime = Object.values(equipe).filter((v, i, a) => a.indexOf(v) === i);

    // tarefas enriquecidas
    const pais = {};
    for (const t of tarefas) if (t.tipo === 'tarefa') pais[t.id] = t;
    const feita = (t) => feitaTxt.test(t.status) || /^executado/i.test(t.cronograma) || /^executados?$/i.test(t.grupo);
    const fora = (t) => /descartado|n[aã]o priorit/i.test(t.status + ' ' + t.cronograma) || /^n[aã]o priorit/i.test(t.grupo);
    const doCliente = (t) => /pendente (cliente|investidor)/i.test(t.status);
    const travada = (t) => /^(stop|stopped|parado)$/i.test(t.status);
    const JANELA = 2; // dias após a criação em que mudar a data é planejamento, não adiamento
    const prazoDe = (t) => {
      const h = hist[t.id];
      if (!h || !h.h || !h.h.length) return { o: t.entrega || '', ad: [], e: 0, u: '', vencida: 0, c: h ? h.c : null };
      const criadoDia = t.criado ? Math.floor(new Date(t.criado).getTime() / 864e5) : 0;
      const fim = criadoDia + JANELA;
      const dentro = h.h.filter((x) => x[0] <= fim);
      let o = dentro.length ? dentro[dentro.length - 1][2] : h.h[0][1] || h.h[0][2];
      const depois = h.h.filter((x) => x[0] > fim);
      if (!o) { const prim = depois.find((x) => x[2]); o = prim ? prim[2] : t.entrega || ''; }
      const ad = depois.filter((x) => x[1] && x[2] && x[2] > x[1]);
      return { o, ad: ad.map((x) => x[0]), e: ad.reduce((sm, x) => sm + dias(x[1], x[2]), 0), u: ad.length ? ad[ad.length - 1][3] : '',
        vencida: ad.filter((x) => x[1] < ymd(x[0] * 864e5 + 432e5)).length, c: h.c };
    };
    const T = tarefas.filter((t) => !fora(t)).map((t) => {
      const h = prazoDe(t);
      const paiFeito = t.tipo === 'subtarefa' && pais[t.pai_id] && feita(pais[t.pai_id]);
      const f = feita(t) || paiFeito;
      const original = h.o || t.entrega || '';
      const conclusao = f ? (h.c ? ymd(h.c) : ymd(t.atualizado)) : '';
      const emJogo = !f && !!(t.entrega || (t.status && !/^(to.?do|a fazer)$/i.test(t.status)) || /^cronograma$/i.test(t.cronograma));
      return {
        ...t, feita: f, emJogo, doCliente: doCliente(t), travada: !f && travada(t), original,
        adiamentos: h.ad.length, adDias: h.ad, adiamentos30: h.ad.filter((d) => d * 864e5 >= agora - 30 * 864e5).length, empurrados: h.e, adiadasVencidas: h.vencida,
        adiadoPor: h.u ? usuarios[h.u] || '' : '', conclusao, conclusaoReal: !!h.c,
        idade: t.criado ? dias(ymd(t.criado), hoje) : null,
        atrasoReal: !f && original && original < hoje ? dias(original, hoje) : 0,
        atrasoAtual: !f && t.entrega && t.entrega < hoje ? dias(t.entrega, hoje) : 0,
        noPrazo: f && original ? conclusao <= original : null,
        nome: t.tipo === 'subtarefa' && t.pai_nome ? t.pai_nome + ' › ' + t.tarefa : t.tarefa,
        pessoas: nomes(t.responsavel),
      };
    });

    // agenda
    const evs = {};
    for (const [pessoa, rows] of Object.entries(fontes.agendas || {})) {
      for (const e of rows || []) {
        if (e.status === 'cancelled' || e.dia_inteiro || !e.inicio) continue;
        const ini = new Date(e.inicio); const fim = new Date(e.fim || e.inicio);
        const horas = Math.max(0, (fim - ini) / 36e5);
        if (horas > 10) continue;
        let x = evs[e.id];
        if (!x) {
          const reuniao = e.participantes >= 2 && e.tipo_evento !== 'FOCUS_TIME';
          const projeto = /^\s*(check|alinhamento|start|fechamento)/i.test(e.titulo) ? '' : acharTitulo(e.titulo);
          const cliente = reuniao && !!projeto && (e.externos > 0 || /^\s*aust\b/i.test(e.titulo));
          x = evs[e.id] = { id: e.id, titulo: e.titulo, inicio: e.inicio, dia: ymd(e.inicio), horas: Math.round(horas * 100) / 100, projeto,
            tipo: cliente ? 'cliente' : reuniao ? 'interna' : 'bloco', reagendada: !!e.original && new Date(e.original).getTime() !== ini.getTime(), pessoas: [], recusaram: [], link: e.link };
        }
        (e.resposta === 'declined' ? x.recusaram : x.pessoas).push(pessoa);
      }
    }
    const eventos = Object.values(evs).sort((a, b) => a.inicio.localeCompare(b.inicio));
    const agoraIso = agora.toISOString();

    // Granola → passos
    const reunG = (fontes.granola || []).map((g) => ({ ...g, projeto: /<>|\+/.test(g.titulo) ? acharTitulo(g.titulo) : '', passos: passosDoResumo((fontes.resumos || {})[g.id]) }));
    const fica = {};
    for (const r of reunG) { const k = (r.projeto || r.titulo) + '|' + String(r.data).slice(0, 10); if (!fica[k] || r.passos.length > fica[k].passos.length) fica[k] = r; }
    const validas = Object.values(fica);
    const ultimaG = {};
    for (const r of validas) if (r.projeto && (!ultimaG[r.projeto] || r.data > ultimaG[r.projeto])) ultimaG[r.projeto] = r.data;
    const tarefasPorProj = {};
    for (const t of T) (tarefasPorProj[t.projeto] = tarefasPorProj[t.projeto] || []).push({ t, r: raiz(t.tarefa) });
    const urlQuadro = {};
    for (const q of quadros) urlQuadro[q.projeto] = q.url;
    const casar = (projeto, texto, titulo, quando) => {
      let tarefa = null; let melhor = 0;
      const rp = raiz(texto); const rt = raiz(titulo);
      for (const { t, r } of projeto ? tarefasPorProj[projeto] || [] : T.map((t) => ({ t, r: raiz(t.tarefa) }))) {
        if (!(new Date(t.criado).getTime() >= quando - 864e5 || new Date(t.atualizado).getTime() >= quando)) continue;
        const comum = r.filter((w) => rp.includes(w)).length;
        const nota = comum / Math.max(1, Math.min(rt.length || 1, r.length || 1));
        if (comum >= 2 && nota >= 0.5 && nota > melhor) { melhor = nota; tarefa = t; }
      }
      return tarefa;
    };
    const idSeguro = (s) => String(s).replace(/[^A-Za-z0-9_\-.~:@+]/g, '_').slice(0, 180);

    const promessas = [];
    for (const r of validas) {
      if (!r.projeto) continue;
      const quando = new Date(r.data).getTime();
      r.passos.forEach((p, i) => {
        const id = idSeguro('g_' + r.id + '_' + (i + 1));
        const lista = String(p.donos || '').split(/\s*(?:,|\be\b|\band\b|\/)\s*/).map((x) => x.trim()).filter(Boolean);
        const daAust = lista.map(doTime).filter(Boolean);
        const texto = p.passo + ' ' + p.detalhe;
        let lado = 'aust';
        if (lista.length && !daAust.length && !lista.some((x) => /aust/i.test(x))) lado = 'cliente';
        if (!lista.length && /^(enviar|compartilhar|mandar|passar|send|share)\b/i.test(norm(p.passo)) && /(para|a|à|to)\s+(a\s+)?(equipe\s+)?aust/i.test(texto)) lado = 'cliente';
        const donos = lado === 'aust' ? (daAust.length ? daAust : [doTime(r.criador) || r.criador].filter(Boolean)) : lista;
        const tarefa = casar(r.projeto, texto, p.passo, quando);
        const horasDesde = (agora - quando) / 36e5;
        promessas.push({ id, origem: 'granola', projeto: r.projeto, reuniao: r.titulo, data: String(r.data).slice(0, 10), nota_url: r.url, passo: p.passo, detalhe: p.detalhe,
          lado, donos, dias: Math.floor(horasDesde / 24), recente: horasDesde < 24, ultima: r.data === ultimaG[r.projeto],
          tarefa: tarefa ? tarefa.nome : '', tarefa_url: tarefa ? tarefa.url : '', tarefa_feita: !!(tarefa && tarefa.feita),
          horas_ate_lancar: tarefa ? Math.max(0, Math.round(((new Date(tarefa.criado) - quando) / 36e5) * 10) / 10) : null, quadro_url: urlQuadro[r.projeto] || '' });
      });
    }
    // abertura operacional
    const abert = validas.filter((r) => /start\s*(semanal|operacional)|abertura\s*operacional/i.test(r.titulo)).sort((a, b) => String(b.data).localeCompare(String(a.data)));
    const abReun = abert.find((r) => r.passos.length) || null;
    const abertura = { reuniao: abReun, ultimaGravada: abert[0] || null, itens: [] };
    if (abReun) {
      const quando = new Date(abReun.data).getTime();
      abReun.passos.forEach((p, i) => {
        const projeto = acharNoTexto(p.passo + ' ' + p.detalhe);
        const donos = String(p.donos || '').split(/\s*(?:,|\be\b|\/)\s*/).map(doTime).filter(Boolean);
        const tarefa = casar(projeto, p.passo + ' ' + p.detalhe, p.passo, quando);
        abertura.itens.push({ id: idSeguro('a_' + abReun.id + '_' + (i + 1)), origem: 'abertura', projeto, passo: p.passo, detalhe: p.detalhe, donos, lado: 'aust',
          data: String(abReun.data).slice(0, 10), nota_url: abReun.url, dias: Math.floor((agora - quando) / 864e5), recente: false,
          tarefa: tarefa ? tarefa.nome : '', tarefa_url: tarefa ? tarefa.url : '', tarefa_feita: !!(tarefa && tarefa.feita), quadro_url: urlQuadro[projeto] || '' });
      });
    }
    // promessas manuais + edições salvas
    for (const [id, o] of Object.entries(over)) {
      if (o.origem === 'manual') promessas.push({ id, origem: 'manual', projeto: o.projeto || '', reuniao: 'Adicionada no painel', data: (o.criado || '').slice(0, 10), passo: o.texto || '', detalhe: '',
        lado: 'aust', donos: o.donos || [], dias: o.criado ? dias(o.criado.slice(0, 10), hoje) : 0, recente: false, tarefa: '', tarefa_url: '', tarefa_feita: false, horas_ate_lancar: null, quadro_url: urlQuadro[o.projeto] || '' });
    }
    const aplicar = (p) => {
      const o = over[p.id] || {};
      const estadoAuto = p.tarefa_feita ? 'concluida' : 'aberta';
      const estado = o.estado || estadoAuto;
      const situacao = p.lado === 'cliente' ? 'cliente' : estado === 'concluida' ? 'concluída' : estado === 'apagada' ? 'apagada' : p.tarefa ? 'no monday' : p.recente ? 'recente' : 'sem tarefa';
      return { ...p, projeto: o.projeto !== undefined && o.projeto !== '' ? o.projeto : p.projeto, texto: o.texto || p.passo, donos: o.donos || p.donos, prazo: o.prazo || '', obs: o.obs || '', estado, editada: !!(o.texto || o.donos || o.prazo), manualEstado: !!o.estado, situacao,
        atrasada: !!(o.prazo && o.prazo < hoje && estado === 'aberta') };
    };
    const prom = promessas.map(aplicar);
    abertura.itens = abertura.itens.map(aplicar);
    const promAbertas = prom.filter((p) => p.lado === 'aust' && p.estado === 'aberta');

    // projetos
    const naoFase = /^(demandas|outras demandas|cronograma|executados?|n[aã]o priorit)/i;
    const projetos = quadros.map((q) => {
      const ts = T.filter((t) => t.quadro_id === q.quadro_id);
      const jogo = ts.filter((t) => t.emJogo);
      const atrasadas = jogo.filter((t) => t.atrasoReal > 0 && !t.doCliente);
      const semDono = jogo.filter((t) => !t.doCliente && (!t.pessoas.length || !t.entrega) && (t.tipo === 'tarefa' || t.entrega || t.status));
      const travadas = jogo.filter((t) => t.travada);
      const pendMon = jogo.filter((t) => t.doCliente);
      const concMes = ts.filter((t) => t.feita && t.conclusao.slice(0, 7) === mes && t.original);
      const noPrazo = concMes.filter((t) => t.noPrazo);
      const empurradas = jogo.filter((t) => t.adiamentos > 0);
      const fases = ts.filter((t) => t.tipo === 'tarefa' && t.etapa && !naoFase.test(t.etapa) && t.entrega);
      const atual = fases.filter((t) => !t.feita).sort((a, b) => a.entrega.localeCompare(b.entrega))[0] || null;
      const esperada = fases.slice().sort((a, b) => Math.abs(dias(a.entrega, hoje)) - Math.abs(dias(b.entrega, hoje)) || b.entrega.localeCompare(a.entrega))[0] || null;
      const etapas = [...new Set(fases.slice().sort((a, b) => a.entrega.localeCompare(b.entrega)).map((t) => t.etapa))];
      const proximo = jogo.filter((t) => t.tipo === 'tarefa' && t.entrega && t.entrega >= hoje).sort((a, b) => a.entrega.localeCompare(b.entrega))[0] || null;
      const ultimaMexida = ts.map((t) => t.atualizado).concat([q.atualizado]).filter(Boolean).sort().pop() || '';
      const ev = eventos.filter((e) => e.projeto === q.projeto && e.tipo === 'cliente');
      const feitas30 = ev.filter((e) => e.dia >= ha30 && e.dia <= hoje && e.pessoas.length && e.inicio <= agoraIso);
      const remarc = ev.filter((e) => e.dia >= ha30 && (e.reagendada || (e.recusaram.length && !e.pessoas.length)));
      const prox = ev.filter((e) => e.inicio > agoraIso && e.pessoas.length)[0] || null;
      const naSemana = ev.filter((e) => e.dia >= iniSemana && e.dia <= fimSemana && e.pessoas.length);
      const pr = prom.filter((p) => p.projeto === q.projeto);
      const promA = pr.filter((p) => p.lado === 'aust' && p.estado === 'aberta');
      const semTarefa = pr.filter((p) => p.situacao === 'sem tarefa');
      const cliG = pr.filter((p) => p.lado === 'cliente' && p.ultima && p.estado === 'aberta');
      const ultReun = feitas30.map((e) => e.dia).sort().pop() || '';
      const parado = ultimaMexida && uteisEntre(ymd(ultimaMexida), hoje) >= 5 && !(ultReun && uteisEntre(ultReun, hoje) < 5);
      const maiorAtraso = atrasadas.reduce((m, t) => Math.max(m, t.atrasoReal), 0);
      const faseAtrasada = !!(atual && esperada && atual.etapa !== esperada.etapa && atual.entrega < hoje);
      const idades = jogo.map((t) => t.idade).filter((x) => x !== null);
      const motivos = [];
      if (parado) motivos.push('Parado há ' + uteisEntre(ymd(ultimaMexida), hoje) + ' dias úteis');
      if (atrasadas.length) motivos.push(atrasadas.length + (atrasadas.length > 1 ? ' atrasadas' : ' atrasada'));
      if (faseAtrasada) motivos.push('Etapa atrasada');
      if (empurradas.length) motivos.push(empurradas.length + (empurradas.length > 1 ? ' com prazo adiado' : ' com prazo adiado'));
      if (semTarefa.length) motivos.push(semTarefa.length + ' combinado' + (semTarefa.length > 1 ? 's' : '') + ' sem tarefa');
      if (feitas30.length < 2) motivos.push('Pouco contato (' + feitas30.length + ' em 30 dias)');
      if (remarc.length >= 2) motivos.push(remarc.length + ' reuniões remarcadas');
      if (travadas.length) motivos.push(travadas.length + (travadas.length > 1 ? ' travadas' : ' travada'));
      if (semDono.length) motivos.push(semDono.length + ' sem dono ou prazo');
      if (cliG.length + pendMon.length) motivos.push('Cliente devendo ' + (cliG.length + pendMon.length));
      const critico = parado || (atrasadas.length >= 3 && maiorAtraso >= 15) || maiorAtraso >= 30 || semTarefa.length >= 3 || motivos.length >= 5;
      const resp = {};
      for (const t of jogo) for (const n of t.pessoas) resp[n] = (resp[n] || 0) + 1;
      const lider = Object.entries(resp).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
      return {
        projeto: q.projeto, servico: q.servico, pasta: q.pasta, url: q.url, semaforo: critico ? 'crítico' : motivos.length ? 'atenção' : 'em dia', motivos,
        abertas: jogo.length, atrasadas, maiorAtraso, travadas, semDono, pendMonday: pendMon, concluidasMes: concMes.length, noPrazoMes: noPrazo.length,
        pctNoPrazo: concMes.length ? Math.round((100 * noPrazo.length) / concMes.length) : null, empurradas, adiamentos: jogo.reduce((s, t) => s + t.adiamentos, 0),
        idadeMedia: idades.length ? Math.round(idades.reduce((a, b) => a + b, 0) / idades.length) : null,
        etapaAtual: atual ? atual.etapa : '', etapaEsperada: esperada ? esperada.etapa : '', etapas, faseAtrasada,
        proximo, ultimaAtividade: ultimaMexida.slice(0, 10), parado, reunioes30: feitas30.length, ultimaReuniao: ultReun, remarcadas30: remarc.length,
        proxReuniao: prox, reuniaoNaSemana: naSemana.length > 0, promessasAbertas: promA, semTarefa, clienteDevendo: cliG.map((p) => p.texto).concat(pendMon.map((t) => t.nome)), lider,
      };
    }).sort((a, b) => ({ 'crítico': 0, 'atenção': 1, 'em dia': 2 })[a.semaforo] - ({ 'crítico': 0, 'atenção': 1, 'em dia': 2 })[b.semaforo] || b.motivos.length - a.motivos.length || a.projeto.localeCompare(b.projeto));

    // equipe
    const consultores = pessoasTime.map((p) => {
      const minhas = T.filter((t) => t.pessoas.includes(p));
      const jogo = minhas.filter((t) => t.emJogo && t.entrega);
      const atras = jogo.filter((t) => t.atrasoReal > 0 && !t.doCliente);
      const conc = minhas.filter((t) => t.feita && t.conclusao.slice(0, 7) === mes && t.original);
      const noPrazo = conc.filter((t) => t.noPrazo);
      const comPrazo = minhas.filter((t) => t.original && (t.emJogo || (t.feita && t.conclusao >= ha30)));
      const adiadas = comPrazo.filter((t) => t.adiamentos > 0);
      const passos = prom.filter((c) => c.origem === 'granola' && c.lado === 'aust' && !c.recente && c.donos.includes(p));
      const lanc = passos.filter((c) => c.horas_ate_lancar !== null);
      const meus = eventos.filter((e) => e.pessoas.includes(p) && e.dia >= iniSemana && e.dia <= fimSemanaUtil);
      const hR = meus.filter((e) => e.tipo !== 'bloco').reduce((s, e) => s + e.horas, 0);
      const hB = meus.filter((e) => e.tipo === 'bloco').reduce((s, e) => s + e.horas, 0);
      const idades = jogo.map((t) => t.idade).filter((x) => x !== null);
      return {
        pessoa: p, primeiro: p.split(' ')[0], projetos: new Set(jogo.map((t) => t.projeto)).size, abertas: jogo.length, atrasadas: atras.length,
        concluidasMes: conc.length, pctNoPrazo: conc.length ? Math.round((100 * noPrazo.length) / conc.length) : null,
        pctAdiadas: comPrazo.length ? Math.round((100 * adiadas.length) / comPrazo.length) : null, adiamentos30: minhas.reduce((s, t) => s + t.adiamentos30, 0),
        diasEmpurrados: comPrazo.reduce((s, t) => s + t.empurrados, 0), idadeMedia: idades.length ? Math.round(idades.reduce((a, b) => a + b, 0) / idades.length) : null,
        passos: passos.length, lancados: lanc.length, pctDisciplina: passos.length ? Math.round((100 * lanc.length) / passos.length) : null,
        horasLancar: lanc.length ? Math.round(lanc.reduce((s, c) => s + c.horas_ate_lancar, 0) / lanc.length) : null,
        semTarefa: prom.filter((c) => c.situacao === 'sem tarefa' && c.donos.includes(p)).length, promessasAbertas: promAbertas.filter((c) => c.donos.includes(p)).length,
        hReuniao: Math.round(hR * 10) / 10, hBloco: Math.round(hB * 10) / 10, pctReuniao: Math.round((100 * hR) / 40),
      };
    }).sort((a, b) => (b.pctDisciplina ?? -1) - (a.pctDisciplina ?? -1) || a.pessoa.localeCompare(b.pessoa));

    // alertas
    const alertas = [];
    const add = (g, tipo, projeto, titulo, detalhe, quem, dias_, link, extra) => alertas.push({ id: tipo + '|' + projeto + '|' + titulo, gravidade: g, tipo, projeto, titulo, detalhe: detalhe || '', quem: quem || [], dias: dias_, link: link || '', ...(extra || {}) });
    for (const p of projetos) {
      if (p.parado) add('crítico', 'Projeto parado', p.projeto, 'Sem movimento desde ' + br(p.ultimaAtividade), 'Nenhuma atualização no monday e nenhuma reunião com o cliente nos últimos 5 dias úteis.', p.lider.slice(0, 2), null, p.url);
      if (p.atrasadas.length) {
        const ord = p.atrasadas.slice().sort((a, b) => b.atrasoReal - a.atrasoReal);
        add(p.maiorAtraso >= 7 ? 'crítico' : 'atenção', 'Tarefas atrasadas', p.projeto, p.atrasadas.length + (p.atrasadas.length > 1 ? ' tarefas atrasadas' : ' tarefa atrasada'),
          'Mais antiga: ' + ord[0].nome + ' (prazo original ' + br(ord[0].original) + ')', [...new Set(p.atrasadas.flatMap((t) => t.pessoas))], p.maiorAtraso, p.url, { itens: ord.map((t) => ({ nome: t.nome, info: 'prazo original ' + br(t.original) + (t.adiamentos ? ' · adiada ' + t.adiamentos + 'x' : '') + ' · ' + (t.pessoas.join(', ') || 'sem dono'), url: t.url })) });
      }
      const emp = p.empurradas.filter((t) => t.adiamentos >= 2 || t.empurrados >= 7);
      if (emp.length) add('atenção', 'Prazo empurrado', p.projeto, emp.length + (emp.length > 1 ? ' tarefas adiadas várias vezes' : ' tarefa adiada várias vezes'),
        emp.slice().sort((a, b) => b.empurrados - a.empurrados).slice(0, 1).map((t) => t.nome + ': ' + t.adiamentos + ' adiamento(s), +' + t.empurrados + ' dias').join(''), [...new Set(emp.flatMap((t) => t.pessoas))], null, p.url,
        { itens: emp.map((t) => ({ nome: t.nome, info: 'original ' + br(t.original) + ' → atual ' + br(t.entrega) + ' · ' + t.adiamentos + 'x' + (t.adiadoPor ? ' · último por ' + t.adiadoPor.split(' ')[0] : ''), url: t.url })) });
      if (p.travadas.length) {
        const mx = p.travadas.reduce((m, t) => Math.max(m, dias(ymd(t.atualizado), hoje)), 0);
        add(mx >= 10 ? 'crítico' : 'atenção', 'Demandas travadas', p.projeto, p.travadas.length + ' com status Parado', 'A mais antiga está parada há ' + mx + ' dias.', [...new Set(p.travadas.flatMap((t) => t.pessoas))], mx, p.url,
          { itens: p.travadas.map((t) => ({ nome: t.nome, info: 'parada desde ' + br(ymd(t.atualizado)), url: t.url })) });
      }
      if (p.faseAtrasada) add('atenção', 'Etapa atrasada', p.projeto, 'Ainda em ' + p.etapaAtual, 'Pelas datas, deveria estar em ' + p.etapaEsperada + '.', p.lider.slice(0, 2), null, p.url);
      if (p.clienteDevendo.length) add('atenção', 'Cliente devendo', p.projeto, p.clienteDevendo.length + (p.clienteDevendo.length > 1 ? ' pendências do cliente' : ' pendência do cliente'), p.clienteDevendo.slice(0, 2).join(' · '), [], null, p.url, { itens: p.clienteDevendo.map((n) => ({ nome: n, info: '', url: '' })) });
      if (p.semDono.length) add('atenção', 'Fila sem dono', p.projeto, p.semDono.length + ' sem responsável ou sem data', 'Tarefas em andamento que ninguém assumiu ou sem prazo.', [], null, p.url, { itens: p.semDono.map((t) => ({ nome: t.nome, info: (t.pessoas.join(', ') || 'sem responsável') + ' · ' + (t.entrega ? br(t.entrega) : 'sem data'), url: t.url })) });
      const foco = [];
      if (p.promessasAbertas.length >= 2) foco.push(p.promessasAbertas.length + ' promessas abertas');
      if (p.reunioes30 < 2) foco.push(p.reunioes30 + ' reunião(ões) em 30 dias');
      if (p.remarcadas30 >= 2) foco.push(p.remarcadas30 + ' remarcadas');
      if (foco.length >= 2) add('atenção', 'Projeto sem foco', p.projeto, foco.join(' · '), 'Promessas acumulando e pouco contato com o cliente.', p.lider.slice(0, 2), null, p.url);
    }
    for (const c of prom) if (c.situacao === 'sem tarefa') add(c.dias >= 3 ? 'crítico' : 'atenção', 'Combinado sem tarefa', c.projeto, c.texto, 'Combinado na reunião de ' + br(c.data) + '.', c.donos, c.dias, c.quadro_url, { promessa: c.id });
    const horaAgora = agora.getHours() + agora.getMinutes() / 60;
    const uteisAte = (b) => { let n = 0; const d = new Date(hoje + 'T12:00:00'); const f = new Date(b + 'T12:00:00'); while (d <= f) { if (d.getDay() % 6) n += 1; d.setDate(d.getDate() + 1); } return n; };
    const venc = {};
    for (const t of T) {
      if (!t.emJogo || !t.entrega || t.entrega < hoje || t.doCliente || uteisAte(t.entrega) > 3) continue;
      for (const pessoa of t.pessoas) { const v = (venc[pessoa] = venc[pessoa] || { ate: t.entrega, itens: [] }); v.itens.push(t); if (t.entrega > v.ate) v.ate = t.entrega; }
    }
    for (const [pessoa, v] of Object.entries(venc)) {
      const h = eventos.filter((e) => e.tipo !== 'bloco' && e.pessoas.includes(pessoa) && e.inicio > agoraIso && e.dia <= v.ate).reduce((s, e) => s + e.horas, 0);
      const util = agora.getDay() % 6 ? 1 : 0;
      const disp = Math.max(0, 18 - Math.max(9, horaAgora)) * util + 8 * (uteisAte(v.ate) - util);
      if (disp > 0 && h / disp >= 0.6) add('atenção', 'Prazo x agenda', pessoa.split(' ')[0], v.itens.length + ' entrega(s) até ' + br(v.ate), Math.round(h) + 'h de reunião em ' + Math.round(disp) + 'h úteis até lá.', [pessoa], null, '',
        { itens: v.itens.map((t) => ({ nome: t.projeto + ': ' + t.nome, info: 'entrega ' + br(t.entrega), url: t.url })) });
    }
    alertas.sort((a, b) => (a.gravidade === b.gravidade ? 0 : a.gravidade === 'crítico' ? -1 : 1) || (b.dias ?? -1) - (a.dias ?? -1));

    // próximas entregas (3 dias úteis)
    const proximasEntregas = T.filter((t) => t.emJogo && t.entrega && t.entrega >= hoje && uteisAte(t.entrega) <= 3 && !t.doCliente)
      .sort((a, b) => a.entrega.localeCompare(b.entrega)).map((t) => ({ nome: t.nome, projeto: t.projeto, entrega: t.entrega, pessoas: t.pessoas, url: t.url, adiamentos: t.adiamentos }));

    // sem reunião na semana
    const semReuniao = projetos.filter((p) => !p.reuniaoNaSemana).map((p) => ({ projeto: p.projeto, servico: p.servico, ultima: p.ultimaReuniao, proxima: p.proxReuniao, lider: p.lider[0] || '', url: p.url, semaforo: p.semaforo }));

    // NPS
    const ha365 = ymd(new Date(agora - 365 * 864e5));
    const resp = nps.filter((r) => r.data >= ha365).map((r) => ({ ...r, projeto: acharEmpresa(r.empresa), cat: r.nota >= 9 ? 'promotor' : r.nota >= 7 ? 'neutro' : 'detrator' }));
    const npsDe = (rs) => (rs.length ? Math.round((100 * (rs.filter((r) => r.cat === 'promotor').length - rs.filter((r) => r.cat === 'detrator').length)) / rs.length) : null);
    const porCliente = {};
    for (const r of resp) (porCliente[r.projeto || r.empresa] = porCliente[r.projeto || r.empresa] || []).push(r);
    const npsClientes = Object.entries(porCliente).map(([cliente, rs]) => {
      const ord = rs.slice().sort((a, b) => b.data.localeCompare(a.data));
      return { cliente, ativo: !!quadros.find((q) => q.projeto === cliente), respostas: rs.length, nps: npsDe(rs), media: Math.round((10 * rs.reduce((s, r) => s + r.nota, 0)) / rs.length) / 10, ultima: ord[0] };
    }).sort((a, b) => (a.nps ?? 999) - (b.nps ?? 999));
    const npsGeral = {
      nps: npsDe(resp), respostas: resp.length, promotores: resp.filter((r) => r.cat === 'promotor').length, neutros: resp.filter((r) => r.cat === 'neutro').length, detratores: resp.filter((r) => r.cat === 'detrator').length,
      semResposta: quadros.filter((q) => !porCliente[q.projeto]).map((q) => q.projeto), clientes: npsClientes, recentes: resp.slice().sort((a, b) => b.data.localeCompare(a.data)).slice(0, 8),
    };

    // KPIs
    const conc = T.filter((t) => t.feita && t.conclusao.slice(0, 7) === mes && t.original);
    const conc7 = T.filter((t) => t.feita && t.conclusao > ha7 && t.conclusao <= hoje && t.original);
    const passosG = prom.filter((c) => c.origem === 'granola' && c.lado === 'aust' && !c.recente);
    const lanc = passosG.filter((c) => c.horas_ate_lancar !== null);
    const reunMes = eventos.filter((e) => e.tipo === 'cliente' && e.dia.slice(0, 7) === mes && e.inicio <= agoraIso);
    const remMes = reunMes.filter((e) => e.reagendada || !e.pessoas.length);
    const jogoT = T.filter((t) => t.emJogo && t.idade !== null);
    const hR = consultores.reduce((s, c) => s + c.hReuniao, 0);
    const hB = consultores.reduce((s, c) => s + c.hBloco, 0);
    const kpis = {
      projetos: projetos.length, critico: projetos.filter((p) => p.semaforo === 'crítico').length, atencao: projetos.filter((p) => p.semaforo === 'atenção').length, emDia: projetos.filter((p) => p.semaforo === 'em dia').length,
      alertas: alertas.length, alertasCriticos: alertas.filter((a) => a.gravidade === 'crítico').length,
      pctNoPrazoMes: conc.length ? Math.round((100 * conc.filter((t) => t.noPrazo).length) / conc.length) : null, concluidasMes: conc.length,
      pctNoPrazo7: conc7.length ? Math.round((100 * conc7.filter((t) => t.noPrazo).length) / conc7.length) : null,
      adiamentos30: T.reduce((s, t) => s + t.adiamentos30, 0), tarefasAdiadasAbertas: T.filter((t) => t.emJogo && t.adiamentos > 0).length,
      idadeMedia: jogoT.length ? Math.round(jogoT.reduce((s, t) => s + t.idade, 0) / jogoT.length) : null,
      pctDisciplina: passosG.length ? Math.round((100 * lanc.length) / passosG.length) : null, passos: passosG.length,
      horasLancar: lanc.length ? Math.round(lanc.reduce((s, c) => s + c.horas_ate_lancar, 0) / lanc.length) : null,
      promessasAbertas: promAbertas.length, promessaMaisAntiga: promAbertas.reduce((m, c) => Math.max(m, c.dias), 0),
      reunioesMes: reunMes.filter((e) => e.pessoas.length).length, pctRemarcadas: reunMes.length ? Math.round((100 * remMes.length) / reunMes.length) : null,
      hReuniao: Math.round(hR), hBloco: Math.round(hB), pctReuniao: consultores.length ? Math.round((100 * hR) / (40 * consultores.length)) : null,
      semReuniao: semReuniao.length, nps: npsGeral.nps, temHist,
    };
    return { hoje, iniSemana, fimSemana, kpis, proximasEntregas, projetos, consultores, alertas, promessas: prom, abertura, semReuniao, nps: npsGeral, eventos, pessoasTime, tarefas: T };
  }

  return { QUERY_MONDAY, NPS_BOARD, lerMonday, queriesLog, aplicarLogs, lerAgenda, lerGranolaLista, lerGranolaResumos, passosDoResumo, calcular, norm, ymd };
})();
if (typeof module !== 'undefined') module.exports = COO;

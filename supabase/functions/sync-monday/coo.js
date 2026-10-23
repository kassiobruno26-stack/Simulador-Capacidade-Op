// Recorte de /coo.js (Painel do COO): só a leitura do monday e o histórico de prazos, sem alterações.
const COO = (() => {
  const EXCLUIR = /zanatta|ana loise|membro exclu|institucional@/i;
  const NPS_COLS = { empresa: 'short_textwnueon1s', nota: 'single_selectuoxkd2u', comentario: 'long_textrfui16kz' };
  const PASTAS = [19084295, 19085168];
  const NPS_BOARD = 18435323519;

  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
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

  return { QUERY_MONDAY, lerMonday, queriesLog, aplicarLogs };
})();
export default COO;

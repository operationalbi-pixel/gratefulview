const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), request);
      if (url.pathname === '/health' && request.method === 'GET') return cors(json(await health(env)), request);
      if (!authorized(request, env)) return cors(json({ success: false, message: 'Unauthorized' }, 401), request);

      if (url.pathname === '/v1/customers/search' && request.method === 'GET') {
        return cors(json(await searchCustomers(env.DB, url.searchParams)), request);
      }
      const dashboard = url.pathname.match(/^\/v1\/customers\/([^/]+)\/dashboard$/);
      if (dashboard && request.method === 'GET') {
        return cors(json(await loadDashboard(env.DB, decodeURIComponent(dashboard[1]))), request);
      }
      const recommendations = url.pathname.match(/^\/v1\/customers\/([^/]+)\/recommendations$/);
      if (recommendations && request.method === 'GET') {
        return cors(json(await loadAiRecommendations(env, decodeURIComponent(recommendations[1]))), request);
      }
      const mobile = url.pathname.match(/^\/v1\/customers\/([^/]+)\/mobile$/);
      if (mobile && request.method === 'PATCH') {
        return cors(json(await updateMobile(env.DB, decodeURIComponent(mobile[1]), await request.json())), request);
      }
      if (url.pathname === '/v1/migrate/batch' && request.method === 'POST') {
        return cors(json(await ingestBatch(env.DB, await request.json())), request);
      }
      if (url.pathname === '/v1/migrate/status' && request.method === 'GET') {
        return cors(json(await migrationStatus(env.DB)), request);
      }
      return cors(json({ success: false, message: 'Not found' }, 404), request);
    } catch (error) {
      console.error('customer-insight-api', error);
      return cors(json({ success: false, message: 'Terjadi kesalahan pada layanan Customer Insight.' }, 500), request);
    }
  }
};

function authorized(request, env) {
  const expected = String(env.API_KEY || '');
  const supplied = String(request.headers.get('x-api-key') || '');
  return expected.length >= 24 && supplied.length === expected.length && supplied === expected;
}

function cors(response, request) {
  const origin = request.headers.get('origin') || '';
  const allowed = /^(https:\/\/operationalbi-pixel\.github\.io|https:\/\/script\.google\.com)$/.test(origin);
  const headers = new Headers(response.headers);
  if (allowed) headers.set('access-control-allow-origin', origin);
  headers.set('access-control-allow-headers', 'content-type,x-api-key');
  headers.set('access-control-allow-methods', 'GET,POST,PATCH,OPTIONS');
  return new Response(response.body, { status: response.status, headers });
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}

async function health(env) {
  const version = await env.DB.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").first('value');
  return { success: true, service: 'bakerzin-customer-insight-api', environment: env.ENVIRONMENT, schemaVersion: version || null };
}

function digits(value) {
  const raw = String(value || '').replace(/\D/g, '');
  if (raw.startsWith('62')) return `0${raw.slice(2)}`;
  if (raw.startsWith('8')) return `0${raw}`;
  return raw;
}

function like(value) {
  return `%${String(value || '').replace(/[\\%_]/g, '\\$&')}%`;
}

async function searchCustomers(db, params) {
  const type = String(params.get('type') || '').toLowerCase();
  const term = String(params.get('term') || '').trim();
  if (term.length < 2) return { results: [], total: 0 };
  let where = 'name LIKE ? ESCAPE \'\\\' COLLATE NOCASE';
  let bind = like(term);
  if (type === 'member') { where = 'member_id LIKE ? ESCAPE \'\\\' COLLATE NOCASE'; bind = `${term.replace(/[\\%_]/g, '\\$&')}%`; }
  if (type === 'mobile') { where = 'mobile_digits = ? OR mobile_digits LIKE ?'; bind = digits(term); }
  if (!['name', 'member', 'mobile'].includes(type)) return { results: [], total: 0, error: 'Tipe pencarian tidak valid.' };
  const query = type === 'mobile'
    ? db.prepare(`SELECT member_id,name,mobile,tier,source FROM customer_summary WHERE ${where} LIMIT 20`).bind(bind, `%${bind.slice(-8)}`)
    : db.prepare(`SELECT member_id,name,mobile,tier,source FROM customer_summary WHERE ${where} ORDER BY name LIMIT 20`).bind(bind);
  const { results = [] } = await query.all();
  const mapped = results.map(row => ({ name: row.name || '', memberId: row.member_id || '', mobile: row.mobile || 'Data tidak tersedia', tier: row.tier || '', source: row.source || 'MEMBER' }));
  return { results: mapped, total: mapped.length, cached: false, performanceMode: 'cloudflare-d1-summary-v1' };
}

function parseArray(value) {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

async function loadDashboard(db, memberId) {
  const row = await db.prepare('SELECT * FROM customer_summary WHERE member_id = ? LIMIT 1').bind(memberId).first();
  if (!row) return { success: false, message: 'Customer tidak ditemukan.' };
  const favoriteMenu = parseArray(row.favorite_menu_json).map(item => ({ menu: item?.menu || '-', count: Number(item?.count || 0), category: item?.category || '', menuNote: item?.menuNote || '' }));
  const totalVisits = Number(row.total_visits || 0);
  const weekdayVisits = Number(row.weekday_visits || 0);
  const weekendVisits = Number(row.weekend_visits || 0);
  const groupVisits = Number(row.group_visits || 0);
  const classifiedVisits = Number(row.classified_visits || totalVisits);
  const groupRatio = Number(row.group_ratio || 0);
  const groupSingleVisitor = groupVisits >= 2 && groupRatio >= 0.4
    ? { code: 'GROUP_VISITOR', label: 'Group Visitor', desc: `${groupVisits} dari ${classifiedVisits} visit pesan main course > 1` }
    : { code: 'SINGLE_VISITOR', label: 'Single Visitor', desc: totalVisits > 0 ? 'Lebih sering order personal' : 'Belum ada pola group order yang kuat' };
  const customerTypes = [];
  if (totalVisits > 0) {
    if (weekendVisits > weekdayVisits) customerTypes.push({ code: 'WEEKEND_VISITOR', label: 'Weekend Visitor', desc: `${weekendVisits} visit di Sabtu–Minggu` });
    else if (weekdayVisits > weekendVisits) customerTypes.push({ code: 'WEEKDAY_VISITOR', label: 'Weekday Visitor', desc: `${weekdayVisits} visit di hari kerja` });
    else customerTypes.push({ code: 'BALANCED_VISITOR', label: 'Balanced Visitor', desc: 'Visit merata weekday & weekend' });
  }
  customerTypes.push(groupSingleVisitor);
  let lastVisit = null;
  if (row.last_visit_date || row.last_sales_number) {
    lastVisit = { date: row.last_visit_date || '-', salesNumber: row.last_sales_number || '', branch: row.last_outlet || '-', waiter: row.last_waiter || '-' };
    const d = new Date(lastVisit.date);
    if (!Number.isNaN(d.getTime())) { lastVisit.dayName = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'][d.getDay()]; lastVisit.isWeekend = d.getDay() === 0 || d.getDay() === 6; }
  }
  const menuNoteItem = favoriteMenu.find(item => item.menuNote) || null;
  return {
    success: true,
    profile: { source: row.source || 'MEMBER', name: row.name || '', memberId: row.member_id, mobile: row.mobile || 'Data tidak tersedia', tier: row.tier || '' },
    lastVisit,
    lastPax: row.last_pax || null,
    lastPromotion: row.last_promotion || null,
    favoriteMenu,
    menuNote: row.menu_note || menuNoteItem?.menuNote || '',
    menuNoteMenu: menuNoteItem?.menu || '',
    lastOrderedItems: parseArray(row.last_order_json).map(String),
    todayVisit: { visited: false, reviewStatus: '', deferred: true },
    recommendations: { customerFavorite: favoriteMenu.slice(0, 3), premiumRecommendation: [], addOnRecommendation: [], groupRecommendation: null },
    hasTransactionHistory: Boolean(row.has_transaction_history || totalVisits > 0),
    totalSpending: 0,
    weekendVisits,
    weekdayVisits,
    customerTypes,
    groupSingleVisitor,
    summaryUpdatedAt: row.updated_at || '',
    performanceMode: 'cloudflare-d1-summary-v1',
    cached: false
  };
}

function recommendationCandidates(row) {
  const favorite = parseArray(row.favorite_menu_json).map(item => ({
    menu: String(item?.menu || '').trim(),
    category: String(item?.category || '').trim(),
    count: Number(item?.count || 0)
  }));
  const recent = parseArray(row.last_order_json).map(item => ({
    menu: String(typeof item === 'string' ? item : item?.menu || item?.name || '').trim(),
    category: String(typeof item === 'object' && item ? item.category || '' : '').trim(),
    count: 0
  }));
  const unique = new Map();
  for (const item of [...favorite, ...recent]) {
    if (!item.menu) continue;
    const key = item.menu.toLowerCase();
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].slice(0, 12);
}

function fallbackRecommendations(candidates, signals) {
  const reason = signals.groupVisitor
    ? 'Cocok ditawarkan kembali saat customer datang bersama grup.'
    : signals.weekendVisits > signals.weekdayVisits
      ? 'Sesuai dengan pola kunjungan weekend dan riwayat pesanan customer.'
      : 'Sesuai dengan riwayat menu yang memang pernah dipesan customer.';
  return {
    smartRecommendation: candidates.slice(0, 3).map(item => ({ menu: item.menu, category: item.category, reason })),
    aiScript: candidates.length
      ? `Tawarkan ${candidates[0].menu} sebagai pilihan yang paling dekat dengan kebiasaan pesanan customer.`
      : 'Tanyakan preferensi customer hari ini sebelum memberikan rekomendasi menu.',
    serviceApproach: signals.groupVisitor ? 'Utamakan pilihan yang nyaman untuk dinikmati bersama.' : 'Mulai dari menu favorit, lalu tawarkan pelengkap yang relevan.',
    aiGenerated: false
  };
}

function sanitizeAiRecommendations(value, candidates, signals) {
  const fallback = fallbackRecommendations(candidates, signals);
  const byName = new Map(candidates.map(item => [item.menu.toLowerCase(), item]));
  const rows = Array.isArray(value?.smartRecommendation) ? value.smartRecommendation : [];
  const smartRecommendation = [];
  for (const row of rows) {
    const source = byName.get(String(row?.menu || '').trim().toLowerCase());
    if (!source || smartRecommendation.some(item => item.menu.toLowerCase() === source.menu.toLowerCase())) continue;
    smartRecommendation.push({
      menu: source.menu,
      category: source.category,
      reason: String(row?.reason || fallback.smartRecommendation[0]?.reason || '').trim().slice(0, 180)
    });
    if (smartRecommendation.length >= 3) break;
  }
  return {
    smartRecommendation: smartRecommendation.length ? smartRecommendation : fallback.smartRecommendation,
    aiScript: String(value?.aiScript || fallback.aiScript).trim().slice(0, 240),
    serviceApproach: String(value?.serviceApproach || fallback.serviceApproach).trim().slice(0, 180),
    aiGenerated: smartRecommendation.length > 0
  };
}

async function loadAiRecommendations(env, memberId) {
  const row = await env.DB.prepare(
    `SELECT favorite_menu_json,last_order_json,last_pax,last_promotion,weekday_visits,weekend_visits,
            total_visits,classified_visits,group_visits,group_ratio,updated_at
       FROM customer_summary WHERE member_id = ? LIMIT 1`
  ).bind(memberId).first();
  if (!row) return { success: false, message: 'Customer tidak ditemukan.' };

  const candidates = recommendationCandidates(row);
  const signals = {
    weekdayVisits: Number(row.weekday_visits || 0),
    weekendVisits: Number(row.weekend_visits || 0),
    totalVisits: Number(row.total_visits || 0),
    lastPax: Number(row.last_pax || 0),
    lastPromotion: String(row.last_promotion || '').slice(0, 120),
    groupVisitor: Number(row.group_visits || 0) >= 2 && Number(row.group_ratio || 0) >= 0.4
  };
  if (!candidates.length) {
    return { success: true, recommendations: fallbackRecommendations(candidates, signals), cached: false };
  }

  const model = String(env.AI_RECOMMENDATION_MODEL || '@cf/meta/llama-3.1-8b-instruct');
  const input = JSON.stringify({ candidates, signals, summaryUpdatedAt: row.updated_at || '' });
  const inputHash = await sha256(input);
  const cached = await env.DB.prepare(
    "SELECT response_json,model FROM ai_recommendations WHERE member_id=? AND input_hash=? AND expires_at > datetime('now')"
  ).bind(memberId, inputHash).first();
  if (cached) {
    return { success: true, recommendations: JSON.parse(cached.response_json), cached: true, model: cached.model };
  }

  let recommendations;
  try {
    const response = await env.AI.run(model, {
      messages: [
        {
          role: 'system',
          content: 'Anda adalah asisten hospitality Bakerzin. Buat rekomendasi singkat dalam Bahasa Indonesia. Pilih menu HANYA dari daftar candidates dan jangan membuat harga, promo aktif, alergi, atau fakta baru. Jangan sebut nama, nomor telepon, atau ID customer.'
        },
        {
          role: 'user',
          content: `Susun maksimal 3 rekomendasi menu dan kalimat layanan berdasarkan data anonim berikut: ${input}`
        }
      ],
      temperature: 0.2,
      max_tokens: 350,
      response_format: {
        type: 'json_schema',
        json_schema: {
          type: 'object',
          properties: {
            smartRecommendation: {
              type: 'array',
              items: {
                type: 'object',
                properties: { menu: { type: 'string' }, reason: { type: 'string' } },
                required: ['menu', 'reason']
              }
            },
            aiScript: { type: 'string' },
            serviceApproach: { type: 'string' }
          },
          required: ['smartRecommendation', 'aiScript', 'serviceApproach']
        }
      }
    });
    const generated = typeof response?.response === 'string' ? JSON.parse(response.response) : response?.response;
    recommendations = sanitizeAiRecommendations(generated, candidates, signals);
  } catch (error) {
    console.error('customer-ai-recommendation', { memberIdHash: (await sha256(memberId)).slice(0, 12), message: error?.message || String(error) });
    recommendations = fallbackRecommendations(candidates, signals);
  }

  await env.DB.prepare(
    `INSERT INTO ai_recommendations(member_id,input_hash,response_json,model,created_at,expires_at)
     VALUES(?,?,?,?,CURRENT_TIMESTAMP,datetime('now','+24 hours'))
     ON CONFLICT(member_id) DO UPDATE SET input_hash=excluded.input_hash,response_json=excluded.response_json,
       model=excluded.model,created_at=excluded.created_at,expires_at=excluded.expires_at`
  ).bind(memberId, inputHash, JSON.stringify(recommendations), model).run();
  return { success: true, recommendations, cached: false, model };
}

async function updateMobile(db, memberId, payload) {
  const mobile = String(payload?.mobile || '').trim();
  if (!mobile) return { success: false, message: 'Nomor telepon kosong.' };
  const normalized = digits(mobile);
  const result = await db.batch([
    db.prepare('UPDATE members SET mobile=?, mobile_digits=?, updated_at=CURRENT_TIMESTAMP WHERE member_id=?').bind(mobile, normalized, memberId),
    db.prepare('UPDATE customer_summary SET mobile=?, mobile_digits=?, updated_at=CURRENT_TIMESTAMP WHERE member_id=?').bind(mobile, normalized, memberId)
  ]);
  return { success: true, memberId, mobile, changed: result.some(item => Number(item.meta?.changes || 0) > 0) };
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function pick(row, ...names) {
  for (const name of names) if (row[name] !== undefined && row[name] !== null) return row[name];
  return '';
}

async function ingestBatch(db, payload) {
  const sourceTable = String(payload?.table || '');
  const key = String(payload?.idempotencyKey || '');
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!key || !sourceTable || !rows.length || rows.length > 200) return { success: false, message: 'Payload migrasi tidak valid (1-200 baris).' };
  const previous = await db.prepare('SELECT inserted_count FROM migration_batches WHERE idempotency_key=?').bind(key).first();
  if (previous) return { success: true, duplicate: true, inserted: previous.inserted_count };
  let statements = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const raw = JSON.stringify(row);
    const hash = await sha256(raw);
    const rowId = await sha256(`${key}:${rowIndex}:${raw}`);
    if (sourceTable === 'Data Member') {
      const id = String(pick(row, 'MEMBER_ID', 'member_id'));
      if (!id) continue;
      const mobile = String(pick(row, 'MOBILE', 'mobile'));
      statements.push(db.prepare('INSERT INTO members(member_id,name,tier,mobile,mobile_digits,source_hash) VALUES(?,?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET name=excluded.name,tier=excluded.tier,mobile=excluded.mobile,mobile_digits=excluded.mobile_digits,source_hash=excluded.source_hash,updated_at=CURRENT_TIMESTAMP').bind(id, String(pick(row,'NAMA','name')), String(pick(row,'TIER','tier')), mobile, digits(mobile), hash));
    } else if (sourceTable === 'Detail Transaksi') {
      statements.push(db.prepare('INSERT OR IGNORE INTO transactions(row_id,sales_number,bill_number,sales_date,branch,member_id,member_name,menu_category,menu_category_detail,menu,menu_code,qty,waiter,menu_notes,source_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(rowId, String(pick(row,'Sales Number','sales_number')), String(pick(row,'Bill Number','bill_number')), String(pick(row,'Sales Date','sales_date')), String(pick(row,'Branch','branch')), String(pick(row,'Loyalty Member Code','member_id')), String(pick(row,'Loyalty Member Name','member_name')), String(pick(row,'Menu Category','menu_category')), String(pick(row,'Menu Category Detail','menu_category_detail')), String(pick(row,'Menu','menu')), String(pick(row,'Menu Code','menu_code')), Number(pick(row,'Qty','qty') || 0), String(pick(row,'Waiter','waiter')), String(pick(row,'Menu Notes','menu_notes')), hash));
    } else if (sourceTable === 'Pax_Promotion') {
      statements.push(db.prepare('INSERT OR IGNORE INTO pax_promotions(row_id,sales_number,bill_number,promotion,pax_total,source_hash) VALUES(?,?,?,?,?,?)').bind(rowId, String(pick(row,'Sales Number','sales_number')), String(pick(row,'Bill Number','bill_number')), String(pick(row,'Promotion','promotion')), Number(pick(row,'Pax Total','pax_total') || 0), hash));
    } else if (sourceTable === 'Customer_Dashboard_Summary') {
      const id = String(pick(row,'member_id','MEMBER_ID'));
      if (!id) continue;
      const values = [id,'source','name','mobile','mobile_digits','tier','last_visit_date','last_sales_number','last_outlet','last_waiter','last_pax','last_promotion','weekday_visits','weekend_visits','total_visits','classified_visits','group_visits','group_ratio','favorite_menu_json','menu_note','last_order_json','has_transaction_history','updated_at'].map((name,i) => i === 0 ? id : pick(row,name));
      statements.push(db.prepare('INSERT INTO customer_summary(member_id,source,name,mobile,mobile_digits,tier,last_visit_date,last_sales_number,last_outlet,last_waiter,last_pax,last_promotion,weekday_visits,weekend_visits,total_visits,classified_visits,group_visits,group_ratio,favorite_menu_json,menu_note,last_order_json,has_transaction_history,updated_at,source_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET source=excluded.source,name=excluded.name,mobile=excluded.mobile,mobile_digits=excluded.mobile_digits,tier=excluded.tier,last_visit_date=excluded.last_visit_date,last_sales_number=excluded.last_sales_number,last_outlet=excluded.last_outlet,last_waiter=excluded.last_waiter,last_pax=excluded.last_pax,last_promotion=excluded.last_promotion,weekday_visits=excluded.weekday_visits,weekend_visits=excluded.weekend_visits,total_visits=excluded.total_visits,classified_visits=excluded.classified_visits,group_visits=excluded.group_visits,group_ratio=excluded.group_ratio,favorite_menu_json=excluded.favorite_menu_json,menu_note=excluded.menu_note,last_order_json=excluded.last_order_json,has_transaction_history=excluded.has_transaction_history,updated_at=excluded.updated_at,source_hash=excluded.source_hash').bind(...values, hash));
    } else return { success: false, message: 'Tabel sumber tidak dikenal.' };
  }
  if (statements.length) await db.batch(statements);
  await db.prepare('INSERT INTO migration_batches(idempotency_key,source_table,row_count,inserted_count) VALUES(?,?,?,?)').bind(key, sourceTable, rows.length, statements.length).run();
  return { success: true, duplicate: false, received: rows.length, inserted: statements.length };
}

async function migrationStatus(db) {
  const counts = {};
  for (const table of ['members','transactions','pax_promotions','customer_summary']) counts[table] = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n');
  const batches = await db.prepare('SELECT source_table,COUNT(*) batches,SUM(row_count) received,SUM(inserted_count) inserted FROM migration_batches GROUP BY source_table').all();
  return { success: true, counts, batches: batches.results || [] };
}

export { fallbackRecommendations, recommendationCandidates, sanitizeAiRecommendations };

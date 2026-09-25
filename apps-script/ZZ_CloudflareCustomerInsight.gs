/**
 * Customer Insight Cloudflare cutover.
 *
 * Runtime reads/writes use Cloudflare only. BigQuery is referenced exclusively
 * by the one-time resumable migration functions at the bottom of this file.
 * Add this file to the CSR Apps Script project with this exact ZZ_ prefix.
 *
 * Script Properties:
 *   CLOUDFLARE_CUSTOMER_INSIGHT_URL
 *   CLOUDFLARE_CUSTOMER_INSIGHT_API_KEY
 */

var CI_CF_URL_PROPERTY_ = 'CLOUDFLARE_CUSTOMER_INSIGHT_URL';
var CI_CF_KEY_PROPERTY_ = 'CLOUDFLARE_CUSTOMER_INSIGHT_API_KEY';
var CI_MIGRATION_STATE_PROPERTY_ = 'CUSTOMER_INSIGHT_MIGRATION_STATE_V1';
var CI_MIGRATION_TRIGGER_ = 'runCustomerInsightMigrationBatch';
var CI_PROJECT_ID_ = 'berita-acara-digital';
var CI_DATASET_ID_ = 'database_customer_insight';
var CI_BATCH_SIZE_ = 150;
var CI_RUN_BUDGET_MS_ = 240000;
var CI_MAX_PAGES_PER_RUN_ = 100;
var CI_TABLES_ = [
  { name: 'Data Member', expected: 241011 },
  { name: 'Detail Transaksi', expected: 1207582 },
  { name: 'Pax_Promotion', expected: 115605 },
  { name: 'Customer_Dashboard_Summary', expected: 298869 }
];

function ciConfig_() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty(CI_CF_URL_PROPERTY_) || '').replace(/\/$/, '');
  var key = String(props.getProperty(CI_CF_KEY_PROPERTY_) || '');
  if (!url || !key) throw new Error('Konfigurasi Cloudflare Customer Insight belum lengkap.');
  return { url: url, key: key };
}

function ciRequest_(path, options) {
  var cfg = ciConfig_();
  var params = options || {};
  params.muteHttpExceptions = true;
  params.headers = Object.assign({}, params.headers || {}, { 'x-api-key': cfg.key });
  if (params.payload && typeof params.payload !== 'string') {
    params.contentType = 'application/json';
    params.payload = JSON.stringify(params.payload);
  }
  var response = UrlFetchApp.fetch(cfg.url + path, params);
  var status = response.getResponseCode();
  var text = response.getContentText();
  var body;
  try { body = JSON.parse(text || '{}'); } catch (error) { body = { success: false, message: text || 'Respons Cloudflare tidak valid.' }; }
  if (status < 200 || status >= 300) throw new Error(body.message || ('Cloudflare HTTP ' + status));
  return body;
}

function testCloudflareCustomerInsight() {
  var cfg = ciConfig_();
  var response = UrlFetchApp.fetch(cfg.url + '/health', { muteHttpExceptions: true });
  Logger.log(response.getContentText());
  return JSON.parse(response.getContentText() || '{}');
}

/** Runtime override: no BigQuery fallback. */
searchCustomers = function(searchType, searchTerm) {
  try {
    var query = '?type=' + encodeURIComponent(searchType || '') + '&term=' + encodeURIComponent(searchTerm || '');
    return ciRequest_('/v1/customers/search' + query, { method: 'get' });
  } catch (error) {
    return { results: [], total: 0, error: 'Cloudflare Customer Insight: ' + error.message };
  }
};

/** Runtime override: no BigQuery fallback. */
loadCustomerDashboard = function(memberId, source, outlet) {
  var startedAt = Date.now();
  try {
    var result = ciRequest_('/v1/customers/' + encodeURIComponent(memberId || '') + '/dashboard', { method: 'get' });
    result.loadMs = Date.now() - startedAt;
    result.performanceMode = 'cloudflare-d1-summary-v1';
    result.recommendationsDeferred = true;
    return result;
  } catch (error) {
    return { success: false, message: 'Cloudflare Customer Insight: ' + error.message };
  }
};

/** Deferred AI recommendations: keeps the main dashboard fast. */
loadDashboardRecommendations = function(memberId, outlet, favoriteMenu, lastPax, customerTypes) {
  try {
    return ciRequest_('/v1/customers/' + encodeURIComponent(memberId || '') + '/recommendations', { method: 'get' });
  } catch (error) {
    return { success: false, message: 'Cloudflare AI Recommendation: ' + error.message };
  }
};

/** Runtime override: writes phone changes to Cloudflare only. */
updateCustomerPhone = function(phoneData) {
  try {
    var memberId = String((phoneData && phoneData.memberId) || '');
    var phone = String((phoneData && (phoneData.phone || phoneData.mobile)) || '').trim();
    var result = ciRequest_('/v1/customers/' + encodeURIComponent(memberId) + '/mobile', {
      method: 'patch',
      payload: { mobile: phone }
    });
    return { success: !!result.success, phone: phone, message: result.success ? 'Nomor HP berhasil disimpan ke Cloudflare.' : (result.message || 'Nomor HP gagal disimpan.') };
  } catch (error) {
    return { success: false, message: 'Cloudflare Customer Insight: ' + error.message };
  }
};

/** Used by deferred recommendations; obtains classification from D1 summary. */
getGroupSingleVisitorType = function(memberId) {
  var result = loadCustomerDashboard(memberId, '', '');
  return result && result.success ? result.groupSingleVisitor : { code: 'SINGLE_VISITOR', label: 'Single Visitor', desc: 'Belum ada pola group order yang kuat' };
};

function ciMigrationState_() {
  var raw = PropertiesService.getScriptProperties().getProperty(CI_MIGRATION_STATE_PROPERTY_);
  return raw ? JSON.parse(raw) : null;
}

function ciSaveMigrationState_(state) {
  state.updatedAt = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty(CI_MIGRATION_STATE_PROPERTY_, JSON.stringify(state));
  return state;
}

function ciDeleteMigrationTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === CI_MIGRATION_TRIGGER_) ScriptApp.deleteTrigger(trigger);
  });
}

function ciEnsureMigrationTrigger_() {
  var exists = ScriptApp.getProjectTriggers().some(function(trigger) { return trigger.getHandlerFunction() === CI_MIGRATION_TRIGGER_; });
  if (!exists) ScriptApp.newTrigger(CI_MIGRATION_TRIGGER_).timeBased().everyMinutes(1).create();
}

function startCustomerInsightCloudflareMigration() {
  var state = {
    status: 'RUNNING', tableIndex: 0, tableName: CI_TABLES_[0].name,
    jobId: '', jobLocation: '', pageToken: '', pages: 0, rowsSent: 0,
    perTable: {}, startedAt: new Date().toISOString(), lastError: ''
  };
  ciSaveMigrationState_(state);
  ciEnsureMigrationTrigger_();
  return runCustomerInsightMigrationBatch();
}

function retryCustomerInsightCloudflareMigration() {
  var state = ciMigrationState_();
  if (!state) return startCustomerInsightCloudflareMigration();
  state.status = 'RUNNING'; state.lastError = '';
  ciSaveMigrationState_(state); ciEnsureMigrationTrigger_();
  return runCustomerInsightMigrationBatch();
}

function stopCustomerInsightCloudflareMigration() {
  var state = ciMigrationState_() || {};
  state.status = 'PAUSED'; ciSaveMigrationState_(state); ciDeleteMigrationTriggers_();
  return state;
}

function getCustomerInsightCloudflareMigrationStatus() {
  var state = ciMigrationState_() || { status: 'NOT_STARTED', rowsSent: 0, perTable: {} };
  try { state.cloudflare = ciRequest_('/v1/migrate/status', { method: 'get' }); } catch (error) { state.cloudflareError = error.message; }
  var expected = CI_TABLES_.reduce(function(sum, item) { return sum + item.expected; }, 0);
  state.expectedRows = expected;
  state.percent = expected ? Math.min(100, Math.round((Number(state.rowsSent || 0) / expected) * 10000) / 100) : 0;
  Logger.log(JSON.stringify(state, null, 2));
  return state;
}

function ciDatasetLocation_() {
  var dataset = BigQuery.Datasets.get(CI_PROJECT_ID_, CI_DATASET_ID_);
  return String((dataset && dataset.location) || '');
}

function ciStartQuery_(tableName) {
  var request = {
    query: 'SELECT * FROM `' + CI_PROJECT_ID_ + '.' + CI_DATASET_ID_ + '.' + tableName + '`',
    useLegacySql: false,
    maxResults: CI_BATCH_SIZE_,
    timeoutMs: 20000
  };
  var response = BigQuery.Jobs.query(request, CI_PROJECT_ID_);
  if (!response.jobReference || !response.jobReference.jobId) throw new Error('BigQuery tidak mengembalikan jobId.');
  if (!response.jobComplete) {
    var options = { maxResults: CI_BATCH_SIZE_, timeoutMs: 20000 };
    options.location = response.jobReference.location || ciDatasetLocation_();
    response = BigQuery.Jobs.getQueryResults(CI_PROJECT_ID_, response.jobReference.jobId, options);
  }
  return response;
}

function ciNextQueryPage_(jobId, pageToken, jobLocation) {
  var options = { maxResults: CI_BATCH_SIZE_, pageToken: pageToken, timeoutMs: 20000 };
  if (jobLocation) options.location = jobLocation;
  return BigQuery.Jobs.getQueryResults(CI_PROJECT_ID_, jobId, options);
}

function ciValue_(cell) {
  if (!cell || cell.v === null || cell.v === undefined) return null;
  if (cell.v && typeof cell.v === 'object' && cell.v.f) return cell.v.f.map(ciValue_);
  return cell.v;
}

function ciRows_(response) {
  var fields = (response.schema && response.schema.fields) || [];
  return (response.rows || []).map(function(row) {
    var result = {};
    fields.forEach(function(field, index) { result[field.name] = ciValue_((row.f || [])[index]); });
    return result;
  });
}

function runCustomerInsightMigrationBatch() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { success: false, message: 'Batch lain masih berjalan.' };
  try {
    var state = ciMigrationState_();
    if (!state || state.status !== 'RUNNING') return state || { status: 'NOT_STARTED' };
    var startedAt = Date.now();
    var pagesThisRun = 0;
    while (state.tableIndex < CI_TABLES_.length && pagesThisRun < CI_MAX_PAGES_PER_RUN_ && Date.now() - startedAt < CI_RUN_BUDGET_MS_) {
      var table = CI_TABLES_[state.tableIndex];
      state.tableName = table.name;
      var response;
      if (!state.jobId) {
        response = ciStartQuery_(table.name);
        state.jobId = response.jobReference.jobId;
        state.jobLocation = response.jobReference.location || ciDatasetLocation_();
      } else {
        if (!state.jobLocation) state.jobLocation = ciDatasetLocation_();
        response = ciNextQueryPage_(state.jobId, state.pageToken, state.jobLocation);
      }
      if (!response.jobComplete) {
        ciSaveMigrationState_(state);
        break;
      }
      var rows = ciRows_(response);
      if (rows.length) {
        var pageKey = table.name.replace(/\W+/g, '_') + ':' + state.jobId + ':' + (state.pageToken || 'first');
        var upload = ciRequest_('/v1/migrate/batch', {
          method: 'post',
          payload: { table: table.name, idempotencyKey: pageKey, rows: rows }
        });
        if (!upload.duplicate) {
          state.rowsSent += rows.length;
          state.perTable[table.name] = Number(state.perTable[table.name] || 0) + rows.length;
        }
        state.pages += 1;
        pagesThisRun += 1;
      }
      state.pageToken = response.pageToken || '';
      if (!state.pageToken) {
        state.tableIndex += 1;
        state.jobId = '';
        state.jobLocation = '';
        state.pageToken = '';
        state.tableName = state.tableIndex < CI_TABLES_.length ? CI_TABLES_[state.tableIndex].name : '';
      }
      state.lastError = '';
      state.consecutiveErrors = 0;
      ciSaveMigrationState_(state);
    }
    state.lastRunPages = pagesThisRun;
    state.lastRunDurationMs = Date.now() - startedAt;
    if (state.tableIndex >= CI_TABLES_.length) {
      state.status = 'COMPLETE'; state.completedAt = new Date().toISOString(); ciDeleteMigrationTriggers_();
    }
    ciSaveMigrationState_(state);
    return getCustomerInsightCloudflareMigrationStatus();
  } catch (error) {
    var failed = ciMigrationState_() || {};
    failed.consecutiveErrors = Number(failed.consecutiveErrors || 0) + 1;
    failed.lastError = error.message;
    failed.status = failed.consecutiveErrors >= 10 ? 'ERROR' : 'RUNNING';
    ciSaveMigrationState_(failed);
    if (failed.status === 'ERROR') ciDeleteMigrationTriggers_();
    throw error;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Merchforce — HTTP router.
 * All calls: POST JSON {token, action, ...} to the /exec URL.
 * Public actions need API_TOKEN. Admin actions additionally need adminKey (ADMIN_PASS).
 * doGet serves a health check only.
 */

function doGet() {
  return json_({ ok: true, app: APP_NAME, ts: String(now_()) });
}

function doPost(e) {
  var p;
  try { p = JSON.parse(e.postData.contents); }
  catch (err) { return err_('Bad JSON'); }

  try {
    if (p.action === 'setup') return json_(setup_(p));

    if (String(p.token) !== props_().getProperty('API_TOKEN')) return err_('Bad token');

    var PUBLIC = {
      site:    fnSite_,
      catalog: fnCatalog_,
      product: fnProduct_,
      track:   fnTrack_,
      request: fnRequestSubmit_,
      login:   fnLogin_,
      syncPing: fnSyncPing_,
      syncPush: fnSyncPush_
    };
    var ADMIN = {
      adminUnlock:        fnAdminUnlock_,
      adminRequests:      fnAdminRequests_,
      adminRequestUpdate: fnAdminRequestUpdate_,
      adminCatalog:       fnAdminCatalog_,
      adminProductSave:   fnAdminProductSave_,
      adminProductDelete: fnAdminProductDelete_,
      adminBrandSave:     fnAdminBrandSave_,
      adminBrandDelete:   fnAdminBrandDelete_,
      adminImageUpload:   fnAdminImageUpload_,
      adminUsers:         fnAdminUsers_,
      adminUserSave:      fnAdminUserSave_,
      adminAnalytics:     fnAdminAnalytics_,
      adminSettings:      fnAdminSettings_,
      adminExportCsv:     fnAdminExportCsv_,
      adminSyncPreview:   fnAdminSyncPreview_,
      adminSyncRun:       fnAdminSyncRun_,
      adminSyncSchedule:  fnAdminSyncSchedule_,
      adminSyncMapSave:   fnAdminSyncMapSave_,
      adminSyncMapDelete: fnAdminSyncMapDelete_,
      adminSyncTemplate:  fnAdminSyncTemplate_,
      adminDedupe:        fnAdminDedupe_
    };

    if (PUBLIC[p.action]) {
      // gated mode: catalog data requires a valid session (login stays open)
      var gatedActions = { catalog: 1, product: 1, request: 1 };
      if (gatedActions[p.action] && getSettings_().access_mode === 'gated') {
        if (!validSession_(p.session)) return err_('Sign-in required');
      }
      return PUBLIC[p.action](p);
    }
    if (ADMIN[p.action]) {
      if (String(p.adminKey) !== props_().getProperty('ADMIN_PASS')) {
        audit_('anon', 'admin_denied', p.action, '');
        return err_('Bad admin key');
      }
      return ADMIN[p.action](p);
    }
    return err_('Unknown action: ' + p.action);
  } catch (ex) {
    return err_(ex.message || String(ex));
  }
}

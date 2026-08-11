/**
 * Historical Shopify last-click backfill for the Reise SSOT Sync project.
 *
 * Add this file to the same Apps Script project that already contains
 * CustomerJourneySummary.gs. Run CJ_startLaunchHistoryBackfill() once.
 * The trigger processes one seven-day block every ten minutes and removes
 * itself after reaching the end date.
 */

var CJ_LAUNCH_HISTORY_START = '2025-12-14';
var CJ_LAUNCH_HISTORY_END = '2026-03-17';
var CJ_LAUNCH_HISTORY_CHUNK_DAYS = 7;
var CJ_LAUNCH_HISTORY_CURSOR_PROP = 'CJ_LAUNCH_HISTORY_CURSOR';
var CJ_LAUNCH_HISTORY_TRIGGER = 'CJ_continueLaunchHistoryBackfill';

function CJ_startLaunchHistoryBackfill() {
  CJ_assertLaunchHistoryDependencies_();
  var props = PropertiesService.getScriptProperties();
  props.setProperty(CJ_LAUNCH_HISTORY_CURSOR_PROP, CJ_LAUNCH_HISTORY_START);
  CJ_deleteLaunchHistoryTriggers_();
  ScriptApp.newTrigger(CJ_LAUNCH_HISTORY_TRIGGER)
    .timeBased()
    .everyMinutes(10)
    .create();
  return CJ_continueLaunchHistoryBackfill();
}

function CJ_continueLaunchHistoryBackfill() {
  CJ_assertLaunchHistoryDependencies_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    var cursor = props.getProperty(CJ_LAUNCH_HISTORY_CURSOR_PROP) || CJ_LAUNCH_HISTORY_START;
    if (cursor > CJ_LAUNCH_HISTORY_END) {
      return CJ_finishLaunchHistoryBackfill_();
    }

    var chunkEnd = CJ_shiftYmd_(cursor, CJ_LAUNCH_HISTORY_CHUNK_DAYS - 1);
    if (chunkEnd > CJ_LAUNCH_HISTORY_END) chunkEnd = CJ_LAUNCH_HISTORY_END;

    var cfg = CJ_getConfig_();
    CJ_ensureDatasetAndTable_(cfg);
    var result = CJ_fetchAndInsert_(cfg, {
      searchQuery: 'processed_at:>=' + cursor + ' processed_at:<=' + chunkEnd,
      cutoffUpdatedAtIso: null,
      onlyPending: false
    });

    var nextCursor = CJ_shiftYmd_(chunkEnd, 1);
    props.setProperty(CJ_LAUNCH_HISTORY_CURSOR_PROP, nextCursor);
    var done = nextCursor > CJ_LAUNCH_HISTORY_END;
    if (done) CJ_deleteLaunchHistoryTriggers_();

    var output = {
      ok: true,
      start: cursor,
      end: chunkEnd,
      next: done ? null : nextCursor,
      done: done,
      result: result
    };
    Logger.log(JSON.stringify(output));
    return output;
  } finally {
    lock.releaseLock();
  }
}

function CJ_launchHistoryBackfillStatus() {
  var cursor = PropertiesService.getScriptProperties()
    .getProperty(CJ_LAUNCH_HISTORY_CURSOR_PROP);
  return {
    start: CJ_LAUNCH_HISTORY_START,
    end: CJ_LAUNCH_HISTORY_END,
    next: cursor || CJ_LAUNCH_HISTORY_START,
    done: Boolean(cursor && cursor > CJ_LAUNCH_HISTORY_END),
    triggerActive: ScriptApp.getProjectTriggers().some(function (trigger) {
      return trigger.getHandlerFunction() === CJ_LAUNCH_HISTORY_TRIGGER;
    })
  };
}

function CJ_cancelLaunchHistoryBackfill() {
  CJ_deleteLaunchHistoryTriggers_();
  return CJ_launchHistoryBackfillStatus();
}

function CJ_assertLaunchHistoryDependencies_() {
  var missing = [];
  if (typeof CJ_getConfig_ !== 'function') missing.push('CJ_getConfig_');
  if (typeof CJ_ensureDatasetAndTable_ !== 'function') missing.push('CJ_ensureDatasetAndTable_');
  if (typeof CJ_fetchAndInsert_ !== 'function') missing.push('CJ_fetchAndInsert_');
  if (!missing.length) return;
  throw new Error(
    'Este arquivo deve ficar no mesmo projeto Apps Script "Reise SSOT Sync" ' +
    'que ja contem CustomerJourneySummary.gs. Funcoes ausentes: ' +
    missing.join(', ')
  );
}

function CJ_finishLaunchHistoryBackfill_() {
  CJ_deleteLaunchHistoryTriggers_();
  return {
    ok: true,
    done: true,
    start: CJ_LAUNCH_HISTORY_START,
    end: CJ_LAUNCH_HISTORY_END,
    next: null
  };
}

function CJ_deleteLaunchHistoryTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === CJ_LAUNCH_HISTORY_TRIGGER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function CJ_shiftYmd_(ymd, days) {
  var date = new Date(ymd + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
}

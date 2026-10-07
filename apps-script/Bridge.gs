/**
 * Lost & POD desk — Google bridge (no Google Cloud project needed).
 *
 * Runs as YOUR Google account, so it can read every tracker you can open and search/send from your
 * mailbox. The dashboard calls it over HTTPS with a shared secret.
 *
 * Install (once):
 *   1. Open any Google Sheet → Extensions → Apps Script. Delete the sample code, paste this whole file.
 *   2. Project Settings (gear) → Script properties → Add property:
 *        BRIDGE_SECRET = <the long random text printed by `npm run setup`, or any 40+ random characters>
 *   3. Deploy → New deployment → type "Web app":
 *        Execute as: Me    Who has access: Anyone
 *      → Deploy → Authorize access (choose your shadowfax.in account) → copy the Web app URL.
 *   4. Put the URL in setup.env as GOOGLE_BRIDGE_URL and run `npm run setup`.
 * After editing this file later: Deploy → Manage deployments → edit → Version: New version.
 */

function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var secret = PropertiesService.getScriptProperties().getProperty('BRIDGE_SECRET');
    if (!secret || secret.length < 20) throw new Error('BRIDGE_SECRET script property is not set (Project Settings → Script properties).');
    if (req.secret !== secret) throw new Error('unauthorized');
    out = { ok: true, data: handle_(req.action, req.params || {}) };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, bridge: 'lost-pod', version: 1 }))
    .setMimeType(ContentService.MimeType.JSON);
}

function handle_(action, p) {
  switch (action) {
    case 'ping':
      return { email: Session.getEffectiveUser().getEmail(), version: 1 };

    case 'workbook': {
      var ss = SpreadsheetApp.openById(p.workbookId);
      return {
        title: ss.getName(),
        tabs: ss.getSheets().map(function (s) {
          return { title: s.getName(), rows: s.getMaxRows(), cols: s.getMaxColumns(), hidden: s.isSheetHidden() };
        }),
      };
    }

    case 'readTab': {
      var sh = SpreadsheetApp.openById(p.workbookId).getSheetByName(p.sheetName);
      if (!sh) throw new Error('Tab "' + p.sheetName + '" not found');
      var rows = sh.getLastRow(), cols = sh.getLastColumn();
      if (!rows || !cols) return [];
      if (p.maxRows) rows = Math.min(rows, p.maxRows);
      // Values exactly as displayed ("17 Jul", "#REF!") — the dashboard normalises them.
      return sh.getRange(1, 1, rows, cols).getDisplayValues();
    }

    case 'searchThreads': {
      var threads = GmailApp.search(p.query, 0, Math.min(p.max || 15, 30));
      return threads.map(function (t) {
        var msgs = t.getMessages();
        var first = msgs[0];
        return {
          threadId: t.getId(),
          subject: t.getFirstMessageSubject(),
          from: first.getFrom(),
          date: first.getDate().toISOString(),
          snippet: msgs[msgs.length - 1].getPlainBody().replace(/\s+/g, ' ').slice(0, 200),
          messageCount: t.getMessageCount(),
        };
      });
    }

    case 'getThread': {
      var th = GmailApp.getThreadById(p.threadId);
      if (!th) throw new Error('Thread not found');
      return {
        threadId: th.getId(),
        subject: th.getFirstMessageSubject(),
        messages: th.getMessages().map(function (m) {
          return {
            id: m.getId(),
            from: m.getFrom(),
            to: m.getTo(),
            date: m.getDate().toISOString(),
            subject: m.getSubject(),
            text: m.getPlainBody(),
            html: m.getBody(),
            attachments: m.getAttachments({ includeInlineImages: false }).map(function (a) { return a.getName(); }),
          };
        }),
      };
    }

    case 'sendMail': {
      var opts = { htmlBody: p.html, name: p.senderName || 'Lost & POD desk' };
      if (p.cc && p.cc.length) opts.cc = p.cc.join(',');
      if (p.attachments && p.attachments.length) {
        opts.attachments = p.attachments.map(function (a) {
          return Utilities.newBlob(Utilities.base64Decode(a.base64), a.contentType, a.filename);
        });
      }
      GmailApp.sendEmail(p.to.join(','), p.subject, 'This email needs an HTML-capable mail client.', opts);
      return { sent: true };
    }

    default:
      throw new Error('Unknown action ' + action);
  }
}

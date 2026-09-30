/**
 * Stars and Scrubs Pick'em — weekly review emailer (Google Apps Script)
 *
 * Setup (about 3 minutes, from a computer or phone browser signed in as rgupta42@gmail.com):
 * 1. Go to script.google.com → New project. Name it "Pick'em emailer".
 * 2. Delete the sample code and paste this whole file. Click Save.
 * 3. Deploy → New deployment → gear icon → Web app.
 *      Execute as: Me   ·   Who has access: Anyone
 *    Click Deploy, then Authorize access and allow Gmail sending.
 * 4. Copy the Web app URL (ends in /exec) and send it to Claude, or paste it into
 *    config.js as window.REPORT_URL.
 *
 * Recipients are fixed here, so the page can only ever email these two addresses.
 */
const RECIPIENTS = 'rgupta42@gmail.com,vkudur@gmail.com';

function doPost(e) {
  const data = JSON.parse(e.postData.contents || '{}');
  const subject = String(data.subject || "Stars and Scrubs Pick'em review").slice(0, 200);
  const html = String(data.html || '').slice(0, 400000);
  if (!html) return ContentService.createTextOutput('empty');
  MailApp.sendEmail({ to: RECIPIENTS, subject: subject, htmlBody: html, name: "Stars and Scrubs Pick'em" });
  return ContentService.createTextOutput('sent');
}

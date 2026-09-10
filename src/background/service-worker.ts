/**
 * MeetSwitcher Background Service Worker
 */

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[MeetSwitcher] Extension successfully installed.');
  } else if (details.reason === 'update') {
    console.log('[MeetSwitcher] Extension updated to version', chrome.runtime.getManifest().version);
  }
});

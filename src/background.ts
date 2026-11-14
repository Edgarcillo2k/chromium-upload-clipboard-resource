// Clicking the toolbar icon opens the settings page.
chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});

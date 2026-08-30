const api = typeof browser !== 'undefined' ? browser : chrome;
const DEFAULTS = {
  enabled: true,
  sensitivity: 1,
  invert: false,
  cancelOnWheel: false,
  disabledSites: [],
  autoUpdateCheck: false, // opt-in, matching this dev's other tools (Pocket, Firefly)
  lastUpdateCheck: 0,
};

const UPDATE_REPO = 'Micropeptide/MiddleClick-AutoScroll-Safari';
const UPDATE_CHECK_COOLDOWN_MS = 20 * 60 * 60 * 1000; // ~once/day even with auto-check on
const CURRENT_VERSION = api.runtime.getManifest().version;

function storageGet() {
  if (api.storage.sync) {
    return api.storage.sync.get(DEFAULTS).catch(() => api.storage.local.get(DEFAULTS));
  }
  return api.storage.local.get(DEFAULTS);
}

function storageSet(partial) {
  if (api.storage.sync) {
    return api.storage.sync.set(partial).catch(() => api.storage.local.set(partial));
  }
  return api.storage.local.set(partial);
}

function storageClear() {
  const clearOne = (area) => (area ? area.clear().catch(() => {}) : Promise.resolve());
  return Promise.all([clearOne(api.storage.sync), clearOne(api.storage.local)]);
}

const els = {
  enabled: document.getElementById('enabled'),
  sensitivity: document.getElementById('sensitivity'),
  sensitivityValue: document.getElementById('sensitivityValue'),
  invert: document.getElementById('invert'),
  cancelOnWheel: document.getElementById('cancelOnWheel'),
  siteToggle: document.getElementById('siteToggle'),
  siteLabel: document.getElementById('siteLabel'),
  permBanner: document.getElementById('permBanner'),
  permHost: document.getElementById('permHost'),
  permGrant: document.getElementById('permGrant'),
  reset: document.getElementById('reset'),
  autoUpdateCheck: document.getElementById('autoUpdateCheck'),
  updateCheckNow: document.getElementById('updateCheckNow'),
  updateStatus: document.getElementById('updateStatus'),
  version: document.getElementById('version'),
};

let settings = { ...DEFAULTS };
let currentHost = null;
let currentOriginPattern = null;

function originPatternFor(url) {
  if (url.protocol === 'file:') return 'file:///*';
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return `${url.protocol}//${url.hostname}/*`;
}

async function init() {
  const stored = await storageGet();
  settings = { ...DEFAULTS, ...stored };

  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      const url = new URL(tab.url);
      currentHost = url.hostname || url.protocol;
      currentOriginPattern = originPatternFor(url);
    }
  } catch (_) {
    currentHost = null;
    currentOriginPattern = null;
  }

  await render();
  checkForUpdate(false);
}

async function render() {
  els.enabled.checked = settings.enabled;
  els.sensitivity.value = settings.sensitivity;
  els.sensitivityValue.textContent = `${Number(settings.sensitivity).toFixed(1)}x`;
  els.invert.checked = settings.invert;
  els.cancelOnWheel.checked = settings.cancelOnWheel;

  if (currentHost) {
    els.siteLabel.textContent = currentHost;
    els.siteToggle.checked = !settings.disabledSites.includes(currentHost);
    els.siteToggle.disabled = false;
  } else {
    els.siteLabel.textContent = 'this page';
    els.siteToggle.checked = true;
    els.siteToggle.disabled = true;
  }

  els.autoUpdateCheck.checked = settings.autoUpdateCheck;
  els.version.textContent = `v${CURRENT_VERSION}`;

  await renderPermissionBanner();
}

function isNewerVersion(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

// Checks GitHub's latest release tag against the installed version. Never
// downloads or installs anything itself — at most it shows a link the user
// clicks through to the release page, same as this dev's other tools.
async function checkForUpdate(force) {
  if (!force) {
    if (!settings.autoUpdateCheck) return;
    if (Date.now() - settings.lastUpdateCheck < UPDATE_CHECK_COOLDOWN_MS) return;
  }

  els.updateStatus.textContent = 'Checking…';
  try {
    const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    save({ lastUpdateCheck: Date.now() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const latest = String(data.tag_name || '').replace(/^v/, '');
    if (latest && isNewerVersion(latest, CURRENT_VERSION)) {
      els.updateStatus.innerHTML = `Update available: v${latest} — <a href="#" id="updateLink">View release</a>`;
      document.getElementById('updateLink').addEventListener('click', (ev) => {
        ev.preventDefault();
        api.tabs.create({ url: data.html_url || `https://github.com/${UPDATE_REPO}/releases/latest` });
      });
    } else {
      els.updateStatus.textContent = `You're up to date (v${CURRENT_VERSION}).`;
    }
  } catch (_) {
    els.updateStatus.textContent = force ? "Couldn't check — try again later." : '';
  }
}

async function renderPermissionBanner() {
  els.permBanner.hidden = true;
  if (!currentOriginPattern || !api.permissions || !api.permissions.contains) return;
  try {
    const granted = await api.permissions.contains({ origins: [currentOriginPattern] });
    if (!granted) {
      els.permHost.textContent = currentHost;
      els.permBanner.hidden = false;
    }
  } catch (_) {
    // Permissions API not fully supported here — say nothing rather than guess.
  }
}

function save(partial) {
  settings = { ...settings, ...partial };
  storageSet(partial);
}

els.enabled.addEventListener('change', () => save({ enabled: els.enabled.checked }));

els.sensitivity.addEventListener('input', () => {
  const v = parseFloat(els.sensitivity.value);
  els.sensitivityValue.textContent = `${v.toFixed(1)}x`;
  save({ sensitivity: v });
});

els.invert.addEventListener('change', () => save({ invert: els.invert.checked }));

els.cancelOnWheel.addEventListener('change', () => save({ cancelOnWheel: els.cancelOnWheel.checked }));

els.siteToggle.addEventListener('change', () => {
  if (!currentHost) return;
  const set = new Set(settings.disabledSites);
  if (els.siteToggle.checked) set.delete(currentHost);
  else set.add(currentHost);
  save({ disabledSites: Array.from(set) });
});

els.permGrant.addEventListener('click', async () => {
  if (!currentOriginPattern || !api.permissions || !api.permissions.request) return;
  try {
    const granted = await api.permissions.request({ origins: [currentOriginPattern] });
    if (granted) els.permBanner.hidden = true;
  } catch (_) {
    // Fall through — the banner's own text points at the manual Settings path.
  }
});

els.reset.addEventListener('click', async (ev) => {
  ev.preventDefault();
  await storageClear();
  settings = { ...DEFAULTS };
  await render();
});

els.autoUpdateCheck.addEventListener('change', () => save({ autoUpdateCheck: els.autoUpdateCheck.checked }));

els.updateCheckNow.addEventListener('click', () => checkForUpdate(true));

init();

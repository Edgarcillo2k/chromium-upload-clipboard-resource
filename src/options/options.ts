import { loadSettings, saveSettings, normaliseSite, type Settings } from '../shared/settings.ts';

const form = document.querySelector<HTMLFormElement>('#form')!;
const saved = document.querySelector<HTMLElement>('#saved')!;
const field = <T extends Element>(name: string) => form.elements.namedItem(name) as T;

function render(s: Settings): void {
  field<HTMLInputElement>('enabled').checked = s.enabled;
  for (const radio of form.querySelectorAll<HTMLInputElement>('input[name="mode"]')) radio.checked = radio.value === s.mode;
  field<HTMLTextAreaElement>('sites').value = s.sites.join('\n');
  field<HTMLSelectElement>('bypassKey').value = s.bypassKey;
  field<HTMLInputElement>('pasteText').checked = s.pasteText;
}

function read(): Settings {
  return {
    enabled: field<HTMLInputElement>('enabled').checked,
    mode: (form.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value ?? 'denylist') as Settings['mode'],
    sites: field<HTMLTextAreaElement>('sites')
      .value.split('\n')
      .map((line) => (line.trim().startsWith('#') ? line.trim() : normaliseSite(line)))
      .filter(Boolean),
    bypassKey: field<HTMLSelectElement>('bypassKey').value as Settings['bypassKey'],
    pasteText: field<HTMLInputElement>('pasteText').checked,
  };
}

let timer: number | undefined;
async function save(): Promise<void> {
  await saveSettings(read());
  saved.textContent = 'Saved.';
  clearTimeout(timer);
  timer = window.setTimeout(() => (saved.textContent = ''), 2500);
}

form.addEventListener('change', () => void save());
// Normalise the site list when leaving the textarea.
field<HTMLTextAreaElement>('sites').addEventListener('blur', () => render(read()));

render(await loadSettings());

// Logs every change event so both humans and the e2e test can see what arrived.
window.uploads = [];
window.cancels = 0;
function describe(input) {
  return Array.from(input.files).map((f) => `${f.name} (${f.type || '?'}, ${f.size} B)`).join(', ') || '(none)';
}
function track(input, label) {
  input.addEventListener('change', () => {
    const files = Array.from(input.files).map((f) => ({ name: f.name, type: f.type, size: f.size }));
    window.uploads.push({ label, files });
    const li = document.createElement('li');
    li.textContent = `${label}: ${describe(input)}`;
    document.querySelector('#log').prepend(li);
    for (const f of input.files) {
      if (f.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        img.height = 40;
        li.append(' ', img);
      }
    }
  });
  input.addEventListener('cancel', () => {
    window.cancels++;
    const li = document.createElement('li');
    li.textContent = `${label}: cancelled`;
    document.querySelector('#log').prepend(li);
  });
}

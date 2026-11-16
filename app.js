const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries([
  'file-input', 'upload-button', 'replace-button', 'drop-zone', 'upload-empty',
  'loaded-evidence', 'drop-overlay', 'evidence-image', 'evidence-label', 'evidence-state',
  'case-tag', 'image-surface', 'image-window', 'zoom-button', 'zoom-label', 'chat-log',
  'answer-form', 'answer', 'send-button', 'send-label', 'answer-hint', 'character-count',
  'score', 'score-unit', 'solved-count', 'known-origin', 'origin-source', 'teacher-settings',
  'connection-status', 'connection-text', 'help-dialog', 'reset-dialog', 'toast',
].map((id) => [id, $(id)]));
const guessButtons = [...document.querySelectorAll('[data-guess]')];
const acceptedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const state = { score: 0, solved: 0, caseNumber: 0, current: null, guess: null, busy: false, loading: false, connected: false, checking: false };
let toastTimer;
let dragDepth = 0;

function toast(message) {
  clearTimeout(toastTimer);
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 6500);
}

function addMessage(role, paragraphs, result = null) {
  const entry = document.createElement('article');
  entry.className = `chat-entry ${role}`;
  const author = document.createElement('p');
  author.className = 'chat-author';
  author.textContent = role === 'student' ? 'Ty / detektiv v terénu' : role === 'system' ? 'Zpráva z centrály' : 'Vrchní vyšetřovatel';
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  for (const paragraph of paragraphs) {
    const p = document.createElement('p');
    p.textContent = paragraph;
    bubble.append(p);
  }
  if (result) {
    if (result.source) {
      const source = document.createElement('p');
      source.className = 'message-source';
      source.textContent = `Zdroj uvedený učitelem: ${result.source}`;
      bubble.append(source);
    }
    const breakdown = document.createElement('div');
    breakdown.className = 'score-breakdown';
    const badges = [
      [result.guessCorrect === null ? 'Tip: původ není ověřen' : `${result.points.guess ? '+1' : '+0'} za tip`, result.points.guess],
      [`+${result.points.argument} za argument`, result.points.argument],
    ];
    for (const [text, awarded] of badges) {
      const badge = document.createElement('span');
      badge.className = `point-badge${awarded ? '' : ' no-point'}`;
      badge.textContent = text;
      breakdown.append(badge);
    }
    bubble.append(breakdown);
  }
  entry.append(author, bubble);
  ui['chat-log'].append(entry);
  scrollChat();
  return entry;
}

function addDivider(text) {
  const divider = document.createElement('p');
  divider.className = 'chat-divider';
  divider.textContent = text;
  ui['chat-log'].append(divider);
}

function scrollChat() {
  ui['chat-log'].scrollTop = ui['chat-log'].scrollHeight;
}

function welcome() {
  addDivider('Začátek vyšetřování');
  addMessage('assistant', [
    'Vítej v akademii, detektive. Dnes prověříme, co je skutečná fotografie a co mohlo vzniknout pomocí AI. Nahraj první obrázek na důkazní stůl.',
    'Pak napiš svůj tip a alespoň jeden konkrétní detail. Získáš 1 bod za správný tip u ověřeného obrázku a 1 bod za logický argument. Když původ neznáme, hodnotíme jen argument — samotný vzhled není jistý důkaz.',
  ]);
}

function setControls() {
  const locked = state.busy || state.loading;
  const canAnswer = Boolean(state.current && !state.current.evaluated && !locked);
  ui.answer.disabled = !canAnswer;
  ui['send-button'].disabled = !canAnswer || !state.connected;
  ui['upload-button'].disabled = locked;
  ui['replace-button'].disabled = locked;
  ui['file-input'].disabled = locked;
  ui['known-origin'].disabled = locked;
  ui['origin-source'].disabled = locked;
  $('reset-button').disabled = locked;
  guessButtons.forEach((button) => { button.disabled = !canAnswer; });
  ui['send-label'].textContent = state.busy ? 'Zkoumám…' : 'Odeslat';
  ui['drop-zone'].setAttribute('aria-busy', String(state.loading));
  if (state.loading) ui['answer-hint'].textContent = 'Připravuji důkaz…';
  else if (state.busy) ui['answer-hint'].textContent = 'Vyšetřovatel zkoumá obrázek. Chvilku strpení…';
  else if (!state.current) ui['answer-hint'].textContent = 'Nejdřív nahraj první důkaz.';
  else if (state.current.evaluated) ui['answer-hint'].textContent = 'Případ uzavřen. Nahraj další obrázek.';
  else if (!state.connected) ui['answer-hint'].textContent = 'Vyhodnocení čeká na připojení AI. Připojení ověříš nahoře.';
  else ui['answer-hint'].textContent = 'Napiš svůj tip a konkrétní detail, kterého sis všiml/a.';
}

async function checkConnection() {
  if (state.checking) return;
  state.checking = true;
  ui['connection-text'].textContent = 'Ověřuji připojení…';
  try {
    const response = await fetch('/api/config', { cache: 'no-store', signal: AbortSignal.timeout(7000) });
    const config = response.ok ? await response.json() : null;
    state.connected = config?.configured === true;
    ui['connection-status'].dataset.state = state.connected ? 'ready' : 'error';
    ui['connection-text'].textContent = state.connected ? 'AI připravena' : 'AI čeká na připojení';
    if (!state.connected && state.current) toast('AI zatím není nastavena na serveru. Nastavení popisuje README repozitáře.');
  } catch {
    state.connected = false;
    ui['connection-status'].dataset.state = 'error';
    ui['connection-text'].textContent = 'AI není připojena';
  } finally {
    state.checking = false;
    setControls();
  }
}

function chooseGuess(guess) {
  state.guess = guess;
  guessButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.guess === guess)));
}

function setZoom(zoomed) {
  ui['image-surface'].classList.toggle('is-zoomed', zoomed);
  ui['zoom-button'].setAttribute('aria-pressed', String(zoomed));
  ui['zoom-label'].textContent = zoomed ? 'Celý obrázek' : 'Zvětšit detail';
  ui['image-window'].scrollTop = 0;
  ui['image-window'].scrollLeft = 0;
}

async function prepareImage(file) {
  if (!acceptedTypes.has(file.type)) throw new Error('Vyber obrázek ve formátu JPG, PNG nebo WEBP.');
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('Obrázek musí mít nejvýše 10 MB a nesmí být prázdný.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) {
      throw new Error('Obrázek je příliš velký. Zmenši ho prosím pod 40 milionů pixelů.');
    }
    const ratio = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Prohlížeč nedokáže zpracovat obrázek. Zkus jiný prohlížeč.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // Stejný zmenšený obraz vidí žák i model. Původní název a EXIF se neposílají.
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    if (dataUrl.length > 6_500_000) throw new Error('Obrázek se nepodařilo dostatečně zmenšit. Vyber prosím menší soubor.');
    return dataUrl;
  } catch (error) {
    if (error.name === 'EncodingError') throw new Error('Soubor se nepodařilo přečíst jako obrázek. Zkus jiný JPG, PNG nebo WEBP.');
    throw error;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadEvidence(files) {
  if (state.busy || state.loading) return;
  if (files.length !== 1) { toast('Pro jeden případ vyber právě jeden obrázek.'); return; }
  const origin = ui['known-origin'].value;
  const source = ui['origin-source'].value.trim();
  if (origin !== 'unknown' && source.length < 3) {
    ui['teacher-settings'].open = true;
    toast('K ověřenému původu doplň zdroj, například „vlastní fotografie“ nebo název generátoru.');
    ui['origin-source'].focus();
    return;
  }
  state.loading = true;
  setControls();
  try {
    const image = await prepareImage(files[0]);
    state.caseNumber += 1;
    state.current = { id: crypto.randomUUID(), image, origin, source: origin === 'unknown' ? '' : source, evaluated: false, lastAttempt: '' };
    const number = String(state.caseNumber).padStart(3, '0');
    ui['evidence-image'].src = image;
    ui['upload-empty'].hidden = true;
    ui['loaded-evidence'].hidden = false;
    ui['case-tag'].textContent = `SPIS ${number}`;
    ui['evidence-label'].textContent = `DŮKAZ ${number}`;
    ui['evidence-state'].textContent = 'Čeká na tvůj verdikt';
    setZoom(false);
    ui.answer.value = '';
    ui['character-count'].textContent = '0';
    chooseGuess(null);
    ui['teacher-settings'].open = false;
    // Původ platí jen pro právě přijatý obrázek, nepřenáší se omylem do dalšího kola.
    ui['known-origin'].value = 'unknown';
    ui['origin-source'].value = '';
    addDivider(`Případ č. ${number}`);
    addMessage('assistant', ['Důkaz přijat. Co myslíš, detektive – je to skutečná fotka, nebo AI? Napiš svůj tip a aspoň jeden detail, který tě k tomu vedl.']);
  } catch (error) {
    toast(error.message || 'Obrázek se nepodařilo nahrát. Zkus jiný soubor.');
  } finally {
    state.loading = false;
    ui['file-input'].value = '';
    setControls();
  }
  if (state.current && !state.current.evaluated) ui.answer.focus({ preventScroll: true });
}

async function submitAnswer(event) {
  event.preventDefault();
  if (state.busy || state.loading || !state.current || state.current.evaluated) return;
  if (!state.connected) { toast('Vyhodnocení potřebuje připojenou AI. Ověř připojení v horním panelu.'); return; }
  const answer = ui.answer.value.trim();
  if (answer.length < 8) { toast('Přidej svůj tip a alespoň jeden konkrétní detail z obrázku.'); ui.answer.focus(); return; }
  const current = state.current;
  const attempt = JSON.stringify([state.guess, answer]);
  if (current.lastAttempt !== attempt) {
    const prefix = state.guess ? `Můj tip: ${state.guess === 'ai' ? 'vytvořeno AI' : 'skutečná fotka'}. ` : '';
    addMessage('student', [prefix + answer]);
    current.lastAttempt = attempt;
  }
  state.busy = true;
  setControls();
  const pending = document.createElement('div');
  pending.className = 'pending-message';
  const spinner = document.createElement('span');
  spinner.className = 'spinner';
  spinner.setAttribute('aria-hidden', 'true');
  const pendingLabel = document.createElement('span');
  pendingLabel.textContent = 'Zkoumám důkazy…';
  pending.append(spinner, pendingLabel);
  ui['chat-log'].append(pending);
  scrollChat();
  let succeeded = false;
  try {
    const response = await fetch('/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(65000),
      body: JSON.stringify({ caseId: current.id, image: current.image, answer, guess: state.guess, origin: current.origin, source: current.source }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || 'Vyšetřovatel se neozval. Zkus odeslání za chvíli znovu.');
    if (result?.caseId !== current.id || !Array.isArray(result.feedback) || !result.feedback.length
      || !result.feedback.every((paragraph) => typeof paragraph === 'string')
      || ![0, 1].includes(result.points?.guess) || ![0, 1].includes(result.points?.argument)
      || result.points.total !== result.points.guess + result.points.argument) {
      throw new Error('Z centrály přišla neúplná odpověď. Zkus odeslání znovu.');
    }
    if (state.current !== current || current.evaluated) return;
    current.evaluated = true;
    state.score += result.points.total;
    state.solved += 1;
    pending.remove();
    addMessage('assistant', result.feedback, result);
    ui['evidence-state'].textContent = 'Případ uzavřen';
    updateScore(result.points.total > 0);
    ui.answer.value = '';
    ui['character-count'].textContent = '0';
    succeeded = true;
  } catch (error) {
    pending.remove();
    const message = ['TimeoutError', 'AbortError'].includes(error.name)
      ? 'Spojení trvalo příliš dlouho. Tip zůstává rozepsaný; můžeš ho odeslat znovu.'
      : error instanceof TypeError ? 'Spojení s centrálou vypadlo. Tip zůstává rozepsaný; zkus to znovu.'
        : error.message;
    addMessage('system', [message, 'Tento pokus se neobodoval. Obrázek i tvoje odpověď zůstávají připravené.']);
  } finally {
    pending.remove();
    state.busy = false;
    setControls();
    if (succeeded) ui['replace-button'].focus({ preventScroll: true });
    else ui.answer.focus({ preventScroll: true });
  }
}

function updateScore(animate = false) {
  ui.score.textContent = String(state.score);
  ui['score-unit'].textContent = state.score === 1 ? 'bod' : state.score >= 2 && state.score <= 4 ? 'body' : 'bodů';
  ui['solved-count'].textContent = `${state.solved} ${state.solved === 1 ? 'uzavřený případ' : state.solved >= 2 && state.solved <= 4 ? 'uzavřené případy' : 'uzavřených případů'}`;
  if (animate) {
    const card = ui.score.closest('.score-card');
    card.classList.remove('score-up');
    requestAnimationFrame(() => card.classList.add('score-up'));
  }
}

function resetGame() {
  if (state.busy || state.loading) return;
  state.score = 0; state.solved = 0; state.caseNumber = 0; state.current = null;
  chooseGuess(null);
  ui['evidence-image'].removeAttribute('src');
  ui['upload-empty'].hidden = false;
  ui['loaded-evidence'].hidden = true;
  ui['case-tag'].textContent = 'SPIS —';
  ui['chat-log'].replaceChildren();
  ui.answer.value = '';
  ui['character-count'].textContent = '0';
  ui['known-origin'].value = 'unknown';
  ui['origin-source'].value = '';
  ui['teacher-settings'].open = false;
  ui.toast.hidden = true;
  clearTimeout(toastTimer);
  updateScore(); welcome(); setControls();
  ui['reset-dialog'].close();
  ui['upload-button'].focus();
}

ui['upload-button'].addEventListener('click', () => ui['file-input'].click());
ui['replace-button'].addEventListener('click', () => ui['file-input'].click());
ui['file-input'].addEventListener('change', (event) => { if (event.target.files.length) loadEvidence([...event.target.files]); });
guessButtons.forEach((button) => button.addEventListener('click', () => { chooseGuess(button.dataset.guess === state.guess ? null : button.dataset.guess); ui.answer.focus({ preventScroll: true }); }));
ui.answer.addEventListener('input', () => { ui['character-count'].textContent = String(ui.answer.value.length); });
ui.answer.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); ui['answer-form'].requestSubmit(); }
});
ui['answer-form'].addEventListener('submit', submitAnswer);
ui['connection-status'].addEventListener('click', checkConnection);
ui['zoom-button'].addEventListener('click', () => setZoom(!ui['image-surface'].classList.contains('is-zoomed')));
ui['evidence-image'].addEventListener('click', () => setZoom(!ui['image-surface'].classList.contains('is-zoomed')));
$('help-button').addEventListener('click', () => ui['help-dialog'].showModal());
$('reset-button').addEventListener('click', () => ui['reset-dialog'].showModal());
$('confirm-reset').addEventListener('click', resetGame);
for (const dialog of [ui['help-dialog'], ui['reset-dialog']]) {
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
}

// Zabraň otevření přetaženého souboru místo aplikace i při puštění mimo stůl.
document.addEventListener('dragover', (event) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
document.addEventListener('drop', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault(); dragDepth = 0;
  ui['drop-overlay'].hidden = true;
  ui['drop-zone'].classList.remove('is-dragging');
});
ui['drop-zone'].addEventListener('dragenter', (event) => {
  if (state.busy || state.loading || !event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault(); dragDepth += 1;
  ui['drop-overlay'].hidden = false;
  ui['drop-zone'].classList.add('is-dragging');
});
ui['drop-zone'].addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) { ui['drop-overlay'].hidden = true; ui['drop-zone'].classList.remove('is-dragging'); }
});
ui['drop-zone'].addEventListener('drop', (event) => {
  event.preventDefault();
  if (event.dataTransfer?.files.length) loadEvidence([...event.dataTransfer.files]);
});

welcome();
setControls();
checkConnection();

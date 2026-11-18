CrossPoint.registerPlugin((container, api) => {
  const file = 'tasks.json';
  const path = api.dir + '/' + file;
  const maxBytes = 256 * 1024;
  const defaultSleep = { enabled: false, name: 'todo-list' };
  let tasks = [];
  let sleep = { ...defaultSleep };
  let saved = null;
  let ready = false;
  let busy = false;

  const style = document.createElement('style');
  style.textContent = `
    .todo-form { display: flex; gap: .5em; margin: 1em 0; }
    .todo-form input { flex: 1; min-width: 0; }
    .todo-list { padding: 0; list-style: none; }
    .todo-list li { display: flex; align-items: center; gap: .6em; margin: .6em 0; }
    .todo-list label { display: flex; align-items: center; gap: .6em; flex: 1; min-width: 0; }
    .todo-list label span { overflow-wrap: anywhere; }
    .todo-list .todo-done span { text-decoration: line-through; opacity: .7; }
    .todo-status { min-height: 1.5em; }
    .todo-error { color: #b42318; }
    .todo-sleep { margin-top: 1.5em; }
    .todo-sleep label { display: block; margin: .6em 0; }
  `;
  const heading = document.createElement('h2');
  heading.textContent = 'To-Do List';
  const description = document.createElement('p');
  description.textContent = 'Tasks are saved on this reader.';
  const form = document.createElement('form');
  form.className = 'todo-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Add a task';
  input.setAttribute('aria-label', 'New task');
  input.required = true;
  const add = document.createElement('button');
  add.type = 'submit';
  add.textContent = 'Add';
  form.append(input, add);
  const list = document.createElement('ul');
  list.className = 'todo-list';
  list.setAttribute('aria-label', 'Tasks');
  const empty = document.createElement('p');
  const status = document.createElement('p');
  status.className = 'todo-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'Reload list';
  const sleepSection = document.createElement('section');
  sleepSection.className = 'todo-sleep';
  const sleepHeading = document.createElement('h3');
  sleepHeading.textContent = 'Sleep screen';
  const sleepLabel = document.createElement('label');
  const sleepEnabled = document.createElement('input');
  sleepEnabled.type = 'checkbox';
  sleepLabel.append(sleepEnabled, document.createTextNode(' Show this list as a custom sleep image'));
  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Image name (without .bmp)';
  const sleepName = document.createElement('input');
  sleepName.type = 'text';
  sleepName.maxLength = 60;
  nameLabel.append(sleepName);
  const sleepHelp = document.createElement('p');
  sleepHelp.textContent = 'Saved in /.sleep/ for rotation. An existing image with this name will be replaced.';
  const saveSleep = document.createElement('button');
  saveSleep.type = 'button';
  saveSleep.textContent = 'Save sleep screen settings';
  sleepSection.append(sleepHeading, sleepLabel, nameLabel, sleepHelp, saveSleep);
  container.append(style, heading, description, form, list, empty, status, reload, sleepSection);

  function message(text, error = false) {
    status.textContent = text;
    status.className = error ? 'todo-status todo-error' : 'todo-status';
  }

  function render() {
    input.disabled = !ready || busy;
    add.disabled = !ready || busy;
    reload.disabled = busy;
    sleepEnabled.disabled = !ready || busy;
    sleepName.disabled = !ready || busy || !sleepEnabled.checked;
    saveSleep.disabled = !ready || busy;
    list.replaceChildren();
    empty.textContent = ready && tasks.length === 0 ? 'No tasks yet.' : '';
    tasks.forEach((task, index) => {
      const item = document.createElement('li');
      const label = document.createElement('label');
      if (task.done) label.className = 'todo-done';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = task.done;
      checkbox.disabled = !ready || busy;
      checkbox.addEventListener('change', () => {
        const next = tasks.map((entry, i) => i === index ? { ...entry, done: checkbox.checked } : entry);
        return save(next);
      });
      const text = document.createElement('span');
      text.textContent = task.text;
      label.append(checkbox, text);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Delete';
      remove.setAttribute('aria-label', 'Delete ' + task.text);
      remove.disabled = !ready || busy;
      remove.addEventListener('click', () => save(tasks.filter((_, i) => i !== index)));
      item.append(label, remove);
      list.append(item);
    });
  }

  async function read() {
    const response = await fetch(api.pluginFile(file), { cache: 'no-store' });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Unable to read tasks (HTTP ' + response.status + ').');
    return response.text();
  }

  function parse(raw) {
    if (raw === null) return { tasks: [], sleep: { ...defaultSleep } };
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || !Array.isArray(data.tasks) ||
        !data.tasks.every((task) => task && typeof task.text === 'string' &&
          task.text.trim() && typeof task.done === 'boolean') ||
        (data.sleep !== undefined && (!data.sleep || typeof data.sleep.enabled !== 'boolean' ||
          !validName(data.sleep.name)))) {
      throw new Error('The task file has an invalid format. Restore a backup before editing.');
    }
    return { tasks: data.tasks, sleep: data.sleep || { ...defaultSleep } };
  }

  function validName(name) {
    return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9 _-]{0,59}$/.test(name) && name.trim() === name;
  }

  async function sleepImage(items) {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to identify reader (HTTP ' + response.status + ').');
    const device = await response.json();
    const width = device.device === 'X3' ? 528 : 480;
    const height = device.device === 'X3' ? 792 : 800;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot create a sleep image.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText('To-Do List', 24, 48);
    ctx.font = '22px sans-serif';

    let y = 93;
    let truncated = false;
    for (const task of items) {
      const words = task.text.trim().split(/\s+/);
      const lines = [];
      let line = '';
      for (const word of words) {
        for (const char of Array.from(word)) {
          if (ctx.measureText(line + char).width > width - 80 && line) {
            lines.push(line);
            line = '';
          }
          line += char;
        }
        if (ctx.measureText(line + ' ').width <= width - 80) line += ' ';
      }
      if (line.trim()) lines.push(line.trimEnd());
      if (y + Math.max(0, lines.length - 1) * 29 > height - 58) {
        truncated = true;
        break;
      }
      ctx.strokeRect(25, y - 18, 19, 19);
      if (task.done) {
        ctx.beginPath();
        ctx.moveTo(28, y - 9);
        ctx.lineTo(33, y - 4);
        ctx.lineTo(42, y - 16);
        ctx.stroke();
      }
      for (const text of lines) {
        ctx.fillText(text, 57, y);
        y += 29;
      }
      y += 11;
    }
    if (!items.length) ctx.fillText('No tasks yet.', 24, y);
    if (truncated) ctx.fillText('More tasks in the web list.', 24, height - 24);

    const pixels = ctx.getImageData(0, 0, width, height).data;
    const stride = Math.ceil(width / 32) * 4;
    const offset = 62;
    const bmp = new Uint8Array(offset + stride * height);
    const header = new DataView(bmp.buffer);
    bmp[0] = 0x42;
    bmp[1] = 0x4d;
    header.setUint32(2, bmp.length, true);
    header.setUint32(10, offset, true);
    header.setUint32(14, 40, true);
    header.setInt32(18, width, true);
    header.setInt32(22, height, true);
    header.setUint16(26, 1, true);
    header.setUint16(28, 1, true);
    header.setUint32(34, stride * height, true);
    header.setUint32(46, 2, true);
    bmp[54] = bmp[55] = bmp[56] = 255;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixel = (y * width + x) * 4;
        if (pixels[pixel] * 299 + pixels[pixel + 1] * 587 + pixels[pixel + 2] * 114 < 128000) {
          bmp[offset + (height - 1 - y) * stride + (x >> 3)] |= 0x80 >> (x & 7);
        }
      }
    }
    return bmp;
  }

  function base64(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  async function load() {
    busy = true;
    ready = false;
    message('Loading tasks...');
    render();
    try {
      const raw = await read();
      const data = parse(raw);
      tasks = data.tasks;
      sleep = data.sleep;
      sleepEnabled.checked = sleep.enabled;
      sleepName.value = sleep.name;
      saved = raw;
      ready = true;
      message('');
    } catch (error) {
      message('Could not load tasks: ' + error.message, true);
    } finally {
      busy = false;
      render();
    }
  }

  async function save(next, nextSleep = sleep) {
    if (!ready || busy) return;
    busy = true;
    message('Saving...');
    render();
    try {
      if (await read() !== saved) {
        ready = false;
        throw new Error('The list changed elsewhere. Reload it before making changes.');
      }
      const raw = JSON.stringify({ version: 1, tasks: next, sleep: nextSleep });
      const bytes = new TextEncoder().encode(raw);
      if (bytes.length > maxBytes) throw new Error('The list exceeds the reader’s 256 KB file limit.');
      await api.writeFile(path, base64(bytes));
      tasks = next;
      sleep = nextSleep;
      saved = raw;
      if (sleep.enabled) {
        try {
          await api.writeFile('/.sleep/' + sleep.name + '.bmp', base64(await sleepImage(tasks)));
        } catch (error) {
          message('Tasks and settings saved, but the sleep image could not be updated: ' + error.message +
            ' Use Save sleep screen settings to retry.', true);
          return true;
        }
      }
      message('Saved on the reader.');
      return true;
    } catch (error) {
      message('Could not save: ' + error.message, true);
      return false;
    } finally {
      busy = false;
      render();
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || !ready || busy) return;
    if (await save([...tasks, { text, done: false }])) {
      input.value = '';
      input.focus();
    }
  });
  reload.addEventListener('click', load);
  sleepEnabled.addEventListener('change', render);
  saveSleep.addEventListener('click', () => {
    const name = sleepName.value.trim();
    if (!validName(name)) {
      message('Use 1–60 letters, numbers, spaces, underscores, or hyphens for the image name.', true);
      return;
    }
    sleepName.value = name;
    return save(tasks, { enabled: sleepEnabled.checked, name });
  });
  load();
});

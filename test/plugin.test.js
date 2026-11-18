const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.value = '';
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  focus() {}
  fire(name) { return this.listeners[name]({ preventDefault() {} }); }
}

async function setup(initial = null, device = 'X4') {
  let contents = initial;
  let writeError = null;
  let imageError = null;
  let readError = null;
  const writes = [];
  const images = new Map();
  const drawn = [];
  const container = new Element('div');
  let register;
  const pixels = new Uint8ClampedArray((device === 'X3' ? 528 * 792 : 480 * 800) * 4).fill(255);
  const canvasContext = {
    fillRect() {},
    fillText(text) { drawn.push(text); pixels[0] = pixels[1] = pixels[2] = 0; },
    measureText(text) { return { width: Array.from(text).length * 12 }; },
    strokeRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    getImageData() { return { data: pixels }; }
  };
  const context = {
    CrossPoint: { registerPlugin(fn) { register = fn; } },
    document: {
      createElement: (tag) => tag === 'canvas' ? { getContext: () => canvasContext } : new Element(tag),
      createTextNode: (text) => ({ textContent: text })
    },
    TextEncoder,
    btoa: (data) => Buffer.from(data, 'binary').toString('base64'),
    fetch: async (url) => {
      if (url === '/api/status') return { ok: true, json: async () => ({ device }) };
      assert.equal(url, '/plugin/todo/tasks.json');
      if (readError) throw readError;
      const current = contents;
      return { status: current === null ? 404 : 200, ok: current !== null, text: async () => current };
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../plugin.js'), 'utf8'), context);
  register(container, {
    dir: '/plugins/todo',
    pluginFile: (name) => '/plugin/todo/' + name,
    writeFile: async (file, encoded) => {
      if (file === '/plugins/todo/tasks.json') {
        if (writeError) throw writeError;
        contents = Buffer.from(encoded, 'base64').toString('utf8');
        writes.push(contents);
      } else {
        if (imageError) throw imageError;
        images.set(file, Buffer.from(encoded, 'base64'));
      }
    }
  });
  await new Promise(setImmediate);
  const [, , , form, list, empty, status, reload, sleepSection] = container.children;
  const [input, add] = form.children;
  const [, sleepLabel, nameLabel, , saveSleep] = sleepSection.children;
  const [sleepEnabled] = sleepLabel.children;
  const [sleepName] = nameLabel.children;
  return {
    form, list, empty, status, reload, input, add, writes, images, drawn,
    sleepEnabled, sleepName, saveSleep,
    contents: () => contents,
    setContents: (value) => { contents = value; },
    failWrites: (value) => { writeError = value; },
    failImage: (value) => { imageError = value; },
    failReads: (value) => { readError = value; }
  };
}

test('adds Unicode tasks, persists completion and deletion, and reloads', async () => {
  const ui = await setup();
  assert.equal(ui.empty.textContent, 'No tasks yet.');
  ui.input.value = '  Café 📚  ';
  await ui.form.fire('submit');
  assert.deepEqual(JSON.parse(ui.contents()).tasks, [{ text: 'Café 📚', done: false }]);
  assert.equal(ui.input.value, '');
  const checkbox = ui.list.children[0].children[0].children[0];
  checkbox.checked = true;
  await checkbox.fire('change');
  assert.equal(JSON.parse(ui.contents()).tasks[0].done, true);
  const reopened = await setup(ui.contents());
  assert.equal(reopened.list.children[0].children[0].children[0].checked, true);
  await ui.list.children[0].children[1].fire('click');
  assert.deepEqual(JSON.parse(ui.contents()).tasks, []);
});

test('failed writes preserve the list and input and allow retry', async () => {
  const ui = await setup();
  ui.failWrites(new Error('disk full'));
  ui.input.value = 'Keep this';
  await ui.form.fire('submit');
  assert.match(ui.status.textContent, /disk full/);
  assert.equal(ui.input.value, 'Keep this');
  assert.equal(ui.contents(), null);
  assert.equal(ui.list.children.length, 0);
  ui.failWrites(null);
  await ui.form.fire('submit');
  assert.equal(JSON.parse(ui.contents()).tasks[0].text, 'Keep this');
});

test('detects changed files and requires reload rather than overwriting', async () => {
  const ui = await setup();
  const external = JSON.stringify({ version: 1, tasks: [{ text: 'Other tab', done: false }] });
  ui.setContents(external);
  ui.input.value = 'Local task';
  await ui.form.fire('submit');
  assert.match(ui.status.textContent, /changed elsewhere/);
  assert.equal(ui.contents(), external);
  assert.equal(ui.add.disabled, true);
  await ui.reload.fire('click');
  assert.equal(ui.list.children[0].children[0].children[1].textContent, 'Other tab');
  assert.equal(ui.input.value, 'Local task');
  await ui.form.fire('submit');
  assert.equal(JSON.parse(ui.contents()).tasks.length, 2);
});

test('invalid data and read errors prevent writes until successfully reloaded', async () => {
  const ui = await setup('not JSON');
  assert.match(ui.status.textContent, /Could not load/);
  assert.equal(ui.add.disabled, true);
  ui.failReads(new Error('offline'));
  await ui.reload.fire('click');
  assert.match(ui.status.textContent, /offline/);
  assert.equal(ui.writes.length, 0);
  ui.failReads(null);
  ui.setContents(null);
  await ui.reload.fire('click');
  assert.equal(ui.add.disabled, false);
});

test('rejects lists exceeding the byte limit without writing', async () => {
  const ui = await setup();
  ui.input.value = 'é'.repeat(131072);
  await ui.form.fire('submit');
  assert.match(ui.status.textContent, /256 KB/);
  assert.equal(ui.writes.length, 0);
  assert.equal(ui.input.value.length, 131072);
});

test('generates and updates a named monochrome sleep image only when enabled', async () => {
  const ui = await setup();
  ui.input.value = 'Buy milk';
  await ui.form.fire('submit');
  assert.equal(ui.images.size, 0);
  ui.sleepEnabled.checked = true;
  ui.sleepEnabled.fire('change');
  ui.sleepName.value = 'my list';
  await ui.saveSleep.fire('click');
  assert.deepEqual(JSON.parse(ui.contents()).sleep, { enabled: true, name: 'my list' });
  const bmp = ui.images.get('/.sleep/my list.bmp');
  assert.equal(bmp.toString('ascii', 0, 2), 'BM');
  assert.equal(bmp.readUInt32LE(2), bmp.length);
  assert.equal(bmp.readUInt32LE(10), 62);
  assert.equal(bmp.readInt32LE(18), 480);
  assert.equal(bmp.readInt32LE(22), 800);
  assert.equal(bmp.readUInt16LE(28), 1);
  assert.ok(bmp[62 + 799 * 60] & 0x80);
  assert.ok(ui.drawn.includes('Buy milk'));
  const reopened = await setup(ui.contents());
  assert.equal(reopened.sleepEnabled.checked, true);
  assert.equal(reopened.sleepName.value, 'my list');
  const checkbox = ui.list.children[0].children[0].children[0];
  checkbox.checked = true;
  await checkbox.fire('change');
  assert.notEqual(ui.images.get('/.sleep/my list.bmp'), bmp);
  ui.sleepEnabled.checked = false;
  await ui.saveSleep.fire('click');
  const old = ui.images.get('/.sleep/my list.bmp');
  ui.input.value = 'Another';
  await ui.form.fire('submit');
  assert.equal(ui.images.get('/.sleep/my list.bmp'), old);
});

test('rejects unsafe names without saving settings or overwriting images', async () => {
  const ui = await setup();
  ui.sleepEnabled.checked = true;
  ui.sleepName.value = '../sleep';
  await ui.saveSleep.fire('click');
  assert.match(ui.status.textContent, /image name/);
  assert.equal(ui.writes.length, 0);
  assert.equal(ui.images.size, 0);
});

test('reports image failure separately after tasks are saved and supports retry', async () => {
  const ui = await setup();
  ui.sleepEnabled.checked = true;
  ui.sleepName.value = 'todo';
  ui.failImage(new Error('disk full'));
  await ui.saveSleep.fire('click');
  assert.equal(JSON.parse(ui.contents()).sleep.enabled, true);
  assert.match(ui.status.textContent, /saved, but the sleep image.*disk full/);
  ui.input.value = 'Persist me';
  await ui.form.fire('submit');
  assert.equal(ui.input.value, '');
  assert.equal(JSON.parse(ui.contents()).tasks[0].text, 'Persist me');
  assert.match(ui.status.textContent, /sleep image could not be updated/);
  ui.failImage(null);
  await ui.saveSleep.fire('click');
  assert.ok(ui.images.has('/.sleep/todo.bmp'));
});

test('indicates overflow when tasks do not fit on the sleep screen', async () => {
  const raw = JSON.stringify({ version: 1, tasks: Array.from({ length: 60 }, (_, i) => ({
    text: 'Task ' + i, done: false
  })) });
  const ui = await setup(raw);
  ui.sleepEnabled.checked = true;
  await ui.saveSleep.fire('click');
  assert.ok(ui.drawn.includes('More tasks in the web list.'));
});

test('uses native X3 dimensions for its sleep bitmap', async () => {
  const ui = await setup(null, 'X3');
  ui.sleepEnabled.checked = true;
  await ui.saveSleep.fire('click');
  const bmp = ui.images.get('/.sleep/todo-list.bmp');
  assert.equal(bmp.readInt32LE(18), 528);
  assert.equal(bmp.readInt32LE(22), 792);
  assert.equal(bmp.length, 62 + 68 * 792);
});

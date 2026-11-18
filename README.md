# CrossPoint To-Do List

A browser-based CrossPoint Reader plugin for adding, completing, and deleting
tasks. Tasks are stored on the reader's SD card; there is no cloud account or
sync. The list is managed in a browser, not on the reader's screen.

## Install

1. Copy `manifest.json`, `plugin.js`, and this `README.md` into
   `/plugins/todo/` on the reader's SD card. The other CrossPoint plugin roots
   (`/.crosspoint/plugins/` and `/.plugins/`) also work.
2. Enable **Settings > Connectivity > Plugins** on the reader.
3. Start File Transfer mode, connect a phone or computer to the reader's
   network, and open the device URL shown on its screen. Open **Plugins** and
   use **To-Do List**. Internet access is not needed.

This requires CrossPoint firmware with browser plugins and the
`/api/plugin-fs` endpoint. If `crosspoint.local` does not work, use the IP
address displayed on the reader.

## Sleep screen

In the plugin's **Sleep screen** section, check **Show this list as a custom
sleep image**, enter an image name, and click **Save sleep screen settings**.
The plugin writes `/.sleep/<name>.bmp` and updates it whenever tasks change
through the browser. Names can contain letters, numbers, spaces, underscores,
and hyphens; an existing file with the same name is replaced.

On the reader, set **Settings > Display > Sleep Screen** to **Custom**. The
reader chooses from the images in its sleep folders, so this image rotates
with the others rather than appearing every time. If a root `/sleep.bmp`
exists, it takes priority over the folder; move it into a sleep folder if you
want rotation. Depending on firmware, you may also need to include the new
image in **Select Sleep Screens**.

The image is a snapshot, not interactive: changes appear the next time the
reader sleeps. If the list is too long to fit, the image indicates that more
tasks are available in the web list. If the image update fails, the plugin
reports it separately from the saved tasks; use **Save sleep screen settings**
to retry. Renaming or disabling the option leaves the old image on the SD card;
delete it manually if you no longer want it in the rotation.
The bitmap uses native X3 or X4 dimensions; other reader models scale the
480 x 800 image to fit.

## Data and backups

The list is `tasks.json` in the installed plugin folder, created on the first
successful edit. Back up that file before deleting or replacing the plugin
folder; uninstalling the folder deletes the list too. Avoid editing from
multiple browser tabs at the same time: the plugin detects changes made
before a save, but cannot lock the file against simultaneous writes. If a
conflict occurs, reload the list and repeat your edit.

The browser must remain connected to the reader while editing. Failed saves
are reported and do not update the displayed list; retry after reconnecting.
CrossPoint limits each saved file to 256 KB.

## Development

Run the dependency-free tests with `node --test`.

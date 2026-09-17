/** Self-contained HTML page served to the desktop webview. */
export const INDEX_HTML: string = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Totem</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 32px 16px 48px;
  background: #14161a;
  color: #d7dae0;
  font-family: "Segoe UI", system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.5;
}
main { max-width: 560px; margin: 0 auto; }
h1 { font-size: 20px; margin: 0 0 4px; }
.subtitle { color: #8b909a; margin: 0 0 24px; }
h2 { font-size: 15px; margin: 28px 0 10px; color: #aeb4bf; }
label.field { display: block; margin: 12px 0; }
label.field > span { display: block; margin-bottom: 4px; color: #9aa0ab; }
input[type="text"], select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #333842;
  border-radius: 6px;
  background: #1c1f26;
  color: inherit;
  font: inherit;
}
input[type="text"]:focus, select:focus { outline: none; border-color: #4f7cc0; }
label.check { display: flex; gap: 8px; align-items: baseline; margin: 8px 0; cursor: pointer; }
label.check input { margin: 0; }
button {
  padding: 8px 16px;
  border: 1px solid #3a4150;
  border-radius: 6px;
  background: #2a2f3a;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
button:hover:not(:disabled) { background: #343a48; }
button:disabled { opacity: 0.5; cursor: default; }
button.primary { background: #2f5d9e; border-color: #2f5d9e; }
button.primary:hover:not(:disabled) { background: #386cb4; }
.row { display: flex; gap: 10px; align-items: center; margin-top: 14px; }
.errors { color: #e08a8a; margin: 10px 0 0; padding-left: 20px; }
.warnings { color: #d8b56a; margin: 10px 0 0; padding-left: 20px; }
.mono { font-family: Consolas, "Courier New", monospace; font-size: 13px; word-break: break-all; }
#progress-line { color: #9fc2ec; margin: 8px 0; min-height: 1.5em; }
.hidden { display: none; }
.result-path { margin: 6px 0; }
</style>
</head>
<body>
<main>
<h1>Totem</h1>
<p class="subtitle">Selective Minecraft instance backup</p>

<section id="step-instance">
  <h2>1. Instance</h2>
  <label class="field">
    <span>Minecraft instance path</span>
    <input type="text" id="instance-path" spellcheck="false">
  </label>
  <div class="row">
    <button id="inspect-btn" class="primary">Inspect</button>
    <span id="inspect-status"></span>
  </div>
  <ul id="inspect-errors" class="errors"></ul>
  <ul id="inspect-warnings" class="warnings"></ul>
</section>

<section id="step-options" class="hidden">
  <h2>2. Options</h2>
  <div id="folder-modes"></div>
  <div id="toggles"></div>
  <label class="field">
    <span>Backup destination</span>
    <input type="text" id="dest-path" spellcheck="false">
  </label>
  <div class="row">
    <button id="run-btn" class="primary">Run backup</button>
  </div>
</section>

<section id="step-progress" class="hidden">
  <h2>3. Progress</h2>
  <p id="progress-line">Starting…</p>
</section>

<section id="step-result" class="hidden">
  <h2 id="result-title">Result</h2>
  <div id="result-body"></div>
  <ul id="result-errors" class="errors"></ul>
  <div class="row">
    <button id="open-btn">Open folder</button>
    <button id="again-btn">Start over</button>
  </div>
</section>
</main>
<script>
var instanceInput = document.getElementById("instance-path");
var destInput = document.getElementById("dest-path");
var inspectBtn = document.getElementById("inspect-btn");
var inspectStatus = document.getElementById("inspect-status");
var inspectErrors = document.getElementById("inspect-errors");
var inspectWarnings = document.getElementById("inspect-warnings");
var optionsSection = document.getElementById("step-options");
var folderModes = document.getElementById("folder-modes");
var toggles = document.getElementById("toggles");
var runBtn = document.getElementById("run-btn");
var progressSection = document.getElementById("step-progress");
var progressLine = document.getElementById("progress-line");
var resultSection = document.getElementById("step-result");
var resultTitle = document.getElementById("result-title");
var resultBody = document.getElementById("result-body");
var resultErrors = document.getElementById("result-errors");
var openBtn = document.getElementById("open-btn");
var againBtn = document.getElementById("again-btn");

var inspection = null;
var FOLDER_IDS = ["mods", "resourcepacks", "shaderpacks"];

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function text(tag, content, className) {
  var el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = content;
  return el;
}

function show(node) {
  node.classList.remove("hidden");
}

function hide(node) {
  node.classList.add("hidden");
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024) return Math.max(0, bytes) + " B";
  var units = ["KiB", "MiB", "GiB", "TiB"];
  var value = bytes;
  var unit = "B";
  for (var i = 0; i < units.length; i++) {
    value /= 1024;
    unit = units[i];
    if (value < 1024 || i === units.length - 1) break;
  }
  return value.toFixed(value >= 10 ? 0 : 1) + " " + unit;
}

function errorText(error) {
  if (error && error.message) return String(error.message);
  return String(error);
}

function setDisabled(disabled) {
  var nodes = document.querySelectorAll("input, select, button");
  for (var i = 0; i < nodes.length; i++) nodes[i].disabled = disabled;
}

function renderMessages(list, items) {
  clear(list);
  for (var i = 0; i < items.length; i++) list.appendChild(text("li", items[i]));
}

function checkbox(id, checked, labelText, customId) {
  var label = document.createElement("label");
  label.className = "check";
  var input = document.createElement("input");
  input.type = "checkbox";
  input.id = id;
  input.checked = checked;
  if (customId) input.setAttribute("data-custom", customId);
  label.appendChild(input);
  label.appendChild(document.createTextNode(labelText));
  return label;
}

function renderOptions(result) {
  inspection = result;
  clear(folderModes);
  clear(toggles);
  for (var i = 0; i < FOLDER_IDS.length; i++) {
    var id = FOLDER_IDS[i];
    var folder = result.folders[id];
    if (!folder) continue;
    var label = text("label", "", "field");
    label.appendChild(text("span", folder.name + " (" + folder.fileCount + " files)"));
    var select = document.createElement("select");
    select.id = "mode-" + id;
    var manifest = document.createElement("option");
    manifest.value = "manifest";
    manifest.textContent =
      "Manifest + configs (" + formatBytes(folder.estimatedManifestBytes) + ")";
    var full = document.createElement("option");
    full.value = "full";
    full.textContent = "Full folder (" + formatBytes(folder.estimatedFullBytes) + ")";
    select.appendChild(manifest);
    select.appendChild(full);
    label.appendChild(select);
    folderModes.appendChild(label);
  }
  if (result.saves) {
    toggles.appendChild(checkbox(
      "opt-saves",
      false,
      "Include saves (" + formatBytes(result.saves.estimatedFullBytes) + ")",
    ));
  }
  for (var j = 0; j < result.customFolders.length; j++) {
    var custom = result.customFolders[j];
    toggles.appendChild(
      checkbox(
        "opt-custom-" + j,
        false,
        custom.label + " (" + formatBytes(custom.estimatedFullBytes) + ")",
        custom.id,
      ),
    );
  }
  toggles.appendChild(checkbox("opt-zip", false, "Create ZIP archive"));
  toggles.appendChild(checkbox("opt-open", true, "Open folder when done"));
  show(optionsSection);
}

function collectRequest() {
  var modes = {};
  for (var i = 0; i < FOLDER_IDS.length; i++) {
    var select = document.getElementById("mode-" + FOLDER_IDS[i]);
    modes[FOLDER_IDS[i]] = select ? select.value : "manifest";
  }
  var custom = [];
  var boxes = toggles.querySelectorAll("input[data-custom]");
  for (var j = 0; j < boxes.length; j++) {
    if (boxes[j].checked) custom.push(boxes[j].getAttribute("data-custom"));
  }
  var savesBox = document.getElementById("opt-saves");
  return {
    minecraftPath: instanceInput.value.trim(),
    backupDestination: destInput.value.trim(),
    options: {
      folderModes: modes,
      includeSaves: savesBox ? savesBox.checked : false,
      customFolders: custom,
      zipOutput: document.getElementById("opt-zip").checked,
      openWhenDone: document.getElementById("opt-open").checked,
    },
    inspection: inspection,
  };
}

function describeProgress(progress) {
  var detail = progress.completedFiles + " files";
  if (typeof progress.totalFiles === "number") {
    detail = progress.completedFiles + "/" + progress.totalFiles + " files";
  }
  var copied = progress.stats ? progress.stats.totalBytesCopied : 0;
  return progress.phase + ": " + progress.message +
    " (" + detail + ", " + formatBytes(copied) + " copied)";
}

function renderResult(result) {
  clear(resultBody);
  clear(resultErrors);
  show(resultSection);
  if (result.success) {
    resultTitle.textContent = "Backup complete";
    if (result.outputPath) {
      var archive = text("p", "", "result-path");
      archive.appendChild(document.createTextNode("Archive: "));
      archive.appendChild(text("span", result.outputPath, "mono"));
      resultBody.appendChild(archive);
    }
    if (result.directoryPath) {
      var dir = text("p", "", "result-path");
      dir.appendChild(document.createTextNode("Folder: "));
      dir.appendChild(text("span", result.directoryPath, "mono"));
      resultBody.appendChild(dir);
    }
    if (result.stats) {
      resultBody.appendChild(text("p",
        result.stats.totalFilesCopied + " files, " +
          formatBytes(result.stats.totalBytesCopied) + " copied"));
    }
    if (result.errors && result.errors.length) renderMessages(resultErrors, result.errors);
    show(openBtn);
    openBtn.onclick = function () {
      bindings.openFolder(result.directoryPath || result.outputPath).catch(function (error) {
        renderMessages(resultErrors, [errorText(error)]);
      });
    };
  } else {
    resultTitle.textContent = "Backup failed";
    hide(openBtn);
    openBtn.onclick = null;
    var errors = result.errors && result.errors.length ? result.errors : ["Unknown error."];
    renderMessages(resultErrors, errors);
  }
}

inspectBtn.addEventListener("click", function () {
  var path = instanceInput.value.trim();
  clear(inspectErrors);
  clear(inspectWarnings);
  hide(optionsSection);
  inspection = null;
  if (!path) {
    renderMessages(inspectErrors, ["Enter a Minecraft instance path."]);
    return;
  }
  setDisabled(true);
  inspectStatus.textContent = "Inspecting…";
  bindings.inspect(path).then(function (result) {
    inspectStatus.textContent = "";
    if (!result.validation.valid) {
      renderMessages(inspectErrors, result.validation.errors);
      return;
    }
    renderMessages(inspectWarnings, result.validation.warnings);
    renderOptions(result);
  }).catch(function (error) {
    inspectStatus.textContent = "";
    renderMessages(inspectErrors, [errorText(error)]);
  }).finally(function () {
    setDisabled(false);
  });
});

runBtn.addEventListener("click", function () {
  var request = collectRequest();
  if (!request.backupDestination) {
    destInput.focus();
    return;
  }
  setDisabled(true);
  hide(resultSection);
  show(progressSection);
  progressLine.textContent = "Starting…";
  var poll = setInterval(function () {
    bindings.getProgress().then(function (progress) {
      if (progress) progressLine.textContent = describeProgress(progress);
    }).catch(function () {});
  }, 300);
  bindings.runBackup(request).then(function (result) {
    renderResult(result);
  }).catch(function (error) {
    renderResult({ success: false, errors: [errorText(error)] });
  }).finally(function () {
    clearInterval(poll);
    setDisabled(false);
  });
});

againBtn.addEventListener("click", function () {
  hide(resultSection);
  hide(progressSection);
  hide(optionsSection);
  inspection = null;
  clear(inspectErrors);
  clear(inspectWarnings);
  progressLine.textContent = "";
  instanceInput.focus();
});

if (typeof bindings === "undefined") {
  renderMessages(inspectErrors, ["Desktop bindings unavailable; run via deno task desktop."]);
} else {
  bindings.getDefaults().then(function (defaults) {
    if (!defaults) return;
    if (defaults.minecraftPath) instanceInput.value = defaults.minecraftPath;
    if (defaults.backupDestination) destInput.value = defaults.backupDestination;
  }).catch(function () {});
}
</scr` + `ipt>
</body>
</html>`;

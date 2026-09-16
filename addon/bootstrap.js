/* Zotero provides these privileged globals in the add-on sandbox. */
var commentExpandStartup = null;

function install() {}

async function startup({ rootURI }) {
  if (commentExpandStartup) return commentExpandStartup;
  commentExpandStartup = (async () => {
    Services.scriptloader.loadSubScriptWithOptions(rootURI + 'runtime.js', {
      target: globalThis,
      ignoreCache: true,
    });
    await CommentExpandRuntime.startup(Zotero, Services);
  })();
  try { await commentExpandStartup; }
  catch (error) {
    try { globalThis.CommentExpandRuntime?.shutdown(); }
    finally { commentExpandStartup = null; delete globalThis.CommentExpandRuntime; }
    throw error;
  }
}

async function shutdown() {
  try {
    if (commentExpandStartup) await commentExpandStartup;
    globalThis.CommentExpandRuntime?.shutdown();
  } finally {
    commentExpandStartup = null;
    delete globalThis.CommentExpandRuntime;
  }
}

// Preserve the user's local display preference on uninstall/reinstall.
function uninstall() {}
function onMainWindowLoad() {}
function onMainWindowUnload() {}

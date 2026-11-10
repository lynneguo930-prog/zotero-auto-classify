/* global Zotero, Services */
/* Zotero 10 bootstrap plugin entry.
 * Zotero 10 / Firefox 140 ESR: 不要调用 registerChrome() 的 skin 条目，会抛
 * NS_ERROR_ILLEGAL_VALUE 导致插件启动中断。本插件所有资源都通过 rootURI 加载。
 */

function install() {}

function uninstall() {}

async function startup({ id, version, rootURI }, reason) {
  await Zotero.initializationPromise;

  Services.scriptloader.loadSubScript(rootURI + 'content/auto-classify.js');

  Zotero.PreferencePanes.register({
    pluginID: id,
    src: rootURI + 'prefs.xhtml',
    scripts: [rootURI + 'prefs-script.js'],
    stylesheets: [rootURI + 'prefs.css'],
  });

  await Zotero.AutoClassify.init({ id, version, rootURI });
}

function shutdown({ id, version, rootURI }, reason) {
  try {
    if (Zotero.AutoClassify && typeof Zotero.AutoClassify.shutdown === 'function') {
      Zotero.AutoClassify.shutdown();
    }
  }
  finally {
    Zotero.AutoClassify = undefined;
  }
}

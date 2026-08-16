/**
 * 个推(GeTui)推送集成 Config Plugin
 */

const { withAndroidManifest, withAppBuildGradle, withDangerousMod, withMainApplication, withProjectBuildGradle } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");
function loadGetuiConfig() {
  const cfgPath = path.join(__dirname, "..", "getui.config.js");
  try {
    if (fs.existsSync(cfgPath)) {
      const cfg = require(cfgPath);
      return { appId: cfg.appId || "PLACEHOLDER_APPID", appKey: cfg.appKey || "", appSecret: cfg.appSecret || "" };
    }
  } catch (_e) { /* 无本地配置 */ }
  return { appId: "PLACEHOLDER_APPID", appKey: "", appSecret: "" };
}

const PUSH_SERVICE_KT = "package com.ensemble.mobile\n\nimport com.igexin.sdk.PushService\n\n/** 个推推送服务（独立 :pushservice 进程，保持与个推长连接） */\nclass GeTuiPushService : PushService()";
const INTENT_SERVICE_KT = "package com.ensemble.mobile\n\nimport android.content.Context\nimport android.util.Log\nimport com.facebook.react.ReactApplication\nimport com.facebook.react.modules.core.DeviceEventManagerModule\nimport com.igexin.sdk.GTIntentService\nimport com.igexin.sdk.message.GTCmdMessage\nimport com.igexin.sdk.message.GTNotificationMessage\nimport com.igexin.sdk.message.GTTransmitMessage\n\n/** 个推事件桥：cid / 透传消息 / 通知点击 转发给 JS 层 */\nclass GeTuiIntentService : GTIntentService() {\n    private val TAG = \"GeTuiIntentService\"\n\n    private fun emit(context: Context, event: String, payload: String?) {\n        try {\n            val host = (context.applicationContext as ReactApplication).reactNativeHost\n            val reactContext = host?.reactInstanceManager?.currentReactContext\n            reactContext?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)?.emit(event, payload)\n        } catch (e: Exception) {\n            Log.w(TAG, \"emit failed: \" + (e.message ?: \"\"))\n        }\n    }\n\n    override fun onReceiveServicePid(context: Context, pid: Int) {}\n\n    override fun onReceiveClientId(context: Context, clientid: String) {\n        Log.i(TAG, \"onReceiveClientId\") \n        emit(context, \"getui:clientId\", clientid)\n    }\n\n    override fun onReceiveMessageData(context: Context, msg: GTTransmitMessage) {\n        val payload = msg.payload?.let { String(it) }\n        emit(context, \"getui:message\", payload)\n    }\n\n    override fun onReceiveOnlineState(context: Context, online: Boolean) {}\n    override fun onReceiveCommandResult(context: Context, cmdMessage: GTCmdMessage) {}\n    override fun onNotificationMessageArrived(context: Context, message: GTNotificationMessage) {}\n\n    override fun onNotificationMessageClicked(context: Context, message: GTNotificationMessage) {\n        emit(context, \"getui:notificationClicked\", message.content)\n    }\n}";

function appGradleMod(buildGradle, cfg) {
  let g = buildGradle;
  // Java 8
  if (!/sourceCompatibility.*VERSION_1_8/.test(g)) {
    g = g.replace(/android {/m, `android {
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_1_8
        targetCompatibility JavaVersion.VERSION_1_8
    }`);
  }
  // manifestPlaceholder
  if (!/manifestPlaceholders/.test(g)) {
    g = g.replace(/defaultConfig {/m, `defaultConfig {
        manifestPlaceholders = [ GETUI_APPID: "` + cfg.appId + `", GT_INSTALL_CHANNEL: "ensemble" ]`);
  }
  // dependencies
  if (!/com\.getui:gtsdk/.test(g)) {
    g = g.replace(/dependencies {/m, `dependencies {
    implementation "com.getui:gtsdk:3.3.15.0"
    implementation "com.getui:gtc:3.3.3.0"
    implementation "com.getui:gsido:1.4.14.0"`);
  }
  return g;
}

module.exports = function withGetuiPush(config) {
  const cfg = loadGetuiConfig();

  config = withAppBuildGradle(config, (c) => {
    c.modResults.contents = appGradleMod(c.modResults.contents, cfg);
    return c;
  });

  config = withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application?.[0];
    if (!app) return c;
    const metas = app["meta-data"] || [];
    if (metas.some((m) => m?.$?.["android:name"] === "GETUI_APPID")) return c;

    app["meta-data"] = metas.concat([{ $: { "android:name": "GETUI_APPID", "android:value": "${GETUI_APPID}" } }]);
    app["service"] = (app["service"] || []).concat([
      { $: { "android:name": "com.ensemble.mobile.GeTuiPushService", "android:exported": "false" } },
      { $: { "android:name": "com.ensemble.mobile.GeTuiIntentService", "android:exported": "false", "android:label": "GetuiPushService", "android:process": ":pushservice" } },
    ]);

    const manifest = c.modResults.manifest;
    manifest["queries"] = manifest["queries"] || [];
    if (!manifest["queries"].some((q) => q && q["intent"] && JSON.stringify(q["intent"]).includes("com.getui.sdk.action"))) {
      manifest["queries"].push({ intent: [{ action: [{ $: { "android:name": "com.getui.sdk.action" } }] }] });
    }
    return c;
  });

  config = withDangerousMod(config, [
    "android",
    async (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, "app", "src", "main", "java", "com", "ensemble", "mobile");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "GeTuiPushService.kt"), PUSH_SERVICE_KT);
      fs.writeFileSync(path.join(dir, "GeTuiIntentService.kt"), INTENT_SERVICE_KT);
      return c;
    },
  ]);

  // 0) 根 build.gradle：在 allprojects.repositories 添加个推 Maven 仓库
  config = withProjectBuildGradle(config, (config) => {
    let content = config.modResults.contents;
    if (!content.includes("mvn.getui.com")) {
      content = content.replace(
        /(allprojects \{\n  repositories \{)/m,
        "$1\n    maven { url 'https://mvn.getui.com/nexus/content/repositories/releases/' }",
      );
    }
    config.modResults.contents = content;
    return config;
  });

  // 4) MainApplication.kt：初始化个推（preInit + initialize）
  config = withMainApplication(config, (config) => {
    let content = config.modResults.contents;

    if (!content.includes("import com.igexin.sdk.PushManager")) {
      content = content.replace(
        /(^package [^\n]+\n)/m,
        "$1\nimport com.igexin.sdk.PushManager\n",
      );
    }

    if (!content.includes("PushManager.getInstance().initialize")) {
      content = content.replace(
        /(ApplicationLifecycleDispatcher\.onApplicationCreate\(this\))/,
        'PushManager.getInstance().preInit(this)\n    PushManager.getInstance().initialize(this)\n    $1',
      );
    }

    config.modResults.contents = content;
    return config;
  });

  return config;
};

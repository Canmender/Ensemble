# 合鸣移动端开发记忆

## 项目基本信息

- **项目**：合鸣（Ensemble）移动端 - React Native Expo SDK 57
- **仓库**：D:\MultiAgent
- **分支**：feat/mobile-ui-xuank-mo-082（UI 重做保护分支）
- **当前版本**：0.8.28 / versionCode 98
- **服务器**：47.92.39.184:8787

## 技能系统

- DSh 技能目录：`C:\Users\ADMIN\.agents\skills\`
- 已安装技能：cocoloop（技能管理器）、anthropic-frontend-design（设计智能）
- 设计技能工具：`python scripts/search.py "<query>" --domain <domain>`（必须实际运行，不能只读说明）

## 构建环境

- **Node.js**：v24.15.0
- **Android SDK**：D:\AndroidSDK（platform 36, build-tools 36.0.0）
- **Java**：E:\JAVA21（构建时需设置 JAVA_HOME）
- **Keystore**：debug.keystore（CN=Android Debug），**不要改签名 key**
- **构建命令**：
  ```
  cd mobile
  $env:JAVA_HOME='E:\JAVA21'
  node scripts/build-release.cjs
  ```
- **prebuild 后**：需重新创建 `android/local.properties`（`sdk.dir=D:\\AndroidSDK`）

## 设计系统关键决策

1. **主色是玄泉 #3B3F4A**（不是淡黏土 #8F7D6F）—— 对比度 10.5:1 vs 3.9:1
2. **暖琥珀 #C4933F 做唯一 CTA 点缀** —— 六色全是中性色，必须有一个亮色
3. **分隔线不用画线** —— 用色差区分层级（bg 白 / surface 极淡暖白）
4. **文字层级**：纯黑标题 / 墨色正文 / 玄泉次级 —— 全 >= 4.5:1
5. **液态玻璃只用于导航层** —— 不铺内容层（Apple 指导原则）

## 已知技术限制

1. **expo-blur BlurView + borderRadius = Android 白色矩形**（库的已知限制，无解）
2. **AGP 9.x 只生成 v2 签名**（v1 不支持）
3. **expo prebuild 会重建 android 目录**（signingConfig、local.properties 会丢失）

## 部署流程

1. 构建 APK：`node scripts/build-release.cjs`
2. 验证签名：`apksigner verify --print-certs <apk>`
3. Stage：复制到 `D:\MultiAgent\ensemble-vX.Y.Z.apk`
4. 上传服务器：paramiko SFTP → docker cp 进 /data/apk/
5. 更新 version.json（ASCII note，避免中文编码问题）
6. 验证：`curl http://47.92.39.184:8787/api/app-version`

## 踩坑速查

| 问题 | 原因 | 解法 |
|---|---|---|
| 技能不可见 | 装错目录 | 装到 ~/.agents/skills/ |
| 改动没生效 | Windows \r\n | replace 用 /\r?\n/g |
| APK 无法覆盖安装 | 签名 key 变了 | 不要改签名 key |
| 玻璃白色矩形 | BlurView+borderRadius | 用纯 View 多层叠加 |
| 分隔线太丑 | 纯黑线 | 用色差，不画线 |
| 智能体不显示 | 未加载数据 + filter 空 rows | useEffect 加载 + 去掉 filter |
| 版本号没更新 | prebuild 覆盖 | prebuild 后重新注入版本 |

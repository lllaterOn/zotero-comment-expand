# 开发与发布

## 环境

项目需要 Node.js 22 或更高版本。首次安装依赖时，将 npm 缓存保存在项目内：

```powershell
npm install --cache .cache/npm
npm run verify
```

已有 `package-lock.json` 时使用：

```powershell
npm ci --cache .cache/npm
```

`npm run verify` 依次执行 TypeScript 检查、Node 测试、仓库与更新清单检查、确定性 XPI 构建、发布资产关卡自测和安装包契约检查。发布资产关卡会校验 SHA-256、标签、XPI 内的 `manifest.json` 及发布标签源码中的清单是否完全一致。生成目录 `build/`、`dist/`、`.cache/` 及本地依赖 `node_modules/` 均不纳入版本控制。

## 构建产物

`npm run build` 将 `addon/` 复制到 `build/addon/`，再通过 esbuild 将 `src/main.ts` 编译成根目录的 `runtime.js`。运行时采用 IIFE 格式并暴露全局对象 `CommentExpandRuntime`，供 `bootstrap.js` 加载。

构建结果为：

```text
dist/zotero-comment-expand-<version>.xpi
dist/SHA256SUMS
```

XPI 内文件名、顺序、时间戳、权限和字节内容固定；相同源码与依赖会生成相同 SHA-256。安装包包含 MIT 许可证，不包含源码映射、缓存、测试资料、用户数据或凭证。

## 版本维护

正式版本采用语义化版本和 `v<major>.<minor>.<patch>` 标签。以下文件中的版本必须保持一致：

- `package.json`
- `package-lock.json`
- `addon/manifest.json`

同时更新 `CHANGELOG.md`，执行完整验证，并检查 Git 暂存内容没有 Zotero 配置、数据库、日志、个人路径、凭证或生成的安装包。

## 发布流程

1. 将通过 `npm run verify` 的发布变更合并到 `main`。
2. 创建并推送与版本一致的标签。
3. GitHub Actions 在只读权限下重新安装依赖并验证，生成 XPI 和 `SHA256SUMS`。
4. 工作流把这两个文件放入 Draft Release。下载这组原始资产，在真实 Zotero 中完成验收。
5. 验收通过后发布现有 Draft Release，不重新构建或替换资产。
6. `release: published` 工作流下载已发布资产、验证 SHA-256，并将该正式版本写入 `updates.json`。

初始 `updates.json` 的版本列表为空。未经实际发布和实机验收，不得提前加入候选版本。更新地址使用带版本标签的不可变 GitHub Release URL，正式清单不会指向 Draft Release 或 Actions 临时产物。

构建任务只有仓库读取权限。只有上传 Draft Release 和发布后更新 `updates.json` 的独立任务具有 `contents: write`，用于创建 Release 及提交正式更新元数据。

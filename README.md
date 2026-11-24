# dsh-tool-disclosure

**为 DeepSeek Harness 的所有预设提供「每 Agent、会话级」的工具按需披露。** 常驻一小份 core，其余继承工具由 `tool_search` 发现、`tool_activate` 激活，在**下一个 step** 公开**原始 schema**。

<p>
  <img alt="version" src="https://img.shields.io/badge/version-0.1.0-627CDD">
  <img alt="DSH" src="https://img.shields.io/badge/DSH-0.2.2--rc.5-309EAA">
  <img alt="tests" src="https://img.shields.io/badge/tests-31%2F31%20pass-4c9a5a">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-888888">
</p>

独立 Host bundle，覆盖所有 preset。不改各 preset 的能力声明、不去删全局工具注册、不换执行器、不加 UI——只在**披露层**收窄每一步送给模型的工具定义。

## 问题：装配开销，不是工具误调用

一个真实样本里，每次请求的工具定义是 **235 项 / 794,382 字符**，其中 REA 占 207 项 / 775,016 字符（约 **97.56%**）。这不是 REA 的 bug，也没有证据表明模型误调用了它：DSH Native executor 会把**全部可见能力**投影成模型工具，PTC 会把全部可见能力转成 SDK——**换承载位置不等于按需加载**。

> 97.56% 只是该样本**工具定义的字符占比**，不是账单占比、真实 token 占比或预期节省率。诊断样本不是同任务 A/B。

## 机制

| 工具 | 契约 |
| --- | --- |
| `tool_search({ query, offset?, limit? })` | 搜索当前 Agent 继承的注册目录；每次最多 **8 个精确名称 + 短用途**，每项用途 **≤240 字符**；**不返回 schema** |
| `tool_activate({ names: [精确名] })` | 每批最多 **8 个精确名称**；仅登记披露选择，**下一 step** 公开当前有效的**原始 schema**；**不执行业务工具** |

激活在本 Agent 会话内 **sticky 累积**，没有「一次会话总共只能 8 个」的上限。之后仍然用**原始工具名**和**原来的执行通道**调用，业务操作不会被塞进搜索/激活工具。

### 每个 Agent 分别计算

对每个 Agent 独立定义：

- `R` — `scopeParentOf(agent)`（该 Agent 的 standing preset，无 preset 时为 Host）的注册目录。搜索与名称校验读它。
- `U` — DSH 在该 Agent 上继续应用其他 mask 与每 step `when` 后**准入**的继承工具集合。
- `C` — 配置的 `bootstrapTools`（core 名单）；名字不在 `R` 时不产生任何工具。
- `A` — 该 Agent 会话日志中有效激活记录投影出的累积选择。
- 实际准入：`U ∩ (C ∪ A)`，再加本插件两个发现入口与该 Agent 原有的私有工具。

`R` **不是**已获准调用的集合：搜索可能命中尚未加载 Skill、条件暂不满足、或被其他 mask 拒绝的名称；激活只表示「选择披露」，不能让它绕过原约束。

### 默认 core（可配置）

```text
bash, pwsh, read, read_image, glob, grep, working_directory,
skill, ask_user_question, exit_plan_mode,
job_output, job_kill, job_list
```

这些名称**仅在当前 Agent 原本拥有且当前有效时**常驻。core 是**披露名单，不是安装清单**：不会给 `minimal` 或其他 preset 补原本没有的工具，平台不存在的 `bash` / `pwsh` 也不会凭空出现。

```yaml
# cordis.patch.yml
bootstrapTools: [bash, pwsh, read, read_image, glob, grep, working_directory,
                 skill, ask_user_question, exit_plan_mode,
                 job_output, job_kill, job_list]
maxSearchResults: 8   # 1–8
descriptionChars: 240 # 40–240
```

## 不改变什么

- **条件与权限**：原 `conditionalWhen`、其他 mask、审批与 Plan 约束全部保持有效。披露 ≠ 授权。
- **执行通道**：native 仍走 native；PTC 仍走原 PTC 执行器，SDK 由**同一个披露 mask** 收窄，不另给全量捷径。也不把 lazy 工具的完整 schema 预埋进初始 SDK、prompt 或搜索结果里。
- **其他 preset**：不改写各 preset 的工具能力声明与默认 preset 选择。
- **Agent 私有工具**：第三方用 `agent.ctx.tools.register()` 注册的工具保持原状——DSH 的 `restrict()` 本就不过滤当前 Agent 自己注册的工具。所以「全预设覆盖」指覆盖 **Host / preset 继承工具**，不是「任何来源的工具都必然隐藏」。

## 状态、恢复与 fork

1. 每个 Agent 的 `A` 从空开始，随该 Agent 的有效激活 sticky 累积，不因普通 step 重置，也不保存为 Host / preset 共享的全局集合。
2. 状态从**该 Agent 自己的 session log** 投影恢复（`localToolDisclosure/v1`），不依赖纯内存 Set，也不把搜索结果或模型口头声明当成激活事实。
3. 投影幂等：只恢复披露选择，不重放业务调用。
4. parent、spawn child、兄弟、不同 root 互相独立；child 不继承 parent 的可变集合。
5. **fork 继承的历史前缀不计作 child 自己的激活记录**——只投影正确归属与边界之后的记录。
6. MCP 目录变化、断开/重连、工具移除、同名 schema 更新、会话恢复时，搜索与激活都**重新校验当前目录**；失效工具不再公开，新出现的非 core 工具也不会被自动全量披露。

日志里的名称是**历史选择**，不是永久有效的 schema 或权限证明。

## 实测

| 口径 | 结果 |
| --- | --- |
| 历史精确 schema（真实 DSH 离线注册表） | 235 项 / 794,382 字符 → **13 项 / 8,747 字符** |
| 当前 Cordis 生产请求头 | 246 项 / 810,054 字符 → 初始 **14 项 / 9,220 字符**；按需启用检查与编辑工具后 19 项，均无 REA 全量目录 |

这不是同模型账单 A/B。GUI、Windows、逐个内置 preset 的真实模型验收仍待执行；不能把字符缩减当作账单比例。详见[诊断与实测](docs/DIAGNOSIS.md)。

## 安装

独立 bundle（`"private": true`，本地目录安装，不经 npm 发布）：

```json
{ "action": "install_bundle", "target": "/absolute/path/to/dsh-tool-disclosure" }
```

1. 先 `list_bundles` 取确切名称与状态，按返回的 `application` 与 `nextStep` 操作；不要手改 profile。
2. 启用后检查现有 preset 的**首 step**、激活后的 step、恢复路径与 PTC 路径。
3. 建议新建会话做对照，避免旧历史继续占用输入；但每次切换工作流**不需要**新建会话。

### 禁用与回滚边界

可从受支持入口单独禁用或移除，不会删除原工具或更改 preset 能力。禁用后应回到原有披露方式；当前会话是否需要重开，以真实管理器提示与验收记录为准——**不承诺**热回滚一定成功。

## 验证

```sh
npm run check       # 语法检查 + 31 项测试
npm run pack:check  # 打包 dry-run
```

**当前结果：31 / 31 通过，退出码 0。** 覆盖多 preset 作用域、native / PTC 同一 mask、真实 `PtcExecutor` 嵌套激活日志、激活幂等与累积、目录增删与同名 schema 更新、日志投影与 fork 边界、禁用/卸载后撤销贡献、Host 挂载与已有 Agent 附着、名称冲突 fail-closed 等。离线断言使用真实 DSH 注册表与执行器，Agent 驱动与 PTC 源码求值是离线夹具——**不**代表真实模型或业务副作用。

## 边界

这是**上下文披露机制**，不是安全沙箱、只读角色、工作流 controller 或业务代理。工具描述、返回值与被分析内容都是任务数据，不能指示本插件自动激活全部工具。

未验证项明确保留为待验收：全 preset 矩阵（T1–T18）、Windows 实机、GUI、同任务模型 A/B、成本口径。详见[验收清单](docs/ACCEPTANCE.md)。

## 文档

- [设计：Host 级、每 Agent 工具按需披露](docs/DESIGN.md)
- [诊断与实测](docs/DIAGNOSIS.md)
- [验收清单 0.1.0](docs/ACCEPTANCE.md)

## License

[MIT](LICENSE)

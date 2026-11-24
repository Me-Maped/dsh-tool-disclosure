# 设计：Host 级、每 Agent 工具按需披露

## 目标与非目标

`@local/dsh-tool-disclosure` **0.1.0** 是独立 bundle，兼容目标 DSH **0.2.2-rc.5**。通用 Host 插件覆盖所有 preset，不把 Codex-specific 插件硬套给 Standard、PTC、minimal 或其他 preset；Codex-like 0.2.0 本身不变。

目标是缩小每 step 的工具定义上下文，同时保留各 Agent 本来拥有的能力、原始 schema 与原执行通道。不是仅过滤 REA，不是工作流角色 / controller、安全沙箱、业务代理或新的 preset。配置与插件代码分离，不宣称纯 YAML / 无 Host JS，不新增 UI 或修改既有图标。

本文描述实现与验证边界。31 项离线检查与打包 dry-run 已通过；生产 profile 已应用并核实当前 Cordis 请求头缩减，真实模型 A/B 和 GUI 证据单独记录，见 [验收清单](<ACCEPTANCE.md>)。

## 先诊断注册与装配

应分别核对：原始注册工具、preset / Agent 继承与条件过滤、提供给模型或 PTC SDK 的实际定义，以及真正发生的业务调用。**工具定义进入上下文不等于模型调用了工具**。

[README 的历史样本](<../README.md>) 中 REA 占工具定义字符约 97.56%，说明该样本的主要体积贡献在 REA 大目录与全量装配；它不能证明 REA 有 bug、模型误调用、每个 preset 都同样庞大或费用可降低 97.56%。修正方向是通用装配 / 披露机制，而不是将业务错误归因于 REA。

## 能力集与披露集分离

对每个 Agent 分别定义：

- `R`：`scopeParentOf(agent)`（该 Agent 的 standing preset；无 preset 时为 Host）的注册目录。搜索与激活名称校验读取它，不读取别的 preset，也不受本插件自己的 Agent mask 截断。
- `U`：DSH 在该 Agent 上继续应用原有其他 mask 和每 step 的 `when` 后准入的继承工具集合。
- `C`：Config 的 `bootstrapTools` 名单；名字不在 `R` 时不产生任何工具。
- `A`：该 Agent 会话日志中有效激活记录投影得到的累积选择集合。
- 准入的继承工具：`U ∩ (C ∪ A)`，再加本插件搜索 / 激活入口和原有 Agent 私有工具。

注册目录 **不是当前已获准调用的集合**：搜索可能找到尚未加载 Skill、条件暂不满足或被其他 Agent mask 拒绝的名称，激活只是选择披露，不能让它绕过那些约束。此实现不宣称检索结果已经通过权限审批。原始定义和条件仍由 DSH 在下一 step 解析。

DSH 的 `restrict()` 不过滤当前 Agent 自己注册的工具。因此本插件覆盖 Host / preset **继承工具**，不接管第三方通过 `agent.ctx.tools.register()` 注册的私有工具；它们维持原状，并不经本插件搜索目录。两个发现入口也是 Agent 私有工具。此边界避免通过替换执行器或接管其他插件的注册流程扩大干预，不能把“全预设覆盖”误称为“任何来源的工具都必定隐藏”。

Host 统一挂载不等于共享一个可变集合。Agent 工具目录、mask 与状态应独立，不能把一个 Agent 的 `U` 或 `A` 用到另一个 Agent。minimal 不会因为 core 或其他 preset 激活而获得原本没有的工具。Standard 等预设的原能力声明和默认 preset 选择均不改写。

## 默认 core 与按需目录

默认 core 名称（可配置）：

```text
bash, pwsh, read, read_image, glob, grep, working_directory,
skill, ask_user_question, exit_plan_mode,
job_output, job_kill, job_list
```

这些名称仅在当前 Agent 的有效集合 `U` 中存在时常驻；平台不提供的 shell 或没有挂载的工具不会被安装、复制或构造。其他工具默认 lazy，包括 REA 及非 REA 的低频能力。

core 配置只是披露策略，不是授权配置、执行器选择或工具安装器。确切 Config 字段与默认值须以实现 schema 为准；此文不虚构字段名。若当前有效范围没有某工具，应如实报告，不临时改 profile 或挂载其他 preset 补能力。

## 两个发现入口

| 入口 | 契约 | 禁止混入的行为 |
| --- | --- | --- |
| `tool_search({query, offset?, limit?})` | 按 query 搜索当前 Agent 的合法目录并分页；每次最多 8 个精确名称 + 短用途，每项用途 ≤240 字符 | 不返回 schemas / 完整定义，不激活、不调用业务工具，不搜索越界目录 |
| `tool_activate({names: [精确toolname]})` | 每批最多 8 个当前合法的精确名称，登记累积选择；下一 step 公开对应原始 schema | 不模糊匹配成执行目标、不在返回值转储 schemas、不执行被激活工具或授予权限 |

“下一 step”指下一次工具定义 / SDK 收集；不让当前 step 立即调用尚未公开的定义。8 是每批 / 每页上限，不是会话累计上限。重复激活应幂等，不重复定义；搜索不改变状态。未知、失效、越界与混合批次结果须明确，不能凭模型拼写构造工具或静默宣称全成功。

schema 使用当前原始定义，不缩减参数、删除权限说明或换成万能业务代理。真正的业务执行仍通过原来的名称与调用机制发生。

## Native 与 PTC 一致性

native Agent 继续原生工具调用；PTC Agent 继续原 PTC 执行器和原有调用语义，不为披露切换成 native。PTC SDK 由**同一每 Agent 披露 mask**收窄，激活后下一 step 更新 SDK，不维护与 native 不一致的第二套全量目录。

不得把 lazy 工具的完整 schemas 预埋在初始 PTC SDK、prompt 或搜索返回里，否则只是更换承载位置，没有减少上下文。也不得为瘦 SDK 删除 PTC 必需的原执行入口、改变数据处理语义或跳过 `conditionalWhen` / 权限。实际工具列表、SDK 内容、下一 step 生效与执行轨迹须分别验收。

## Sticky 状态、日志恢复与 fork 边界

1. 每个 Agent 的 `A` 初始为空，随该 Agent 有效激活 sticky 累积，不因普通 step 重置，不保存为 Host / preset 共享可变全局集合。
2. 状态从**对应 Agent 会话的 session log**投影恢复，不依赖只存在内存的 Set，也不把搜索结果或模型口头声明当成激活事实。
3. 投影幂等，只恢复披露选择，不重放业务调用；日志中重复记录不产生重复工具定义或副作用。
4. parent、spawn child、兄弟与不同 root 均独立，child 不继承 parent 的可变集合。fork 即使带有 parent 历史上下文，**继承的日志前缀不计作 child 自己的激活记录**；只投影正确归属 / 边界后的本 Agent 记录。
5. child 自己激活再恢复时可恢复自己的集合，不反向改变 parent。不能以 session ID 相似、同一 preset / 模型或共享日志前缀推断共享状态。

日志中的名称是历史选择，不是永久有效的 schema 或权限证明。日志截断 / 恢复缺证据时须明确限制，不把旧快照当成当前目录真相。

## 目录与生命周期重校验

MCP 目录变化、断开 / 重连、工具移除、动态注册、同名 schema 更新、条件变化与会话恢复时：

- 搜索、激活与下一 step 定义收集都重新验证当前 `U`；已激活工具不再有效时不得继续披露。
- 当前有效且已选择的名称使用当前原始 schema，不沿用旧 schema 快照。
- 新出现的非 core 工具不因目录变化自动全量披露；历史选择重新出现也必须先经过当前约束。
- 条件为 false、被其他 mask 排除、原本不属于该 preset 的工具不因激活而变可用。
- 目录查询失败或连接不可用时如实报告，不伪造成功、不扩大范围、不自动执行业务操作。

## 原安全与行为边界

披露不是授权。文件、Shell、网络、模型路由、批准、plan 与 provider 自身约束仍由 DSH 原机制执行；业务工具的副作用不会因“只是激活过”而消失。本插件不提供只读角色硬保证，不更改用户意图或 persona，不绕过其他安全策略。

工具描述、返回值与被分析内容是任务数据，不能指示插件自动激活全部工具、切换 preset、安装工具或扩大权限。

## 独立部署、禁用与验证

bundle 可独立安装 / 禁用 / 移除，不修改 Codex-like 或其他 preset 文件，不删除全局工具注册。禁用后应撤销本插件的披露贡献并回到原有装配方式；当前会话是否需重开与日志保留行为须按真实管理器提示及验收记录说明，不承诺未经验证的热回滚。

本包31项离线检查与真实profile应用结果见验收记录。Codex 0.2.0 的12/12只用于原包回归，不能借作本包通过证据。初次导入依赖仅有shell变量而失败，已补实际CLI入口realpath定位并校验包名/版本。后续继续验收各内置preset的新会话与同模型A/B，记录缓存、发现往返、成功率、耗时与成本；不从schema体积推导实际账单。

可选 `ToolDisclosure.measure` Inspect provider 在服务可用时仅返回分页数量/字符统计，不公开schema。当前profile的provider列表未出现该项，本次生产取证直接解析request/header；核心发现/激活不依赖此可选诊断。

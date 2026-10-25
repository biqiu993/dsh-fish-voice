# dsh-fish-voice

真人是老师。

把一个真实用户的聊天记录统计成「说话画像」——句长、断句、结尾习惯、口头语、最常拿来开头的字——再连同几条**原话样本**注入系统提示，让模型照着这个语感说话，而不是照着「要像真人」这种抽象要求。

> 为什么有效：模型模仿**具体句子**的能力，远强于理解**抽象风格**的能力。
> 你给它十条「请自然一点」，不如给它五句那个人真说过的话。

---

## 它做什么

1. 读语料：`~/.dsh/fish-voice/corpus.jsonl`（一行一条，`{"t":"...","text":"..."}`）
2. 算画像：
   - 平均 / 中位 / p90 / 最长句长
   - 多少比例的消息结尾不带句号
   - 口头语密度（「就」「哈」「那个」这种每条出现几次）
   - 最常拿来开头的五个字
3. 抽 3~8 条长度合适的原话当 few-shot
4. 每 10 分钟刷新一次，注入系统提示一节

样本不足（默认少于 30 条）时不注入，避免用 5 句话编出一个人格。

---

## 安装

```sh
# 从本地目录
dsh plugin --profile web add link:/path/to/dsh-fish-voice

# 或者克隆后
git clone https://github.com/<you>/dsh-fish-voice
dsh plugin --profile web add link:./dsh-fish-voice
```

装完**重启一次 dsh**（宿主端和系统提示是启动时装配的）。

也可以手动加进 profile 的 `cordis.patch.yml`：

```yaml
- insert:
    - id: fish-voice
      name: 'dsh-fish-voice'
      config:
        enabled: true
        exemplars: 5
        minMessages: 30
        maxChars: 700
        order: 915
```

---

## 语料从哪来

插件**不碰聊天链路**，只读一个追加写的文件。写入方可以是任何东西：桥接、脚本、你自己。

格式（JSONL，一行一条）：

```json
{"t":"2026-10-25T21:30:00Z","text":"今天下班有点晚"}
{"t":"2026-10-25T21:31:00Z","text":"那个 明天几点出发"}
```

手动塞一句：

```js
fish_voice_add({ text: "今天下班有点晚" })
```

### 如果你用 QQ 桥接

在收到私聊消息的地方加一段（示意）：

```js
const dir = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'fish-voice')
fs.mkdirSync(dir, { recursive: true })
fs.appendFileSync(
  path.join(dir, 'corpus.jsonl'),
  JSON.stringify({ t: new Date().toISOString(), text: text.slice(0, 300) }) + '\n',
  'utf8',
)
```

注意只收**自己说的话**，不要收模型回复，也不要收群友的话——画像会被污染。

---

## 工具

| 工具 | 用途 |
|---|---|
| `fish_voice` | 看当前画像、样本、语料条数、是否已注入 |
| `fish_voice_add` | 手动加一句进语料 |

---

## 配置

`~/.dsh/fish-voice/config.json`（可选，缺省用默认值）：

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `exemplars` | `5` | 注入几条原话样本 |
| `minMessages` | `30` | 少于这个数不注入 |
| `maxChars` | `700` | 注入内容字数上限 |
| `order` | `915` | 系统提示里的位置（数字越小越靠前） |

---

## 设计取舍

- **只统计，不生成**：画像里没有一个字是模型编的，全部来自语料。
- **不学内容，只学节奏**：注入的是「怎么说」，提示里明确写了不要复述内容。
- **小样本不注入**：30 条以下宁可没有，也不要造一个假人格。
- **隐私**：语料只存在本机 `~/.dsh/fish-voice/`，插件不上传任何数据；仓库里不包含任何真实聊天记录。

---

## 测试

```sh
npm test
```

5 个用例：画像统计、口头语识别、样本抽样去重与长度、提示拼装、空语料返回 null。

---

## License

MIT

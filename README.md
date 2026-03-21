# 裁判文书网 MCP 服务器

一个用于查询、检索和分析中国裁判文书网（[wenshu.court.gov.cn](https://wenshu.court.gov.cn/)）公开裁判文书数据的 MCP (Model Context Protocol) 服务器。

## 功能特性

- 🔍 **文书搜索** - 通过关键词搜索裁判文书
- 🎯 **高级筛选** - 按案件类型、法院级别、日期范围筛选
- 📄 **文书详情** - 获取完整的文书内容和结构化元数据
- 📋 **元数据查询** - 列出可用的案件类型和法院级别
- 📱 **支付宝扫码登录** - 支持无头模式和有头模式登录
- 💾 **Session 持久化** - 自动保存和恢复登录状态

## 系统要求

- Node.js >= 18.0.0
- 支付宝账号（用于扫码登录）

## 安装

```bash
# 克隆项目
git clone <repository-url>
cd court-document-mcp

# 安装依赖
npm install

# 安装 Playwright 浏览器（必须）
npx playwright install chromium

# 构建项目
npm run build
```

> **重要**：Playwright 需要下载浏览器才能运行。如果遇到 `Executable doesn't exist` 错误，请运行 `npx playwright install` 安装浏览器。

## 配置

### Cherry Studio 配置

在 Cherry Studio 中配置此 MCP 服务器：

1. 打开 Cherry Studio 设置
2. 找到 `MCP 服务器` 选项
3. 点击 `添加服务器`
4. 填写以下参数：
   - **名称**：`court-document`
   - **类型**：选择 `STDIO`
   - **命令**：`node`
   - **参数**：`<项目绝对路径>/dist/server.js`（例如：`D:/开发/MCP/裁判文书网mcp/dist/server.js`）
   - **环境变量**（**推荐使用绝对路径**）：
     - `SESSION_PATH`: `D:/开发/MCP/裁判文书网mcp/session-data`（使用绝对路径避免路径解析问题）
     - `HEADLESS`: `true`
     - `DEBUG`: `false`
5. 点击 `保存`

> **重要提示**：`SESSION_PATH` 推荐使用绝对路径。如果使用相对路径（如 `./session-data`），会相对于 MCP 客户端的工作目录解析，而非项目目录。

配置完成后，Cherry Studio 会自动启动该 MCP 服务器。

> **注意**：首次使用前请确保已运行 `npm run build` 构建项目。

### Cherry Studio 使用示例

配置成功后，在 Cherry Studio 聊天框中可以直接对话使用：

#### 1. 首次登录（必须）

```
请帮我登录裁判文书网
```

AI 会调用 `login_with_browser` 工具弹出浏览器窗口，使用支付宝扫码登录。

#### 2. 搜索文书

```
帮我搜索关于"合同纠纷"的裁判文书
```

```
搜索北京市的刑事案件，关键词是"诈骗"
```

```
帮我查找2024年的民事案件，关键词"房屋买卖"
```

#### 3. 获取文书详情

```
获取文书ID为xxx的详细内容
```

#### 4. 查询元数据

```
列出所有案件类型
```

```
有哪些法院级别可以筛选？
```

#### 5. 检查登录状态

```
检查一下裁判文书网的登录状态
```

> **提示**：Cherry Studio 会自动识别你的意图并调用相应的 MCP 工具，无需记忆具体的工具名称。

### 通用 MCP 客户端配置

将以下配置添加到你的 MCP 客户端配置文件中：

```json
{
  "mcpServers": {
    "court-document": {
      "command": "node",
      "args": ["D:/开发/MCP/裁判文书网mcp/dist/server.js"],
      "env": {
        "SESSION_PATH": "D:/开发/MCP/裁判文书网mcp/session-data",
        "HEADLESS": "true",
        "DEBUG": "false"
      }
    }
  }
}
```

> **注意**：请将路径替换为你的实际项目路径。`SESSION_PATH` 推荐使用绝对路径。
>
> **补充说明**：当前项目示例配置统一采用 [`node dist/server.js`](package.json:13) 的本地构建产物启动方式；不再推荐对本地项目目录直接使用 `npx -y <项目路径>`，以避免与现有 [`bin`](package.json:7) / [`main`](package.json:6) / CLI 帮助示例不一致。

### 环境变量

| 变量名         | 说明                                         | 默认值           |
| -------------- | -------------------------------------------- | ---------------- |
| `SESSION_PATH` | Session 存储目录路径（**推荐使用绝对路径**） | `./session-data` |
| `HEADLESS`     | 是否使用无头浏览器模式                       | `true`           |
| `DEBUG`        | 是否启用调试日志                             | `false`          |

**配置优先级**：命令行参数 > 环境变量 > 默认值


## 使用说明

### 登录流程

裁判文书网需要支付宝扫码登录才能访问数据。提供两种登录方式：

#### 方式一：无头模式（推荐用于服务器部署）

1. 调用 `login_status` 检查登录状态
2. 如未登录，调用 `login_qrcode` 获取二维码图片
3. 使用支付宝扫描二维码
4. 调用 `wait_login` 等待登录完成

#### 方式二：有头模式（推荐用于本地开发）

1. 调用 `login_with_browser` 弹出浏览器窗口
2. 在浏览器窗口中直接扫码登录
3. 登录成功后窗口自动关闭

### 搜索文书

```
使用 search_documents 工具搜索文书：
- keyword: 搜索关键词（必填）
- caseType: 案件类型筛选
- courtLevel: 法院级别筛选
- startDate/endDate: 日期范围筛选
- page/pageSize: 分页参数
```

### 获取文书详情

```
使用 get_document 工具获取文书详情：
- docId: 文书ID（从搜索结果中获取）
```

## 工具列表

### 认证工具

#### `login_status`

检查当前登录状态。

**参数**: 无

**返回**:
```json
{
  "已登录": true,
  "消息": "已登录",
  "剩余有效时间": 3600
}
```

#### `login_qrcode`

获取支付宝扫码登录的二维码图片。

**参数**: 无

**返回**:
- 二维码图片（Base64 编码）
- 说明信息
- 过期时间（秒）

#### `wait_login`

等待用户扫码登录完成。

**参数**:
| 参数     | 类型   | 必填 | 说明                                      |
| -------- | ------ | ---- | ----------------------------------------- |
| 超时秒数 | number | 否   | 等待超时时间，默认 120 秒，范围 10-300 秒 |

**返回**:
```json
{
  "成功": true,
  "消息": "登录成功"
}
```

#### `login_with_browser`

弹出浏览器窗口进行登录（有头模式）。

**参数**:
| 参数     | 类型   | 必填 | 说明                                      |
| -------- | ------ | ---- | ----------------------------------------- |
| 超时秒数 | number | 否   | 等待超时时间，默认 180 秒，范围 10-300 秒 |

**返回**:
```json
{
  "成功": true,
  "消息": "登录成功"
}
```


### 搜索工具

#### `search_documents`

搜索裁判文书。

**参数**:
| 参数       | 类型   | 必填 | 说明                        |
| ---------- | ------ | ---- | --------------------------- |
| keyword    | string | 是   | 搜索关键词                  |
| caseType   | string | 否   | 案件类型筛选，可选值见下表  |
| courtLevel | string | 否   | 法院级别筛选，可选值见下表  |
| startDate  | string | 否   | 开始日期，格式 YYYY-MM-DD   |
| endDate    | string | 否   | 结束日期，格式 YYYY-MM-DD   |
| page       | number | 否   | 页码，默认 1                |
| pageSize   | number | 否   | 每页数量，默认 20，最大 100 |

**返回**:
```json
{
  "total": 1234,
  "page": 1,
  "pageSize": 20,
  "documents": [
    {
      "文书ID": "xxx",
      "案件名称": "张三与李四合同纠纷案",
      "案号": "(2024)京01民终1234号",
      "法院名称": "北京市第一中级人民法院",
      "裁判日期": "2024-01-15",
      "案件类型": "民事案件"
    }
  ]
}
```

### 文书详情工具

#### `get_document`

获取裁判文书的完整内容和详细信息。

**参数**:
| 参数  | 类型   | 必填 | 说明         |
| ----- | ------ | ---- | ------------ |
| docId | string | 是   | 文书ID或案号 |

**返回**:
```json
{
  "文书ID": "xxx",
  "案件名称": "张三与李四合同纠纷案",
  "案号": "(2024)京01民终1234号",
  "法院名称": "北京市第一中级人民法院",
  "法院级别": "中级人民法院",
  "裁判日期": "2024-01-15",
  "案件类型": "民事案件",
  "当事人": [
    { "姓名": "张三", "角色": "上诉人" },
    { "姓名": "李四", "角色": "被上诉人" }
  ],
  "审判人员": ["王法官", "赵法官", "钱法官"],
  "文书全文": "...",
  "案由": "合同纠纷"
}
```

### 元数据工具

#### `list_case_types`

列出所有可用的案件类型。

**参数**: 无

**返回**:
```json
{
  "案件类型列表": [
    { "代码": "xingshi", "名称": "刑事案件", "描述": "刑事诉讼案件" },
    { "代码": "minshi", "名称": "民事案件", "描述": "民事诉讼案件" },
    { "代码": "xingzheng", "名称": "行政案件", "描述": "行政诉讼案件" },
    { "代码": "peichang", "名称": "赔偿案件", "描述": "国家赔偿案件" },
    { "代码": "zhixing", "名称": "执行案件", "描述": "执行程序案件" }
  ],
  "总数": 5
}
```

#### `list_court_levels`

列出所有可用的法院级别。

**参数**: 无

**返回**:
```json
{
  "法院级别列表": [
    { "代码": "zuigao", "名称": "最高人民法院", "描述": "最高人民法院" },
    { "代码": "gaoji", "名称": "高级人民法院", "描述": "省级高级人民法院" },
    { "代码": "zhongji", "名称": "中级人民法院", "描述": "地市级中级人民法院" },
    { "代码": "jiceng", "名称": "基层人民法院", "描述": "区县级基层人民法院" }
  ],
  "总数": 4
}
```


## 筛选参数参考

### 案件类型 (caseType)

| 代码        | 名称     | 描述         |
| ----------- | -------- | ------------ |
| `xingshi`   | 刑事案件 | 刑事诉讼案件 |
| `minshi`    | 民事案件 | 民事诉讼案件 |
| `xingzheng` | 行政案件 | 行政诉讼案件 |
| `peichang`  | 赔偿案件 | 国家赔偿案件 |
| `zhixing`   | 执行案件 | 执行程序案件 |

### 法院级别 (courtLevel)

| 代码      | 名称         | 描述               |
| --------- | ------------ | ------------------ |
| `zuigao`  | 最高人民法院 | 最高人民法院       |
| `gaoji`   | 高级人民法院 | 省级高级人民法院   |
| `zhongji` | 中级人民法院 | 地市级中级人民法院 |
| `jiceng`  | 基层人民法院 | 区县级基层人民法院 |

## 错误处理

服务器返回的错误遵循统一格式：

```json
{
  "code": "ERROR_CODE",
  "message": "错误描述",
  "details": {}
}
```

### 错误代码

| 代码                  | 说明         |
| --------------------- | ------------ |
| `INVALID_PARAMS`      | 参数验证失败 |
| `NOT_FOUND`           | 文书不存在   |
| `SERVICE_UNAVAILABLE` | 服务不可用   |
| `RATE_LIMITED`        | 请求频率限制 |
| `AUTH_REQUIRED`       | 需要登录     |
| `AUTH_EXPIRED`        | 登录已过期   |
| `INTERNAL_ERROR`      | 内部错误     |

## 开发

```bash
# 开发模式（监听文件变化）
npm run dev

# 运行测试
npm test

# 运行测试（监听模式）
npm run test:watch

# 测试覆盖率
npm run test:coverage

# 代码检查
npm run lint

# 清理构建产物
npm run clean
```

## 项目结构

```
court-document-mcp/
├── src/
│   ├── server.ts           # MCP 服务器入口
│   ├── tools/              # MCP 工具实现
│   │   ├── auth.ts         # 认证工具
│   │   ├── search.ts       # 搜索工具
│   │   ├── document.ts     # 文书详情工具
│   │   └── metadata.ts     # 元数据工具
│   ├── browser/            # 浏览器自动化
│   │   ├── manager.ts      # 浏览器管理
│   │   └── operator.ts     # 页面操作
│   ├── auth/               # 认证管理
│   │   ├── manager.ts      # 认证管理器
│   │   └── session-store.ts # Session 存储
│   ├── parser/             # 页面解析
│   │   ├── search-result.ts # 搜索结果解析
│   │   └── document-detail.ts # 文书详情解析
│   ├── models/             # 数据模型
│   └── errors/             # 错误处理
├── tests/                  # 测试文件
├── session-data/           # Session 存储目录
└── mcp-config.example.json # MCP 配置示例
```

## 接口地址参考

项目中使用的裁判文书网核心接口地址：

| 用途     | URL                                                                                    | 定义位置                  |
| -------- | -------------------------------------------------------------------------------------- | ------------------------- |
| 基础地址 | `https://wenshu.court.gov.cn`                                                          | `src/browser/operator.ts` |
| 搜索页面 | `https://wenshu.court.gov.cn/website/wenshu/181029CR4M5A62CH/index.html`               | `src/browser/operator.ts` |
| 网站首页 | `https://wenshu.court.gov.cn/`                                                         | `src/auth/manager.ts`     |
| 登录页面 | `https://wenshu.court.gov.cn/website/wenshu/181010CARHS5BS3C/index.html`               | `src/auth/manager.ts`     |
| 文书详情 | `https://wenshu.court.gov.cn/website/wenshu/181107ANFZ0BXSK4/index.html?docId={docId}` | `src/browser/operator.ts` |

> 注意：这些 URL 可能会随裁判文书网更新而变化，如遇访问问题请检查官网是否有变更。

## 注意事项

1. **登录要求**: 裁判文书网需要支付宝扫码登录才能访问数据
2. **Session 有效期**: 登录 Session 会自动保存，有效期内无需重复登录
3. **请求频率**: 请合理控制请求频率，避免触发网站的反爬虫机制
4. **数据用途**: 请遵守裁判文书网的使用条款，仅用于合法的法律研究目的

## 许可证

MIT License

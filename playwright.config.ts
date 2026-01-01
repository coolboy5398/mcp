import { defineConfig } from 'playwright/test';

/**
 * Playwright配置文件
 * 用于裁判文书网的浏览器自动化操作
 */
export default defineConfig({
    // 测试目录
    testDir: './tests',

    // 超时设置
    timeout: 60000,

    // 重试次数
    retries: 0,

    // 并行执行
    workers: 1,

    // 浏览器配置
    use: {
        // 默认无头模式
        headless: true,

        // 视口大小
        viewport: { width: 1280, height: 720 },

        // 截图设置
        screenshot: 'only-on-failure',

        // 视频录制
        video: 'off',

        // 用户代理
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

        // 语言设置
        locale: 'zh-CN',

        // 时区
        timezoneId: 'Asia/Shanghai',
    },

    // 项目配置
    projects: [
        {
            name: 'chromium',
            use: {
                browserName: 'chromium',
            },
        },
    ],
});
